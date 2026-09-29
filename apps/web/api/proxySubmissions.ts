import { api } from './client';
import type { ProxyStatusRow } from '../lib/proxy/status';

/**
 * 批次代繳交：先收照片、後台辨識。
 *
 * 三支端點刻意分開：
 *
 *   上傳   `POST /submissions/ocr_proxy`         只存照片，**不做 OCR**
 *   觸發   `POST /submissions/ocr_proxy/start`   送去背景辨識（重試也是這一支）
 *   狀態   `GET  /assignments/:id/proxy_status`  輪詢用，不含作文全文
 *
 * 上傳與觸發分開，老師才能一位接一位地拍而不必等辨識；
 * 而且重試時**不必重傳照片**（照片早就在 GCS 了）。
 */

export interface ProxyImage {
  /** 不含 `data:` 前綴 */
  base64Image: string;
  mimeType: string;
}

export interface ProxyUploadResult {
  batchId: string;
  batchUUID: string;
  /** GCS 上的裸檔名（沒有資料夾前綴，見 lib/proxy/paths.ts） */
  files: string[];
}

/** 收一位學生的照片（整份一次送，見 lib/proxy/queue.ts 為什麼不拆張） */
export function uploadProxyImages(
  assignmentId: string,
  studentId: string,
  images: ProxyImage[],
): Promise<ProxyUploadResult> {
  return api.post<ProxyUploadResult>('/service/instructor/submissions/ocr_proxy', {
    assignmentId,
    studentId,
    images,
  });
}

export interface ProxyStartResult {
  started: Array<{ studentId: string; batchUUID: string }>;
  failed: Array<{ studentId: string; error: string }>;
  skipped: Array<{ studentId: string; reason: 'not_found' | 'already_done' }>;
}

/**
 * 送去背景辨識。`studentIds` 省略＝這份作業所有待辨識的。
 * 重試也是這一支（帶那一位的 id）；已經辨識完成的要帶 `force` 才會重跑。
 */
export function startProxyOcr(
  assignmentId: string,
  studentIds?: string[],
  force = false,
): Promise<ProxyStartResult> {
  return api.post<ProxyStartResult>('/service/instructor/submissions/ocr_proxy/start', {
    assignmentId,
    ...(studentIds ? { studentIds } : {}),
    ...(force ? { force: true } : {}),
  });
}

interface RawProxyStatus {
  /** 伺服器時間 —— 逾時要用它算，不能用老師電腦的時鐘 */
  now: string;
  rows: Array<{
    id: string;
    user_id: string;
    submission_id: string | null;
    created_at: string;
    last_update: string;
    ocr_time: string | null;
    has_content: boolean;
    img_files: string[];
  }>;
}

export interface ProxyStatus {
  /** 伺服器此刻的時間（毫秒） */
  nowMs: number;
  rows: ProxyStatusRow[];
}

export async function fetchProxyStatus(assignmentId: string): Promise<ProxyStatus> {
  const raw = await api.get<RawProxyStatus>(
    `/service/instructor/assignments/${assignmentId}/proxy_status`,
  );
  return {
    nowMs: Date.parse(raw.now),
    rows: raw.rows.map((r) => ({
      userId: String(r.user_id),
      batchId: String(r.id),
      submissionId: r.submission_id != null ? String(r.submission_id) : null,
      createdAt: r.created_at,
      lastUpdate: r.last_update,
      ocrTime: r.ocr_time,
      hasContent: !!r.has_content,
      imgFiles: Array.isArray(r.img_files) ? r.img_files : [],
    })),
  };
}
