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

/**
 * 學生繳交（`POST /service/student/submit`）。
 *
 * 三件事要釘住：
 *   1. 草稿與送出是同一支端點、同一列（upsert），差別在 `is_submitted`
 *   2. 草稿不寫 `submited_time` —— 那一欄的意思是「什麼時候送出的」
 *   3. **批改過就不能再改** —— 少了這道擋，學生可以在老師批完之後把作文
 *      整篇換掉，分數與評語就會指向一段已經不存在的文字
 */
describe('學生繳交與草稿', () => {
  const submit = (cookie: string, assignmentId: string, content: string, isSubmitted?: boolean) =>
    req(srv, '/service/student/submit', cookie, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        assignment_id: assignmentId, content, pic_files: [], word_count: content.length,
        ...(isSubmitted === undefined ? {} : { is_submitted: isSubmitted }),
      }),
    });

  const rowOf = (assignmentId: string, userId: string) =>
    rawDb.oneOrNone(
      `SELECT id, content, is_submitted, submited_time FROM submission
       WHERE ref_assignment_id = $1 AND ref_user_id = $2`, [assignmentId, userId]);

  /**
   * 以**學生身分**登入的情境。
   *
   * ⚠️ `uc_learner` 一定要在 `login()` **之前**建好 —— `isLearner` 是登入當下
   *    算進 session 的，事後補資料列不會讓已經發出的 session 變成學生，
   *    打 /service/student/* 會拿到 403。（第一次寫這組測試就是這樣失敗的。）
   *
   * 假 IdP 固定回 ACCOUNT，所以讓同一個人既是這個班的授課教師也是學生。
   * 這在真實資料裡也成立 —— 實測有帳號同時具備兩種身分。
   */
  async function asStudent() {
    const me = await seedUser(ACCOUNT, '我');
    const school = await seedSchool();
    const course = await seedCourse(school, '我的班');
    await seedInstructor(course, me.id);
    await seedLearner(course, me.id, 1);
    const task = await seedTask(me.id);
    const assignment = await seedAssignment(course, task, me.id);
    return { me, course, assignment, cookie: await login(srv) };
  }

  test('存草稿：is_submitted = false，submited_time 留空', async () => {
    const s = await asStudent();
    const res = await submit(s.cookie, s.assignment, '草稿內容', false);
    assert.equal(res.status, 200);

    const row = await rowOf(s.assignment, s.me.id);
    assert.equal(row.is_submitted, false);
    assert.equal(row.submited_time, null, '草稿還沒送出，不該有送出時間');
  });

  test('草稿再送出：同一列，補上 submited_time', async () => {
    const s = await asStudent();
    await submit(s.cookie, s.assignment, '草稿內容', false);
    const draft = await rowOf(s.assignment, s.me.id);

    await submit(s.cookie, s.assignment, '正式內容', true);
    const sent = await rowOf(s.assignment, s.me.id);

    assert.equal(sent.id, draft.id, 'upsert 不該產生第二筆');
    assert.equal(sent.is_submitted, true);
    assert.equal(sent.content, '正式內容');
    assert.ok(sent.submited_time, '送出時要補上時間');
  });

  test('沒帶 is_submitted 時當成送出（舊前端的語意不能變）', async () => {
    const s = await asStudent();
    await submit(s.cookie, s.assignment, '直接送出');
    const row = await rowOf(s.assignment, s.me.id);
    assert.equal(row.is_submitted, true);
  });

  test('批改之後不能再改 → 409，內容原封不動', async () => {
    const s = await asStudent();
    await submit(s.cookie, s.assignment, '原本的作文', true);
    const before = await rowOf(s.assignment, s.me.id);

    await rawDb.none(
      `INSERT INTO submission_feedback (ref_submission_id, score, content, ref_user_id, is_ai, is_valid)
       VALUES ($1, 5, '{}', $2, true, true)`, [before.id, s.me.id]);

    const res = await submit(s.cookie, s.assignment, '偷偷換掉的作文', true);
    assert.equal(res.status, 409);

    const after = await rowOf(s.assignment, s.me.id);
    assert.equal(after.content, '原本的作文', '批改過的作文不可以被覆寫');
  });

  test('批改被重置之後又可以改了', async () => {
    const s = await asStudent();
    await submit(s.cookie, s.assignment, '原本的作文', true);
    const row = await rowOf(s.assignment, s.me.id);
    await rawDb.none(
      `INSERT INTO submission_feedback (ref_submission_id, score, content, ref_user_id, is_ai, is_valid)
       VALUES ($1, 5, '{}', $2, true, true)`, [row.id, s.me.id]);
    assert.equal((await submit(s.cookie, s.assignment, '改一次', true)).status, 409);

    // 老師重置批改（is_valid 轉 false）之後就不擋了
    await rawDb.none(
      `UPDATE submission_feedback SET is_valid = false WHERE ref_submission_id = $1`, [row.id]);
    assert.equal((await submit(s.cookie, s.assignment, '改一次', true)).status, 200);
    assert.equal((await rowOf(s.assignment, s.me.id)).content, '改一次');
  });
});
