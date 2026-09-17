/**
 * 批改：版本模型與授權。
 *
 * 批改結果的模型是**版本**不是欄位：任何時刻一份繳交最多只有一筆
 * `is_valid = true`，`is_ai` 標示那一版是 AI 產的還是教師改的。
 * 教師修改評語 = 舊的全部失效 + 寫一筆 `is_ai = false` 的新版本。
 *
 * 授權的部分是補上去的 —— 這三支先前**完全沒有檢查**：
 *   saveFeedback          任何教師都能批改任何一份作品
 *   returnFeedback        任何教師都能把別班的成績發還給學生（不可逆）
 *   resetBySubmissionId   任何教師都能重置任何一份作品的批改
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

const json = (body: unknown) => ({
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

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
  await seedLearner(mine, myStudent.id);
  await seedLearner(theirs, theirStudent.id);

  const task = await seedTask(me.id);
  const myAssignment = await seedAssignment(mine, task, me.id);
  const theirAssignment = await seedAssignment(theirs, task, other.id);

  return {
    me, other, mine, theirs,
    mySubmission: await seedSubmission(myAssignment, myStudent.id),
    theirSubmission: await seedSubmission(theirAssignment, theirStudent.id),
    cookie: await login(srv),
  };
}

/** 模擬 AI 先批過一次 */
async function aiGraded(submissionId: string, teacherId: string, score = 3) {
  await rawDb.none(
    `INSERT INTO submission_feedback (ref_submission_id, score, content, ref_user_id, is_ai, is_valid)
     VALUES ($1, $2, $3, $4, true, true)`,
    [submissionId, score, JSON.stringify({ score, response: '### AI 的評語' }), teacherId]);
}

const saveFeedback = (cookie: string, subId: string, score: number, content: unknown) =>
  req(srv, `/service/instructor/submissions/${subId}/feedback`, cookie,
      { method: 'POST', ...json({ score, analysis_content: content }) });

describe('教師修改評語 = 新版本，不是新欄位', () => {
  test('舊的全部失效，新的一筆 is_ai = false', async () => {
    const s = await scenario();
    await aiGraded(s.mySubmission, s.me.id, 3);

    const res = await saveFeedback(s.cookie, s.mySubmission, 5, { score: 5, response: '老師改過的評語' });
    assert.equal(res.status, 200);

    const rows = await rawDb.manyOrNone(
      `SELECT score, is_ai, is_valid FROM submission_feedback WHERE ref_submission_id = $1 ORDER BY id`,
      [s.mySubmission]);
    assert.equal(rows.length, 2, '歷史留著，不是覆蓋');
    assert.equal(rows[0].is_valid, false, 'AI 那一版被設為失效');
    assert.equal(rows[0].is_ai, true);
    assert.equal(rows[1].is_valid, true);
    assert.equal(rows[1].is_ai, false, '教師改的那一版');
    assert.equal(rows[1].score, 5);
  });

  test('任何時刻只有一筆 is_valid = true', async () => {
    const s = await scenario();
    await aiGraded(s.mySubmission, s.me.id);
    await saveFeedback(s.cookie, s.mySubmission, 4, { response: '第一次改' });
    await saveFeedback(s.cookie, s.mySubmission, 6, { response: '再改一次' });

    const { count } = await rawDb.one(
      `SELECT count(*)::int FROM submission_feedback WHERE ref_submission_id = $1 AND is_valid = true`,
      [s.mySubmission]);
    assert.equal(count, 1);
    const valid = await rawDb.one(
      `SELECT score FROM submission_feedback WHERE ref_submission_id = $1 AND is_valid = true`,
      [s.mySubmission]);
    assert.equal(valid.score, 6, '有效的是最新那一筆');
  });

  test('繳交清單只會帶出有效的那一版', async () => {
    const s = await scenario();
    await aiGraded(s.mySubmission, s.me.id, 3);
    await saveFeedback(s.cookie, s.mySubmission, 6, { response: '老師改的' });

    const assignmentId = (await rawDb.one(
      `SELECT ref_assignment_id::text AS id FROM submission WHERE id = $1`, [s.mySubmission])).id;
    const rows = await (await req(srv, `/service/instructor/assignments/${assignmentId}/submissions`, s.cookie)).json();
    const row = rows.find((r: { submission_id: string | null }) => r.submission_id);
    assert.equal(row.score, 6, '不該看到 AI 那一版的 3 分');
  });
});

  test('已發還的作品改完再存，仍然是已發還', async () => {
    const { mySubmission, me, cookie } = await scenario();
    await aiGraded(mySubmission, me.id, 5);
    // 老師發還
    await req(srv, '/service/instructor/submission_feedback/return', cookie,
      { method: 'POST', ...json({ submissionIds: [mySubmission] }) });

    await saveFeedback(cookie, mySubmission, 4, { score: 4, response: '改過的評語' });

    const row = await rawDb.one(
      `SELECT score, is_ai, is_returned FROM submission_feedback
        WHERE ref_submission_id=$1 AND is_valid=true`, [mySubmission]);
    assert.equal(Number(row.score), 4);
    assert.equal(row.is_ai, false, '教師改的版本 is_ai 要是 false');
    /*
      ⚠️ 這一條是實測抓到的：新列的 is_returned 吃預設值 false，
         於是老師改個分數就把已經發還的成績**無聲收回**，
         學生端從「已完成」退回「批閱中」。
    */
    assert.equal(row.is_returned, true, '已發還的作品改完仍然是已發還');
  });

  test('還沒發還的作品改完不會變成已發還', async () => {
    const { mySubmission, me, cookie } = await scenario();
    await aiGraded(mySubmission, me.id, 5);
    await saveFeedback(cookie, mySubmission, 4, { score: 4, response: '改過的評語' });

    const row = await rawDb.one(
      `SELECT is_returned FROM submission_feedback
        WHERE ref_submission_id=$1 AND is_valid=true`, [mySubmission]);
    assert.notEqual(row.is_returned, true);
  });

describe('授權：不能碰別班的批改', () => {
  test('批改別班的作品 → 403，而且什麼都沒寫進去', async () => {
    const s = await scenario();
    const res = await saveFeedback(s.cookie, s.theirSubmission, 6, { response: '我不該改得動' });
    assert.equal(res.status, 403);
    const { count } = await rawDb.one(
      `SELECT count(*)::int FROM submission_feedback WHERE ref_submission_id = $1`, [s.theirSubmission]);
    assert.equal(count, 0);
  });

  test('批改失敗時**不會**把別人既有的批改設成失效', async () => {
    // saveFeedback 的第一個動作是「把舊的全部設為失效」。授權檢查如果
    // 放在那之後，即使最後 403，別人的批改也已經被作廢了。
    const s = await scenario();
    await aiGraded(s.theirSubmission, s.other.id);
    await saveFeedback(s.cookie, s.theirSubmission, 6, { response: 'x' });
    const row = await rawDb.one(
      `SELECT is_valid FROM submission_feedback WHERE ref_submission_id = $1`, [s.theirSubmission]);
    assert.equal(row.is_valid, true, '別人的批改必須完好無損');
  });

  test('發還：別班的 id 混進陣列會被略過', async () => {
    // 這一支先前最危險 —— 收一個陣列就直接 UPDATE，
    // 而且副作用不可逆（學生已經看到成績了）
    const s = await scenario();
    await aiGraded(s.mySubmission, s.me.id);
    await aiGraded(s.theirSubmission, s.other.id);

    await req(srv, '/service/instructor/submission_feedback/return', s.cookie,
      { method: 'POST', ...json({ submissionIds: [s.mySubmission, s.theirSubmission] }) });

    const mine = await rawDb.one(
      `SELECT is_returned FROM submission_feedback WHERE ref_submission_id = $1`, [s.mySubmission]);
    const theirs = await rawDb.one(
      `SELECT is_returned FROM submission_feedback WHERE ref_submission_id = $1`, [s.theirSubmission]);
    assert.equal(mine.is_returned, true, '自己的班要發還成功');
    assert.equal(theirs.is_returned, false, '別班的絕對不能被發還');
  });

  test('重置別班的批改 → 404，而且對方的批改還有效', async () => {
    const s = await scenario();
    await aiGraded(s.theirSubmission, s.other.id);
    const res = await req(srv, `/service/instructor/grading/reset/${s.theirSubmission}`, s.cookie, { method: 'POST' });
    assert.equal(res.status, 404);
    const row = await rawDb.one(
      `SELECT is_valid FROM submission_feedback WHERE ref_submission_id = $1`, [s.theirSubmission]);
    assert.equal(row.is_valid, true);
  });

  test('重置自己的批改 → 退回未批改，歷史留著', async () => {
    const s = await scenario();
    await aiGraded(s.mySubmission, s.me.id);
    const res = await req(srv, `/service/instructor/grading/reset/${s.mySubmission}`, s.cookie, { method: 'POST' });
    assert.equal(res.status, 200);
    const rows = await rawDb.manyOrNone(
      `SELECT is_valid FROM submission_feedback WHERE ref_submission_id = $1`, [s.mySubmission]);
    assert.equal(rows.length, 1, '紀錄還在');
    assert.equal(rows[0].is_valid, false, '但已失效 —— 狀態退回 Pending');
  });
});

/**
 * AI 批改（`POST /service/instructor/grading/:submissionId`）。
 *
 * 測試環境刻意把 Vertex AI 的環境變數關掉（見 test/setup.ts），所以這裡跑到的
 * 是 dal/simulated_grading.ts 的決定性模擬批改 —— 既不會打真的 AI，
 * 也正好驗到「沒有憑證時仍要能跑完整條流程」這條規格。
 */
describe('AI 批改', () => {
  const autoGrade = (cookie: string, subId: string) =>
    req(srv, `/service/instructor/grading/${subId}`, cookie, { method: 'POST' });

  /** 那一筆有效批改的 content（後端存 JSON 字串） */
  const validFeedbackOf = async (subId: string) =>
    rawDb.oneOrNone(
      `SELECT score, content, is_ai, input_tokens, output_tokens
       FROM submission_feedback WHERE ref_submission_id=$1 AND is_valid=true`, [subId]);

  test('沒有 AI 憑證也能批完，評語標明示範模式', async () => {
    const { mySubmission, cookie } = await scenario();
    const res = await autoGrade(cookie, mySubmission);
    assert.equal(res.status, 200);

    const row = await validFeedbackOf(mySubmission);
    assert.ok(row, '應該要寫進一筆有效批改');
    assert.equal(row.is_ai, true);
    const parsed = JSON.parse(row.content);
    assert.match(parsed.response, /示範模式/);
  });

  test('模擬批改的三則建議有併進評語，不會安靜消失', async () => {
    const { mySubmission, cookie } = await scenario();
    await autoGrade(cookie, mySubmission);
    const row = await validFeedbackOf(mySubmission);
    const parsed = JSON.parse(row.content);
    assert.match(parsed.response, /### 修改建議/);
    // 三則建議各自一行
    assert.equal((parsed.response.match(/^- /gm) || []).length, 3);
  });

  test('決定性：同一篇重批兩次拿到同一個分數', async () => {
    const { mySubmission, cookie } = await scenario();
    await autoGrade(cookie, mySubmission);
    const first = await validFeedbackOf(mySubmission);
    await autoGrade(cookie, mySubmission);
    const second = await validFeedbackOf(mySubmission);
    assert.equal(Number(second.score), Number(first.score));
    assert.equal(JSON.parse(second.content).response, JSON.parse(first.content).response);
  });

  /**
   * 這是修掉的漏洞：權限檢查以前在 AI 呼叫**之後**才做，而且回傳值被忽略。
   * 寫入擋住了，但別班學生的作文與批改結果已經回給呼叫者、token 也燒掉了。
   */
  test('批改別班的作品 → 404，而且不回傳任何批改結果', async () => {
    const { theirSubmission, cookie } = await scenario();
    const res = await autoGrade(cookie, theirSubmission);
    assert.equal(res.status, 404);

    const body = await res.json().catch(() => ({}));
    assert.equal(body.result, undefined, '不可以把別班的批改結果回給呼叫者');

    assert.equal(await validFeedbackOf(theirSubmission), null);
  });

  test('批改別班的作品不會動到對方既有的批改', async () => {
    const { theirSubmission, other, cookie } = await scenario();
    await aiGraded(theirSubmission, other.id, 5);
    await autoGrade(cookie, theirSubmission);
    const row = await validFeedbackOf(theirSubmission);
    assert.ok(row, '對方原本那一筆必須還有效');
    assert.equal(Number(row.score), 5);
  });

  test('不存在的 submission → 404', async () => {
    const { cookie } = await scenario();
    assert.equal((await autoGrade(cookie, '999999999')).status, 404);
  });
});

/**
 * Phase 5 新增的無狀態 AI 端點。取代前端原本直接呼叫 Gemini 的那四支。
 * 這裡驗的是把關與參數檢查 —— 真正的 AI 呼叫在測試環境不會發生。
 */
describe('AI 端點：登入與參數', () => {
  const post = (path: string, cookie: string | undefined, body: unknown) =>
    req(srv, path, cookie, { method: 'POST', ...json(body) });

  const IMAGE_ENDPOINTS = ['/service/gemini/ocr_text', '/service/gemini/analyze_image'];

  test('未登入一律 401', async () => {
    for (const path of [...IMAGE_ENDPOINTS, '/service/gemini/rubric', '/service/gemini/grade']) {
      const res = await post(path, undefined, {});
      assert.equal(res.status, 401, `${path} 未登入應該回 401`);
    }
  });

  test('缺參數 → 400', async () => {
    const cookie = await login(srv);
    assert.equal((await post('/service/gemini/ocr_text', cookie, {})).status, 400);
    assert.equal((await post('/service/gemini/rubric', cookie, { topic: '只有題目' })).status, 400);
    assert.equal((await post('/service/gemini/grade', cookie, { content: '只有內容' })).status, 400);
  });

  test('非圖片的 mimeType → 400', async () => {
    const cookie = await login(srv);
    for (const path of IMAGE_ENDPOINTS) {
      const res = await post(path, cookie, { base64Image: 'AAAA', mimeType: 'application/pdf' });
      assert.equal(res.status, 400, `${path} 應該擋掉非圖片`);
    }
  });

  test('過大的圖片 → 413，不會送去 AI', async () => {
    const cookie = await login(srv);
    const huge = 'A'.repeat(11 * 1024 * 1024 + 1);
    const res = await post('/service/gemini/ocr_text', cookie, { base64Image: huge, mimeType: 'image/jpeg' });
    assert.equal(res.status, 413);
  });

  test('試批改沒有憑證時走模擬批改，而且不寫資料庫', async () => {
    const { cookie } = await scenario();
    const res = await post('/service/gemini/grade', cookie, { content: '一段測試用的作文內容。', topic: '測試題目' });
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.ok(Number.isInteger(body.totalScore));
    assert.match(body.feedback, /示範模式/);
    assert.equal(body.suggestions.length, 3);

    // 試批改是給教師試跑題目用的，不屬於任何學生
    const count = await rawDb.one('SELECT count(*)::int AS n FROM submission_feedback');
    assert.equal(count.n, 0);
  });
});
