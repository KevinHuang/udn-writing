/**
 * 代繳交照片在 GCS 上的相對路徑。
 *
 * ⚠️ 這是一個**跨前後端的隱性約定**：
 *    `batch_proxy_submission.img_files` 存的是 StorageHelper 回的**裸檔名**
 *    （`sub_12_345_0929-1415_<uuid>.jpg`），沒有資料夾前綴 ——
 *    而 `submission.pic_files` 存的是含前綴的相對路徑（`submit/assign_12/…`）。
 *
 *    後端刻意不統一：背景的 ocr-job（原始碼不在這個 repo）很可能是自己
 *    用 assignmentId 把資料夾組回去的，改了格式就打爆它。所以補前綴在這裡做。
 *
 * 回傳相對路徑；要放進 <img src> 時再交給 api/ai.ts 的 imageUrlOf()。
 */
export function proxyImagePath(assignmentId: string, file: string): string {
  // 已經是相對路徑或完整網址（舊資料、或哪天後端改了）就不要重複補
  if (file.includes('/')) return file;
  return `submit/assign_${assignmentId}/${file}`;
}

/**
 * 顯示原稿要用哪一組：submission 自己有就用它的，沒有才退回批次的照片。
 *
 * ocr-job 有沒有把 pic_files 寫回 submission 是未知數 ——
 * 不要因為黑箱少寫一欄，老師校對時旁邊的原稿就變成空白。
 */
export function originalsFor(
  assignmentId: string,
  picFiles: string[] | undefined,
  batchFiles: string[] | undefined,
): string[] {
  if (picFiles && picFiles.length) return picFiles;
  return (batchFiles ?? []).map((f) => proxyImagePath(assignmentId, f));
}
