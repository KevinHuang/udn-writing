import { useCallback, useEffect, useState } from 'react';

export type LoadStatus = 'loading' | 'ready' | 'error';

/**
 * 一份從後端載入的清單。
 *
 * 資源 3～7 都是同一個形狀（載入、重新載入、就地更新），所以收在這裡一份。
 * 各自寫一次的話，「載入失敗時要不要清空既有資料」這種細節就會四份不一樣。
 *
 * `enabled` 是給登入狀態用的 —— 還沒登入就打 API 只會拿到 401，
 * 徒增一次失敗的請求與一行沒必要的錯誤訊息。
 */
export function useApiList<T>(
  load: () => Promise<T[]>,
  enabled: boolean,
): {
  items: T[];
  setItems: React.Dispatch<React.SetStateAction<T[]>>;
  status: LoadStatus;
  reload: () => Promise<void>;
} {
  const [items, setItems] = useState<T[]>([]);
  // 初值就是 loading —— 還沒載入完本來就是這個狀態。
  // 在 effect 裡同步呼叫 setStatus('loading') 會觸發一次多餘的 render
  // （react-hooks/set-state-in-effect 擋的就是這個）。
  const [status, setStatus] = useState<LoadStatus>('loading');

  const reload = useCallback(async () => {
    setStatus('loading');
    try {
      setItems(await load());
      setStatus('ready');
    } catch (e) {
      console.error('載入失敗:', e);
      // **刻意不清空 items。** 重新載入失敗時把畫面上的資料抹掉，
      // 使用者看到的是「東西不見了」而不是「更新失敗」——
      // 後者才是實際發生的事。
      setStatus('error');
    }
  }, [load]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    load()
      .then((rows) => { if (!cancelled) { setItems(rows); setStatus('ready'); } })
      .catch((e) => {
        if (cancelled) return;
        console.error('載入失敗:', e);
        // 刻意不清空 items，理由見 reload()
        setStatus('error');
      });
    return () => { cancelled = true; };
  }, [enabled, load]);

  return { items, setItems, status, reload };
}
