import { Context, Next } from 'koa';
import { SessionUser } from '../types';
import Util from '../util/util';
import { IdentityType } from '../lib/identity';

/**
 * 守衛的共同判斷：這個人**有**這個身分，而且**目前選的**就是它。
 *
 * 只檢查前者，前端的身分切換就只是畫面效果 —— 老師身分的人打學生 API
 * 照樣通。只檢查後者，等於讓前端自己決定權限。
 *
 * ⚠️ `explicit === false` 時放寬成只檢查「有沒有」。
 *    原因：目前線上的舊前端（apps/api/public/）沒有身分切換 UI，
 *    不會呼叫 /auth/identity，嚴格檢查會直接把它擋死。
 *    **舊前端退場後把這個放寬拿掉**（spec.md 開放問題 4）。
 */
function allows(ctx: Context, type: IdentityType, has: boolean): boolean {
  if (!has) return false;
  const active = ctx.session?.activeIdentity;
  if (!active?.explicit) return true;
  return active.type === type;
}

/**
 * 目前是不是以聯合報管理人員的身分在操作。
 *
 * 給「同一支路由、身分不同權限不同」的情形用 —— 例如題庫：授課教師與管理人員
 * 打的是同一組 /instructor/tasks，但只有管理人員能動共同題庫。
 * 規則與 isSystemAdmin 中介層相同（見 allows）。
 */
export function actsAsSystemAdmin(ctx: Context): boolean {
  return allows(ctx, 'system_admin', !!ctx.session?.userInfo?.isSystemAdmin);
}

/**
 * 目前是不是以校務管理的身分在操作。
 *
 * 與 actsAsSystemAdmin 同構，差別只在能看到的範圍：校務管理限定自己管的學校
 * （見 lib/course_scope.ts 的 CourseScope）。
 */
export function actsAsSchoolAdmin(ctx: Context): boolean {
  return allows(ctx, 'school_admin', !!ctx.session?.userInfo?.isSchoolAdmin);
}

/** 目前是不是以某一種管理身分在操作（兩種管理人員都算） */
export function actsAsAdmin(ctx: Context): boolean {
  return actsAsSystemAdmin(ctx) || actsAsSchoolAdmin(ctx);
}

// 簡單的 in-memory session 存儲（實務上應使用 Redis）
const sessions = new Map<string, SessionUser>();

export class OAuthMiddleware {
    /**
     * 驗證 session，確保使用者已登入
     */
    static async requireLogin(ctx: Context, next: Next) {

        const user = ctx.session.userInfo;
        // console.log({ user });

        if (!user) {
            Util.returnError(ctx, 401, 'Session expired');
            return;
        }

        await next();
    }

    /**
    * 驗證 session，確保具有學生身份
    */
    static async isLearner(ctx: Context, next: Next) {

        const user = ctx.session.userInfo;
        // console.log({ user });

        if (!allows(ctx, 'learner', !!user?.isLearner)) {
            Util.returnError(ctx, 403, 'User is not a learner');
            return;
        }

        await next();
    }

    /**
    * 驗證 session，確保具有教師/指導者身份
    */
    static async isInstructor(ctx: Context, next: Next) {

        const user = ctx.session.userInfo;
        
        if (!allows(ctx, 'instructor', !!user?.isInstructor)) {
            Util.returnError(ctx, 403, 'User is not an instructor');
            return;
        }

        await next();
    }


    /**
    * 驗證 session，確保具有系統管理者身份（聯合報管理人員）。
    *
    * isSystemAdmin 是 auth/callback 查 system_admin 表之後寫進 session 的，
    * 不是 1Campus 回傳的欄位。
    */
    static async isSystemAdmin(ctx: Context, next: Next) {

        const user = ctx.session?.userInfo;

        if (!allows(ctx, 'system_admin', !!user?.isSystemAdmin)) {
            Util.returnError(ctx, 403, 'User is not a system admin');
            return;
        }

        await next();
    }


    /**
     * 存儲 session
     */
    static setSession(sessionId: string, user: SessionUser) {
        sessions.set(sessionId, user);
    }

    /**
     * 取得 session
     */
    static getSession(sessionId: string): SessionUser | undefined {
        return sessions.get(sessionId);
    }

    /**
     * 刪除 session
     */
    static deleteSession(sessionId: string) {
        sessions.delete(sessionId);
    }
}