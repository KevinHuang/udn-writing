import Router from '@koa/router';
import { Context } from 'koa';
import { OAuthMiddleware } from '../middleware/oauth';
import CourseHelper from '../dal/course_helper';

const router = new Router({ prefix: '/courses' });

/**
 * @route GET /service/courses
 * @description **目前身分看得到的課程。**
 *
 * 可視範圍的規則收在這裡一處，而不是散在前端：
 *   - 系統管理者（聯合報管理人員）：全部課程
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

        // explicit=false（舊前端，沒有身分切換 UI）時退回看擁有的身分，
        // 管理者優先。舊前端退場後這個分支跟著拿掉。
        const asAdmin = active?.explicit
            ? active.type === 'system_admin'
            : !!user?.isSystemAdmin;

        if (asAdmin) {
            ctx.body = await CourseHelper.getAllForAdmin();
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
