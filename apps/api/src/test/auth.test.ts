/**
 * 登入流程與 session。
 *
 * 打的是真的 app 與真的 postgres，只有 1Campus 換成本機假 IdP。
 */
import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  resetDb, rawDb, seedUser, seedSystemAdmin, seedSchool, seedCourse,
  seedInstructor, seedLearner, startFakeIdp, startServer, login, req,
  type TestServer,
} from './helpers';

const ACCOUNT = 'teacher@test.edu.tw';
let srv: TestServer;
let idp: { close: () => Promise<void> };

before(async () => {
  idp = await startFakeIdp({ mail: ACCOUNT, lastName: '王', firstName: '小明' });
  srv = await startServer();
});
after(async () => { await srv.close(); await idp.close(); await rawDb.$pool.end(); });
beforeEach(resetDb);

describe('OAuth 登入', () => {
  test('/auth/login 會導向授權頁並設定 state cookie', async () => {
    const res = await req(srv, '/auth/login');
    assert.equal(res.status, 302);
    const location = res.headers.get('location')!;
    assert.ok(location.startsWith('http://127.0.0.1:39001/authorize'), location);
    const url = new URL(location);
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.ok(url.searchParams.get('state'));
    assert.ok(res.headers.getSetCookie().some((c) => c.startsWith('oauth_state=')));
  });

  test('完整流程：登入後 /auth/me 回傳身分', async () => {
    const cookie = await login(srv);
    const me = await req(srv, '/auth/me', cookie);
    assert.equal(me.status, 200);
    const body = await me.json();
    assert.equal(body.account, ACCOUNT);
    assert.equal(body.mail, ACCOUNT);
  });

  test('登入會在 user 表建立帳號，並寫入 auth_uuid', async () => {
    await login(srv);
    const row = await rawDb.one(`SELECT name, auth_uuid, last_signin FROM "user" WHERE account = $1`, [ACCOUNT]);
    // 姓在前、名在後，中間不加空白（auth/index.ts 的 lastName + firstName）
    assert.equal(row.name, '王小明');
    // auth_uuid 先前完全沒有被寫入 —— userInfo.uuid 拿到就被丟掉了
    assert.equal(row.auth_uuid, 'uuid-' + ACCOUNT);
    assert.ok(row.last_signin);
  });

  test('登入會寫一筆 login_history', async () => {
    await login(srv);
    const rows = await rawDb.manyOrNone(`SELECT user_name, client_ip FROM login_history`);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].user_name, ACCOUNT);
    assert.ok(rows[0].client_ip);
  });

  test('重複登入不會建立第二個帳號', async () => {
    await login(srv);
    await login(srv);
    const { count } = await rawDb.one(`SELECT count(*)::int FROM "user" WHERE account = $1`, [ACCOUNT]);
    assert.equal(count, 1);
  });
});

describe('state 參數（CSRF）', () => {
  test('完全不帶 state 也沒有 cookie → 400', async () => {
    // 這是修補前會通過的情況：undefined !== undefined 是 false，直接放行
    const res = await req(srv, '/auth/callback?code=abc');
    assert.equal(res.status, 400);
  });

  test('帶了猜測的 state 但沒有對應 cookie → 400', async () => {
    const res = await req(srv, '/auth/callback?code=abc&state=guessed');
    assert.equal(res.status, 400);
  });

  test('state 與 cookie 不符 → 400', async () => {
    const res = await req(srv, '/auth/callback?code=abc&state=aaa', 'oauth_state=bbb');
    assert.equal(res.status, 400);
  });

  test('state 是一次性的：用過就被清除', async () => {
    const loginRes = await req(srv, '/auth/login');
    const stateCookie = loginRes.headers.getSetCookie()
      .find((c) => c.startsWith('oauth_state='))!.split(';')[0];
    const state = decodeURIComponent(stateCookie.split('=')[1]);

    const first = await req(srv, `/auth/callback?code=c1&state=${state}`, stateCookie);
    assert.equal(first.status, 302);
    // callback 回應應該把 state cookie 清掉
    assert.ok(first.headers.getSetCookie().some((c) => /^oauth_state=;/.test(c)));
  });
});

describe('session 存在 postgres，不是記憶體', () => {
  test('登入後 session 表有對應的資料列', async () => {
    await login(srv);
    const rows = await rawDb.manyOrNone(`SELECT session_id, expiry_date, data FROM session`);
    assert.equal(rows.length, 1);
    assert.ok(rows[0].expiry_date > Date.now(), 'expiry_date 應該是未來的 epoch 毫秒');
    assert.equal(rows[0].data.userInfo.account, ACCOUNT);
  });

  test('把資料庫裡的 session 刪掉，cookie 就失效', async () => {
    // 這是「session 真的在 postgres」最直接的證明：
    // 如果它存在記憶體，刪資料庫不會有任何影響。
    const cookie = await login(srv);
    assert.equal((await req(srv, '/auth/me', cookie)).status, 200);

    await rawDb.none(`DELETE FROM session`);

    assert.equal((await req(srv, '/auth/me', cookie)).status, 401);
  });

  test('登出後 cookie 失效', async () => {
    const cookie = await login(srv);
    const out = await req(srv, '/auth/logout', cookie, { method: 'POST' });
    assert.equal(out.status, 200);
    assert.equal((await req(srv, '/auth/me', cookie)).status, 401);
  });
});

describe('身分判定', () => {
  test('沒有任何課程關聯時，三個旗標都是 false', async () => {
    const cookie = await login(srv);
    const body = await (await req(srv, '/auth/me', cookie)).json();
    assert.equal(body.isInstructor, false);
    assert.equal(body.isLearner, false);
    assert.equal(body.isSystemAdmin, false);
  });

  test('uc_instructor 有資料列 → isInstructor', async () => {
    const user = await seedUser(ACCOUNT, '王小明');
    const course = await seedCourse(await seedSchool());
    await seedInstructor(course, user.id);

    const body = await (await req(srv, '/auth/me', await login(srv))).json();
    assert.equal(body.isInstructor, true);
    assert.equal(body.isLearner, false);
  });

  test('uc_learner 有資料列 → isLearner', async () => {
    const user = await seedUser(ACCOUNT, '王小明');
    const course = await seedCourse(await seedSchool());
    await seedLearner(course, user.id);

    const body = await (await req(srv, '/auth/me', await login(srv))).json();
    assert.equal(body.isLearner, true);
    assert.equal(body.isInstructor, false);
  });

  test('system_admin 表有帳號 → isSystemAdmin', async () => {
    await seedSystemAdmin(ACCOUNT);
    const body = await (await req(srv, '/auth/me', await login(srv))).json();
    assert.equal(body.isSystemAdmin, true);
  });

  test('身分不依學期篩選：舊學年度的課程照樣算數', async () => {
    // 刻意的行為，見 dal/user_helper.ts 的註解與 docs/auth.md
    const user = await seedUser(ACCOUNT, '王小明');
    const school = await seedSchool();
    const old = await rawDb.one(
      `INSERT INTO course (ref_school_id, school_year, semester, course_name, course_type)
       VALUES ($1, 100, 1, '很久以前的班', 'class') RETURNING id::text`, [school]);
    await seedInstructor(old.id, user.id);

    const body = await (await req(srv, '/auth/me', await login(srv))).json();
    assert.equal(body.isInstructor, true);
  });

  test('/service/user/my_identity 回傳陣列，不是空物件', async () => {
    // 這支先前少了 await，ctx.body 被指派成 Promise，序列化出來是 {}
    const user = await seedUser(ACCOUNT, '王小明');
    const course = await seedCourse(await seedSchool());
    await seedInstructor(course, user.id);

    const res = await req(srv, '/service/user/my_identity', await login(srv));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body), `預期陣列，得到 ${JSON.stringify(body)}`);
    assert.equal(body.length, 1);
    assert.equal(body[0].identity_type, 'instructor');
  });
});
