import type { ProxyOcrStatus } from './status';

/**
 * 輪詢節奏。
 *
 * 剛按下開始的前幾次要快一點（老師正盯著看），之後逐步放慢 ——
 * 一次 execution 要好幾分鐘，每三秒問一次只是在燒請求。
 */
const STEPS_MS = [3000, 5000, 10000];
export const POLL_MAX_MS = 15000;

export function pollDelayMs(attempt: number): number {
  if (attempt < 0) return STEPS_MS[0];
  return attempt < STEPS_MS.length ? STEPS_MS[attempt] : POLL_MAX_MS;
}

/**
 * 還要不要繼續問。
 *
 * 只看「辨識中」。待辨識的不會自己變（除非每小時的自動 OCR 撿走，
 * 那由清單的正常重載接手就好），完成與失敗是終態。
 */
export function shouldKeepPolling(statuses: ProxyOcrStatus[]): boolean {
  return statuses.includes('running');
}
