import Router from '@koa/router';
import { Context } from 'koa';
import { OAuthMiddleware } from '../middleware/oauth';
import Util from '../util/util';
import TaskHelper from '../dal/task_helper';


const router = new Router();

/**
 * Step 1：登入按鈕
 * 導向使用者到 1Campus 授權頁面
 */
router.get('/:id', OAuthMiddleware.requireLogin, async (ctx: Context) => {
    try {
        console.log("Task ID: ", ctx.params.id);
        const task = await TaskHelper.getById(ctx.params.id);
        if (!task) {
            Util.returnError(ctx, 404, 'Task not found');
            return;
        }
        ctx.body = task;
    }
    catch (error: any) {
        if (error.status) {
            Util.returnError(ctx, error.status, error.message);
        }
        else {
            Util.returnError(ctx, 500, 'Failed to get task');
        }
    }
});

export default router;
