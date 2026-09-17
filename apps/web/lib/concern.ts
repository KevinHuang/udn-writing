/**
 * 「需要關注的學生」怎麼算 —— 全站唯一來源。
 *
 * 儀表板的關心名單卡片與關心名單頁面必須用同一套定義，
 * 否則卡片上寫 5 位、點進去列出 7 位，老師會不信任這個數字。
 *
 * 判準只有一個是明確的：**有逾期未繳的作業**。
 * 「低分」那組在關心名單頁面裡只是「平均分數最低的前幾名」，
 * 沒有分數門檻 —— 只要班上有人繳交就一定選得出人來，
 * 所以不能拿來當「需關注人數」。
 */

import { Assignment, Course, Submission } from '../types';
import { isOnLeave, type LeaveMarks } from './leave';
import { isOverdue } from './assignments';

export interface StudentStat {
  studentId: string;
  /** 座號。校務系統沒給就是 undefined —— 畫面上顯示破折號，不要假造號碼 */
  seatNo?: number;
  name: string;
  /** 已批改／已發還作業的平均分數；沒有已批改的作業時為 0 */
  avgScore: number;
  /** 已逾期且未繳交的作業數 */
  missingCount: number;
  submissionCount: number;
  totalAssignments: number;
}

/** 單一班級的學生統計 */
export function studentStatsForCourse(
  course: Course,
  assignments: Assignment[],
  submissions: Submission[],
  now: Date = new Date(),
  /** 請假註記。標了請假的那一份不算逾期未繳 —— 見 lib/leave.ts */
  leaveMarks?: LeaveMarks,
): StudentStat[] {
  const courseAssignments = assignments.filter((a) => a.courseId === course.id);
  const assignmentIds = courseAssignments.map((a) => a.id);
  const courseSubmissions = submissions.filter((s) =>
    assignmentIds.includes(s.assignmentId),
  );

  /*
    名冊**從繳交紀錄推出來**。

    後端的 /service/instructor/submissions 是「名冊 × 作業」的完整結果 ——
    每位學生對每份作業都有一列，沒交的是 Unsubmitted。所以依 studentId 分組
    就是這個班的名冊。

    ⚠️ 以前是 `COURSE_ROSTERS[course.id]`（mockData，鍵是原型的 'c1'）
       加上 `studentIdFor(course.id, seatNo)` 組出來的假 id 去比對繳交 ——
       **兩邊都對不上真實資料**，所以關心名單每一班都是「尚無名單資料」
       （實測）。這是同一份 mock 名冊造成的第二處失效，第一處是批改清單。
  */
  const byStudent = new Map<string, Submission[]>();
  for (const s of courseSubmissions) {
    const list = byStudent.get(s.studentId);
    if (list) list.push(s);
    else byStudent.set(s.studentId, [s]);
  }

  return [...byStudent.entries()].map(([studentId, studentSubmissions]) => {
    const first = studentSubmissions[0];

    const graded = studentSubmissions.filter(
      (s) => s.status === 'Graded' || s.status === 'Published',
    );
    const avgScore = graded.length
      ? graded.reduce((sum, s) => sum + (s.result?.totalScore || 0), 0) / graded.length
      : 0;

    // 「未繳」要看狀態，不能只看有沒有紀錄 ——
    // 系統對每個學生每份作業都會先建一筆列，狀態才是 Unsubmitted／Draft。
    // 先前只判斷紀錄存在與否，所以逾期未繳永遠算不出來。
    const missingCount = courseAssignments.filter((a) => {
      // 沒設截止日就不會逾期，自然也不算欠交
      if (!isOverdue(a, now)) return false;
      // 老師標了請假就不是欠交，畫面上寫著請假、名單裡卻還在催繳會很奇怪
      if (isOnLeave(leaveMarks, a.id, studentId)) return false;
      const sub = studentSubmissions.find((s) => s.assignmentId === a.id);
      return !sub || sub.status === 'Unsubmitted' || sub.status === 'Draft';
    }).length;

    return {
      studentId,
      seatNo: first.seatNo,
      name: first.studentName,
      avgScore,
      missingCount,
      submissionCount: studentSubmissions.length,
      totalAssignments: courseAssignments.length,
    };
  });
}

/**
 * 這些班級裡有幾位學生需要關注（有逾期未繳）。
 *
 * 同一位學生若同時出現在多個班級的名單上，各算一次 ——
 * 老師是以班級為單位處理的，跨班合併反而看不出要處理幾件事。
 */
export function concernStudentCount(
  courses: Course[],
  assignments: Assignment[],
  submissions: Submission[],
  leaveMarks?: LeaveMarks,
): number {
  return courses.reduce(
    (total, course) =>
      total +
      studentStatsForCourse(
        course,
        assignments,
        submissions,
        new Date(),
        leaveMarks,
      ).filter((s) => s.missingCount > 0).length,
    0,
  );
}
