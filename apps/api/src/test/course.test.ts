/**
 * GET /service/courses —— 可視範圍。
 *
 * 這是整個系統最容易外洩資料的地方：教師看到別人的班、或是管理者看不到全部。
 * 前端的 lib/access.ts 自己註明「這是原型的展示用權限，不是真的存取控制」——
 * 真正的把關在這裡，所以測試也在這裡。
 */
import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  resetDb, rawDb, seedUser, seedSystemAdmin, seedSchool, seedCourse,
  seedInstructor, startFakeIdp, startServer, login, req,
  type TestServer,
} from './helpers';

const ACCOUNT = 'me@test.edu.tw';
let srv: TestServer;
let idp: { close: () => Promise<void> };

before(async () => {
  idp = await startFakeIdp({ mail: ACCOUNT });
  srv = await startServer();
});
after(async () => { await srv.close(); await idp.close(); await rawDb.$pool.end(); });
beforeEach(resetDb);

const list = async (cookie: string) => {
  const res = await req(srv, '/service/courses', cookie);
  return { status: res.status, rows: res.status === 200 ? await res.json() : [] };
};

const setIdentity = (cookie: string, type: string) =>
  req(srv, '/auth/identity', cookie, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type }),
  });

/** 我的一個班、別人的一個班，都在同一間學校。 */
async function seedTwoCourses() {
  const me = await seedUser(ACCOUNT, '我');
  const other = await seedUser('other@test.edu.tw', '別人');
  const school = await seedSchool('測試中學');
  const mine = await seedCourse(school, '我的班');
  const theirs = await seedCourse(school, '別人的班');
  await seedInstructor(mine, me.id);
  await seedInstructor(theirs, other.id);
  return { me, mine, theirs };
}

describe('授課教師', () => {
  test('只看得到掛在自己名下的班', async () => {
    const { mine } = await seedTwoCourses();
    const { status, rows } = await list(await login(srv));
    assert.equal(status, 200);
    assert.equal(rows.length, 1);
    assert.equal(String(rows[0].id), mine);
    assert.equal(rows[0].course_name, '我的班');
  });

  test('帶出前端要的欄位：校名、學段、學生數、校務系統編號', async () => {
    const me = await seedUser(ACCOUNT, '我');
    const school = await seedSchool('臺北市測試國中');
    const course = await seedCourse(school, '國三孝班');
    await seedInstructor(course, me.id);
    await rawDb.none('UPDATE course SET source_index = 4242 WHERE id = $1', [course]);

    const { rows } = await list(await login(srv));
    const c = rows[0];
    assert.equal(c.school_name, '臺北市測試國中');
    assert.equal(c.school_type, '國中');
    assert.equal(c.course_name, '國三孝班');
    assert.equal(String(c.source_index), '4242');
    assert.equal(Number(c.stud_count), 0);
    assert.equal(c.school_year, 115);
  });

  test('課程名稱**不含**校名 —— 兩者是分開的欄位', async () => {
    // 原型假設課程名稱是「新北市淡江中學國三孝班」這種黏在一起的字串，
    // 所以才有 parseCourseName() 與「待確認」流程。真實資料不長那樣。
    const me = await seedUser(ACCOUNT, '我');
    const course = await seedCourse(await seedSchool('新北市二重國中'), '國三8班');
    await seedInstructor(course, me.id);
    const { rows } = await list(await login(srv));
    assert.equal(rows[0].course_name, '國三8班');
    assert.ok(!rows[0].course_name.includes('國中'), '課程名稱不該含校名');
  });
});

describe('系統管理者', () => {
  test('看得到全部課程，包含不是自己的', async () => {
    await seedTwoCourses();
    await seedSystemAdmin(ACCOUNT);
    const cookie = await login(srv);
    await setIdentity(cookie, 'system_admin');
    const { rows } = await list(cookie);
    assert.equal(rows.length, 2);
  });

  test('切回教師身分就只剩自己的班', async () => {
    // 身分切換若不影響可視範圍，那個切換就沒有意義
    const { mine } = await seedTwoCourses();
    await seedSystemAdmin(ACCOUNT);
    const cookie = await login(srv);

    await setIdentity(cookie, 'system_admin');
    assert.equal((await list(cookie)).rows.length, 2);

    await setIdentity(cookie, 'instructor');
    const after = await list(cookie);
    assert.equal(after.rows.length, 1);
    assert.equal(String(after.rows[0].id), mine);
  });
});

describe('其他情形', () => {
  test('未登入 → 401', async () => {
    assert.equal((await req(srv, '/service/courses')).status, 401);
  });

  test('既不是教師也不是管理者 → 403', async () => {
    await seedUser(ACCOUNT, '路人');
    assert.equal((await list(await login(srv))).status, 403);
  });

  test('是教師但一個班都沒有 → 200 空陣列，不是錯誤', async () => {
    const me = await seedUser(ACCOUNT, '新老師');
    const course = await seedCourse(await seedSchool());
    await seedInstructor(course, me.id);
    await rawDb.none('DELETE FROM uc_instructor WHERE ref_course_id = $1', [course]);
    // 身分是登入當下算的，所以這時仍是 instructor，但已經沒有班
    const cookie = await login(srv);
    await rawDb.none('INSERT INTO uc_instructor (ref_course_id, ref_user_id) VALUES ($1, $2)', [course, me.id]);
    await rawDb.none('DELETE FROM uc_instructor WHERE ref_user_id = $1', [me.id]);
    const { status, rows } = await list(cookie);
    assert.equal(status, 403, '身分是登入當下算的，沒有班就不是教師');
    assert.deepEqual(rows, []);
  });
});

/**
 * PUT /service/instructor/courses/:id —— 封存。
 *
 * 封存存在 `course.is_active`（false = 已封存）。這一組測試釘住三件事：
 * 真的寫進資料庫、封存後課程仍讀得回來（否則「已封存」分頁會是空的）、
 * 以及沒給的欄位不會被清成 NULL。
 */
describe('封存課程', () => {
  const put = (cookie: string, id: string, body: unknown) =>
    req(srv, `/service/instructor/courses/${id}`, cookie, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  test('封存寫進 is_active，而且課程仍在清單裡', async () => {
    const { mine } = await seedTwoCourses();
    const cookie = await login(srv);

    const res = await put(cookie, mine, { is_active: false });
    assert.equal(res.status, 200);

    const row = await rawDb.one('SELECT is_active FROM course WHERE id=$1', [mine]);
    assert.equal(row.is_active, false);

    // 讀得回來，前端才畫得出「已封存」那一頁
    const { rows } = await list(cookie);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].is_active, false);
  });

  test('復原把 is_active 設回 true', async () => {
    const { mine } = await seedTwoCourses();
    const cookie = await login(srv);
    await put(cookie, mine, { is_active: false });
    await put(cookie, mine, { is_active: true });
    const row = await rawDb.one('SELECT is_active FROM course WHERE id=$1', [mine]);
    assert.equal(row.is_active, true);
  });

  test('沒給的欄位維持原值，不會被寫成 NULL', async () => {
    const { mine } = await seedTwoCourses();
    const before = await rawDb.one(
      'SELECT school_year, semester, course_name, course_type FROM course WHERE id=$1', [mine],
    );
    await put(await login(srv), mine, { is_active: false });
    const after = await rawDb.one(
      'SELECT school_year, semester, course_name, course_type FROM course WHERE id=$1', [mine],
    );
    assert.deepEqual(after, before);
  });

  test('不能封存別人的班', async () => {
    const { theirs } = await seedTwoCourses();
    const res = await put(await login(srv), theirs, { is_active: false });
    assert.equal(res.status, 404);
    const row = await rawDb.one('SELECT is_active FROM course WHERE id=$1', [theirs]);
    assert.notEqual(row.is_active, false);
  });
});
