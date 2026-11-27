/**
 * 重置批改：哪幾份會被動到、按下去之前要跟老師說什麼。
 *
 * ── 為什麼抽成一支 ────────────────────────────────────────
 * 清單上那顆「重置批改 (N)」的 N 以前只數 `status === 'Graded'`，
 * 而真正執行的 `handleBatchReset` 動的是 Graded **和** Published ——
 * 勾 2 份已批改 ＋ 3 份已發還，按鈕寫 (2)、實際重置 5 份；
 * 只勾已發還時按鈕是 (0) 而且停用，那條路反而走不到。
 * 數字與動作各算一次就是這樣漂的，所以兩邊都問 `resetTargets()`。
 *
 * ── 為什麼需要確認視窗 ────────────────────────────────────
 * 清除繳交、刪作業、換題、重新評分都有確認，只有重置沒有，而它會：
 *   1. 把級分與評語退回「待批改」（歷史留著，但畫面與學生端都讀不到）
 *   2. 對**已發還**的作品一樣生效 —— 學生昨天看到的分數今天無聲消失
 *   3. 連簡易批改的「評分依據」「請老師留意」一起刪掉（後端
 *      /grading/reset/:id → SimpleGradingHelper.remove），**無法復原**
 * 第 2 點多半不是老師要的：只想改原稿上的紅筆的話，「收回發還」
 * 就夠了（分數與評語留著），所以文案要把那條路指出來。
 *
 * 純邏輯，沒有副作用 —— 元件沒有 DOM 測試環境，判斷與文案放這裡才測得到。
 */

import type { Submission, SubmissionStatus } from '../types';

/**
 * 這份作品能不能重置批改。**可用範圍的唯一來源**（比照 lib/submissionMarks.ts 的 canMark）。
 *
 * 已發還算數：發還出去才發現評語寫錯是常有的事，不讓它重置等於沒有退路。
 * 代價是學生看得到的成績會被收回，由確認視窗負責講清楚。
 */
export function canResetGrading(status: SubmissionStatus): boolean {
  return status === 'Graded' || status === 'Published';
}

/**
 * 這次重置真的會動到哪幾份。
 *
 * 一定要給 `ids`（勾選的那些）—— 重置會清掉分數與評語，不該有
 * 「沒勾就全部重置」這種預設行為。沒勾選時呼叫端傳空陣列，結果就是空的。
 */
export function resetTargets(submissions: Submission[], ids: string[]): Submission[] {
  const want = new Set(ids);
  return submissions.filter((s) => want.has(s.id) && canResetGrading(s.status));
}

export interface ResetConfirmText {
  title: string;
  message: string;
}

/**
 * 確認視窗的標題與內容。
 *
 * 單筆帶學生姓名（批改頁上老師看著一個人），多筆帶份數。
 * 已發還的份數 > 0 時多一段：成績會被收回，而且指出「收回發還」那條路。
 */
export function resetConfirmText(
  targets: Array<Pick<Submission, 'status' | 'studentName'>>,
): ResetConfirmText {
  const returned = targets.filter((s) => s.status === 'Published').length;
  const single = targets.length === 1 ? targets[0] : null;

  const head = single
    ? `確定要重置 ${single.studentName || '這位學生'} 這一份的批改嗎？`
    : `確定要重置這 ${targets.length} 份的批改嗎？`;

  const paragraphs = [
    head,
    '級分與評語會退回「待批改」，要重新批改一次。作文與手寫原稿不會被刪掉。',
  ];

  if (returned > 0) {
    paragraphs.push(
      single
        ? '這一份已經發還，學生現在看得到的分數與評語會被收回。\n' +
          '如果只是要改原稿上的紅筆，用「收回發還」就好 —— 分數與評語會留著。'
        : `其中 ${returned} 份已經發還，學生現在看得到的分數與評語會被收回。\n` +
          '如果只是要改原稿上的紅筆，請改用批改頁的「收回發還」 —— 分數與評語會留著。',
    );
  }

  paragraphs.push(
    '稿紙代繳交的作文，簡易批改的「評分依據」與「請老師留意」會一併刪掉，這部分無法復原。',
  );

  return {
    title: single ? '重置批改' : `重置 ${targets.length} 份的批改`,
    message: paragraphs.join('\n\n'),
  };
}
