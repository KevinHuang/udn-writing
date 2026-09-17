/**
 * 從 `submission_feedback.content` 取出評語本文。
 *
 * 後端存的是 `{ raw_score, score, response }`，`response` 才是那一整份 markdown。
 *
 * ⚠️ **回來的可能是字串，也可能是物件。**
 *    `/instructor/submissions`（摘要）回字串，`/assignments/:id/submissions`
 *    （詳細）的 `ai_analysis` 經過 jsonb 轉換，pg 直接給物件。
 *    先前這裡無條件 `JSON.parse(raw)` —— 傳物件進去會先被轉成
 *    `"[object Object]"` 再解析失敗，catch 裡 `return raw` 就把**物件**
 *    交給 `<Markdown>`，react-markdown 丟 assertion、整頁白畫面。
 *    實測 AI 批改完成的那一刻就會發生。
 *
 * ⚠️ 這支以前在 api/submissions.ts 與 api/student.ts **各寫一份**。
 *    收在這裡一支 —— 同一份資訊不要在多處各自解析（CLAUDE.md）。
 */
export function feedbackTextOf(raw: unknown): string {
  if (raw == null) return '';

  // 詳細端點給的是已經解析好的物件
  if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (typeof o.response === 'string') return o.response;
    if (typeof o.feedback === 'string') return o.feedback;
    // 認不得的形狀：印出來總比整頁掛掉好
    return JSON.stringify(raw);
  }

  if (typeof raw !== 'string') return String(raw);
  if (!raw) return '';

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.response === 'string') return parsed.response;
    if (typeof parsed?.feedback === 'string') return parsed.feedback;
    // 是合法 JSON 但不是預期的形狀，回原字串（舊資料可能就是純文字）
    return raw;
  } catch {
    // 根本不是 JSON —— 舊資料或手動寫入的純文字評語
    return raw;
  }
}
