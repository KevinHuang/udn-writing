/**
 * 掃描畫面開不起來時，退回手機內建的相機（components/scan/DocumentScannerModal.tsx）。
 *
 * 以前老師端在掃描旁邊另外放一顆「直接拍照」當備用；學生端沒有，掃描一壞就只剩一行錯誤訊息。
 * 2026-11-27 使用者決定只留「掃描稿紙」一顆，備用的那條路收進掃描視窗裡：平常看不到，壞了才出現。
 *
 * 這裡只管「要不要出現、怎麼跟使用者說」，都是純函式。
 */

export type CvState = 'loading' | 'ready' | 'error';

export interface ScanFallbackInput {
  /** 不是 https（也不是 localhost）：網頁不能開相機 */
  insecure: boolean;
  /** 影像處理工具（約 10MB）的載入狀態 */
  cvState: CvState;
  /** 按了「開啟相機掃描」之後相機回報的錯誤（沒給權限、沒有鏡頭、瀏覽器不支援） */
  cameraError: string | null;
}

export interface ScanFallback {
  /** 給使用者看的一句話：為什麼掃描不能用 */
  reason: string;
  /**
   * 拍下來的照片還能不能自動拉正。
   * 相機開不起來但影像處理工具是好的 → 可以（和「從相簿選擇照片」走同一條路）；
   * 影像處理工具壞了 → 不行，照片照原樣收下。
   */
  canRectify: boolean;
}

/**
 * 要不要給「改用手機相機」這條路。null＝掃描是好的，不要多一顆按鈕出來分散注意。
 *
 * ⚠️ 影像處理工具還在載入時**不算壞**：手機網路慢的時候 10MB 要載十幾秒，
 *    這時候就跳出「改用手機相機」，大家都會去按，等於把掃描廢掉。
 */
export function scanFallbackOf({ insecure, cvState, cameraError }: ScanFallbackInput): ScanFallback | null {
  const canRectify = cvState === 'ready';
  if (cvState === 'error') {
    return { reason: '影像處理工具沒有載入成功，這次不能自動拉正。', canRectify: false };
  }
  if (insecure) {
    return { reason: '這個網址不是安全連線，網頁不能直接開相機。', canRectify };
  }
  if (cameraError) {
    return { reason: `相機開不起來（${cameraError}）。`, canRectify };
  }
  return null;
}

/** 那顆備用按鈕下面的說明 */
export function scanFallbackHint(fallback: ScanFallback): string {
  return fallback.canRectify
    ? '用手機內建的相機拍，拍完一樣會自動框出稿紙、拉正。'
    : '用手機內建的相機拍，照片會照原樣收下。請盡量從正上方拍、四個角都拍進去。';
}
