/**
 * 清除繳交的確認文案。
 *
 * 「清除繳交」是把那一列繳交整筆刪掉（批改清單與學生端都是「找不到紀錄就是未繳交」），
 * 所以老師按它的用意幾乎都是「這一份不要了，讓他重交／我重拍」。
 *
 * ⚠️ 但**學生能不能自己重交，要看這份作業現在收不收件**。
 *    原本的文案一律寫「學生可以重新繳交」—— 作業已經截止又不收遲交時，
 *    後端 /student/submit 會回 409 把他擋住（規則見 lib/assignments.ts 的
 *    canStudentSubmit，前後端同一條）。老師照著文案跟學生說「你再交一次」，
 *    學生交不了，而老師不會知道是自己這邊要先改截止設定。
 *
 * 純邏輯，沒有副作用 —— 元件沒有 DOM 測試環境，文案放這裡才測得到。
 */

import type { Assignment } from '../types';
import { assignmentPhase, canStudentSubmit } from './assignments';

/**
 * 學生接下來能不能自己重新繳交，以及不能的話老師要先做什麼。
 * 查不到作業時回 null —— 不要猜，那一句話整個不出現。
 */
export function resubmitNote(assignment: Assignment | undefined, now: Date = new Date()): string | null {
  if (!assignment) return null;
  if (canStudentSubmit(assignment, now)) {
    return '這份作業還在收件，學生可以自己重新繳交。';
  }
  if (assignmentPhase(assignment, now) === 'draft') {
    return '這份作業目前是「未開放」，學生看不到也不能繳交 —— 要讓他重交，請先把作業開放。';
  }
  return '這份作業已經截止，學生不能自己重新繳交 —— 要讓他重交，請先把截止日往後改，或是允許遲交。';
}

export interface ClearSubmissionText {
  title: string;
  message: string;
}

export function clearSubmissionText(
  studentName: string,
  assignment: Assignment | undefined,
  now: Date = new Date(),
): ClearSubmissionText {
  const note = resubmitNote(assignment, now);
  return {
    title: '清除繳交內容',
    message: [
      `確定要清除 ${studentName || '這位學生'} 這一份的繳交內容嗎？`,
      '作文內容、分數與評語都會被刪除，學生端也會一併清空，這份作業會回到「未繳交」。',
      ...(note ? [note] : []),
      '此操作無法復原。',
    ].join('\n\n'),
  };
}
