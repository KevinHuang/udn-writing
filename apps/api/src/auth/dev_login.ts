import Router from '@koa/router';
import { Context } from 'koa';
import { db } from '../dal/database';
import UserHelper from '../dal/user_helper';
import SystemAdminHelper from '../dal/system_admin_helper';
import { defaultIdentity } from '../lib/identity';
import { UserInfo } from '../types';

/**
 * ⚠️ 開發專用的臨時登入。**不要進正式環境，也不要留在長期分支上。**
 *
 * 為什麼需要它：1Campus 的 OAuth `redirect_uri` 固定是
 * `http://localhost:3001/auth/callback`，而且必須與註冊的完全一致。
 * 手機連的是 `https://<電腦IP>:3443`，那個 localhost 是手機自己 ——
 * 登入流程走不完，手機上就只看得到登入頁，稿紙掃描與作文頁都測不到。
 *
 * 兩道鎖，任一個不成立就整條路由不掛上（連 404 都不會變成線索）：
 *   1. NODE_ENV 不是 production
 *   2. 有設定 DEV_LOGIN_TOKEN，且網址帶的 token 一致
 *
 * 它只讀 `user` 資料表現有的帳號來建立 session，不會新增使用者，
 * 也不寫登入歷程（LoginHistoryHelper）—— 測試不該污染正式的登入紀錄。
 */
export function mountDevLogin(router: Router) {
  const token = process.env.DEV_LOGIN_TOKEN;
  if (!token || process.env.NODE_ENV === 'production') return;

  console.warn('[dev-login] 已啟用開發專用登入 /auth/dev-login —— 正式環境絕對不能啟用');

  router.get('/dev-login', async (ctx: Context) => {
    if (ctx.query.token !== token) {
      ctx.status = 404;
      return;
    }

    const account = String(ctx.query.account ?? '').trim();

    // 沒指定帳號就給一張清單。手機上打長長的 email 很痛苦，點連結最快。
    if (!account) {
      const rows = await db.default.manyOrNone<{ account: string; name: string }>(
        `select u.account, u.name
           from "user" u
          where exists (select 1 from uc_learner l where l.ref_user_id = u.id)
             or exists (select 1 from uc_instructor i where i.ref_user_id = u.id)
          order by u.name
          limit 60`,
      );
      const q = encodeURIComponent(token);
      ctx.type = 'html';
      ctx.body = `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>開發用登入</title>
<style>body{font:16px system-ui;margin:0;padding:16px;background:#faf7f2}
h1{font-size:18px}a{display:block;padding:14px 12px;margin:8px 0;background:#fff;border:1px solid #e5ded3;border-radius:12px;color:#12405a;text-decoration:none}</style>
<h1>開發用登入（僅限本機測試）</h1>
${rows
  .map(
    (r) =>
      `<a href="/auth/dev-login?token=${q}&account=${encodeURIComponent(r.account)}">${r.name} <small>${r.account}</small></a>`,
  )
  .join('\n')}`;
      return;
    }

    // 學校不在 "user" 上（那張表只有 account/name/auth_uuid），
    // 而在 user_role.ref_school_id —— 正式流程是 UserHelper.add() 回傳的 join 結果。
    const row = await db.default.oneOrNone<{
      id: number;
      account: string;
      name: string;
      ref_school_id: string | null;
      auth_uuid: string | null;
    }>(
      `select u.id, u.account, u.name, u.auth_uuid,
              (select r.ref_school_id::text from user_role r
                where r.ref_user_id = u.id order by r.id limit 1) as ref_school_id
         from "user" u
        where u.account = $1`,
      [account],
    );

    if (!row) {
      ctx.status = 404;
      ctx.body = { error: '查無這個帳號' };
      return;
    }

    const identities = await UserHelper.getIdentity(row.account);
    const systemAdmin = await SystemAdminHelper.get_by_account(row.account);

    const userInfo: UserInfo = {
      uuid: row.auth_uuid ?? '',
      // 1Campus 給的是姓／名兩欄，這裡只有全名 —— 第一個字當姓，其餘當名
      lastName: (row.name ?? '').slice(0, 1),
      firstName: (row.name ?? '').slice(1),
      language: 'zh-Hant-TW',
      mail: row.account,
      account: row.account,
      id: row.id,
      ref_school_id: row.ref_school_id ?? '',
      clientIP: ctx.request.ip,
      targetDSNS: '',
      roles: identities,
      isSystemAdmin: !!systemAdmin,
      isSchoolAdmin: identities.some((i: { identity_type: string }) => i.identity_type === 'school_admin'),
      isInstructor: identities.some((i: { identity_type: string }) => i.identity_type === 'instructor'),
      isLearner: identities.some((i: { identity_type: string }) => i.identity_type === 'learner'),
    };

    ctx.session.userInfo = userInfo;
    ctx.session.activeIdentity = { type: defaultIdentity(userInfo), explicit: false };

    // 相對路徑，不要用 CLIENT_HOME_PAGE —— 那個寫死 localhost:3000，
    // 在手機上會導到手機自己。用相對路徑就留在手機連的那個位址。
    ctx.redirect('/');
  });
}
