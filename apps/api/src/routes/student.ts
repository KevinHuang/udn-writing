import Router from '@koa/router';
import { Context } from 'koa';
import config from '../config';
import { randomBytes } from 'crypto';
import { OAuthMiddleware } from '../middleware/oauth';
import UserHelper from '../dal/user_helper';
import { db } from '../dal/database';
import Util from '../util/util';
import AssignmentHelper from '../dal/assignment_helper';
import SubmissionHelper from '../dal/submission_helper';
import SubmissionFeedbackHelper from '../dal/submission_feedback_helper';
import PublishConsentHelper from '../dal/publish_consent_helper';


const router = new Router({ prefix: '/student' });
router.use(OAuthMiddleware.requireLogin);
router.use(OAuthMiddleware.isLearner);

/**
 * 取得使用者在本學期的所有被指派作業清單
 * 包含作業資訊，繳交狀態，以及批改狀態
 */
router.get('/my_assignments', async (ctx: Context) => {
    try {
        const assignments = await AssignmentHelper.getAssignments(ctx.session.userInfo.id);
        Util.returnMsg(ctx, 200, assignments);
    }
    catch (error) {
        console.log({ error })
        Util.returnError(ctx, 500, 'Failed to get assignments for current user.');
    }
});

router.get('/submission', async (ctx: Context) => {
    try {
        // console.log({ body: ctx.request.body })
        const { assignment_id } = ctx.request.query as { assignment_id: string };
        if (!assignment_id) {
            Util.returnError(ctx, 400, 'Missing required fields.');
            return;
        }
        const result = await SubmissionHelper.getSubmission(ctx.session.userInfo.id, assignment_id);
        Util.returnMsg(ctx, 200, result);
    }
    catch (error) {
        console.log({ error })
        Util.returnError(ctx, 500, 'Failed to submit assignment.');
    }
});

router.post('/submit', async (ctx: Context) => {
    try {
        // console.log({ body: ctx.request.body })
        const { assignment_id, content, pic_files, word_count, is_submitted } = ctx.request.body as
            { assignment_id: string, content: string, pic_files: any, word_count: number, is_submitted?: boolean };
        if (!assignment_id || !content) {
            Util.returnError(ctx, 400, 'Missing required fields.');
            return;
        }
        /*
          **只能交自己班的作業。**

          以前這裡只看作業開不開放，沒看這位學生在不在那個班的名冊上 ——
          只要知道作業編號，任何學生都能對別班的作業寫進一筆 submission。
          那一列不會出現在任何教師畫面（批改清單是 JOIN uc_learner 排出來的），
          所以看不出症狀，但它是教師端兩支代繳交補過的同一個洞。

          規則與教師端同一支（assertLearnerInScope：作業屬於某個班、學生在那個班的
          名冊上），範圍給「全部」—— 學生沒有「看得到哪些班」這一層，只問在不在名冊。
          學生自己的作業清單（AssignmentHelper.getAssignments）本來就是照名冊列的，
          所以正常操作不會走到這裡；會走到的是名冊被改掉的學生（轉班、同步出錯），
          訊息要讓他知道該找老師，而不是一直重試。

          查不到一律 404，不區分「沒這份作業」與「不是你的班」。
        */
        const enrolled = await AssignmentHelper.assertLearnerInScope(
            assignment_id, ctx.session.userInfo.id, { kind: 'all' });
        if (!enrolled) {
            Util.returnError(ctx, 404, '找不到這份作業，或你不在這個班的名冊上。請跟老師確認。');
            return;
        }

        /*
          **不收件的作業不接受繳交（含存草稿）。**

          規則與前端 lib/assignments.ts 的 canStudentSubmit() 相同：
            未開放（opened = false）          → 不收
            沒有截止日，或還沒到截止時間        → 收
            過了截止時間                        → 只有允許遲交才收

          畫面上也擋了，但畫面擋不住直接打 API。以前這裡只看 opened，
          過了截止日照樣收得進來。遲交與否不存，用 submited_time 與
          deadline 比出來 —— 老師事後改截止日，遲交標示要跟著變。
        */
        const open = await db.default.oneOrNone(
            `SELECT 1 FROM assignment
              WHERE id = $1
                AND opened = true
                AND (deadline IS NULL OR deadline >= NOW() OR allow_late_submission = true)`,
            [assignment_id]);
        if (!open) {
            Util.returnError(ctx, 409, '這份作業已經截止，不能再繳交了。');
            return;
        }

        // 沒給就當成送出 —— 舊前端不會帶這個欄位，語意要維持原樣
        const submitted = is_submitted !== false;
        /*
          ⚠️ pic_files **直接給陣列**。SubmissionHelper.submit 自己會 JSON.stringify ——
             以前這裡先轉了一次，jsonb 裡存的就變成一個 JSON **字串**（'"[...]"'），
             不是陣列。開發庫盤點有 729 筆是這種字串（前端 picFilesOf() 兩種都吃，
             所以畫面看不出來）。稿紙掃描的原稿就走這條路，存對格式。
        */
        const result = await SubmissionHelper.submit(
            ctx.session.userInfo.id, assignment_id, content,
            Array.isArray(pic_files) ? pic_files : [], word_count, submitted);

        /*
          兩個 CTE 都是 0 筆 = 沒有新增也沒有更新，代表這一份已經批改過，
          UPDATE 的 WHERE 把它擋掉了（見 SubmissionHelper.submit）。
          回 409 而不是 200 —— 回 200 的話學生會以為存進去了。
        */
        const changed = result.reduce((n: number, row: { count: string }) => n + Number(row.count), 0);
        if (changed === 0) {
            Util.returnError(ctx, 409, '這份作業已經批改過了，不能再修改。');
            return;
        }

        Util.returnMsg(ctx, 200, result);
    }
    catch (error) {
        console.log({ error })
        Util.returnError(ctx, 500, 'Failed to submit assignment.');
    }
});

router.get('/submission_feedback', async (ctx: Context) => {
    try {
        // console.log({ body: ctx.request.body })
        const { submission_id } = ctx.request.query as { submission_id: string };
        if (!submission_id) {
            Util.returnError(ctx, 400, 'Missing required fields.');
            return;
        }
        const result = await SubmissionFeedbackHelper.getBySubmissionId(ctx.session.userInfo.id, submission_id);
        Util.returnMsg(ctx, 200, result);
    }
    catch (error) {
        console.log({ error })
        Util.returnError(ctx, 500, 'Failed to submit assignment.');
    }
});

/**
 * @route PUT /service/student/submissions/:submissionId/publish-consent
 * @description 學生決定自己這篇佳作要不要公開在數位作品集的同校觀摩。body：`{ willing: boolean }`
 *
 * 只有自己的、已發還、蓋了佳作章的作品可以設定，其餘一律 404
 * （不區分「不是你的」與「還不能設」，理由同教師端的範圍檢查）。
 */
router.put('/submissions/:submissionId/publish-consent', async (ctx: Context) => {
    try {
        const { submissionId } = ctx.params;
        const { willing } = (ctx.request.body ?? {}) as { willing?: unknown };
        if (!/^\d+$/.test(submissionId) || typeof willing !== 'boolean') {
            Util.returnError(ctx, 400, 'willing must be boolean');
            return;
        }
        const row = await PublishConsentHelper.set(submissionId, ctx.session.userInfo.id, willing);
        if (!row) {
            Util.returnError(ctx, 404, 'Submission not found or not a returned featured work.');
            return;
        }
        Util.returnMsg(ctx, 200, row);
    }
    catch (error) {
        console.log({ error })
        Util.returnError(ctx, 500, 'Failed to save publish consent.');
    }
});

export default router;
