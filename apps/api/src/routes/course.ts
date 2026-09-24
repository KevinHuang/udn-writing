import Router from '@koa/router';
import { Context } from 'koa';
import { OAuthMiddleware, actsAsAdmin } from '../middleware/oauth';
import CourseHelper from '../dal/course_helper';
import { courseScopeOf } from '../lib/scope_of';

const router = new Router({ prefix: '/courses' });

/**
 * @route GET /service/courses
 * @description **目前身分看得到的課程。**
 *
 * 可視範圍的規則收在這裡一處，而不是散在前端：
 *   - 聯合報管理人員：全部課程
 *   - 校務管理：自己管的學校底下的課程
 *   - 授課教師：只有掛在自己名下的（uc_instructor）
 *
 * 前端的 lib/access.ts 有一支 visibleCourses()，但它自己就註明
 * 「這是原型的展示用權限，不是真的存取控制，真實系統必須在伺服器端過濾」。
 * 這支 endpoint 就是那個伺服器端。
 *
 * 兩種身分回傳**完全相同的欄位**，前端不需要為身分寫兩套對應。
 *
 * ⚠️ 依的是「目前選的身分」而不是「擁有的身分」：一個同時是管理者與
 *    教師的人，切到教師身分時就只該看到自己的班 —— 否則身分切換等於沒有意義。
 */
router.get('/', OAuthMiddleware.requireLogin, async (ctx: Context) => {
    try {
        const user = ctx.session.userInfo;
        const active = ctx.session.activeIdentity;

        /*
          ⚠️ 兩種管理人員都走範圍查詢（actsAsAdmin 已經處理「目前選的身分」與
             舊前端的寬鬆判斷）。以前只認 system_admin，校務管理會掉到下面的
             教師分支 —— 於是班級列表是「他自己教的班」、作業列表卻是
             「他管的學校」，兩份清單互相對不上。
        */
        if (actsAsAdmin(ctx)) {
            ctx.body = await CourseHelper.getByScope(await courseScopeOf(ctx));
            return;
        }
        if (!user?.isInstructor) {
            ctx.status = 403;
            ctx.body = { error: 'User is neither an instructor nor a system admin' };
            return;
        }
        ctx.body = await CourseHelper.getByInstructorUserId(user.id);
    } catch (error) {
        console.error('Error fetching courses:', error);
        ctx.status = 500;
        ctx.body = { error: 'Internal Server Error' };
    }
});

export default router;
