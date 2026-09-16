/**
 * 整合測試的共用工具。
 *
 * 測試打的是**真的 Koa app 與真的 postgres**，只有 1Campus 的 OAuth
 * 換成本機的假 IdP —— 那是唯一一個我們控制不了、也不該在測試裡連的外部系統。
 */
import http from 'http';
import { AddressInfo } from 'net';
import { db } from '../dal/database';
import app from '../app';
import { FAKE_IDP_PORT } from './setup';

// ─────────────────────────────────────────────
// 資料庫
// ─────────────────────────────────────────────

/**
 * 把測試庫清空。每個測試案例開頭都要呼叫 ——
 * 案例之間互相污染的話，測試結果就變成「看你用什麼順序跑」。
 *
 * 用一句 TRUNCATE 帶所有表，是因為這個資料庫**沒有任何外鍵**
 * （見 artifacts/spec.md），一張一張刪還得自己算順序。
 */
export async function resetDb(): Promise<void> {
  //
  // 只清「這個連線使用者真的有 TRUNCATE 權限」的表。
  // 測試庫裡有 course_bk 這種備份表，writing_mng 對它沒有權限 ——
  // 一律全清會直接炸掉，而那張表本來就跟這個應用無關。
  const rows = await db.default.manyOrNone<{ tablename: string }>(
    `select tablename
       from pg_tables
      where schemaname = 'public'
        and has_table_privilege(current_user, format('%I.%I', schemaname, tablename), 'TRUNCATE')`
  );
  if (!rows.length) return;
  const list = rows.map((r) => `public."${r.tablename}"`).join(', ');
  // 不加 RESTART IDENTITY —— 那需要序列的**擁有權**，而 writing_mng 只有 GRANT ALL，
  // 擁有者是 postgres。測試本來就不該依賴特定的 id 值。
  await db.default.none(`TRUNCATE ${list}`);
}

export const rawDb = db.default;

// ─────────────────────────────────────────────
// 測試資料
// ─────────────────────────────────────────────

export interface SeededUser {
  id: string;
  account: string;
  name: string;
}

export async function seedUser(account: string, name: string): Promise<SeededUser> {
  const row = await db.default.one(
    `INSERT INTO "user" (account, name) VALUES ($1, $2) RETURNING id::text, account, name`,
    [account, name]
  );
  return row as SeededUser;
}

/** 讓這個帳號成為系統管理者（前端的「聯合報管理人員」）。 */
export async function seedSystemAdmin(account: string): Promise<void> {
  await db.default.none(`INSERT INTO system_admin (account) VALUES ($1)`, [account]);
}

export async function seedSchool(name = '測試中學', dsns = 'test.edu.tw'): Promise<string> {
  const row = await db.default.one(
    `INSERT INTO school (dsns, school_name, school_type) VALUES ($1, $2, '國中') RETURNING id::text`,
    [dsns, name]
  );
  return row.id;
}

export async function seedCourse(schoolId: string, name = '測試班'): Promise<string> {
  const row = await db.default.one(
    `INSERT INTO course (ref_school_id, school_year, semester, course_name, course_type)
     VALUES ($1, 115, 1, $2, 'class') RETURNING id::text`,
    [schoolId, name]
  );
  return row.id;
}

/**
 * 掛成授課教師。
 *
 * 身分是**現算**的（見 docs/auth.md）：getIdentity() 看 uc_instructor
 * 有沒有資料列，不是讀 user_role。所以測試也照這個路徑造資料。
 */
export async function seedInstructor(courseId: string, userId: string): Promise<void> {
  await db.default.none(
    `INSERT INTO uc_instructor (ref_course_id, ref_user_id, is_primary) VALUES ($1, $2, true)`,
    [courseId, userId]
  );
}

export async function seedLearner(courseId: string, userId: string, seatNo = 1): Promise<void> {
  await db.default.none(
    `INSERT INTO uc_learner (ref_course_id, ref_user_id, seat_no) VALUES ($1, $2, $3)`,
    [courseId, userId, seatNo]
  );
}

export async function seedTask(userId: string, title = '測試題目'): Promise<string> {
  const row = await db.default.one(
    `INSERT INTO task (title, description, ref_user_id, shared) VALUES ($1, '題說', $2, false) RETURNING id::text`,
    [title, userId]
  );
  return row.id;
}

export async function seedAssignment(courseId: string, taskId: string, assignerId: string): Promise<string> {
  const row = await db.default.one(
    `INSERT INTO assignment (ref_course_id, ref_task_id, ref_user_id, opened)
     VALUES ($1, $2, $3, true) RETURNING id::text`,
    [courseId, taskId, assignerId]
  );
  return row.id;
}

export async function seedSubmission(assignmentId: string, userId: string, content = '這是一篇作文'): Promise<string> {
  const row = await db.default.one(
    `INSERT INTO submission (ref_assignment_id, ref_user_id, content, word_count)
     VALUES ($1, $2, $3, $4) RETURNING id::text`,
    [assignmentId, userId, content, content.length]
  );
  return row.id;
}

// ─────────────────────────────────────────────
// 假的 1Campus IdP
// ─────────────────────────────────────────────

export interface FakeIdentity {
  mail: string;
  uuid?: string;
  lastName?: string;
  firstName?: string;
}

/**
 * 起一個假的 1Campus。
 *
 * 只實作 auth/index.ts 真正會打的兩個 endpoint：
 *   POST /token → { access_token }
 *   GET  /me?access_token=... → userInfo
 *
 * userInfo 的形狀照 docs/auth.md 記錄的實際回應 —— 只有五個欄位，
 * isInstructor / isLearner 那些是後端自己補的，IdP 不給。
 */
export function startFakeIdp(identity: FakeIdentity) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${FAKE_IDP_PORT}`);
    if (url.pathname === '/token') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ access_token: 'fake-token', token_type: 'Bearer', expires_in: 3600 }));
      return;
    }
    if (url.pathname === '/me') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        mail: identity.mail,
        uuid: identity.uuid ?? 'uuid-' + identity.mail,
        language: 'zh-Hant-TW',
        lastName: identity.lastName ?? '測',
        firstName: identity.firstName ?? '試',
      }));
      return;
    }
    res.writeHead(404); res.end();
  });
  return new Promise<{ close: () => Promise<void> }>((resolve) => {
    server.listen(FAKE_IDP_PORT, '127.0.0.1', () =>
      resolve({ close: () => new Promise<void>((r) => server.close(() => r())) })
    );
  });
}

// ─────────────────────────────────────────────
// 起 app
// ─────────────────────────────────────────────

export interface TestServer {
  url: string;
  close: () => Promise<void>;
}

/** 把 app 掛在隨機 port。用 0 讓作業系統挑，測試才能平行跑而不搶 port。 */
export async function startServer(): Promise<TestServer> {
  const server = http.createServer(app.callback());
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

// ─────────────────────────────────────────────
// 登入
// ─────────────────────────────────────────────

/** 從 set-cookie 標頭挑出某個 cookie 的 `名字=值` 片段。 */
function pickCookie(res: Response, name: string): string | undefined {
  const all = res.headers.getSetCookie?.() ?? [];
  const hit = all.find((c) => c.startsWith(name + '='));
  return hit?.split(';')[0];
}

/**
 * 走完整的 OAuth 流程拿到 session cookie。
 *
 * 不抄捷徑（例如直接往 session 表塞一列），因為 state 驗證、
 * 身分判定、login_history 寫入這些都在 callback 裡 —— 繞過去就測不到它們。
 */
export async function login(srv: TestServer): Promise<string> {
  const loginRes = await fetch(`${srv.url}/auth/login`, { redirect: 'manual' });
  const stateCookie = pickCookie(loginRes, 'oauth_state');
  if (!stateCookie) throw new Error('/auth/login 沒有設定 oauth_state cookie');

  const state = decodeURIComponent(stateCookie.split('=')[1]);
  const cbRes = await fetch(`${srv.url}/auth/callback?code=test-code&state=${state}`, {
    redirect: 'manual',
    headers: { cookie: stateCookie },
  });
  if (cbRes.status !== 302) {
    throw new Error(`callback 預期 302，得到 ${cbRes.status}：${await cbRes.text()}`);
  }

  const sess = pickCookie(cbRes, '@1campus_writing_classroom');
  const sig = pickCookie(cbRes, '@1campus_writing_classroom.sig');
  if (!sess) throw new Error('callback 沒有設定 session cookie');
  return [sess, sig].filter(Boolean).join('; ');
}

/** 帶著 cookie 打 API。 */
export function req(srv: TestServer, path: string, cookie?: string, init: RequestInit = {}) {
  return fetch(`${srv.url}${path}`, {
    redirect: 'manual',
    ...init,
    headers: { ...(cookie ? { cookie } : {}), ...(init.headers ?? {}) },
  });
}
