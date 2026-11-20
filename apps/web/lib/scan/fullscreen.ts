/**
 * 拍照時的全螢幕。
 *
 * 為什麼要：從 LINE、Google App 之類點連結開的網頁，是在那個 App 的內嵌瀏覽器
 * （Chrome Custom Tab）裡跑，頂端有一條網頁畫不到的工具列。手機橫拿時它吃掉快兩成的高度，
 * 對齊框看不完整（2026-11-20 手機實測）。正式部署後那條工具列也還在 —— 它是瀏覽器的，不是網頁的。
 * 唯一的辦法是請瀏覽器進入全螢幕。
 *
 * - 只在觸控裝置上做：電腦用網路攝影機拍時突然全螢幕只會嚇到人。
 * - 只能在使用者按下按鈕的當下呼叫（瀏覽器規定要有使用者手勢），所以掛在「開啟相機」的按鈕上。
 * - iPhone 的 Safari 不支援對網頁元素全螢幕（只有影片可以），requestFullscreen 不存在，就安靜地不做。
 * - 進不了全螢幕不算錯，拍照照常進行。
 * - 只退出「自己進入的」全螢幕：使用者本來就在全螢幕的話，關掉掃描不該把它退掉。
 */

/** 用到的 document 介面。抽出來是為了能用假的 document 測試 */
export interface FullscreenDoc {
  fullscreenElement: Element | null;
  documentElement: { requestFullscreen?: (options?: FullscreenOptions) => Promise<void> };
  exitFullscreen?: () => Promise<void>;
}

/** 是不是手機、平板這類主要用手指操作的裝置 */
export function isTouchDevice(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches;
}

/**
 * 請瀏覽器進入全螢幕。
 * @returns 這一次真的由我們進入了全螢幕才回 true（之後要靠它決定要不要退出）
 */
export async function enterScanFullscreen(
  doc: FullscreenDoc = document as unknown as FullscreenDoc,
  touch: boolean = isTouchDevice(),
): Promise<boolean> {
  if (!touch) return false;
  if (doc.fullscreenElement) return false;
  const request = doc.documentElement.requestFullscreen;
  if (typeof request !== 'function') return false;
  try {
    // navigationUI: 'hide'：Android 的系統導覽列也一起收起來
    await request.call(doc.documentElement, { navigationUI: 'hide' });
    return true;
  } catch {
    return false;
  }
}

/** 退出全螢幕。只在 enterScanFullscreen 回 true 過之後呼叫 */
export function exitScanFullscreen(doc: FullscreenDoc = document as unknown as FullscreenDoc): void {
  if (!doc.fullscreenElement || typeof doc.exitFullscreen !== 'function') return;
  doc.exitFullscreen().catch(() => {
    /* 使用者已經自己按返回鍵退出了，就算了 */
  });
}
