/**
 * 會寫進 localStorage 的 useState。
 *
 * 這是為了「展示」而做的：原型原本所有操作（派發作業、批改、開關）
 * 都只存在記憶體裡，示範到一半按了重新整理就全部回到 mockData。
 * 對著人講解時這很致命。
 *
 * 注意這不是後端。它只存在這一台瀏覽器，換裝置或清除網站資料就沒了；
 * 真正上線仍然需要伺服器。
 */

import { useState, useEffect, useCallback, type Dispatch, type SetStateAction } from 'react';

/** 統一前綴，方便一次清除，也避免和其他站台的鍵衝突 */
const PREFIX = 'udn-writing:';

/**
 * 示範資料的版本。**改動 mockData.ts 的結構或代碼時，把這個數字加一。**
 *
 * 原因：課程、題目、作業都會被存進 localStorage，之後就一直沿用舊的快取。
 * 學期代碼換掉那次，舊快取裡的課程全部對不上新的學期選項，
 * 畫面上一門課都不剩 —— 程式沒錯，是資料過期了，但看起來像壞掉。
 * 版本不合就整包清掉重來，比讓人對著空畫面猜原因好。
 */
const SCHEMA_VERSION = '16';
const VERSION_KEY = PREFIX + 'schema';

/** 版本不符就清空舊資料。模組載入時跑一次，早於任何 useState 初始化 */
function migrate(): void {
  try {
    if (localStorage.getItem(VERSION_KEY) === SCHEMA_VERSION) return;
    clearAll();
    localStorage.setItem(VERSION_KEY, SCHEMA_VERSION);
  } catch {
    // 隱私模式之類讀不到 localStorage，就當作沒有快取
  }
}

function clearAll(): void {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(PREFIX)) keys.push(k);
  }
  keys.forEach((k) => localStorage.removeItem(k));
}

migrate();

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    // 隱私模式、封鎖 site data、或存進去的 JSON 壞掉，
    // 一律回退到預設值，不要讓整個畫面掛掉
    return fallback;
  }
}

export function usePersistentState<T>(
  key: string,
  initial: T,
): [T, Dispatch<SetStateAction<T>>] {
  // 用初始化函式讀取，避免每次 render 都碰 localStorage
  const [value, setValue] = useState<T>(() => read(key, initial));

  useEffect(() => {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      // 存不進去（容量滿、隱私模式）就算了，畫面照常運作
    }
  }, [key, value]);

  return [value, setValue];
}

/**
 * 把所有展示資料清空，回到 mockData 的初始狀態。
 * 展示前重置、或講解途中想重來一次時使用。
 */
export function resetDemoData(): void {
  try {
    clearAll();
    localStorage.setItem(VERSION_KEY, SCHEMA_VERSION);
  } catch {
    // 清不掉就算了
  }
}

/** 目前是否有存下來的展示資料（用來決定要不要顯示「重置」按鈕） */
export function hasDemoData(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX) && k !== VERSION_KEY) return true;
    }
  } catch {
    return false;
  }
  return false;
}

/** 提供給元件的重置動作：清除後重新載入頁面 */
export function useResetDemo(): () => void {
  return useCallback(() => {
    resetDemoData();
    window.location.reload();
  }, []);
}
