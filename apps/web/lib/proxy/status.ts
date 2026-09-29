/**
 * 批次代繳交：每一位學生的辨識狀態。
 *
 * 背景辨識是 Cloud Run 的 ocr-job 做的，**它的原始碼不在這個 repo**，
 * 我們只看得到它留在資料表上的痕跡（`batch_proxy_submission.ocr_time`
 * 與 submission 有沒有文字）。所以狀態是**推導**出來的，全部集中在這裡，
 * 時鐘由參數注入 —— 函式裡不碰 `Date.now()`，才測得到逾時那幾格。
 */

/** 伺服器回的一列（`GET /assignments/:id/proxy_status`） */
export interface ProxyStatusRow {
  userId: string;
  batchId: string;
  submissionId: string | null;
  createdAt: string;
  lastUpdate: string;
  ocrTime: string | null;
  /** submission 有沒有真的拿到文字 —— `ocrTime` 有值不等於成功 */
  hasContent: boolean;
  /** GCS 上的**裸檔名**（沒有 `submit/assign_<id>/` 前綴，見 paths.ts） */
  imgFiles: string[];
}

export type ProxyOcrStatus =
  /** 還沒收照片 */
  | 'idle'
  /** 照片正在傳（只存在於這台裝置的記憶體裡） */
  | 'uploading'
  /** 傳失敗了，照片還在記憶體，可以重傳 */
  | 'upload_failed'
  /** 照片收好了，還沒按「開始辨識」 */
  | 'queued'
  /** 已經送去辨識，等結果 */
  | 'running'
  /** 辨識完成，而且真的有文字 */
  | 'done'
  /** 辨識失敗或逾時 */
  | 'failed';

/**
 * 送去辨識之後等多久算逾時。
 *
 * 一次 execution 實際要多久要等量過才知道（計畫的階段 0），
 * 先抓一個寬鬆的值：寧可晚一點標失敗，也不要辨識到一半就叫老師重試 ——
 * 重試會再開一個 job，兩個 job 可能競寫同一篇作文。
 */
export const OCR_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * 「有沒有按過開始辨識」。
 *
 * 不存在瀏覽器裡：老師在手機上收照片、按開始，回到電腦上看清單，
 * 兩台裝置要看到同一個答案。用伺服器上的兩個時間戳推：
 *
 *   收照片時   created_at 與 last_update 是同一個 now()（同一句 INSERT）
 *   按開始時   只推 last_update（touchTriggered）
 *
 * 所以 last_update 晚於 created_at 就是按過了。
 */
export function wasTriggered(row: Pick<ProxyStatusRow, 'createdAt' | 'lastUpdate'>): boolean {
  return Date.parse(row.lastUpdate) > Date.parse(row.createdAt);
}

/**
 * 一位學生現在是什麼狀態。
 *
 * `upload` 是這台裝置上傳佇列的狀態，**優先於**伺服器的資料 ——
 * 正在傳新的一批時，伺服器上那一列還是舊的。
 */
export function proxyOcrStatusOf(
  row: ProxyStatusRow | undefined,
  opts: { nowMs: number; upload?: 'uploading' | 'upload_failed'; timeoutMs?: number },
): ProxyOcrStatus {
  if (opts.upload) return opts.upload;
  if (!row) return 'idle';

  /*
    ⚠️ ocr_time 有值**不等於**成功。黑箱失敗時也可能蓋時間戳，
       所以要跟 submission 有沒有文字一起看。
  */
  if (row.ocrTime) return row.hasContent ? 'done' : 'failed';

  if (!wasTriggered(row)) return 'queued';

  /*
    ⚠️ 逾時要從 last_update 算，**不能**從 created_at 算。
       老師是拍完一整班才按開始的 —— 第一位的 created_at 可能早二十分鐘，
       用它算的話，按下按鈕的那一瞬間前面幾位就全被標成失敗。
  */
  const elapsed = opts.nowMs - Date.parse(row.lastUpdate);
  return elapsed >= (opts.timeoutMs ?? OCR_TIMEOUT_MS) ? 'failed' : 'running';
}

// 顯示文字與顏色在 lib/statusStyles.ts 的 PROXY_OCR_STYLE（全站狀態樣式的唯一來源）

/** 這一批裡各狀態有幾位 */
export type ProxyStatusCounts = Record<ProxyOcrStatus, number>;

export function countStatuses(statuses: ProxyOcrStatus[]): ProxyStatusCounts {
  const counts: ProxyStatusCounts = {
    idle: 0, uploading: 0, upload_failed: 0, queued: 0, running: 0, done: 0, failed: 0,
  };
  for (const s of statuses) counts[s] += 1;
  return counts;
}

/**
 * 給批改清單上那顆 pill 的一句話。沒有東西要回報時回 null（整顆不顯示）。
 *
 * 只算「進了這條流程」的人 —— 名冊上還沒登錄的不列入分母，
 * 否則三十人的班登錄了兩位，會看到「30 位中 2 位完成」，像是出了大事。
 */
export function proxyBatchSummary(counts: ProxyStatusCounts): string | null {
  const inFlow =
    counts.uploading + counts.upload_failed + counts.queued +
    counts.running + counts.done + counts.failed;
  if (inFlow === 0) return null;

  const parts: string[] = [];
  if (counts.running) parts.push(`辨識中 ${counts.running}`);
  if (counts.queued) parts.push(`待辨識 ${counts.queued}`);
  if (counts.uploading) parts.push(`上傳中 ${counts.uploading}`);
  const trouble = counts.failed + counts.upload_failed;
  if (trouble) parts.push(`失敗 ${trouble}`);
  if (!parts.length) return `代繳交 ${counts.done} 位已辨識完成`;
  return `代繳交 ${parts.join('・')}（共 ${inFlow} 位）`;
}

/** 可以按「重試」的人：辨識失敗的（上傳失敗是另一顆按鈕 —— 那要重傳，不是重新辨識） */
export function retryTargets(
  entries: Array<{ studentId: string; status: ProxyOcrStatus }>,
): string[] {
  return entries.filter((e) => e.status === 'failed').map((e) => e.studentId);
}

/** 「開始辨識 N 位」的 N */
export function startTargets(
  entries: Array<{ studentId: string; status: ProxyOcrStatus }>,
): string[] {
  return entries.filter((e) => e.status === 'queued').map((e) => e.studentId);
}
