/**
 * 單一班級的學生名單同步（課程卡片的「同步學生名單」）。
 *
 * 這一支釘的是「同步會刪人」這件事的邊界：
 *   - 轉出的學生要從名冊上消失，但**他的作文不能跟著消失**
 *   - 名字裡有單引號的學生不能把 SQL 打壞（舊的批次同步是字串接出來的）
 *   - 座號變動要寫得回去（舊的只做新增與刪除，座號永遠是第一次的那個）
 */
import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import RosterSyncHelper from '../dal/roster_sync_helper';
import {
  resetDb, rawDb, seedUser, seedSchool, seedCourse, seedLearner,
  seedTask, seedAssignment, seedSubmission,
} from './helpers';

before(resetDb);
after(async () => { await rawDb.$pool.end(); });
beforeEach(resetDb);

async function classWithTwoStudents() {
  const school = await seedSchool('測試中學');
  const course = await seedCourse(school, '國三孝班');
  const a = await seedUser('a@test.edu.tw', '甲同學');
  const b = await seedUser('b@test.edu.tw', '乙同學');
  await seedLearner(course, a.id, 1);
  await seedLearner(course, b.id, 2);
  return { course, a, b };
}

const rosterOf = (courseId: string) =>
  rawDb.manyOrNone<{ account: string; seat_no: number }>(
    `SELECT u.account, l.seat_no
       FROM uc_learner l JOIN "user" u ON u.id = l.ref_user_id
      WHERE l.ref_course_id = $1
      ORDER BY l.seat_no`,
    [courseId],
  );

describe('syncCourseRoster', () => {
  test('新來的學生會被加進名冊，連帶建立使用者', async () => {
    const { course } = await classWithTwoStudents();
    const result = await RosterSyncHelper.syncCourseRoster(course, [
      { account: 'a@test.edu.tw', name: '甲同學', seatNo: 1 },
      { account: 'b@test.edu.tw', name: '乙同學', seatNo: 2 },
      { account: 'c@test.edu.tw', name: '丙同學', seatNo: 3 },
    ]);

    assert.equal(result.added.length, 1);
    assert.equal(result.added[0].name, '丙同學');
    assert.equal(result.removed.length, 0);
    assert.equal(result.total, 3);
    assert.equal((await rosterOf(course)).length, 3);
  });

  test('不在新名單上的學生會被移出', async () => {
    const { course } = await classWithTwoStudents();
    const result = await RosterSyncHelper.syncCourseRoster(course, [
      { account: 'a@test.edu.tw', name: '甲同學', seatNo: 1 },
    ]);

    assert.equal(result.removed.length, 1);
    assert.equal(result.removed[0].account, 'b@test.edu.tw');
    assert.deepEqual((await rosterOf(course)).map((r) => r.account), ['a@test.edu.tw']);
  });

  test('⚠️ 被移出的學生，作文仍然留在資料庫裡', async () => {
    const { course, b } = await classWithTwoStudents();
    const task = await seedTask(b.id, '一次旅行');
    const assignment = await seedAssignment(course, task, b.id);
    const submission = await seedSubmission(assignment, b.id, '乙同學的作文');

    await RosterSyncHelper.syncCourseRoster(course, [
      { account: 'a@test.edu.tw', name: '甲同學', seatNo: 1 },
    ]);

    const row = await rawDb.oneOrNone(`SELECT content FROM submission WHERE id = $1`, [submission]);
    assert.ok(row, '同步不該刪掉任何一篇作文');
    assert.equal(row.content, '乙同學的作文');
  });

  test('座號變動會寫回去（舊的批次同步不會）', async () => {
    const { course } = await classWithTwoStudents();
    await RosterSyncHelper.syncCourseRoster(course, [
      { account: 'a@test.edu.tw', name: '甲同學', seatNo: 9 },
      { account: 'b@test.edu.tw', name: '乙同學', seatNo: 2 },
    ]);
    const roster = await rosterOf(course);
    const a = roster.find((r) => r.account === 'a@test.edu.tw');
    assert.equal(Number(a?.seat_no), 9);
  });

  test('名字裡有單引號也不會把 SQL 打壞', async () => {
    const { course } = await classWithTwoStudents();
    const result = await RosterSyncHelper.syncCourseRoster(course, [
      { account: 'a@test.edu.tw', name: '甲同學', seatNo: 1 },
      { account: "quote@test.edu.tw", name: "O'Brien'); DROP TABLE uc_learner;--", seatNo: 5 },
    ]);
    assert.equal(result.added.length, 1);
    const still = await rawDb.one(`SELECT count(*)::int AS n FROM uc_learner WHERE ref_course_id = $1`, [course]);
    assert.equal(still.n, 2, 'uc_learner 還在，而且是兩個人');
  });

  test('沒有座號的學生照樣收得下（seat_no 允許空）', async () => {
    const { course } = await classWithTwoStudents();
    await RosterSyncHelper.syncCourseRoster(course, [
      { account: 'a@test.edu.tw', name: '甲同學', seatNo: null },
      { account: 'b@test.edu.tw', name: '乙同學', seatNo: 2 },
    ]);
    const roster = await rosterOf(course);
    assert.equal(roster.length, 2);
  });

  test('名單完全一樣時不會動到任何一列', async () => {
    const { course } = await classWithTwoStudents();
    const result = await RosterSyncHelper.syncCourseRoster(course, [
      { account: 'a@test.edu.tw', name: '甲同學', seatNo: 1 },
      { account: 'b@test.edu.tw', name: '乙同學', seatNo: 2 },
    ]);
    assert.equal(result.added.length, 0);
    assert.equal(result.removed.length, 0);
    assert.equal(result.total, 2);
  });

  test('只動這一班 —— 別班的同名學生不受影響', async () => {
    const { course, a } = await classWithTwoStudents();
    const school = await seedSchool('另一間中學', 'other.edu.tw');
    const other = await seedCourse(school, '別班');
    await seedLearner(other, a.id, 7);

    await RosterSyncHelper.syncCourseRoster(course, [
      { account: 'b@test.edu.tw', name: '乙同學', seatNo: 2 },
    ]);

    const otherRoster = await rosterOf(other);
    assert.deepEqual(otherRoster.map((r) => r.account), ['a@test.edu.tw']);
  });
});
