import type { Submission } from '../types';

/**
 * 繳交「摘要」回來時，和手上的清單合起來（純函式，state/useApiList.ts 的 merge）。
 *
 * 教師端的繳交分兩層（state/AppState.tsx）：摘要撈全部班級，但沒有作文、原稿照片與評語；
 * 批改清單與批改頁進來時再用 ensureSubmissions() 補那一份作業的完整內容。
 * 兩支 API 誰先回來不一定 —— 開頁時摘要要撈全部班級，常常比較晚到。以前摘要回來是整份換掉，
 * 剛補好的完整內容就被抹掉了（2026-11-23 在本機重現：直接開批改頁「辨識文字」空白；
 * 重新整理批改清單再點進去，評語編輯器與稿紙上的老師評語空白，這時存檔會把 AI 的評語蓋成空白）。
 *
 * 規則：
 * - **有哪些繳交、狀態、分數，以摘要為準**（它是最新的；被清除的繳交要消失）。
 * - 同一筆手上已經有完整內容的，**作文與原稿照片留著**。
 * - **評語只在「還是同一版批改」時留著**（feedbackId 一樣）。重新批改、老師存檔之後是新的一版，
 *   舊評語配新分數是錯的；這時先給空的，緊接著的 ensureSubmissions() 會補上新的。
 * - 批改被重置（摘要說沒有批改結果）：照摘要，沒有結果。
 */
export function mergeSubmissionSummary(prev: Submission[], summary: Submission[]): Submission[] {
  const detailed = new Map(prev.filter((s) => s.detailed).map((s) => [s.id, s]));
  if (detailed.size === 0) return summary;
  return summary.map((row) => {
    const full = detailed.get(row.id);
    if (!full) return row;
    const sameVersion = Boolean(row.feedbackId) && row.feedbackId === full.feedbackId;
    return {
      ...row,
      content: full.content,
      picFiles: full.picFiles,
      detailed: true,
      result: row.result && sameVersion && full.result
        ? { ...row.result, feedback: full.result.feedback }
        : row.result,
    };
  });
}
