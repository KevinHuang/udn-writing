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

/** 這一份繳交有沒有手寫原稿：有、沒有、還不知道 */
export type OriginalsState = 'has' | 'none' | 'unknown';

/**
 * 批改清單「原稿」欄的燈號。和批改頁看的是同一組照片（originalsFor），
 * 清單說有原稿，點進去就真的看得到。
 *
 * 以前這一欄是原型留下來的模擬 —— 用繳交編號最後一碼的奇偶數決定顏色，和有沒有原稿無關
 * （2026-11-23 做手冊時發現：示範班三位學生都有稿紙照片，卻有紅有綠）。
 *
 * 'unknown'：手上只有摘要（沒有 picFiles 這一欄），批次那邊也沒有照片。這時不能說「沒有原稿」——
 * 完整內容還在路上，先亮紅燈再變綠燈，比先不表態更糟。
 */
export function originalsState(
  submission: { assignmentId: string; picFiles?: string[]; detailed?: boolean },
  batchFiles: string[] | undefined,
): OriginalsState {
  if (originalsFor(submission.assignmentId, submission.picFiles, batchFiles).length > 0) return 'has';
  return submission.detailed ? 'none' : 'unknown';
}
