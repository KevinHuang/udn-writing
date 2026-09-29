import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchProxyStatus, type ProxyStatus } from '../../api/proxySubmissions';
import { pollDelayMs, shouldKeepPolling } from './poll';
import { proxyOcrStatusOf, type ProxyOcrStatus, type ProxyStatusRow } from './status';

/**
 * 批改清單與批改頁用的代繳交辨識狀態（代繳交視窗自己另有一份更密的輪詢）。
 *
 * 老師關掉代繳交視窗之後，辨識還在背景跑 —— 這裡讓批改清單看得到進度，
 * 有人完成時通知外面重載作文。
 *
 * 輪詢比視窗裡慢（最快 15 秒一次）：老師這時候在做別的事，不需要即時。
 * 沒有「辨識中」的人就完全不問。
 */
const LIST_POLL_MIN_MS = 15000;

export interface ProxyStatusView {
  rows: ProxyStatusRow[];
  /** 伺服器時間（最後一次回應時） */
  nowMs: number;
  statusOf: (studentId: string) => ProxyOcrStatus;
  /** 「AI 辨識、還沒有人校對過」：辨識完成、而且批次還沒退役 */
  isUnproofread: (studentId: string) => boolean;
  refresh: () => Promise<void>;
}

export function useProxyStatus(
  assignmentId: string | null | undefined,
  onNewlyDone?: () => void,
): ProxyStatusView {
  const [rows, setRows] = useState<ProxyStatusRow[]>([]);
  const [nowMs, setNowMs] = useState(0);
  const lastDoneRef = useRef<number | null>(null);
  // 同 ProxySubmitModal：呼叫端多半傳行內函式，不能放進相依陣列
  const onNewlyDoneRef = useRef(onNewlyDone);
  useEffect(() => {
    onNewlyDoneRef.current = onNewlyDone;
  });

  const apply = useCallback((next: ProxyStatus) => {
    setRows(next.rows);
    setNowMs(next.nowMs);
    const done = next.rows.filter((r) => r.ocrTime && r.hasContent).length;
    if (lastDoneRef.current !== null && done > lastDoneRef.current) onNewlyDoneRef.current?.();
    lastDoneRef.current = done;
  }, []);

  const refresh = useCallback(async () => {
    if (!assignmentId) return;
    try {
      apply(await fetchProxyStatus(assignmentId));
    } catch (e) {
      // 進度讀不到不該擋住批改清單 —— 清單本身照常用，只是沒有徽章
      console.error('讀取代繳交辨識進度失敗:', e);
    }
  }, [assignmentId, apply]);

  // 換作業時重讀。setState 在 then 裡（非同步回呼），不在 effect 本體同步呼叫
  useEffect(() => {
    lastDoneRef.current = null;
    if (!assignmentId) return;
    let cancelled = false;
    fetchProxyStatus(assignmentId)
      .then((next) => { if (!cancelled) apply(next); })
      .catch((e) => console.error('讀取代繳交辨識進度失敗:', e));
    return () => { cancelled = true; };
  }, [assignmentId, apply]);

  const byStudent = useMemo(() => new Map(rows.map((r) => [r.userId, r])), [rows]);
  const statusOf = useCallback(
    (studentId: string) => proxyOcrStatusOf(byStudent.get(studentId), { nowMs }),
    [byStudent, nowMs],
  );

  const keepPolling = shouldKeepPolling(rows.map((r) => statusOf(r.userId)));
  useEffect(() => {
    if (!keepPolling) return;
    let attempt = 0;
    let timer: number | undefined;
    let cancelled = false;
    const tick = async () => {
      if (document.visibilityState !== 'hidden') await refresh();
      if (cancelled) return;
      timer = window.setTimeout(tick, Math.max(LIST_POLL_MIN_MS, pollDelayMs(++attempt)));
    };
    timer = window.setTimeout(tick, LIST_POLL_MIN_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [keepPolling, refresh]);

  const isUnproofread = useCallback(
    (studentId: string) => statusOf(studentId) === 'done',
    [statusOf],
  );

  return { rows, nowMs, statusOf, isUnproofread, refresh };
}
