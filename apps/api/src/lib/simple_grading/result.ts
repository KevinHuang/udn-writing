import { normalizeSubScores, type SubScores } from '../grading_result';
import { findTrustedSpan, flaggedPositions, type EssayIndex, type TypoMark } from './essay';

/**
 * 讀回簡易批改的結果（搬自 1Campus Write 的 functions/lib/simpleGradingResult.js，會考那一版）：
 *   1. findSimpleGradingProblems：級分、總評、四向度這些硬規則；有問題就重批一次（grade.ts）
 *   2. buildSimpleGradingOutcome：引用、成語逐格檢查 —— 對不上只拿掉、不重批；
 *      組出學生看得到的評語（submission_feedback.content.response）與只給老師看的細節（simple_grading_result）
 * 純函式，不碰資料庫與網路。
 */

export interface SimpleCard {
    type: '亮點' | '密圈' | '建議';
    title: string;
    comment: string;
    quote: string;
    /** 引用每個字所在的格子（第三階段在原稿上畫線用；退回模式是空陣列） */
    quoteKeys: string[];
}

export interface SimpleGradingDetail {
    promptVersion: number;
    /** 不足 100 字，沒有送 AI */
    systemZero: boolean;
    /** 評分依據：只給老師看 */
    scoreBasis: string;
    /** 判 0 級分的原因：只給老師看 */
    zeroReason: string;
    cards: SimpleCard[];
    idioms: { items: string[]; comment: string; spans: Array<{ item: string; keys: string[] }> };
    /** 請老師留意：只給老師看，學生端任何地方都不能出現 */
    teacherAlert: { needed: boolean; reason: string; paragraph: number | null };
    /** 系統做了什麼：重批過、拿掉了哪些引用。給老師看 */
    checks: string[];
    /** 批改當下的錯字狀態（lib/manuscript/marks.ts markBaseline）；原稿紅筆比對要不要提醒重新評分 */
    baseline?: unknown;
}

export interface SimpleGradingOutcome {
    score: number;
    /** 學生看得到的評語（markdown），存進 submission_feedback.content.response，老師可以改 */
    response: string;
    subScores: SubScores | null;
    detail: SimpleGradingDetail;
}

const CARD_TYPES = ['亮點', '密圈', '建議'] as const;
/** 一定要有引用的卡片：沒有可以用的引用就整張不出 */
const QUOTE_REQUIRED = new Set(['密圈']);
const MAX_IDIOMS = 5;

const QUOTE_PROBLEMS = {
    notFound: '和辨識全文對不上',
    untrusted: '裡有辨識不確定的字',
    typo: '身上有錯字標記',
} as const;

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const toNumber = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v);

/** 依規則檢查 AI 的回傳；回傳問題清單（空陣列＝通過） */
export function findSimpleGradingProblems(details: unknown): string[] {
    if (!details || typeof details !== 'object' || Array.isArray(details)) return ['AI 沒有回傳 JSON 格式的批改結果'];
    const d = details as Record<string, unknown>;
    const score = toNumber(d.score);
    const problems: string[] = [];
    if (!(typeof score === 'number' && Number.isInteger(score) && score >= 0 && score <= 6)) {
        return ['級分不是 0～6 的整數'];
    }
    if (!text(d.response)) problems.push('沒有總評');
    if (score > 0 && normalizeSubScores(d.sub_scores, score) === null) problems.push('四向度不完整');
    return problems;
}

const cleanQuote = (v: unknown) => {
    const q = text(v);
    // AI 偶爾自己加上「」：裡面那段逐字相同就照收
    return q.startsWith('「') && q.endsWith('」') ? q.slice(1, -1).trim() : q;
};

function sanitizeCards(raw: unknown, index: EssayIndex, flagged: Set<string>, checks: string[]): SimpleCard[] {
    const cards: SimpleCard[] = [];
    (Array.isArray(raw) ? raw : []).forEach((c, order) => {
        const type = text(c?.type) as SimpleCard['type'];
        if (!CARD_TYPES.includes(type)) {
            checks.push(`第 ${order + 1} 張卡片的類型「${type || '（空白）'}」不認得，已略過`);
            return;
        }
        const title = text(c?.title);
        let quote = cleanQuote(c?.quote);
        let quoteKeys: string[] = [];
        if (quote) {
            const found = findTrustedSpan(index, quote, flagged);
            if (found.ok) {
                quoteKeys = found.keys;
            } else {
                checks.push(`${type}「${title}」的引用${QUOTE_PROBLEMS[found.reason]}，已拿掉引用：${quote}`);
                quote = '';
            }
        }
        if (!quote && QUOTE_REQUIRED.has(type)) {
            checks.push(`${type}「${title}」沒有可以用的引用，整張不顯示`);
            return;
        }
        cards.push({ type, title, comment: text(c?.comment), quote, quoteKeys });
    });
    return cards;
}

function sanitizeIdioms(raw: unknown, index: EssayIndex, flagged: Set<string>, checks: string[]) {
    const r = (raw ?? {}) as { items?: unknown; comment?: unknown };
    const items: string[] = [];
    const spans: Array<{ item: string; keys: string[] }> = [];
    for (const item of (Array.isArray(r.items) ? r.items : []).map(text).filter(Boolean)) {
        if (items.length >= MAX_IDIOMS || items.includes(item)) continue;
        const found = findTrustedSpan(index, item, flagged);
        if (found.ok) {
            items.push(item);
            spans.push({ item, keys: found.keys });
        } else {
            checks.push(`成語「${item}」${QUOTE_PROBLEMS[found.reason]}，不列入`);
        }
    }
    return { items, comment: items.length > 0 ? text(r.comment) : '', spans };
}

function sanitizeTeacherAlert(raw: unknown): SimpleGradingDetail['teacherAlert'] {
    const r = (raw ?? {}) as { needed?: unknown; reason?: unknown; paragraph?: unknown };
    const paragraph = toNumber(r.paragraph);
    return {
        needed: r.needed === true || r.needed === 'true',
        reason: text(r.reason),
        paragraph: typeof paragraph === 'number' && Number.isInteger(paragraph) && paragraph > 0 ? paragraph : null,
    };
}

/**
 * 學生看得到的評語：總評在前，再接卡片與成語鼓勵。
 *
 * 為什麼卡片要併進評語，而不是另外顯示：這個系統的評語只有**一個**欄位（老師改評語＝存一版新的，
 * 見 GradingEditor），學生端也只讀這一欄。卡片另外放，老師改不到、學生也看不到。
 * 結構化的卡片照樣存在 simple_grading_result，第三階段在原稿上畫線時用。
 */
export function composeStudentResponse(overall: string, cards: SimpleCard[], idioms: SimpleGradingDetail['idioms']): string {
    const line = (c: SimpleCard) => {
        const head = c.title ? `**${c.title}**：` : '';
        return `- ${head}${c.quote ? `「${c.quote}」` : ''}${c.comment}`;
    };
    const section = (heading: string, list: SimpleCard[]) =>
        list.length > 0 ? [`### ${heading}`, ...list.map(line)].join('\n') : '';
    return [
        overall,
        section('文章亮點', cards.filter((c) => c.type === '亮點')),
        section('精彩詞語', cards.filter((c) => c.type === '密圈')),
        section('再上層樓', cards.filter((c) => c.type === '建議')),
        idioms.items.length > 0
            ? `### 成語運用\n你用了${idioms.items.map((i) => `「${i}」`).join('')}，${idioms.comment}`
            : '',
    ].filter(Boolean).join('\n\n');
}

/**
 * 通過驗證的結果 → 學生看得到的評語＋只給老師看的細節。
 * typoMarks 是卡片引用、成語要避開的錯字 —— **包括待確認的**：同一個詞不能又被說寫錯、又被稱讚。
 */
export function buildSimpleGradingOutcome(params: {
    details: Record<string, unknown>;
    index: EssayIndex;
    typoMarks: TypoMark[];
    promptVersion: number;
    retryProblems?: string[];
}): SimpleGradingOutcome {
    const { details, index, typoMarks, promptVersion, retryProblems = [] } = params;
    const checks: string[] = [];
    if (retryProblems.length > 0) {
        checks.push(`第一次的批改結果不符合規則（${retryProblems.join('；')}），已自動重批一次`);
    }
    const score = Number(toNumber(details.score));
    const flagged = flaggedPositions(index, typoMarks);
    const zero = score === 0;
    const cards = zero ? [] : sanitizeCards(details.cards, index, flagged, checks);
    const idioms = zero ? { items: [], comment: '', spans: [] } : sanitizeIdioms(details.idioms, index, flagged, checks);
    return {
        score,
        response: composeStudentResponse(text(details.response), cards, idioms),
        subScores: normalizeSubScores(details.sub_scores, score),
        detail: {
            promptVersion,
            systemZero: false,
            scoreBasis: text(details.score_basis),
            zeroReason: text(details.zero_reason),
            cards,
            idioms,
            teacherAlert: sanitizeTeacherAlert(details.teacher_alert),
            checks,
        },
    };
}

/** 不足 100 字：沒有送 AI，直接建議 0 級分 */
export function buildSystemZeroOutcome(reason: string, feedback: string, promptVersion: number): SimpleGradingOutcome {
    return {
        score: 0,
        response: feedback,
        subScores: normalizeSubScores(null, 0),
        detail: {
            promptVersion,
            systemZero: true,
            scoreBasis: '',
            zeroReason: reason,
            cards: [],
            idioms: { items: [], comment: '', spans: [] },
            teacherAlert: { needed: false, reason: '', paragraph: null },
            checks: ['這篇字數不足，沒有送 AI，也沒有檢查作文裡有沒有需要留意的狀況，請老師親自看過。'],
        },
    };
}
