/**
 * InstructorHelper 的 DAL 測試。
 *
 * 取代原本的 src/dal/instructor_helper.test.ts —— 那支不是測試：
 *   - 它在 import 當下就跑 runTests() 並呼叫 process.exit(0)，
 *     被 node:test 收進去會直接中斷整個測試套件。
 *   - 它假設 user id 1 與 assignment id 1 存在。
 *   - 它自己的註解寫著「避免寫髒資料到 production」—— 因為它就是對著
 *     當下設定的資料庫跑的，而那時的設定指向 production。
 *
 * 現在有專屬的測試庫與 fixtures，可以斷言真正的行為。
 */
import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import InstructorHelper from '../dal/instructor_helper';
import { CourseScope } from '../lib/course_scope';
import {
  resetDb, rawDb, seedUser, seedSchool, seedCourse, seedInstructor,
  seedLearner, seedTask, seedAssignment, seedSubmission,
} from './helpers';

beforeEach(resetDb);
after(async () => { await rawDb.$pool.end(); });

/** 一個完整的情境：一位教師、一位學生、一門課、一份作業。 */
async function scenario() {
  const teacher = await seedUser('t@test.edu.tw', '陳老師');
  const student = await seedUser('s@test.edu.tw', '林同學');
  const school = await seedSchool('永平中學');
  const course = await seedCourse(school, '國三孝班');
  await seedInstructor(course, teacher.id);
  await seedLearner(course, student.id, 7);
  const task = await seedTask(teacher.id, '一個印象深刻的人');
  const assignment = await seedAssignment(course, task, teacher.id);
  return { teacher, student, school, course, task, assignment };
}


/** 教師的範圍。改成 CourseScope 之後，DAL 收的不再是 id（見 lib/course_scope.ts） */
const asTeacher = (userId: string | number): CourseScope => ({ kind: 'instructor', userId: Number(userId) });

describe('getAssignments', () => {
  test('沒有任何課程的教師拿到空陣列', async () => {
    const rows = await InstructorHelper.getAssignments(asTeacher('999999'));
    assert.deepEqual(rows, []);
  });

  test('回傳自己班級的作業，欄位齊全', async () => {
    const s = await scenario();
    const rows = await InstructorHelper.getAssignments(asTeacher(s.teacher.id));
    assert.equal(rows.length, 1);
    const a = rows[0];
    assert.equal(a.assignment_id, s.assignment);
    assert.equal(a.course_name, '國三孝班');
    assert.equal(a.school_name, '永平中學');
    assert.equal(a.task_title, '一個印象深刻的人');
    assert.equal(Number(a.student_count), 1);
    assert.equal(Number(a.submission_count), 0);
    assert.equal(Number(a.graded_count), 0);
  });

  test('看不到別人班級的作業', async () => {
    const s = await scenario();
    const other = await seedUser('other@test.edu.tw', '別的老師');
    const rows = await InstructorHelper.getAssignments(asTeacher(other.id));
    assert.deepEqual(rows, []);
  });

  test('學生繳交後 submission_count 跟著增加', async () => {
    const s = await scenario();
    await seedSubmission(s.assignment, s.student.id);
    const rows = await InstructorHelper.getAssignments(asTeacher(s.teacher.id));
    assert.equal(Number(rows[0].submission_count), 1);
    assert.equal(Number(rows[0].graded_count), 0);
  });
});

describe('getSubmissions', () => {
  test('沒繳交的學生也要出現在名單裡（否則老師看不到缺繳）', async () => {
    const s = await scenario();
    const rows = await InstructorHelper.getSubmissions(s.assignment, asTeacher(s.teacher.id));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].user_id, s.student.id);
    assert.equal(rows[0].student_name, '林同學');
    assert.equal(rows[0].submission_id, null);
    assert.ok('ai_analysis' in rows[0]);
  });

  test('繳交後帶出作文內容', async () => {
    const s = await scenario();
    const sub = await seedSubmission(s.assignment, s.student.id, '春天來了');
    const rows = await InstructorHelper.getSubmissions(s.assignment, asTeacher(s.teacher.id));
    assert.equal(rows[0].submission_id, sub);
    assert.equal(rows[0].content, '春天來了');
    assert.ok(rows[0].submited_time);
  });
});

describe('saveFeedback', () => {
  test('寫入一筆有效的批改結果', async () => {
    const s = await scenario();
    const sub = await seedSubmission(s.assignment, s.student.id);
    await InstructorHelper.saveFeedback(sub, 5, { summary: '寫得很好' }, s.teacher.id, asTeacher(s.teacher.id));

    const rows = await rawDb.manyOrNone(
      `SELECT score, content, is_valid, is_ai, is_returned FROM submission_feedback WHERE ref_submission_id = $1`, [sub]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].score, 5);
    assert.equal(rows[0].is_valid, true);
    assert.equal(rows[0].is_ai, true);      // 預設是 AI 批改
    assert.equal(rows[0].is_returned, false); // 還沒發還
    assert.equal(JSON.parse(rows[0].content).summary, '寫得很好');
  });

  test('重新批改會讓前一筆失效，而不是覆蓋它', async () => {
    // spec.md Phase 4 的驗收條件之一。schema 的 is_valid 註解就是這個意思：
    // 「如果某提交作業重新批改，則前一份批改為無效」。歷史要留著。
    const s = await scenario();
    const sub = await seedSubmission(s.assignment, s.student.id);

    await InstructorHelper.saveFeedback(sub, 3, { summary: '第一次' }, s.teacher.id, asTeacher(s.teacher.id));
    await InstructorHelper.saveFeedback(sub, 6, { summary: '重批' }, s.teacher.id, asTeacher(s.teacher.id));

    const all = await rawDb.manyOrNone(
      `SELECT score, is_valid FROM submission_feedback WHERE ref_submission_id = $1 ORDER BY id`, [sub]);
    assert.equal(all.length, 2, '舊紀錄應該留著，不是被覆蓋');
    assert.equal(all[0].is_valid, false, '前一筆應該被標記為無效');
    assert.equal(all[1].is_valid, true);
    assert.equal(all[1].score, 6);
  });

  test('教師手動修改可以標記成非 AI 產生', async () => {
    const s = await scenario();
    const sub = await seedSubmission(s.assignment, s.student.id);
    await InstructorHelper.saveFeedback(sub, 4, { summary: '老師改的' }, s.teacher.id, asTeacher(s.teacher.id), 0, 0, false);
    const row = await rawDb.one(
      `SELECT is_ai FROM submission_feedback WHERE ref_submission_id = $1 AND is_valid = true`, [sub]);
    assert.equal(row.is_ai, false);
  });

  test('批改後 getAssignments 的 graded_count 增加', async () => {
    const s = await scenario();
    const sub = await seedSubmission(s.assignment, s.student.id);
    await InstructorHelper.saveFeedback(sub, 5, { summary: 'ok' }, s.teacher.id, asTeacher(s.teacher.id));
    const rows = await InstructorHelper.getAssignments(asTeacher(s.teacher.id));
    assert.equal(Number(rows[0].graded_count), 1);
  });
});
