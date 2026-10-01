import type { Submission } from '../types';

/**
 * 成績管理「學習歷程」視窗的作品清單：這位學生已批改或已發還的作品，新的在前。
 *
 * ⚠️ **用 studentId，不要用姓名。** 實測資料裡同一個班有兩位學生同名，
 *    以前用姓名比對，兩個人的作品會混在同一個視窗裡（2026-10-01 修正）。
 */
export function studentHistory(submissions: Submission[], studentId: string): Submission[] {
  return submissions
    .filter((s) => s.studentId === studentId && (s.status === 'Graded' || s.status === 'Published'))
    .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
}
