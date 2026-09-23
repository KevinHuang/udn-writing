import { useCallback, useState } from 'react';

/**
 * 左右分割版面的比例（左欄佔幾 %），記在這台裝置的瀏覽器裡。
 *
 * 老師批改時習慣的比例因人而異（有人要大稿紙、有人要大評語面板），
 * 拖過一次之後下次打開就該是那個比例，不要每次重調。
 *
 * ⚠️ 與 lib/avatar.ts 同樣的前提：localStorage 在無痕模式、擋了網站資料
 *    的瀏覽器裡會丟錯，所有讀寫都要 try/catch，讀不到就回預設值。
 */

/** 左欄最少、最多佔多少 —— 兩邊都要留得下內容 */
export const MIN_PCT = 30;
export const MAX_PCT = 75;

export const clampPct = (pct: number): number =>
  Math.min(MAX_PCT, Math.max(MIN_PCT, Math.round(pct)));

/** 存進去的字串 → 比例。壞掉、超出範圍、不是數字都回 fallback */
export function parsePct(raw: string | null, fallback: number): number {
  // 空字串要當成「沒存過」—— Number('') 是 0，會被 clamp 成最小比例，
  // 老師一打開就看到最窄的稿紙，看起來像設定被改掉了
  if (raw === null || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return clampPct(n);
}

export function useSplitPane(
  storageKey: string,
  defaultPct: number,
): [number, (pct: number) => void, () => void] {
  const [pct, setPctState] = useState(() => {
    try {
      return parsePct(window.localStorage.getItem(storageKey), defaultPct);
    } catch {
      return defaultPct;
    }
  });

  const setPct = useCallback(
    (next: number) => {
      const value = clampPct(next);
      setPctState(value);
      try {
        window.localStorage.setItem(storageKey, String(value));
      } catch {
        // 存不了就只在這次開著的期間有效
      }
    },
    [storageKey],
  );

  /** 回到預設比例（雙擊分隔線、按 Home） */
  const reset = useCallback(() => setPct(defaultPct), [setPct, defaultPct]);

  return [pct, setPct, reset];
}
