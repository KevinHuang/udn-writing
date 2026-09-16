/**
 * 題庫資料夾的純計算邏輯。
 *
 * 這裡的函式都沒有副作用，也不依賴 React，
 * 好處是可以直接在 console 或測試裡驗證。
 */

import { Folder, Question } from '../types';

/**
 * 從某個資料夾往下收集所有子孫資料夾的 id（含自己）。
 *
 * 迴圈保護：資料若因為手動編輯而形成環（A 的 parent 是 B、B 的 parent 是 A），
 * 寧可回傳截斷的結果，也不要讓畫面卡死。
 */
export function descendantFolderIds(folders: Folder[], folderId: string): Set<string> {
  const ids = new Set<string>([folderId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) {
        ids.add(f.id);
        grew = true;
      }
    }
  }
  return ids;
}

/**
 * 資料夾卡片上顯示的題目數 —— 含子資料夾，這比較符合直覺：
 * 「敘事文類」底下只有兩個子資料夾、沒有直接掛題目，
 * 但使用者會期待它顯示的是裡面總共有幾題。
 *
 * 預設不計入已封存的題目，因為封存的題目在預設檢視裡看不到，
 * 數字卻把它算進去會讓人以為漏了東西。
 *
 * 注意：這是「算出來的」，不是存在 Folder 上的欄位。
 * 先前 Folder 有一個手動維護的 questionCount，散在新增／刪除／
 * 搬移／匯入等七個地方各自 +1 −1，只要有一條路徑漏掉數字就開始漂移
 * （改版時 f2「議論文類」標 4 題實際 3 題、f4「節慶與文化」標 3 題實際 2 題）。
 */
export function deepQuestionCount(
  folders: Folder[],
  questions: Question[],
  folderId: string,
  options: { includeArchived?: boolean } = {},
): number {
  const ids = descendantFolderIds(folders, folderId);
  return questions.filter(
    (q) =>
      q.folderId !== null &&
      ids.has(q.folderId) &&
      (options.includeArchived || !q.isArchived),
  ).length;
}

/**
 * 一次算好所有資料夾的題目數，供列表渲染使用。
 * 逐一呼叫 deepQuestionCount 會是 O(資料夾數 × 題目數)，
 * 資料夾一多就會在每次 render 重算，這裡改成掃一次就好。
 */
export function questionCountsByFolder(
  folders: Folder[],
  questions: Question[],
  options: { includeArchived?: boolean } = {},
): Record<string, number> {
  // 先建 parent 索引，再由每一題往上加到所有祖先資料夾
  const parentOf = new Map<string, string | null>(
    folders.map((f) => [f.id, f.parentId]),
  );
  const counts: Record<string, number> = {};
  for (const f of folders) counts[f.id] = 0;

  for (const q of questions) {
    if (q.folderId === null) continue;
    if (!options.includeArchived && q.isArchived) continue;

    let cur: string | null | undefined = q.folderId;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      if (cur in counts) counts[cur] += 1;
      cur = parentOf.get(cur);
    }
  }
  return counts;
}
