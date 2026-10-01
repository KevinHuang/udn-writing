/**
 * 兩個資料外洩的修補（2026-10-01）。
 *
 * 1. GET /service/instructor/courses/:course_id/tasks/:task_ids/scores
 *    - 以前沒有範圍檢查：改網址上的班級編號就拿得到別班的分數
 *    - 以前 task_ids 直接拼進 SQL：網址上可以塞任意 SQL
 *
 * 2. 學生端的批改結果
 *    - 以前不論發還與否，分數與評語都送到學生的瀏覽器，只靠畫面不顯示
 *    - GET /service/student/my_assignments 與 GET /service/student/submission_feedback 都是
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

const addFeedback = (submissionId: string, userId: string, score: number, returned: boolean) =>
  rawDb.none(
    `INSERT INTO submission_feedback (ref_submission_id, score, content, ref_user_id, is_ai, is_valid, is_returned)
     VALUES ($1, $2, $3, $4, true, true, $5)`,
    [submissionId, score, JSON.stringify({ score, response: '老師還沒確認的評語' }), userId, returned],
  );

describe('成績查詢：範圍檢查與 SQL 注入', () => {
  /** 我的班與別人的班各一位學生、各批改一篇，用同一個題目 */
  async function scenario() {
    const me = await seedUser(ACCOUNT, '我');
    const other = await seedUser('other@test.edu.tw', '別的老師');
    const school = await seedSchool();
    const mine = await seedCourse(school, '我的班');
    const theirs = await seedCourse(school, '別人的班');
    await seedInstructor(mine, me.id);
    await seedInstructor(theirs, other.id);
    const task = await seedTask(me.id);

    const myStudent = await seedUser('s1@test.edu.tw', '我的學生');
    const theirStudent = await seedUser('s2@test.edu.tw', '別班學生');
    await seedLearner(mine, myStudent.id);
    await seedLearner(theirs, theirStudent.id);
    const mySub = await seedSubmission(await seedAssignment(mine, task, me.id), myStudent.id);
    const theirSub = await seedSubmission(await seedAssignment(theirs, task, other.id), theirStudent.id);
    await addFeedback(mySub, me.id, 5, true);
    await addFeedback(theirSub, other.id, 6, true);
    return { mine, theirs, task, cookie: await login(srv) };
  }

  const scores = (cookie: string, courseId: string, taskIds: string) =>
    req(srv, `/service/instructor/courses/${courseId}/tasks/${encodeURIComponent(taskIds)}/scores`, cookie);

  test('自己的班照常查得到（回傳形狀不變，舊前端在用）', async () => {
    const { mine, task, cookie } = await scenario();
    const res = await scores(cookie, mine, task);
    assert.equal(res.status, 200);
    const rows = await res.json();
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].score), 5);
    assert.ok('ref_submission_id' in rows[0] && 'raw_score' in rows[0] && 'sub_scores' in rows[0]);
  });

  test('多個題目用逗號分隔照樣可以', async () => {
    const { mine, task, cookie } = await scenario();
    const res = await scores(cookie, mine, `${task},999999`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).length, 1);
  });

  test('別人的班 → 404，拿不到任何分數', async () => {
    const { theirs, task, cookie } = await scenario();
    const res = await scores(cookie, theirs, task);
    assert.equal(res.status, 404);
  });

  test('題目編號塞 SQL → 400，不會執行', async () => {
    const { mine, task, cookie } = await scenario();
    for (const bad of [
      `${task}) OR (1=1`,
      `${task}); DELETE FROM submission_feedback; --`,
      `${task} UNION SELECT 1`,
      'abc',
      `${task},`,
    ]) {
      const res = await scores(cookie, mine, bad);
      assert.equal(res.status, 400, bad);
    }
    // 資料都還在
    const { n } = await rawDb.one(`SELECT count(*)::int AS n FROM submission_feedback`);
    assert.equal(n, 2);
  });

  test('班級編號不是數字 → 400', async () => {
    const { task, cookie } = await scenario();
    assert.equal((await scores(cookie, '1 OR 1=1', task)).status, 400);
  });
});

describe('學生端：發還之前拿不到分數與評語', () => {
  /** 同一個帳號是這個班的學生（假 IdP 固定回 ACCOUNT，uc_learner 要在登入前建好） */
  async function asStudent() {
    const me = await seedUser(ACCOUNT, '我');
    const teacher = await seedUser('t@test.edu.tw', '老師');
    const school = await seedSchool();
    const course = await seedCourse(school, '我的班');
    await seedInstructor(course, teacher.id);
    await seedLearner(course, me.id, 1);
    const task = await seedTask(teacher.id);
    const assignment = await seedAssignment(course, task, teacher.id);
    const submission = await seedSubmission(assignment, me.id);
    return { me, teacher, assignment, submission, cookie: await login(srv) };
  }

  const myRow = async (cookie: string, assignmentId: string) => {
    const rows = await (await req(srv, '/service/student/my_assignments', cookie)).json();
    return rows.find((r: { assignment_id: string }) => String(r.assignment_id) === String(assignmentId));
  };

  test('已批改、還沒發還：my_assignments 不帶分數與評語，但看得出「已批改」', async () => {
    const s = await asStudent();
    await addFeedback(s.submission, s.teacher.id, 6, false);
    const row = await myRow(s.cookie, s.assignment);
    assert.ok(row, '作業要在清單裡');
    assert.equal(row.score, null);
    assert.equal(row.feedback_content, null);
    assert.equal(row.is_ai, null);
    assert.equal(row.has_feedback, true, '前端靠這個顯示「已批改、待發還」');
    assert.equal(row.is_returned, false);
  });

  test('發還之後：my_assignments 帶分數與評語', async () => {
    const s = await asStudent();
    await addFeedback(s.submission, s.teacher.id, 6, true);
    const row = await myRow(s.cookie, s.assignment);
    assert.equal(Number(row.score), 6);
    assert.ok(row.feedback_content);
  });

  test('已批改、還沒發還：submission_feedback 跟「還沒批改」一樣是 204 沒有內容', async () => {
    const s = await asStudent();
    await addFeedback(s.submission, s.teacher.id, 6, false);
    const res = await req(srv, `/service/student/submission_feedback?submission_id=${s.submission}`, s.cookie);
    assert.equal(res.status, 204);
    const body = await res.text();
    assert.ok(!body.includes('老師還沒確認的評語'), body);
    assert.ok(!/"score"\s*:\s*6/.test(body), body);
  });

  test('發還之後：submission_feedback 回傳批改結果', async () => {
    const s = await asStudent();
    await addFeedback(s.submission, s.teacher.id, 6, true);
    const res = await req(srv, `/service/student/submission_feedback?submission_id=${s.submission}`, s.cookie);
    const body = await res.text();
    assert.ok(body.includes('老師還沒確認的評語'));
  });
});

describe('學生的「我的作品集」：原稿、佳作標記、公開意願', () => {
  async function asStudent() {
    const me = await seedUser(ACCOUNT, '我');
    const teacher = await seedUser('t@test.edu.tw', '老師');
    const school = await seedSchool();
    const course = await seedCourse(school, '我的班');
    await seedInstructor(course, teacher.id);
    await seedLearner(course, me.id, 1);
    const task = await seedTask(teacher.id);
    const assignment = await seedAssignment(course, task, teacher.id);
    const submission = await seedSubmission(assignment, me.id);
    return { me, teacher, course, task, assignment, submission, cookie: await login(srv) };
  }

  const mark = (submissionId: string, kind: 'featured' | 'preselect') =>
    rawDb.none(`INSERT INTO submission_mark (ref_submission_id, kind) VALUES ($1, $2)`, [submissionId, kind]);

  const myRow = async (cookie: string, assignmentId: string) => {
    const rows = await (await req(srv, '/service/student/my_assignments', cookie)).json();
    return rows.find((r: { assignment_id: string }) => String(r.assignment_id) === String(assignmentId));
  };

  const putConsent = (cookie: string, submissionId: string, body: unknown) =>
    req(srv, `/service/student/submissions/${submissionId}/publish-consent`, cookie, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });

  test('帶出學生自己的原稿路徑', async () => {
    const s = await asStudent();
    await rawDb.none(`UPDATE submission SET pic_files = $2::jsonb WHERE id = $1`,
      [s.submission, JSON.stringify(['submit/assign_1/a.jpg'])]);
    const row = await myRow(s.cookie, s.assignment);
    assert.deepEqual(row.pic_files, ['submit/assign_1/a.jpg']);
  });

  test('佳作：還沒發還是 false，發還之後才是 true', async () => {
    const s = await asStudent();
    await mark(s.submission, 'featured');
    await addFeedback(s.submission, s.teacher.id, 6, false);
    assert.equal((await myRow(s.cookie, s.assignment)).is_featured, false);
    await rawDb.none(`UPDATE submission_feedback SET is_returned = true WHERE ref_submission_id = $1`, [s.submission]);
    assert.equal((await myRow(s.cookie, s.assignment)).is_featured, true);
  });

  test('只蓋了預選：發還之後也是 false —— 預選學生看不到', async () => {
    const s = await asStudent();
    await mark(s.submission, 'preselect');
    await addFeedback(s.submission, s.teacher.id, 6, true);
    assert.equal((await myRow(s.cookie, s.assignment)).is_featured, false);
  });

  test('公開意願：沒設定過是 null；已發還的佳作可以設，讀得回來', async () => {
    const s = await asStudent();
    await mark(s.submission, 'featured');
    await addFeedback(s.submission, s.teacher.id, 6, true);
    assert.equal((await myRow(s.cookie, s.assignment)).publish_consent, null);

    assert.equal((await putConsent(s.cookie, s.submission, { willing: true })).status, 200);
    assert.equal((await myRow(s.cookie, s.assignment)).publish_consent, true);
    assert.equal((await putConsent(s.cookie, s.submission, { willing: false })).status, 200);
    assert.equal((await myRow(s.cookie, s.assignment)).publish_consent, false);
  });

  test('公開意願：還沒發還、或不是佳作 → 404，不寫入', async () => {
    const s = await asStudent();
    await addFeedback(s.submission, s.teacher.id, 6, true);
    assert.equal((await putConsent(s.cookie, s.submission, { willing: true })).status, 404, '不是佳作');

    await mark(s.submission, 'featured');
    await rawDb.none(`UPDATE submission_feedback SET is_returned = false WHERE ref_submission_id = $1`, [s.submission]);
    assert.equal((await putConsent(s.cookie, s.submission, { willing: true })).status, 404, '還沒發還');

    const { n } = await rawDb.one(`SELECT count(*)::int AS n FROM submission_publish_consent`);
    assert.equal(n, 0);
  });

  test('公開意願：不能替別人設定', async () => {
    const s = await asStudent();
    const other = await seedUser('s9@test.edu.tw', '別的學生');
    await seedLearner(s.course, other.id, 2);
    const otherAssignment = await seedAssignment(s.course, s.task, s.teacher.id);
    const theirs = await seedSubmission(otherAssignment, other.id);
    await mark(theirs, 'featured');
    await addFeedback(theirs, s.teacher.id, 6, true);
    assert.equal((await putConsent(s.cookie, theirs, { willing: true })).status, 404);
  });

  test('公開意願：格式不對 → 400', async () => {
    const s = await asStudent();
    for (const body of [{}, { willing: 'yes' }, { willing: 1 }]) {
      assert.equal((await putConsent(s.cookie, s.submission, body)).status, 400, JSON.stringify(body));
    }
  });
});
