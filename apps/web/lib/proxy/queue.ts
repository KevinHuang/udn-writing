/**
 * 代繳交的上傳佇列（純資料結構，不碰 fetch）。
 *
 * 一個工作 = **一位學生的整份照片**，一次請求送完。
 *
 * ⚠️ 不要拆成「一張照片一個請求」：後端每收一批就會把該生的舊批退役
 *    （一位學生任何時刻只有一批是現行的）—— 三頁作文分三次傳，
 *    最後只剩第三頁。照片先在前端壓到長邊 3000px，八頁也遠低於 20MB 上限。
 */

export type UploadState = 'pending' | 'uploading' | 'failed';

export interface UploadJob {
  /** 佇列裡的唯一鍵（同一位學生重拍會產生新的工作） */
  id: string;
  studentId: string;
  pageCount: number;
  state: UploadState;
  attempts: number;
  error?: string;
}

/**
 * 同時傳幾位。
 *
 * 老師是連續在拍的，前一位還在傳、下一位就交進來了。開兩條就夠用，
 * 再多只是在搶手機那一條上行頻寬，每一位都變慢。
 */
export const UPLOAD_CONCURRENCY = 2;

/**
 * 收一位學生的照片。
 *
 * 同一位學生**還沒開始傳**或**傳失敗**的舊工作直接換掉（老師重拍了）；
 * 已經在傳的留著讓它傳完 —— 伺服器會用新的那一批把它退役。
 */
export function enqueue(
  queue: UploadJob[],
  job: Omit<UploadJob, 'state' | 'attempts' | 'error'>,
): UploadJob[] {
  const kept = queue.filter((j) => !(j.studentId === job.studentId && j.state !== 'uploading'));
  return [...kept, { ...job, state: 'pending', attempts: 0 }];
}

/** 下一個可以開始傳的工作；已經滿了就回 undefined */
export function nextPending(
  queue: UploadJob[],
  concurrency = UPLOAD_CONCURRENCY,
): UploadJob | undefined {
  const inFlight = queue.filter((j) => j.state === 'uploading').length;
  if (inFlight >= concurrency) return undefined;
  return queue.find((j) => j.state === 'pending');
}

const update = (queue: UploadJob[], id: string, patch: Partial<UploadJob>): UploadJob[] =>
  queue.map((j) => (j.id === id ? { ...j, ...patch } : j));

export const markUploading = (queue: UploadJob[], id: string) =>
  update(queue, id, { state: 'uploading', error: undefined });

export function markFailed(queue: UploadJob[], id: string, error: string): UploadJob[] {
  const job = queue.find((j) => j.id === id);
  return update(queue, id, { state: 'failed', error, attempts: (job?.attempts ?? 0) + 1 });
}

/** 傳好的直接移出佇列 —— 之後的狀態以伺服器為準 */
export const markDone = (queue: UploadJob[], id: string) => queue.filter((j) => j.id !== id);

/** 把失敗的放回去重傳 */
export const requeue = (queue: UploadJob[], id: string) =>
  update(queue, id, { state: 'pending', error: undefined });

/**
 * 這位學生在這台裝置上的上傳狀態。**最新的那個工作說了算**
 * （重拍之後，舊的失敗不該再把他標成紅色）。
 */
export function uploadStateOf(
  queue: UploadJob[],
  studentId: string,
): 'uploading' | 'upload_failed' | undefined {
  const mine = queue.filter((j) => j.studentId === studentId);
  const latest = mine[mine.length - 1];
  if (!latest) return undefined;
  if (latest.state === 'failed') return 'upload_failed';
  return 'uploading'; // pending 在老師眼裡也是「傳送中」
}

/** 還有沒有照片只存在於記憶體裡（關掉視窗就會不見） */
export const hasUnsentPhotos = (queue: UploadJob[]) => queue.length > 0;
