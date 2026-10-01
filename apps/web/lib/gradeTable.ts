import type { Submission } from '../types';
import { averageLevel } from './scoring';
import { hasMark, type SubmissionMarks } from './submissionMarks';

/**
 * 成績管理表的每位學生統計（繳交篇數、佳作數、平均級分）與排序。
 *
 * 表格與 CSV 都用這裡算，兩邊的數字才會一樣
 * （以前平均在兩個地方各算一次，表格還把草稿當成 0 級分算進去）。
 */

/** 交出來了才算。草稿、未繳交都不是作品 */
export const isSubmitted = (s: Submission) =>
  s.status === 'Pending' || s.status === 'Graded' || s.status === 'Published';

/** 已經有成績的（待批改的還沒有） */
const isGraded = (s: Submission) => s.status === 'Graded' || s.status === 'Published';

export interface StudentGradeStats {
  /** 繳交篇數：待批改、已批改、已發還 */
  submitted: number;
  /** 被蓋佳作章的篇數 */
  featured: number;
  /** 平均級分，取到小數一位；還沒有任何成績是 null */
  average: number | null;
}

/**
 * 一位學生在這些作業裡的統計。
 *
 * ⚠️ 用 studentId 比對，不要用姓名（同班有同名學生，見 lib/studentHistory.ts）。
 */
export function studentGradeStats(
  submissions: Submission[],
  studentId: string,
  assignmentIds: ReadonlySet<string>,
  marks?: SubmissionMarks,
): StudentGradeStats {
  const mine = submissions.filter((s) => s.studentId === studentId && assignmentIds.has(s.assignmentId));
  const graded = mine.filter(isGraded);
  return {
    submitted: mine.filter(isSubmitted).length,
    // 佳作章只能蓋在已批改的作品上（canMark），所以只看 graded 就夠
    featured: graded.filter((s) => hasMark(marks, s.id, 'featured')).length,
    // 已批改但沒有分數的，沿用表格原本的算法當 0
    average: averageLevel(graded.map((s) => s.result?.totalScore || 0)),
  };
}

export type GradeSortKey = 'seat' | 'submitted' | 'featured' | 'average';
export type SortDir = 'asc' | 'desc';

export interface GradeRow {
  studentId: string;
  seatNo?: number;
  name: string;
  stats: StudentGradeStats;
}

/** 座號順序：沒有座號的排最後，同座號依姓名 */
function bySeat(a: GradeRow, b: GradeRow): number {
  const sa = a.seatNo ?? Number.POSITIVE_INFINITY;
  const sb = b.seatNo ?? Number.POSITIVE_INFINITY;
  if (sa !== sb) return sa - sb;
  return a.name.localeCompare(b.name, 'zh-Hant');
}

/**
 * 依欄位排序（回傳新陣列）。沒有平均（還沒有成績）的不論升降冪都排最後 ——
 * 否則「低到高」時一整排「-」會擠在最前面。同分依座號。
 */
export function sortGradeRows<T extends GradeRow>(rows: T[], key: GradeSortKey, dir: SortDir): T[] {
  if (key === 'seat') return [...rows].sort(bySeat);
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = a.stats[key];
    const vb = b.stats[key];
    if (va === null && vb === null) return bySeat(a, b);
    if (va === null) return 1;
    if (vb === null) return -1;
    return (va - vb) * sign || bySeat(a, b);
  });
}
