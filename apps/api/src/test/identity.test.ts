/**
 * 身分切換。
 *
 * 一個人可以同時是教師與學生，前端一次只呈現一種（大頭貼下拉可切換），
 * 所以 session 要記住「現在選的是哪一種」，而守衛要同時檢查
 * 「有這個身分」與「目前選的是它」。
 */
import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  resetDb, rawDb, seedUser, seedSystemAdmin, seedSchool, seedCourse,
  seedInstructor, seedLearner, startFakeIdp, startServer, login, req,
  type TestServer,
} from './helpers';

const ACCOUNT = 'both@test.edu.tw';
let srv: TestServer;
let idp: { close: () => Promise<void> };

before(async () => {
  idp = await startFakeIdp({ mail: ACCOUNT });
  srv = await startServer();
});
after(async () => { await srv.close(); await idp.close(); await rawDb.$pool.end(); });
beforeEach(resetDb);

/** 造一個同時是教師與學生的人。 */
async function seedDualRole() {
  const user = await seedUser(ACCOUNT, '兩種身分');
  const school = await seedSchool();
  await seedInstructor(await seedCourse(school, '我教的班'), user.id);
  await seedLearner(await seedCourse(school, '我修的班'), user.id);
  return user;
}

const me = async (cookie: string) => (await req(srv, '/auth/me', cookie)).json();
const setIdentity = (cookie: string, type: unknown) =>
  req(srv, '/auth/identity', cookie, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type }),
  });

describe('/auth/me 帶出可選身分', () => {
  test('沒有任何身分時是空陣列', async () => {
    const body = await me(await login(srv));
    assert.deepEqual(body.identities, []);
    assert.equal(body.activeIdentity, null);
  });

  test('同時是教師與學生時兩種都列出來，並帶學校名稱', async () => {
    await seedDualRole();
    const body = await me(await login(srv));
    const types = body.identities.map((i: { type: string }) => i.type).sort();
    assert.deepEqual(types, ['instructor', 'learner']);
    assert.deepEqual(body.identities.find((i: { type: string }) => i.type === 'instructor').schools,
                     ['測試中學']);
  });

  test('預設落在 instructor（優先序見 lib/identity.ts）', async () => {
    await seedDualRole();
    assert.equal((await me(await login(srv))).activeIdentity, 'instructor');
  });

  test('只有學生身分時預設就是 learner', async () => {
    const user = await seedUser(ACCOUNT, '學生');
    await seedLearner(await seedCourse(await seedSchool()), user.id);
    assert.equal((await me(await login(srv))).activeIdentity, 'learner');
  });
});

describe('POST /auth/identity', () => {
  test('切換到自己有的身分 → 200，且 /auth/me 跟著變', async () => {
    await seedDualRole();
    const cookie = await login(srv);
    const res = await setIdentity(cookie, 'learner');
    assert.equal(res.status, 200);
    assert.equal((await me(cookie)).activeIdentity, 'learner');
  });

  test('切換到自己沒有的身分 → 403（這支是提權的入口，一定要驗）', async () => {
    await seedDualRole();   // 只有 instructor 與 learner
    const cookie = await login(srv);
    assert.equal((await setIdentity(cookie, 'system_admin')).status, 403);
    assert.equal((await me(cookie)).activeIdentity, 'instructor', '不該被改掉');
  });

  test('亂送值 → 400', async () => {
    await seedDualRole();
    const cookie = await login(srv);
    for (const bad of ['superuser', '', 123, null]) {
      assert.equal((await setIdentity(cookie, bad)).status, 400, String(bad));
    }
  });

  test('未登入 → 401', async () => {
    assert.equal((await setIdentity('', 'learner')).status, 401);
  });
});

describe('守衛會看目前身分，切換才有意義', () => {
  test('切到 learner 之後，教師的 endpoint 回 403', async () => {
    // 這個人「有」教師身分 —— 只檢查旗標的話這裡會放行，
    // 身分切換就只是畫面效果。
    await seedDualRole();
    const cookie = await login(srv);
    assert.equal((await req(srv, '/service/instructor/courses', cookie)).status, 200);

    await setIdentity(cookie, 'learner');
    assert.equal((await req(srv, '/service/instructor/courses', cookie)).status, 403);
    assert.equal((await req(srv, '/service/student/my_assignments', cookie)).status, 200);
  });

  test('切回 instructor 就恢復', async () => {
    await seedDualRole();
    const cookie = await login(srv);
    await setIdentity(cookie, 'learner');
    await setIdentity(cookie, 'instructor');
    assert.equal((await req(srv, '/service/instructor/courses', cookie)).status, 200);
    assert.equal((await req(srv, '/service/student/my_assignments', cookie)).status, 403);
  });

  test('管理身分同理', async () => {
    await seedSystemAdmin(ACCOUNT);
    await seedDualRole();
    const cookie = await login(srv);

    // 只驗「守衛有沒有放行」，不驗 handler 成不成功 ——
    // 這幾條 admin endpoint 會真的去呼叫 DevAPI、寫資料或呼叫 AI。
    // 被擋下時不會進到 handler，所以 403 這一邊測起來是安全的；
    // 放行那一邊只能斷言「不是 403」，後面 handler 自己會因為連不到
    // DevAPI 而失敗，那與這個測試要問的事情無關。
    const status = async () =>
      (await req(srv, '/service/admin/sync/school', cookie, { method: 'POST' })).status;

    await setIdentity(cookie, 'system_admin');
    assert.notEqual(await status(), 403, '選了管理身分就該通過守衛');

    await setIdentity(cookie, 'learner');
    assert.equal(await status(), 403, '切到學生身分就該被擋下');
  });
});

describe('舊前端相容：沒有明確選過身分時放寬', () => {
  test('從沒呼叫過 /auth/identity 的人，兩邊的 endpoint 都進得去', async () => {
    // 目前線上的舊前端沒有身分切換 UI。嚴格檢查會直接把它擋死，
    // 所以 explicit=false 時只檢查「有沒有這個身分」。
    // ⚠️ 舊前端退場後要把這個放寬拿掉，屆時這個測試要改成 assert 403。
    await seedDualRole();
    const cookie = await login(srv);
    assert.equal((await req(srv, '/service/instructor/courses', cookie)).status, 200);
    assert.equal((await req(srv, '/service/student/my_assignments', cookie)).status, 200);
  });

  test('但放寬不等於沒有檢查：沒有的身分照樣擋', async () => {
    await seedDualRole();   // 不是 system_admin
    const cookie = await login(srv);
    assert.equal((await req(srv, '/service/admin/import', cookie, { method: 'POST' })).status, 403);
  });
});
