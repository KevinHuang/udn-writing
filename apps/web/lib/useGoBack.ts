import { useNavigate } from 'react-router-dom';

/**
 * 「上一頁」。
 *
 * 取代先前 App.tsx 裡手刻的 `viewHistory` 堆疊與 `handleBack()` ——
 * 那份堆疊要自己記錄每個畫面的狀態快照，漏掉一個欄位就會在返回時
 * 把它還原成 undefined（`hideOverdueAssignments` 就這樣被關掉過）。
 * 交給瀏覽器之後，狀態在網址裡，沒有東西需要快照。
 *
 * `canGoBack` 用的是 React Router 寫在 `history.state.idx` 的索引：
 * 0 代表這是使用者在這個分頁的第一個頁面（直接貼網址進來、或新分頁開啟），
 * 那時候按上一頁會離開這個站，所以按鈕要收起來。
 *
 * **判斷收在這一支，不要在各個畫面自己看 history。** 六個畫面都有返回鍵，
 * 六個地方各寫一次就是下一個漂移 bug（CLAUDE.md 那條「同一份資訊不要
 * 在多處各自解析」講的就是這個）。
 */
export function useGoBack(): { goBack: () => void; canGoBack: boolean } {
  const navigate = useNavigate();
  const idx = typeof window !== 'undefined'
    ? ((window.history.state as { idx?: number } | null)?.idx ?? 0)
    : 0;
  return { goBack: () => navigate(-1), canGoBack: idx > 0 };
}
