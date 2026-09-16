/**
 * 一份作業的批改名單 —— 批改清單與批改頁共用同一份順序。
 *
 * 這段合併（名冊 × 繳交紀錄）原本寫在 App.tsx 的清單分支裡。
 * 批改頁要做「上一位／下一位」時如果自己再排一次，兩邊遲早會不一樣：
 * 清單上看到的第三位，按「下一位」卻跳到別人身上。收在這裡只排一次。
 */

import { Assignment, Submission, SubmissionStatus } from '../types';
import { studentIdFor, seatNoFromStudentId } from '../mockData';

export interface RosterEntry {
  seatNo: number;
  name: string;
}

/**
 * 全班名單，依座號排序。沒有繳交紀錄的補一筆 Unsubmitted 佔位，
 * 讓老師看得到誰沒交 —— 缺席的人不該從畫面上消失。
 */
export function assignmentRoster(
  assignment: Assignment,
  roster: RosterEntry[],
  submissions: Submission[],
): Submission[] {
  const merged = roster.map((student) => {
    const existing = submissions.find(
      (s) => s.assignmentId === assignment.id && s.studentName === student.name,
    );
    if (existing) return existing;

    return {
      id: `unsub-${assignment.id}-${student.seatNo}`,
      assignmentId: assignment.id,
      studentId: studentIdFor(assignment.courseId, student.seatNo),
      studentName: student.name,
      submittedAt: '',
      status: 'Unsubmitted',
      content: '',
    } as Submission;
  });

  return merged.sort((a, b) => {
    const seatA = seatNoFromStudentId(a.studentId);
    const seatB = seatNoFromStudentId(b.studentId);
    return (isNaN(seatA) ? 0 : seatA) - (isNaN(seatB) ? 0 : seatB);
  });
}

/**
 * 「上一位／下一位」實際會走過的人 —— 就是清單上點得進去的那些。
 *
 * Draft 也要排除，這是實測抓到的：草稿有內容、狀態卻不是 Unsubmitted，
 * 清單把它標成「未繳交」且按鈕停用，但「下一位」會停在那一位身上，
 * 變成一頁進得去、出不來的死角。判斷條件要和清單完全一致
 * （見 App.tsx 的 `s.status === "Unsubmitted" || s.status === "Draft"`）。
 */
const OPENABLE: SubmissionStatus[] = ['Pending', 'Graded', 'Published'];

export function gradableQueue(roster: Submission[]): Submission[] {
  return roster.filter((s) => OPENABLE.includes(s.status) && s.content);
}

/** 某一位在佇列中的前後鄰居。到頭或到尾就是 null */
export function neighbours(
  queue: Submission[],
  currentId: string,
): { prev: Submission | null; next: Submission | null; index: number; total: number } {
  const index = queue.findIndex((s) => s.id === currentId);
  return {
    prev: index > 0 ? queue[index - 1] : null,
    next: index >= 0 && index < queue.length - 1 ? queue[index + 1] : null,
    index,
    total: queue.length,
  };
}
