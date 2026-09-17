/**
 * 一份作業的批改名單 —— 批改清單與批改頁共用同一份順序。
 *
 * 這段合併（名冊 × 繳交紀錄）原本寫在 App.tsx 的清單分支裡。
 * 批改頁要做「上一位／下一位」時如果自己再排一次，兩邊遲早會不一樣：
 * 清單上看到的第三位，按「下一位」卻跳到別人身上。收在這裡只排一次。
 */

import { Submission, SubmissionStatus } from '../types';

export interface RosterEntry {
  seatNo: number;
  name: string;
}

/**
 * 全班名單，依座號排序。沒有繳交紀錄的補一筆 Unsubmitted 佔位，
 * 讓老師看得到誰沒交 —— 缺席的人不該從畫面上消失。
 */
/**
 * 一份作業的完整名冊（含未繳交的人），照座號排序。
 *
 * **後端已經把「名冊 × 繳交」合併好了** —— `/service/instructor/submissions`
 * 與 `/assignments/:id/submissions` 都是每位學生一列，沒交的人是
 * `submission_id: null`（前端對應成 Unsubmitted）。所以這裡只要篩出這份作業
 * 的列並排序，不需要另外拿一份名冊來合併。
 *
 * ⚠️ 取代的是 `assignmentRoster()`。那一支拿 mockData 的 `COURSE_ROSTERS` 合併，
 *    而它的鍵是原型的課程 id（`'c1'`）—— 真實課程 id 是 `'229'`，查不到，
 *    於是**批改清單整張表是空的**（實測：清單卡片寫「待批改 1」，點進去 0 列）。
 */
export function rosterOf(assignmentId: string, submissions: Submission[]): Submission[] {
  return submissions
    .filter((s) => s.assignmentId === assignmentId)
    .sort((a, b) => {
      // 沒有座號的排到最後，不要當成 0 排到最前
      const sa = a.seatNo ?? Number.POSITIVE_INFINITY;
      const sb = b.seatNo ?? Number.POSITIVE_INFINITY;
      if (sa !== sb) return sa - sb;
      return a.studentName.localeCompare(b.studentName, 'zh-Hant');
    });
}


/** 座號顯示。沒有座號時用破折號，不要印出 NaN 或 00 */
export function seatText(s: Submission): string {
  return s.seatNo == null ? '—' : String(s.seatNo).padStart(2, '0');
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
