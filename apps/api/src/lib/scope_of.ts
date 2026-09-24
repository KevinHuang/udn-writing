import { Context } from 'koa';
import { actsAsSchoolAdmin, actsAsSystemAdmin } from '../middleware/oauth';
import { SchoolAdminHelper } from '../dal/school_admin_helper';
import { CourseScope } from './course_scope';

/**
 * 這個請求看得到哪些班級。
 *
 * 教師端的路由（/service/instructor/*）原本只認授課教師，管理人員切過去之後
 * 每一支都 403 或回空陣列 —— 畫面上「批改作業」整頁空白。現在改成依目前身分決定範圍：
 *
 *   聯合報管理人員（system_admin）→ 全部班級
 *   校務管理（school_admin）      → 自己管的學校底下的班級
 *   授課教師（instructor）        → 自己有掛課的班級（原本的行為，完全不變）
 *
 * ⚠️ 順序有意義：同時具有多重身分的人，以**目前選的那一個**為準（見 middleware 的 allows）。
 *    沒有明確切換過身分時（舊前端）才退回「有沒有這個身分」的寬鬆判斷。
 *
 * ⚠️ 校務管理每次請求都會查一次 school_admin 表。那是一張很小的表、又有 account 條件，
 *    成本可以忽略；換來的是「權限改了立刻生效」，不必等使用者重新登入。
 */
export async function courseScopeOf(ctx: Context): Promise<CourseScope> {
  if (actsAsSystemAdmin(ctx)) return { kind: 'all' };

  if (actsAsSchoolAdmin(ctx)) {
    const account = ctx.session?.userInfo?.account ?? ctx.session?.userInfo?.mail ?? '';
    const schoolIds = account ? await SchoolAdminHelper.schoolIdsOfAccount(account) : [];
    return { kind: 'schools', schoolIds };
  }

  return { kind: 'instructor', userId: ctx.session.userInfo.id };
}
