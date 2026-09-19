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

export default router;
