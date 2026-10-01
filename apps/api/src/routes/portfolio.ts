import Router from '@koa/router';
import type { Context, Next } from 'koa';
import PortfolioHelper, { type LearnerContext, type PortfolioWorkRow } from '../dal/portfolio_helper';
import StorageHelper from '../dal/storage_helper';
import { bearerTokenOf, identityOf, type CampusIdentity } from '../lib/portfolio_identity';
import { imagePathsOf, signedImagePath, verifyImageSignature } from '../lib/portfolio_image';
import { parentLinks } from '../lib/parent_links';

/**
 * 數位作品集專用資料介面 —— `/service/portfolio/v1/*`。**全部唯讀。**
 *
 * 數位作品集是另一個獨立平台（同校佳作觀摩、家長功能）。它的使用者用 1Campus 登入，
 * 帶著自己的 access token 呼叫這裡（Authorization: Bearer）。誰能看什麼由這個系統決定：
 *
 *   學生   自己已發還的作品（含評語、級分、公開意願）
 *          同校觀摩：佳作 ＋ 學生願意公開 ＋ 同校。級分依班級設定，評語不給
 *   家長   子女已發還的作品 —— **預留**，等 1Campus 家長身分的文件（lib/parent_links.ts）
 *
 * 家長的「同意公開」存在作品集那邊，同校觀摩清單由作品集再用它篩一次。
 * 原稿照片給的是 15 分鐘有效的簽章網址（lib/portfolio_image.ts），可以直接放進 <img>。
 *
 * 完整說明給作品集的工程師：docs/portfolio-api.md
 */

const router = new Router({ prefix: '/portfolio/v1' });

// ─────────────────────────────────────────────
// 轉成回傳格式
// ─────────────────────────────────────────────

/** submission_feedback.content → 評語本文（markdown）。形狀與前端 lib/feedbackText.ts 相同 */
function feedbackTextOf(raw: unknown): string {
    if (raw == null) return '';
    let v: unknown = raw;
    if (typeof raw === 'string') {
        try { v = JSON.parse(raw); } catch { return raw; }
    }
    if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        if (typeof o.response === 'string') return o.response;
        if (typeof o.feedback === 'string') return o.feedback;
    }
    return typeof raw === 'string' ? raw : '';
}

const imagesOf = (r: PortfolioWorkRow) =>
    imagePathsOf(r.assignment_id, r.pic_files, r.batch_files).map((_, i) => signedImagePath(r.submission_id, i));

const base = (r: PortfolioWorkRow) => ({
    id: r.submission_id,
    title: r.title ?? '',
    school: { id: r.school_id, name: r.school_name ?? '' },
    class_name: r.class_name ?? '',
    semester: `${r.school_year}-${r.semester}`,
    student_name: r.student_name ?? '',
    submitted_at: r.submitted_at,
    word_count: r.word_count,
});

/** 自己（或家長看子女）的作品：什麼都給 */
const ownWork = (r: PortfolioWorkRow) => ({
    ...base(r),
    seat_no: r.seat_no,
    score: r.score == null ? null : Number(r.score),
    feedback: feedbackTextOf(r.feedback_raw),
    content: r.content ?? '',
    images: imagesOf(r),
    featured: r.featured,
    publish_consent: r.publish_consent,
});

/**
 * 同校觀摩：不給座號、評語、公開意願（一定是 true）。
 * 級分只在班級設定「顯示」時給（migration 008，預設不顯示）。
 */
const showcaseSummary = (r: PortfolioWorkRow) => ({
    ...base(r),
    score: r.show_score && r.score != null ? Number(r.score) : null,
    image_count: imagePathsOf(r.assignment_id, r.pic_files, r.batch_files).length,
    excerpt: (r.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
});
const showcaseDetail = (r: PortfolioWorkRow) => ({
    ...showcaseSummary(r),
    content: r.content ?? '',
    images: imagesOf(r),
});

// ─────────────────────────────────────────────
// 原稿照片（簽章網址，不需要 Authorization）
// ─────────────────────────────────────────────

/**
 * @route GET /service/portfolio/v1/images/:submissionId/:index?exp=&sig=
 *
 * 放在驗證 middleware **之前** —— <img> 送不出標頭，權限靠簽章（簽發時檢查過）。
 * 簽章錯誤或過期一律 403；找不到圖 404。
 */
router.get('/images/:submissionId/:index', async (ctx) => {
    const { submissionId, index } = ctx.params;
    const i = Number(index);
    const { exp, sig } = ctx.query as { exp?: string; sig?: string };
    if (!/^\d+$/.test(submissionId) || !Number.isInteger(i) || i < 0
        || !verifyImageSignature(submissionId, i, exp, sig)) {
        ctx.status = 403; ctx.body = { error: 'invalid_or_expired_link' }; return;
    }
    try {
        const src = await PortfolioHelper.imageSourceOf(submissionId);
        const path = src ? imagePathsOf(src.assignment_id, src.pic_files, src.batch_files)[i] : undefined;
        const image = path ? await StorageHelper.openImage(path) : null;
        if (!image) { ctx.status = 404; ctx.body = { error: 'not_found' }; return; }
        ctx.type = image.contentType;
        // 網址本身 15 分鐘就失效，瀏覽器快取也不要比它久
        ctx.set('Cache-Control', 'private, max-age=600');
        ctx.set('X-Content-Type-Options', 'nosniff');
        ctx.body = image.body;
    } catch (error) {
        console.error('Error streaming portfolio image:', error);
        ctx.status = 500; ctx.body = { error: 'internal_error' };
    }
});

// ─────────────────────────────────────────────
// 驗證：1Campus access token
// ─────────────────────────────────────────────

interface PortfolioState {
    campus: CampusIdentity;
    token: string;
    learner: LearnerContext | null;
}
const stateOf = (ctx: Context) => ctx.state.portfolio as PortfolioState;

router.use(async (ctx: Context, next: Next) => {
    const token = bearerTokenOf(ctx.get('Authorization'));
    if (!token) { ctx.status = 401; ctx.body = { error: 'missing_token' }; return; }
    let campus: CampusIdentity | null;
    try {
        campus = await identityOf(token);
    } catch (error) {
        // 連不上 1Campus 不是「token 無效」，不要讓作品集以為使用者被登出
        console.error('1Campus userinfo unreachable:', error);
        ctx.status = 502; ctx.body = { error: 'identity_provider_unavailable' }; return;
    }
    if (!campus) { ctx.status = 401; ctx.body = { error: 'invalid_token' }; return; }
    const learner = await PortfolioHelper.learnerContext(campus.mail);
    ctx.state.portfolio = { campus, token, learner } satisfies PortfolioState;
    await next();
});

/** 學生才能用的端點。不是學生 → 403 */
const requireLearner = async (ctx: Context, next: Next) => {
    if (!stateOf(ctx).learner) { ctx.status = 403; ctx.body = { error: 'not_a_student' }; return; }
    await next();
};

// ─────────────────────────────────────────────
// 端點
// ─────────────────────────────────────────────

/**
 * @route GET /service/portfolio/v1/me
 * 這個人是誰、是不是學生、在哪些學校；家長功能接上了沒有。
 */
router.get('/me', async (ctx) => {
    const { campus, learner } = stateOf(ctx);
    ctx.body = {
        account: campus.mail,
        name: learner?.name ?? campus.name,
        roles: learner ? ['student'] : [],
        schools: learner?.schools ?? [],
        parent_links_available: parentLinks().available,
    };
});

/**
 * @route GET /service/portfolio/v1/me/works
 * 自己所有已發還的作品，依學期由舊到新。
 */
router.get('/me/works', requireLearner, async (ctx) => {
    try {
        const rows = await PortfolioHelper.worksOf(stateOf(ctx).learner!.user_id);
        ctx.body = rows.map(ownWork);
    } catch (error) {
        console.error('Error fetching portfolio works:', error);
        ctx.status = 500; ctx.body = { error: 'internal_error' };
    }
});

const SEMESTER = /^(\d{2,3})-([12])$/;

/**
 * @route GET /service/portfolio/v1/showcase?semester=114-2&school_id=12
 * 同校觀摩：觀看者所屬學校裡，蓋了佳作章、學生願意公開的已發還作品。
 * school_id 選填，必須是觀看者自己的學校（否則 403）；semester 選填。
 * 家長同意由作品集再篩。
 */
router.get('/showcase', requireLearner, async (ctx) => {
    const { semester, school_id } = ctx.query as { semester?: string; school_id?: string };
    const mine = stateOf(ctx).learner!.schools.map((s) => s.id);
    if (school_id !== undefined && !mine.includes(String(school_id))) {
        ctx.status = 403; ctx.body = { error: 'not_your_school' }; return;
    }
    let sem: { year: number; term: number } | undefined;
    if (semester !== undefined) {
        const m = SEMESTER.exec(String(semester));
        if (!m) { ctx.status = 400; ctx.body = { error: 'invalid_semester' }; return; }
        sem = { year: Number(m[1]), term: Number(m[2]) };
    }
    try {
        const rows = await PortfolioHelper.showcase(school_id ? [String(school_id)] : mine, sem);
        ctx.body = rows.map(showcaseSummary);
    } catch (error) {
        console.error('Error fetching showcase:', error);
        ctx.status = 500; ctx.body = { error: 'internal_error' };
    }
});

/**
 * @route GET /service/portfolio/v1/works/:submissionId
 * 一篇作品。自己的 → 完整資料；同校觀摩裡的 → 觀摩版（沒有評語，級分依設定）。
 * 其餘一律 404（不區分「沒有這篇」與「你不能看」）。
 */
router.get('/works/:submissionId', requireLearner, async (ctx) => {
    const { submissionId } = ctx.params;
    if (!/^\d+$/.test(submissionId)) { ctx.status = 404; ctx.body = { error: 'not_found' }; return; }
    const learner = stateOf(ctx).learner!;
    try {
        const row = await PortfolioHelper.viewableWork(
            submissionId, learner.user_id, learner.schools.map((s) => s.id),
        );
        if (!row) { ctx.status = 404; ctx.body = { error: 'not_found' }; return; }
        ctx.body = row.student_id === learner.user_id ? ownWork(row) : showcaseDetail(row);
    } catch (error) {
        console.error('Error fetching portfolio work:', error);
        ctx.status = 500; ctx.body = { error: 'internal_error' };
    }
});

/**
 * @route GET /service/portfolio/v1/children
 * @route GET /service/portfolio/v1/children/:account/works
 * 家長：子女清單、子女已發還的作品。
 *
 * **預留。** 1Campus 家長身分的接法還沒有文件（lib/parent_links.ts），
 * 沒接上之前一律 501，作品集看到 501 就知道「功能還沒開」而不是「沒有子女」。
 */
const requireParentLinks = async (ctx: Context, next: Next) => {
    if (!parentLinks().available) {
        ctx.status = 501; ctx.body = { error: 'parent_links_not_available' }; return;
    }
    await next();
};

router.get('/children', requireParentLinks, async (ctx) => {
    const { campus, token } = stateOf(ctx);
    const accounts = await parentLinks().childrenOf(campus, token);
    const children = [];
    for (const account of accounts) {
        const c = await PortfolioHelper.learnerContext(account);
        if (c) children.push({ account, name: c.name, schools: c.schools });
    }
    ctx.body = children;
});

router.get('/children/:account/works', requireParentLinks, async (ctx) => {
    const { campus, token } = stateOf(ctx);
    const { account } = ctx.params;
    const accounts = await parentLinks().childrenOf(campus, token);
    if (!accounts.includes(account)) { ctx.status = 404; ctx.body = { error: 'not_found' }; return; }
    const child = await PortfolioHelper.learnerContext(account);
    if (!child) { ctx.status = 404; ctx.body = { error: 'not_found' }; return; }
    ctx.body = (await PortfolioHelper.worksOf(child.user_id)).map(ownWork);
});

export default router;
