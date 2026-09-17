/**
 * 期末總結：授權與產生。
 *
 * 期末總結把一位學生整學期的分數與 AI 評語彙整成一份，所以讀取的把關特別要緊 ——
 * 一次外洩的是整班的姓名、成績與評語。
 *
 * 讀取原本**完全沒有把關**：路由取了 userId 卻沒有往下傳，
 * 任何教師拿任意 course_id 就讀得到別班的整份總結。
 *
 * 測試環境沒有 Vertex AI 憑證（見 test/setup.ts），所以產生走的是
 * dal/simulated_grading.ts 的決定性模擬摘要 —— 既不會打真的 AI，
 * 也正好驗到「沒有憑證時仍要能跑完流程」。
 */
import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  resetDb, rawDb, seedUser, seedSchool, seedCourse, seedInstructor, seedLearner,
  seedTask, seedAssignment, seedSubmission, startFakeIdp, startServer, login, req,
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

const listReports = (cookie: string | undefined, courseId: string) =>
  req(srv, `/service/instructor/courses/${courseId}/finalReports`, cookie);

const generate = (cookie: string | undefined, courseId: string) =>
  req(srv, `/service/instructor/courses/${courseId}/finalReports`, cookie, { method: 'POST' });

/** 寫一筆有效批改，讓這位學生有東西可以總結 */
async function gradedSubmission(courseId: string, taskId: string, teacherId: string, studentId: string, score: number) {
  const assignment = await seedAssignment(courseId, taskId, teacherId);
  const submission = await seedSubmission(assignment, studentId);
  await rawDb.none(
    `INSERT INTO submission_feedback (ref_submission_id, score, content, ref_user_id, is_ai, is_valid, sub_scores)
     VALUES ($1, $2, $3, $4, true, true, $5::jsonb)`,
    [submission, score, JSON.stringify({ score, response: '總體評語：寫得不錯。' }), teacherId,
     JSON.stringify({
       theme_and_content_score: score,
       structure_and_organization_score: score,
       diction_and_sentence_structure_score: score,
       mechanics_and_punctuation_score: score,
       theme_and_content_score_summary: '取材不錯',
       structure_and_organization_score_summary: '結構清楚',
       diction_and_sentence_structure_score_summary: '用字精確',
       mechanics_and_punctuation_score_summary: '標點正確',
     })]);
  return submission;
}

/** 我教一班、別人教一班，兩邊各有一位有批改作品的學生 */
async function scenario() {
  const me = await seedUser(ACCOUNT, '我');
  const other = await seedUser('other@test.edu.tw', '別的老師');
  const school = await seedSchool();
  const mine = await seedCourse(school, '我的班');
  const theirs = await seedCourse(school, '別人的班');
  await seedInstructor(mine, me.id);
  await seedInstructor(theirs, other.id);

  const myStudent = await seedUser('s1@test.edu.tw', '我的學生');
  const theirStudent = await seedUser('s2@test.edu.tw', '別班學生');
  await seedLearner(mine, myStudent.id, 7);
  await seedLearner(theirs, theirStudent.id, 3);

  const task = await seedTask(me.id);
  await gradedSubmission(mine, task, me.id, myStudent.id, 5);
  await gradedSubmission(theirs, task, other.id, theirStudent.id, 4);

  return { me, other, mine, theirs, myStudent, theirStudent, task, cookie: await login(srv) };
}

describe('產生期末總結', () => {
  test('沒有 AI 憑證也能產生，總評標明示範模式', async () => {
    const { mine, myStudent, cookie } = await scenario();

    const res = await generate(cookie, mine);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { success: true, generated: 1, skipped: 0 });

    const row = await rawDb.one(
      'SELECT * FROM final_report WHERE ref_course_id=$1 AND ref_user_id=$2', [mine, myStudent.id]);
    assert.equal(Number(row.avg_score), 5);
    assert.equal(Number(row.theme_and_content_score), 5);
    assert.match(row.final_summarys, /示範模式/);
    assert.equal(row.model_name, '示範模式（未設定 AI）');
    // 沒有真的呼叫 AI，token 就該是 0，不要記假數字讓用量統計失真
    assert.equal(row.input_tokens, 0);
    assert.equal(row.output_tokens, 0);
  });

  test('沒有已批改作品的學生會被略過，不是報錯', async () => {
    const { mine, cookie } = await scenario();
    const idle = await seedUser('s3@test.edu.tw', '沒交作業的學生');
    await seedLearner(mine, idle.id, 8);

    const body = await (await generate(cookie, mine)).json();
    assert.equal(body.generated, 1);
    assert.equal(body.skipped, 1);
  });

  test('重複按不會重算，也不會產生第二筆', async () => {
    const { mine, myStudent, cookie } = await scenario();
    await generate(cookie, mine);
    const first = await rawDb.one(
      'SELECT id, created_at FROM final_report WHERE ref_user_id=$1', [myStudent.id]);

    const body = await (await generate(cookie, mine)).json();
    assert.equal(body.generated, 0, '已經有總結的學生不該重算');

    const rows = await rawDb.many('SELECT id FROM final_report WHERE ref_user_id=$1', [myStudent.id]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, first.id);
  });

  test('不能為別人的班產生 → 404，而且什麼都沒寫進去', async () => {
    const { theirs, cookie } = await scenario();
    assert.equal((await generate(cookie, theirs)).status, 404);
    const n = await rawDb.one('SELECT count(*)::int AS n FROM final_report WHERE ref_course_id=$1', [theirs]);
    assert.equal(n.n, 0);
  });

  test('未登入 → 401', async () => {
    const { mine } = await scenario();
    assert.equal((await generate(undefined, mine)).status, 401);
  });
});

describe('讀取期末總結', () => {
  test('帶得出姓名與座號，照座號排序', async () => {
    const { mine, me, task, cookie } = await scenario();
    // 再加一位座號比較小的學生，才驗得出排序
    const early = await seedUser('s4@test.edu.tw', '一號學生');
    await seedLearner(mine, early.id, 1);
    await gradedSubmission(mine, task, me.id, early.id, 3);
    await generate(cookie, mine);

    const rows = await (await listReports(cookie, mine)).json();
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r: any) => r.seat_no), [1, 7]);
    assert.deepEqual(rows.map((r: any) => r.student_name), ['一號學生', '我的學生']);
  });

  /**
   * 這是修掉的漏洞：路由原本取了 userId 卻沒往下傳，
   * getFinalReport 只用 course_id 查，任何教師都讀得到任何一班。
   */
  test('讀別班的期末總結 → 空的，不外洩姓名與評語', async () => {
    const { theirs, other, cookie } = await scenario();
    // 讓別人的班真的有資料，才驗得出擋掉的是「有東西但不給你」，
    // 而不是「本來就是空的」
    await rawDb.none(
      `INSERT INTO final_report (ref_user_id, ref_course_id, avg_score, created_by)
       SELECT ref_user_id, $1, 4, $2 FROM uc_learner WHERE ref_course_id=$1`, [theirs, other.id]);
    const before = await rawDb.one('SELECT count(*)::int AS n FROM final_report WHERE ref_course_id=$1', [theirs]);
    assert.equal(before.n, 1, '前置條件：別人的班要有一筆');

    const res = await listReports(cookie, theirs);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), []);
  });

  test('未登入 → 401', async () => {
    const { mine } = await scenario();
    assert.equal((await listReports(undefined, mine)).status, 401);
  });
});
