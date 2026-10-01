/**
 * 學生的佳作與公開意願 —— 畫面這一側的判斷。
 *
 * 公開意願存在後端（submission_publish_consent，migration 010），
 * 前端拿到的是 Submission.isFeatured（發還後才可能 true）與 publishConsent（null ＝ 還沒決定）。
 */

import type { Assignment, Course, Submission } from '../types';

/** 學期代碼由舊到新：114-2 < 115-1 */
const bySemester = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/**
 * 還沒決定要不要公開的佳作（**所有學期**）。學習概況的提醒用。
 *
 * firstSemester：最早一篇所在的學期 —— 提醒的「前往決定」帶學生去那個學期的
 * 「我的作業 › 已發還」。決定完那一學期，提醒自動指向下一個。
 */
export function undecidedFeatured(
  submissions: Submission[],
  assignments: Assignment[],
  courses: Course[],
): { count: number; firstSemester?: string } {
  const courseOf = new Map(assignments.map((a) => [a.id, a.courseId]));
  const semesterOf = new Map(courses.map((c) => [c.id, c.semester]));
  const semesters: string[] = [];
  let count = 0;
  for (const s of submissions) {
    if (!s.isFeatured || s.status !== 'Published' || s.publishConsent != null) continue;
    count++;
    const sem = semesterOf.get(courseOf.get(s.assignmentId) ?? '');
    if (sem) semesters.push(sem);
  }
  return { count, firstSemester: semesters.sort(bySemester)[0] };
}
