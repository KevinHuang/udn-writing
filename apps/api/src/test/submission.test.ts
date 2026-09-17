/**
 * 繳交：狀態推導、清除繳交、作品標記、請假註記。
 */
import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { submissionStatusOf } from '@udn/shared';
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

describe('submissionStatusOf（純函式，前後端共用同一支）', () => {
  const base = { submissionId: '1', isSubmitted: true, hasValidFeedback: false, isReturned: false };

  test('名冊上有、沒有繳交紀錄 → Unsubmitted', () => {
    assert.equal(submissionStatusOf({ ...base, submissionId: null }), 'Unsubmitted');
  });

  test('寫了但沒送出 → Draft', () => {
    assert.equal(submissionStatusOf({ ...base, isSubmitted: false }), 'Draft');
  });

  test('已送出、還沒批改 → Pending', () => {
    assert.equal(submissionStatusOf(base), 'Pending');
  });

  test('批改完但還沒發還 → Graded（學生看不到分數）', () => {
    assert.equal(submissionStatusOf({ ...base, hasValidFeedback: true }), 'Graded');
  });

  test('已發還 → Published', () => {
    assert.equal(submissionStatusOf({ ...base, hasValidFeedback: true, isReturned: true }), 'Published');
  });

  test('重置批改（沒有有效批改了）退回 Pending，不是留在 Graded', () => {
    // 重置是把所有 is_valid 設成 false，歷史留著但狀態退回去
    assert.equal(submissionStatusOf({ ...base, hasValidFeedback: false, isReturned: true }), 'Pending');
  });

  test('草稿優先於批改結果', () => {
    // 正常操作走不到，但資料上可能出現。回 Draft 而不是 Graded ——
    // 防的是「學生看到一份自己沒送出的草稿被打了分數」
    assert.equal(
      submissionStatusOf({ ...base, isSubmitted: false, hasValidFeedback: true, isReturned: true }),
      'Draft',
    );
  });

  test('沒有繳交紀錄時，其他欄位一律不影響', () => {
    assert.equal(
      submissionStatusOf({ submissionId: null, isSubmitted: false, hasValidFeedback: true, isReturned: true }),
      'Unsubmitted',
    );
  });
});

/** 我的班、一位學生、一份作業與繳交。 */
async function scenario() {
  const me = await seedUser(ACCOUNT, '老師');
  const other = await seedUser('other@test.edu.tw', '別的老師');
  const school = await seedSchool();
  const mine = await seedCourse(school, '我的班');
  const theirs = await seedCourse(school, '別人的班');
  await seedInstructor(mine, me.id);
  await seedInstructor(theirs, other.id);
  const student = await seedUser('stu@test.edu.tw', '林同學');
  await seedLearner(mine, student.id, 7);
  const task = await seedTask(me.id);
  const assignment = await seedAssignment(mine, task, me.id);
  const submission = await seedSubmission(assignment, student.id);
  const theirAssignment = await seedAssignment(theirs, task, other.id);
  return { me, student, mine, theirs, task, assignment, submission, theirAssignment, cookie: await login(srv) };
}

describe('繳交清單帶得出推導需要的欄位', () => {
  test('未繳交的學生也在清單裡，submission_id 是 null', async () => {
    const s = await scenario();
    const second = await seedUser('stu2@test.edu.tw', '沒交的同學');
    await seedLearner(s.mine, second.id, 8);

    const rows = await (await req(srv, `/service/instructor/assignments/${s.assignment}/submissions`, s.cookie)).json();
    assert.equal(rows.length, 2);
    const nothing = rows.find((r: { student_name: string }) => r.student_name === '沒交的同學');
    assert.equal(nothing.submission_id, null, 'Unsubmitted 是「名冊 − 繳交」的差集');
    assert.equal(submissionStatusOf({
      submissionId: nothing.submission_id, isSubmitted: nothing.is_submitted,
      hasValidFeedback: !!nothing.feedback_id, isReturned: nothing.is_returned,
    }), 'Unsubmitted');
  });

  test('帶出 is_submitted 與座號', async () => {
    const s = await scenario();
    const rows = await (await req(srv, `/service/instructor/assignments/${s.assignment}/submissions`, s.cookie)).json();
    const row = rows.find((r: { submission_id: string | null }) => r.submission_id);
    assert.equal(row.is_submitted, true);
    assert.equal(row.seat_no, 7);
  });

  test('重置批改之後不會挑到失效的那一筆', async () => {
    // 先前的 SQL 只比對 created_time、沒有再過濾 is_valid，
    // 同一秒內同時有有效與無效紀錄時可能挑到剛剛才重置掉的舊分數
    const s = await scenario();
    await rawDb.none(
      `INSERT INTO submission_feedback (ref_submission_id, score, content, ref_user_id, is_valid, created_time)
       VALUES ($1, 3, '{}', $2, false, now()), ($1, 6, '{}', $2, false, now())`,
      [s.submission, s.me.id]);

    const rows = await (await req(srv, `/service/instructor/assignments/${s.assignment}/submissions`, s.cookie)).json();
    const row = rows.find((r: { submission_id: string | null }) => r.submission_id);
    assert.equal(row.feedback_id, null, '全部失效就等於沒有批改');
    assert.equal(submissionStatusOf({
      submissionId: row.submission_id, isSubmitted: row.is_submitted,
      hasValidFeedback: !!row.feedback_id, isReturned: row.is_returned,
    }), 'Pending');
  });
});

describe('清除繳交', () => {
  test('整筆刪掉，連同批改結果與作品標記', async () => {
    const s = await scenario();
    await rawDb.none(
      `INSERT INTO submission_feedback (ref_submission_id, score, content, ref_user_id) VALUES ($1, 5, '{}', $2)`,
      [s.submission, s.me.id]);
    await rawDb.none(
      `INSERT INTO submission_mark (ref_submission_id, kind, ref_user_id) VALUES ($1, 'featured', $2)`,
      [s.submission, s.me.id]);

    const res = await req(srv, `/service/instructor/submissions/${s.submission}`, s.cookie, { method: 'DELETE' });
    assert.equal(res.status, 200);

    for (const [table, col] of [['submission', 'id'], ['submission_feedback', 'ref_submission_id'],
                                ['submission_mark', 'ref_submission_id']] as const) {
      const { count } = await rawDb.one(`SELECT count(*)::int FROM ${table} WHERE ${col} = $1`, [s.submission]);
      assert.equal(count, 0, `${table} 要清乾淨`);
    }
  });

  test('刪掉之後那位學生回到「未繳交」，可以重新繳交', async () => {
    const s = await scenario();
    await req(srv, `/service/instructor/submissions/${s.submission}`, s.cookie, { method: 'DELETE' });
    const rows = await (await req(srv, `/service/instructor/assignments/${s.assignment}/submissions`, s.cookie)).json();
    assert.equal(rows.length, 1, '學生還在名冊上');
    assert.equal(rows[0].submission_id, null);
  });

  test('別人班的繳交 → 403', async () => {
    const s = await scenario();
    const theirStudent = await seedUser('s2@test.edu.tw', '別班學生');
    await seedLearner(s.theirs, theirStudent.id);
    const theirSub = await seedSubmission(s.theirAssignment, theirStudent.id);
    const res = await req(srv, `/service/instructor/submissions/${theirSub}`, s.cookie, { method: 'DELETE' });
    assert.equal(res.status, 403);
    assert.ok(await rawDb.oneOrNone(`SELECT 1 FROM submission WHERE id = $1`, [theirSub]));
  });
});

describe('作品標記（佳作／預選）', () => {
  const setMark = (cookie: string, subId: string, kind: string, marked: boolean) =>
    req(srv, `/service/instructor/submissions/${subId}/marks/${kind}`, cookie, { method: 'PUT', ...json({ marked }) });

  test('蓋章、列出、取消', async () => {
    const s = await scenario();
    await setMark(s.cookie, s.submission, 'featured', true);
    let marks = await (await req(srv, '/service/instructor/marks', s.cookie)).json();
    assert.equal(marks.length, 1);
    assert.equal(marks[0].kind, 'featured');

    await setMark(s.cookie, s.submission, 'preselect', true);
    marks = await (await req(srv, '/service/instructor/marks', s.cookie)).json();
    assert.equal(marks.length, 2, '兩種章可以同時存在');

    await setMark(s.cookie, s.submission, 'featured', false);
    marks = await (await req(srv, '/service/instructor/marks', s.cookie)).json();
    assert.equal(marks.length, 1, '取消是整列刪掉，不是留旗標');
    assert.equal(marks[0].kind, 'preselect');
  });

  test('重複蓋同一種章不會變成兩列', async () => {
    const s = await scenario();
    await setMark(s.cookie, s.submission, 'featured', true);
    await setMark(s.cookie, s.submission, 'featured', true);
    const { count } = await rawDb.one(
      `SELECT count(*)::int FROM submission_mark WHERE ref_submission_id = $1 AND kind = 'featured'`, [s.submission]);
    assert.equal(count, 1);
  });

  test('不認得的章 → 400', async () => {
    const s = await scenario();
    assert.equal((await setMark(s.cookie, s.submission, 'gold_star', true)).status, 400);
  });

  test('蓋在別人班的作品上 → 403', async () => {
    const s = await scenario();
    const theirStudent = await seedUser('s2@test.edu.tw', '別班學生');
    await seedLearner(s.theirs, theirStudent.id);
    const theirSub = await seedSubmission(s.theirAssignment, theirStudent.id);
    assert.equal((await setMark(s.cookie, theirSub, 'featured', true)).status, 403);
  });

  test('看不到別人班的標記', async () => {
    const s = await scenario();
    const theirStudent = await seedUser('s2@test.edu.tw', '別班學生');
    await seedLearner(s.theirs, theirStudent.id);
    const theirSub = await seedSubmission(s.theirAssignment, theirStudent.id);
    await rawDb.none(`INSERT INTO submission_mark (ref_submission_id, kind) VALUES ($1, 'featured')`, [theirSub]);
    assert.deepEqual(await (await req(srv, '/service/instructor/marks', s.cookie)).json(), []);
  });
});

describe('請假註記', () => {
  const setLeave = (cookie: string, aId: string, sId: string, onLeave: boolean) =>
    req(srv, `/service/instructor/assignments/${aId}/leaves/${sId}`, cookie, { method: 'PUT', ...json({ onLeave }) });

  test('標記、列出、取消', async () => {
    const s = await scenario();
    await setLeave(s.cookie, s.assignment, s.student.id, true);
    let leaves = await (await req(srv, '/service/instructor/leaves', s.cookie)).json();
    assert.equal(leaves.length, 1);
    assert.equal(String(leaves[0].ref_user_id), s.student.id);

    await setLeave(s.cookie, s.assignment, s.student.id, false);
    leaves = await (await req(srv, '/service/instructor/leaves', s.cookie)).json();
    assert.deepEqual(leaves, []);
  });

  test('重複標記不會變成兩列', async () => {
    const s = await scenario();
    await setLeave(s.cookie, s.assignment, s.student.id, true);
    await setLeave(s.cookie, s.assignment, s.student.id, true);
    const { count } = await rawDb.one(`SELECT count(*)::int FROM assignment_leave`, []);
    assert.equal(count, 1);
  });

  test('別人班的作業 → 標不上去', async () => {
    const s = await scenario();
    await setLeave(s.cookie, s.theirAssignment, s.student.id, true);
    const { count } = await rawDb.one(`SELECT count(*)::int FROM assignment_leave`, []);
    assert.equal(count, 0);
  });

  test('onLeave 不是布林 → 400', async () => {
    const s = await scenario();
    const res = await req(srv, `/service/instructor/assignments/${s.assignment}/leaves/${s.student.id}`,
      s.cookie, { method: 'PUT', ...json({ onLeave: 'yes' }) });
    assert.equal(res.status, 400);
  });

  test('刪掉作業時請假註記跟著走（外鍵 CASCADE）', async () => {
    const s = await scenario();
    await setLeave(s.cookie, s.assignment, s.student.id, true);
    await req(srv, `/service/instructor/assignments/${s.assignment}`, s.cookie, { method: 'DELETE' });
    const { count } = await rawDb.one(`SELECT count(*)::int FROM assignment_leave`, []);
    assert.equal(count, 0);
  });
});

/**
 * 重置繳交（`POST /submissions/:id/reset`）。
 *
 * 這一支做的是把 `ref_user_id` 變成負數 —— 把作品從學生身上摘掉。
 * 系統裡沒有任何地方會把負數讀回來，所以實際上是不可逆的。
 *
 * `SubmissionHelper.resetSubmissions()` 原本**連 instructorId 參數都沒有**，
 * WHERE 只有 id。任何一位合法教師拿任意 submissionId 就能摘掉別班學生的作文。
 * 而且它後面還跟著一支**有**把關的 resetBySubmissionId —— 打別班時
 * 第一支成功、第二支被擋，留下「作文沒有主人、批改卻還有效」的半毀狀態。
 */
describe('重置繳交', () => {
  const reset = (cookie: string | undefined, subId: string) =>
    req(srv, `/service/instructor/submissions/${subId}/reset`, cookie, { method: 'POST' });

  const ownerOf = async (subId: string) =>
    (await rawDb.one('SELECT ref_user_id FROM submission WHERE id=$1', [subId])).ref_user_id;

  test('重置自己班的作品：擁有者變成負數，批改也失效', async () => {
    const s = await scenario();
    await rawDb.none(
      `INSERT INTO submission_feedback (ref_submission_id, score, content, ref_user_id, is_ai, is_valid)
       VALUES ($1, 4, '{}', $2, true, true)`, [s.submission, s.me.id]);

    const res = await reset(s.cookie, s.submission);
    assert.equal(res.status, 200);

    assert.equal(String(await ownerOf(s.submission)), String(-Number(s.student.id)));
    const fb = await rawDb.one(
      'SELECT is_valid FROM submission_feedback WHERE ref_submission_id=$1', [s.submission]);
    assert.equal(fb.is_valid, false);
  });

  test('重置別班的作品 → 404，學生的作文原封不動', async () => {
    const s = await scenario();
    const otherStudent = await seedUser('stu9@test.edu.tw', '別班同學');
    await seedLearner(s.theirs, otherStudent.id, 1);
    const theirSubmission = await seedSubmission(s.theirAssignment, otherStudent.id);

    const res = await reset(s.cookie, theirSubmission);
    assert.equal(res.status, 404);

    // 這是漏洞的核心：以前這裡會變成負數
    assert.equal(String(await ownerOf(theirSubmission)), String(otherStudent.id));
  });

  /**
   * 第一支被擋就必須停下來。以前兩支各自判斷，打別班時第一支成功、
   * 第二支被擋，結果是作品沒有主人、批改卻還掛著 is_valid = true。
   */
  test('擋下來的時候，別班既有的批改不會被連帶失效', async () => {
    const s = await scenario();
    const otherStudent = await seedUser('stu9@test.edu.tw', '別班同學');
    await seedLearner(s.theirs, otherStudent.id, 1);
    const theirSubmission = await seedSubmission(s.theirAssignment, otherStudent.id);
    await rawDb.none(
      `INSERT INTO submission_feedback (ref_submission_id, score, content, ref_user_id, is_ai, is_valid)
       VALUES ($1, 5, '{}', $2, true, true)`, [theirSubmission, s.me.id]);

    await reset(s.cookie, theirSubmission);

    const fb = await rawDb.one(
      'SELECT is_valid FROM submission_feedback WHERE ref_submission_id=$1', [theirSubmission]);
    assert.equal(fb.is_valid, true, '別班的批改必須維持有效');
  });

  test('不存在的 submission → 404', async () => {
    const s = await scenario();
    assert.equal((await reset(s.cookie, '999999999')).status, 404);
  });

  test('未登入 → 401', async () => {
    const s = await scenario();
    assert.equal((await reset(undefined, s.submission)).status, 401);
  });
});
