import type { PaperOrientation } from './geometry';

/**
 * 拍照畫面上「橫式稿紙／直式稿紙」的選擇，記在這台裝置上。
 *
 * 預設橫式：聯合報、會考、學測的稿紙都是橫的。用直式稿紙（坊間稿紙、作文簿）的學校
 * 切一次就好，下次打開相機還是直式。只是對齊框的形狀，存錯或讀不到都不影響拍照，
 * 所以 localStorage 不能用（無痕模式、被封鎖）時安靜地用預設值。
 */
export const PAPER_ORIENTATION_KEY = 'udn.scan.paperOrientation';
export const DEFAULT_PAPER_ORIENTATION: PaperOrientation = 'landscape';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const browserStorage = (): StorageLike | null => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
};

export function readPaperOrientation(storage: StorageLike | null = browserStorage()): PaperOrientation {
  try {
    const v = storage?.getItem(PAPER_ORIENTATION_KEY);
    return v === 'portrait' || v === 'landscape' ? v : DEFAULT_PAPER_ORIENTATION;
  } catch {
    return DEFAULT_PAPER_ORIENTATION;
  }
}

export function savePaperOrientation(
  value: PaperOrientation,
  storage: StorageLike | null = browserStorage(),
): void {
  try {
    storage?.setItem(PAPER_ORIENTATION_KEY, value);
  } catch {
    /* 存不了就下次再用預設值，不影響拍照 */
  }
}
