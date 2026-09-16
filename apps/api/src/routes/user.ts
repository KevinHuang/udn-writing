import Router from '@koa/router';
import { Context } from 'koa';
import config from '../config';
import { randomBytes } from 'crypto';
import { OAuthMiddleware } from '../middleware/oauth';
import UserHelper from '../dal/user_helper';
import Util from '../util/util';


const router = new Router({ prefix: '/user' });

/**
 * Step 1：登入按鈕
 * 導向使用者到 1Campus 授權頁面
 */
router.get('/my_identity', OAuthMiddleware.requireLogin, async (ctx: Context) => {
    try {

        // 少了 await 的話 ctx.body 會被指派成一個 Promise，
        // Koa 序列化出來是 {} —— 這支 endpoint 曾經一直回傳空物件。
        const identities = await UserHelper.getIdentity(ctx.session.userInfo.account);
        ctx.body = identities;

    }
    catch (error) {
        Util.returnError(ctx, 500, 'Failed to get user identity');
    }
});

export default router;
