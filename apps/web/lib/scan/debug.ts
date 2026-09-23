/**
 * 掃描的效能診斷旗標。
 *
 * 只給開發與現場除錯用：正式使用者看不到，也不會因此多付任何成本
 * （關閉時 HUD 整個不 render，見 components/scan/ScanDebugHud.tsx）。
 *
 * 兩種開啟方式：
 *   1. 網址加 `?scandebug=1` —— 電話裡口述得出來，也貼得進 LINE。
 *      讀到之後寫進 sessionStorage，之後在站內換頁不會掉。
 *   2. 長按相機畫面右上角的解析度標籤 —— 已經在掃描畫面裡、懶得重打網址時用。
 *
 * 嚴格比對 `'1'`：不要讓 `?scandebug=0` 之類的字串也算數。
 */

const KEY = 'udn.scan.debug';
const PARAM = 'scandebug';

/** 記憶體裡的一份，sessionStorage 被擋（無痕模式）時仍然可用 */
let memory: boolean | null = null;

function readSession(): boolean | null {
  try {
    const v = sessionStorage.getItem(KEY);
    return v === null ? null : v === '1';
  } catch {
    return null;
  }
}

function writeSession(on: boolean) {
  try {
    sessionStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* 無痕模式或被擋，記憶體那份還在 */
  }
}

/** 目前要不要顯示診斷。網址的 ?scandebug=1 會寫進 session，之後都以 session 為準 */
export function isScanDebug(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const q = new URLSearchParams(window.location.search).get(PARAM);
    if (q !== null) {
      const on = q === '1';
      memory = on;
      writeSession(on);
      return on;
    }
  } catch {
    /* URL 解析失敗就當作沒帶參數 */
  }
  if (memory !== null) return memory;
  const s = readSession();
  memory = s ?? false;
  return memory;
}

/** 長按解析度標籤時切換 */
export function toggleScanDebug(): boolean {
  const next = !isScanDebug();
  memory = next;
  writeSession(next);
  return next;
}
