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
  /**
   * 稿紙逐格辨識的狀態（照片是「我的稿紙」印的稿紙時才有，docs/grid-ocr.md）。
   * 有值時狀態是後端**明確記下來的**，不用從 ocrTime 推；null＝照舊走 ocr-job。
   */
  gridStatus?: GridStatus | null;
  /** 逐格辨識失敗的原因（給老師看的一句話） */
  gridError?: string | null;
  /** 背景工作**領到**這一批的時間（claim）。沒領到就是 null */
  gridStartedAt?: string | null;
  /** 這一列最後一次變動的時間。queued 卡住只能用它算 —— 那時候還沒有 started_at */
  gridUpdatedAt?: string | null;
}

export type GridStatus = 'pending' | 'queued' | 'running' | 'done' | 'failed';

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
 * 逐格辨識卡住多久就當作失敗。
 * 要和後端 dal/grid_ocr_helper.ts 的 STALE_RUNNING_MINUTES 一致：過了這個時間，後端也接受重新辨識。
 *
 * **兩種卡住都要算**，時間基準不同：
 *   running  背景工作領到了卻沒跑完（中途被關掉）→ 算 gridStartedAt
 *   queued   背景工作**根本沒領到**（job 啟動了卻在 claim 之前就掛掉、映像檔壞了、
 *            配額滿了）→ 那時候還沒有 started_at，只能算 gridUpdatedAt
 *
 * ⚠️ queued 這一格以前沒有出口：它顯示成「辨識中」，而逾時只看 running，
 *    所以那一列會永遠轉圈，而「重試」只出現在失敗的人身上 —— 老師沒有任何辦法
 *    讓它動。後端的 markQueued 本來就接受重新排隊 queued，缺的只是畫面上的出口。
 */
export const GRID_STALE_MS = 15 * 60 * 1000;

/** 這個時間點到現在有沒有超過 GRID_STALE_MS。沒有時間戳就不算卡住（舊資料） */
const stale = (at: string | null | undefined, nowMs: number): boolean =>
  !!at && nowMs - Date.parse(at) >= GRID_STALE_MS;

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

  // 稿紙逐格辨識：狀態是記下來的，照著對應就好
  if (row.gridStatus) {
    switch (row.gridStatus) {
      // 還沒按「開始辨識」—— 不是卡住，放多久都還是「待辨識」
      case 'pending': return 'queued';
      // 已經送出去了，等背景工作領取。領不到就一直是 queued，所以也要算卡住
      case 'queued': return stale(row.gridUpdatedAt, opts.nowMs) ? 'failed' : 'running';
      case 'running': return stale(row.gridStartedAt, opts.nowMs) ? 'failed' : 'running';
      case 'done': return 'done';
      case 'failed': return 'failed';
    }
  }

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

/**
 * 辨識失敗的原因（給老師看）。只有逐格辨識記得原因；ocr-job 是黑箱，回 null。
 * 卡住太久的也給一句話，免得老師只看到「失敗」不知道為什麼。
 */
export function failureReasonOf(row: ProxyStatusRow | undefined, nowMs: number): string | null {
  if (!row?.gridStatus) return null;
  if (row.gridStatus === 'failed') return row.gridError || '稿紙辨識失敗，請按「重試」';
  if (row.gridStatus === 'running' && stale(row.gridStartedAt, nowMs)) {
    return '辨識太久沒有完成，請按「重試」';
  }
  // 送出去了卻一直沒有開始 —— 背景工作沒領到這一批（和「跑到一半停住」不是同一件事）
  if (row.gridStatus === 'queued' && stale(row.gridUpdatedAt, nowMs)) {
    return '辨識一直沒有開始，請按「重試」';
  }
  return null;
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
