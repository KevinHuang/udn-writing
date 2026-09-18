/**
 * 作業：授權、狀態語意、刪除連鎖。
 *
 * 這一支蓋的三件事都曾經是壞的：
 *   1. 四支查詢收了 user_id 卻沒放進 WHERE —— 任何教師都能讀寫別人班的作業
 *   2. opened_at 在「關閉」時也被寫成 NOW() —— Draft 與 Closed 從此分不出來
 *   3. 刪作業沒有清底下的繳交與批改 —— 留下孤兒資料
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

/** 我的班、別人的班，各一份作業。 */
async function twoCourses() {
  const me = await seedUser(ACCOUNT, '我');
  const other = await seedUser('other@test.edu.tw', '別人');
  const school = await seedSchool();
  const mine = await seedCourse(school, '我的班');
  const theirs = await seedCourse(school, '別人的班');
  await seedInstructor(mine, me.id);
  await seedInstructor(theirs, other.id);
  const task = await seedTask(me.id);
  return {
    me, other, mine, theirs, task,
    myAssignment: await seedAssignment(mine, task, me.id),
    theirAssignment: await seedAssignment(theirs, task, other.id),
    cookie: await login(srv),
  };
}

describe('授權：不能碰別人班的作業', () => {
  test('讀別人班的作業清單 → 空的，不是別人的資料', async () => {
    const s = await twoCourses();
    const rows = await (await req(srv, `/service/instructor/courses/${s.theirs}/assignments`, s.cookie)).json();
    assert.deepEqual(rows, []);
    const ok = await (await req(srv, `/service/instructor/courses/${s.mine}/assignments`, s.cookie)).json();
    assert.equal(ok.length, 1);
  });

  test('開關別人班的作業 → 404', async () => {
    const s = await twoCourses();
    const res = await req(srv, `/service/instructor/assignments/${s.theirAssignment}/status`, s.cookie,
      { method: 'PUT', ...json({ opened: true }) });
    assert.equal(res.status, 404);
    const row = await rawDb.one(`SELECT opened FROM assignment WHERE id=$1`, [s.theirAssignment]);
    assert.equal(row.opened, true, '原本就是 true，不該被動到（seedAssignment 建的是 opened=true）');
  });

  test('把作業派進別人的班 → 403', async () => {
    const s = await twoCourses();
    const res = await req(srv, `/service/instructor/courses/${s.theirs}/assignments`, s.cookie,
      { method: 'POST', ...json({ ref_task_id: s.task }) });
    assert.equal(res.status, 403);
    const { count } = await rawDb.one(`SELECT count(*)::int FROM assignment WHERE ref_course_id=$1`, [s.theirs]);
    assert.equal(count, 1, '別人的班還是只有原本那一份');
  });

  test('換掉別人班作業的題目 → 404', async () => {
    const s = await twoCourses();
    const other = await seedTask(s.me.id, '換成這題');
    const res = await req(srv, `/service/instructor/assignments/${s.theirAssignment}/task`, s.cookie,
      { method: 'PUT', ...json({ ref_task_id: other }) });
    assert.equal(res.status, 404);
  });

  test('刪別人班的作業 → 403', async () => {
    const s = await twoCourses();
    const res = await req(srv, `/service/instructor/assignments/${s.theirAssignment}`, s.cookie, { method: 'DELETE' });
    assert.equal(res.status, 403);
    assert.ok(await rawDb.oneOrNone(`SELECT 1 FROM assignment WHERE id=$1`, [s.theirAssignment]));
  });

  test('重新排序別人的班 → 403', async () => {
    const s = await twoCourses();
    const res = await req(srv, `/service/instructor/courses/${s.theirs}/assignments/order`, s.cookie,
      { method: 'PUT', ...json({ orderedIds: [s.theirAssignment] }) });
    assert.equal(res.status, 403);
  });
});

describe('狀態：Draft / Published / Closed 分得出來', () => {
  test('關閉時不會覆蓋 opened_at —— 否則 Draft 與 Closed 混在一起', async () => {
    const s = await twoCourses();
    // 先收回成未開放，而且從來沒開過的話 opened_at 應該還是 null
    await rawDb.none(`UPDATE assignment SET opened=false, opened_at=NULL WHERE id=$1`, [s.myAssignment]);

    // 開啟 → opened_at 被寫入
    await req(srv, `/service/instructor/assignments/${s.myAssignment}/status`, s.cookie,
      { method: 'PUT', ...json({ opened: true }) });
    const opened = await rawDb.one(`SELECT opened, opened_at FROM assignment WHERE id=$1`, [s.myAssignment]);
    assert.equal(opened.opened, true);
    assert.ok(opened.opened_at, '開啟要記下第一次開放的時間');

    // 關閉 → opened 變 false，但 opened_at **保留**
    await req(srv, `/service/instructor/assignments/${s.myAssignment}/status`, s.cookie,
      { method: 'PUT', ...json({ opened: false }) });
    const closed = await rawDb.one(`SELECT opened, opened_at FROM assignment WHERE id=$1`, [s.myAssignment]);
    assert.equal(closed.opened, false);
    assert.deepEqual(closed.opened_at, opened.opened_at, 'opened_at 不該被關閉動作蓋掉');
  });

  test('再次開啟不會改掉第一次開放的時間', async () => {
    const s = await twoCourses();
    const first = (await rawDb.one(`SELECT opened_at FROM assignment WHERE id=$1`, [s.myAssignment])).opened_at;
    await req(srv, `/service/instructor/assignments/${s.myAssignment}/status`, s.cookie,
      { method: 'PUT', ...json({ opened: false }) });
    await req(srv, `/service/instructor/assignments/${s.myAssignment}/status`, s.cookie,
      { method: 'PUT', ...json({ opened: true }) });
    const now = (await rawDb.one(`SELECT opened_at FROM assignment WHERE id=$1`, [s.myAssignment])).opened_at;
    assert.deepEqual(now, first);
  });
});

describe('截止日與排序', () => {
  test('建立時可以帶截止日；不帶就是 NULL（沒有截止日）', async () => {
    const s = await twoCourses();
    const withDue = await (await req(srv, `/service/instructor/courses/${s.mine}/assignments`, s.cookie,
      { method: 'POST', ...json({ ref_task_id: s.task, deadline: '2026-12-31T15:59:00.000Z', allow_late_submission: true }) })).json();
    assert.ok(withDue.deadline);
    assert.equal(withDue.allow_late_submission, true);

    const without = await (await req(srv, `/service/instructor/courses/${s.mine}/assignments`, s.cookie,
      { method: 'POST', ...json({ ref_task_id: s.task }) })).json();
    assert.equal(without.deadline, null, '預設不設截止日 —— 這是實際的操作習慣');
    assert.equal(without.allow_late_submission, false);
  });

  test('新作業自動接在該班最後面', async () => {
    const s = await twoCourses();
    const a = await (await req(srv, `/service/instructor/courses/${s.mine}/assignments`, s.cookie,
      { method: 'POST', ...json({ ref_task_id: s.task }) })).json();
    const b = await (await req(srv, `/service/instructor/courses/${s.mine}/assignments`, s.cookie,
      { method: 'POST', ...json({ ref_task_id: s.task }) })).json();
    assert.ok(b.sort_order > a.sort_order);
  });

  test('重新排序整個班', async () => {
    const s = await twoCourses();
    const a = await (await req(srv, `/service/instructor/courses/${s.mine}/assignments`, s.cookie,
      { method: 'POST', ...json({ ref_task_id: s.task }) })).json();
    const b = await (await req(srv, `/service/instructor/courses/${s.mine}/assignments`, s.cookie,
      { method: 'POST', ...json({ ref_task_id: s.task }) })).json();

    await req(srv, `/service/instructor/courses/${s.mine}/assignments/order`, s.cookie,
      { method: 'PUT', ...json({ orderedIds: [String(b.id), String(a.id), s.myAssignment] }) });

    const rows = await (await req(srv, `/service/instructor/courses/${s.mine}/assignments`, s.cookie)).json();
    assert.deepEqual(rows.map((r: { id: string }) => String(r.id)),
                     [String(b.id), String(a.id), s.myAssignment]);
  });

  test('orderedIds 不是字串陣列 → 400', async () => {
    const s = await twoCourses();
    const res = await req(srv, `/service/instructor/courses/${s.mine}/assignments/order`, s.cookie,
      { method: 'PUT', ...json({ orderedIds: [1, 2] }) });
    assert.equal(res.status, 400);
  });
});

describe('刪除作業的連鎖清理', () => {
  test('底下的繳交、批改結果、作品標記、請假註記全部要清乾淨', async () => {
    const s = await twoCourses();
    const student = await seedUser('stu@test.edu.tw', '學生');
    await seedLearner(s.mine, student.id);
    const sub = await seedSubmission(s.myAssignment, student.id);
    await rawDb.none(
      `INSERT INTO submission_feedback (ref_submission_id, score, content, ref_user_id) VALUES ($1, 5, '{}', $2)`,
      [sub, s.me.id]);
    await rawDb.none(
      `INSERT INTO submission_mark (ref_submission_id, kind, ref_user_id) VALUES ($1, 'featured', $2)`,
      [sub, s.me.id]);
    await rawDb.none(
      `INSERT INTO assignment_leave (ref_assignment_id, ref_user_id) VALUES ($1, $2)`,
      [s.myAssignment, student.id]);

    const res = await req(srv, `/service/instructor/assignments/${s.myAssignment}`, s.cookie, { method: 'DELETE' });
    assert.equal(res.status, 200);

    // 資料庫幾乎沒有外鍵，少刪一層就留下孤兒 —— 逐張確認
    for (const [table, where, param] of [
      ['assignment', 'id', s.myAssignment],
      ['submission', 'ref_assignment_id', s.myAssignment],
      ['submission_feedback', 'ref_submission_id', sub],
      ['submission_mark', 'ref_submission_id', sub],
      ['assignment_leave', 'ref_assignment_id', s.myAssignment],
    ] as const) {
      const { count } = await rawDb.one(`SELECT count(*)::int FROM ${table} WHERE ${where} = $1`, [param]);
      assert.equal(count, 0, `${table} 應該被清乾淨`);
    }
  });

  test('不會誤傷別的作業', async () => {
    const s = await twoCourses();
    const keep = await seedAssignment(s.mine, s.task, s.me.id);
    const student = await seedUser('stu@test.edu.tw', '學生');
    const keepSub = await seedSubmission(keep, student.id);

    await req(srv, `/service/instructor/assignments/${s.myAssignment}`, s.cookie, { method: 'DELETE' });

    assert.ok(await rawDb.oneOrNone(`SELECT 1 FROM assignment WHERE id=$1`, [keep]));
    assert.ok(await rawDb.oneOrNone(`SELECT 1 FROM submission WHERE id=$1`, [keepSub]));
  });
});

/**
 * 更換題目。
 *
 * 換了題目之後，學生寫的還是舊題目的作文、老師打的還是舊題目的分數 ——
 * 留著就是把一篇「那次失敗之後」掛在「給未來自己的一封信」底下。
 *
 * 前端的換題視窗早就把這件事寫在畫面上了（「換題後會全部刪除，無法復原」），
 * 但後端原本只改 ref_task_id，什麼都沒刪 —— 對老師說了不會發生的事。
 */
describe('更換題目', () => {
  const swap = (cookie: string, assignmentId: string, taskId: string) =>
    req(srv, `/service/instructor/assignments/${assignmentId}/task`, cookie, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ref_task_id: taskId }),
    });

  test('題目換掉，底下的繳交、批改、作品標記一併清乾淨', async () => {
    const s = await twoCourses();
    const student = await seedUser('stu@test.edu.tw', '學生');
    await seedLearner(s.mine, student.id);
    const sub = await seedSubmission(s.myAssignment, student.id);
    await rawDb.none(
      `INSERT INTO submission_feedback (ref_submission_id, score, content, ref_user_id) VALUES ($1, 5, '{}', $2)`,
      [sub, s.me.id]);
    await rawDb.none(
      `INSERT INTO submission_mark (ref_submission_id, kind, ref_user_id) VALUES ($1, 'featured', $2)`,
      [sub, s.me.id]);

    const newTask = await seedTask(s.me.id, '換過去的新題目');
    const res = await swap(s.cookie, s.myAssignment, newTask);
    assert.equal(res.status, 200);

    const a = await rawDb.one('SELECT ref_task_id FROM assignment WHERE id=$1', [s.myAssignment]);
    assert.equal(String(a.ref_task_id), String(newTask), '題目要真的換掉');

    for (const [table, where, param] of [
      ['submission', 'ref_assignment_id', s.myAssignment],
      ['submission_feedback', 'ref_submission_id', sub],
      ['submission_mark', 'ref_submission_id', sub],
    ] as const) {
      const { count } = await rawDb.one(`SELECT count(*)::int FROM ${table} WHERE ${where} = $1`, [param]);
      assert.equal(count, 0, `${table} 應該跟著舊題目一起清掉`);
    }
  });

  test('請假註記留著 —— 那是作業層級的，與題目無關', async () => {
    const s = await twoCourses();
    const student = await seedUser('stu@test.edu.tw', '學生');
    await seedLearner(s.mine, student.id);
    await rawDb.none(
      `INSERT INTO assignment_leave (ref_assignment_id, ref_user_id) VALUES ($1, $2)`,
      [s.myAssignment, student.id]);

    await swap(s.cookie, s.myAssignment, await seedTask(s.me.id, '新題目'));

    const { count } = await rawDb.one(
      'SELECT count(*)::int FROM assignment_leave WHERE ref_assignment_id=$1', [s.myAssignment]);
    assert.equal(count, 1);
  });

  test('換別人班作業的題目 → 404，而且對方的繳交原封不動', async () => {
    const s = await twoCourses();
    const other = await seedUser('stu2@test.edu.tw', '別班學生');
    await seedLearner(s.theirs, other.id);
    const sub = await seedSubmission(s.theirAssignment, other.id);

    const res = await swap(s.cookie, s.theirAssignment, await seedTask(s.me.id, '新題目'));
    assert.equal(res.status, 404);

    const { count } = await rawDb.one('SELECT count(*)::int FROM submission WHERE id=$1', [sub]);
    assert.equal(count, 1, '擋下來就不該刪到對方的資料');
  });
});
