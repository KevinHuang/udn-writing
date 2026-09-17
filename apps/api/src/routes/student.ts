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
          **已結束收件的作業不接受繳交。**

          學生端現在看得到已關閉的作業（要能查自己的成績），畫面上也擋了，
          但畫面擋不住直接打 API。`opened = false` 就是已關閉或未開放，
          兩種都不該收件。
        */
        const open = await db.default.oneOrNone(
            `SELECT 1 FROM assignment WHERE id = $1 AND opened = true`, [assignment_id]);
        if (!open) {
            Util.returnError(ctx, 409, '這份作業已經結束收件了。');
            return;
        }

        // 沒給就當成送出 —— 舊前端不會帶這個欄位，語意要維持原樣
        const submitted = is_submitted !== false;
        const result = await SubmissionHelper.submit(ctx.session.userInfo.id, assignment_id, content, JSON.stringify(pic_files), word_count, submitted);

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
