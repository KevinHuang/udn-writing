import Router from '@koa/router';
import { Context } from 'koa';
import config from '../config';
import { randomBytes } from 'crypto';
import { OAuthMiddleware } from '../middleware/oauth';
import UserHelper from '../dal/user_helper';
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
        const { assignment_id, content, pic_files, word_count } = ctx.request.body as { assignment_id: string, content: string, pic_files: any, word_count: number };
        if (!assignment_id || !content) {
            Util.returnError(ctx, 400, 'Missing required fields.');
            return;
        }
        const result = await SubmissionHelper.submit(ctx.session.userInfo.id, assignment_id, content, JSON.stringify(pic_files), word_count);
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
