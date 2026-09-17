import Router from '@koa/router';
import { Context } from 'koa';
import { OAuthMiddleware } from '../middleware/oauth';
import SemesterHelper from '../dal/semester_helper';

const router = new Router({ prefix: '/semesters' });

/**
 * @route GET /service/semesters
 * @description 學年期清單與目前學期。
 *
 * 任何登入者都會用到（課程、成績、學生端的學期篩選），所以不綁身分。
 * 只要求登入是因為這不是公開資訊。
 */
router.get('/', OAuthMiddleware.requireLogin, async (ctx: Context) => {
    try {
        const [list, current] = await Promise.all([
            SemesterHelper.list(),
            SemesterHelper.current(),
        ]);
        ctx.body = { semesters: list, current };
    } catch (error) {
        console.error('Error fetching semesters:', error);
        ctx.status = 500;
        ctx.body = { error: 'Internal Server Error' };
    }
});

export default router;
