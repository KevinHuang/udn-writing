/**
 * 管理人員的批改範圍。
 *
 * 起因：管理人員切換身分之後，批改頁整頁空白 —— `/service/instructor/*`
 * 原本只認授課教師，管理人員每一支都 403，作文、評語、標記、請假全部載不到，
 * 但前端照樣把教師的畫面給他們看。
 *
 * 現在兩種管理人員都走同一組 API，差別只在看得到的範圍：
 *   聯合報管理人員（system_admin）→ 全部學校
 *   校務管理（school_admin）      → 只有自己管的學校
 *
 * **範圍錯了不會當掉，只會安靜地多給或少給資料**，所以這裡一條一條釘死。
 */
import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  resetDb, rawDb, seedUser, seedSystemAdmin, seedSchoolAdmin, seedSchool, seedCourse,
  seedInstructor, seedLearner, seedTask, seedAssignment, seedSubmission,
  startFakeIdp, startServer, login, req,
  type TestServer,
} from './helpers';

const ACCOUNT = 'admin@test.edu.tw';
let srv: TestServer;
let idp: { close: () => Promise<void> };

before(async () => {
  idp = await startFakeIdp({ mail: ACCOUNT });
  srv = await startServer();
});
after(async () => { await srv.close(); await idp.close(); await rawDb.$pool.end(); });
beforeEach(resetDb);

const setIdentity = (cookie: string, type: string) =>
  req(srv, '/auth/identity', cookie, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type }),
  });

const get = async (cookie: string, path: string) => {
  const res = await req(srv, path, cookie);
  return { status: res.status, body: res.status === 200 ? await res.json() : null };
};

/**
 * 兩間學校各一個班、各一份作業與一篇作文，兩班都由別人教
 * —— 登入的這個人**完全沒有授課教師身分**，只有管理身分。
 */
async function twoSchools() {
  const teacher = await seedUser('teacher@test.edu.tw', '別的老師');
  const student = await seedUser('stu@test.edu.tw', '學生');

  const schoolA = await seedSchool('甲中學', 'a.edu.tw');
  const schoolB = await seedSchool('乙中學', 'b.edu.tw');
  const courseA = await seedCourse(schoolA, '甲班');
  const courseB = await seedCourse(schoolB, '乙班');
  await seedInstructor(courseA, teacher.id);
  await seedInstructor(courseB, teacher.id);
  await seedLearner(courseA, student.id, 1);
  await seedLearner(courseB, student.id, 1);

  const task = await seedTask(teacher.id, '一次印象深刻的旅行');
  const assignA = await seedAssignment(courseA, task, teacher.id);
  const assignB = await seedAssignment(courseB, task, teacher.id);
  const subA = await seedSubmission(assignA, student.id, '甲班的作文');
  const subB = await seedSubmission(assignB, student.id, '乙班的作文');

  return { teacher, student, schoolA, schoolB, courseA, courseB, assignA, assignB, subA, subB };
}

describe('聯合報管理人員（system_admin）', () => {
  test('批改清單看得到全部學校的作業', async () => {
    const s = await twoSchools();
    await seedUser(ACCOUNT, '聯合報管理員');
    await seedSystemAdmin(ACCOUNT);
    const cookie = await login(srv);
    await setIdentity(cookie, 'system_admin');

    const { status, body } = await get(cookie, '/service/instructor/assignments');
    assert.equal(status, 200, '以前這裡是 403，整頁空白');
    const ids = body.map((r: { assignment_id: string }) => String(r.assignment_id));
    assert.ok(ids.includes(s.assignA), '看得到甲校');
    assert.ok(ids.includes(s.assignB), '看得到乙校');
  });

  test('打得開別人班的作文全文與評語', async () => {
    const s = await twoSchools();
    await seedUser(ACCOUNT, '聯合報管理員');
    await seedSystemAdmin(ACCOUNT);
    const cookie = await login(srv);
    await setIdentity(cookie, 'system_admin');

    const { status, body } = await get(cookie, `/service/instructor/assignments/${s.assignA}/submissions`);
    assert.equal(status, 200);
    const mine = body.find((r: { submission_id: string }) => String(r.submission_id) === s.subA);
    assert.ok(mine, '找得到那一篇');
    assert.equal(mine.content, '甲班的作文', '作文全文要看得到 —— 空白就是這次要修的 bug');
  });

  test('批改摘要、標記、請假都拿得到（不是空陣列）', async () => {
    await twoSchools();
    await seedUser(ACCOUNT, '聯合報管理員');
    await seedSystemAdmin(ACCOUNT);
    const cookie = await login(srv);
    await setIdentity(cookie, 'system_admin');

    const summary = await get(cookie, '/service/instructor/submissions');
    assert.equal(summary.status, 200);
    assert.ok(summary.body.length >= 2, '兩校的繳交都要在摘要裡');
    assert.equal((await get(cookie, '/service/instructor/marks')).status, 200);
    assert.equal((await get(cookie, '/service/instructor/leaves')).status, 200);
  });

  test('可以批改（與授課教師相同）', async () => {
    const s = await twoSchools();
    await seedUser(ACCOUNT, '聯合報管理員');
    await seedSystemAdmin(ACCOUNT);
    const cookie = await login(srv);
    await setIdentity(cookie, 'system_admin');

    const res = await req(srv, `/service/instructor/submissions/${s.subA}/feedback`, cookie, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ score: 5, analysis_content: { summary: '管理人員批的' } }),
    });
    assert.equal(res.status, 200);
    const row = await rawDb.one(
      `SELECT score, ref_user_id FROM submission_feedback WHERE ref_submission_id = $1 AND is_valid = true`,
      [s.subA]);
    assert.equal(Number(row.score), 5);
  });
});

describe('校務管理（school_admin）', () => {
  /** 只管甲校 */
  async function loginAsSchoolAdminOfA() {
    const s = await twoSchools();
    await seedUser(ACCOUNT, '甲校管理員');
    await seedSchoolAdmin(s.schoolA, ACCOUNT);
    const cookie = await login(srv);
    await setIdentity(cookie, 'school_admin');
    return { s, cookie };
  }

  test('看得到自己學校的作業', async () => {
    const { s, cookie } = await loginAsSchoolAdminOfA();
    const { status, body } = await get(cookie, '/service/instructor/assignments');
    assert.equal(status, 200);
    const ids = body.map((r: { assignment_id: string }) => String(r.assignment_id));
    assert.ok(ids.includes(s.assignA));
    assert.ok(!ids.includes(s.assignB), '⚠️ 別校的不能出現 —— 這是權限外洩');
  });

  test('打得開自己學校的作文全文', async () => {
    const { s, cookie } = await loginAsSchoolAdminOfA();
    const { status, body } = await get(cookie, `/service/instructor/assignments/${s.assignA}/submissions`);
    assert.equal(status, 200);
    const row = body.find((r: { submission_id: string }) => String(r.submission_id) === s.subA);
    assert.equal(row.content, '甲班的作文');
  });

  test('⚠️ 批改不到別校的作品', async () => {
    const { s, cookie } = await loginAsSchoolAdminOfA();
    const res = await req(srv, `/service/instructor/submissions/${s.subB}/feedback`, cookie, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ score: 6, analysis_content: { summary: '不該寫得進去' } }),
    });
    assert.equal(res.status, 403);
    const rows = await rawDb.manyOrNone(
      `SELECT id FROM submission_feedback WHERE ref_submission_id = $1`, [s.subB]);
    assert.equal(rows.length, 0, '一列都不該寫進去');
  });

  test('批改得了自己學校的作品', async () => {
    const { s, cookie } = await loginAsSchoolAdminOfA();
    const res = await req(srv, `/service/instructor/submissions/${s.subA}/feedback`, cookie, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ score: 4, analysis_content: { summary: '校務管理批的' } }),
    });
    assert.equal(res.status, 200);
  });

  test('⚠️ 直接換網址也讀不到別校的作文（以前這支查詢完全沒有把關）', async () => {
    const { s, cookie } = await loginAsSchoolAdminOfA();
    const { status, body } = await get(cookie, `/service/instructor/assignments/${s.assignB}/submissions`);
    // 範圍外回空陣列（與其他查詢一致），重點是**拿不到任何一篇作文**
    assert.equal(status, 200);
    assert.deepEqual(body, []);
  });
});

describe('授課教師（回歸）', () => {
  test('行為完全沒變：只看得到自己的班', async () => {
    const s = await twoSchools();
    // 這次登入的人自己也是老師，但只教甲班
    const me = await seedUser(ACCOUNT, '我');
    await seedInstructor(s.courseA, me.id);
    const cookie = await login(srv);

    const { status, body } = await get(cookie, '/service/instructor/assignments');
    assert.equal(status, 200);
    const ids = body.map((r: { assignment_id: string }) => String(r.assignment_id));
    assert.deepEqual(ids, [s.assignA]);
  });

  test('沒有任何身分的人仍然被擋在外面', async () => {
    await twoSchools();
    await seedUser(ACCOUNT, '路人');
    const cookie = await login(srv);
    const { status } = await get(cookie, '/service/instructor/assignments');
    assert.equal(status, 403);
  });
});
