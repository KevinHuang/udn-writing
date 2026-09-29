import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  Camera,
  Check,
  FileText,
  Keyboard,
  ListChecks,
  Loader2,
  Play,
  RefreshCw,
  ScanLine,
  Upload,
  UserCheck,
  X,
} from 'lucide-react';
import { Assignment, Submission } from '../types';
/*
  ⚠️ 座號走 lib/gradingQueue 的 seatText()，**不要用 mockData 的 seatLabel()**。
     那一支是從原型的 studentId（`s-c1-0`）split 出最後一段，真實的 studentId
     是 user.id —— 它會把 user id 當成座號印出來（實測：畫面顯示 52、53，
     那其實是使用者編號，而這個班的 seat_no 全是 null）。
*/
import { seatText } from '../lib/gradingQueue';
import { checkImageFile } from '../lib/questionMeta';
import { imageUrlOf } from '../api/ai';
import {
  fetchProxyStatus,
  startProxyOcr,
  uploadProxyImages,
  type ProxyStatus,
} from '../api/proxySubmissions';
import { prepareProxyImage } from '../lib/proxy/image';
import {
  countStatuses,
  proxyBatchSummary,
  proxyOcrStatusOf,
  retryTargets,
  startTargets,
  type ProxyOcrStatus,
  type ProxyStatusRow,
} from '../lib/proxy/status';
import { pollDelayMs, shouldKeepPolling } from '../lib/proxy/poll';
import { proxyImagePath } from '../lib/proxy/paths';
import {
  enqueue,
  hasUnsentPhotos,
  markDone,
  markFailed,
  markUploading,
  nextPending,
  requeue,
  uploadStateOf,
  type UploadJob,
} from '../lib/proxy/queue';
import { PROXY_OCR_STYLE } from '../lib/statusStyles';
import { DocumentScannerModal, type ScannedPage } from './scan/DocumentScannerModal';
import { ConfirmDialog } from './ConfirmDialog';

type Tab = 'register' | 'progress';

interface ProxySubmitModalProps {
  assignment: Assignment;
  /** App.tsx 已經把名冊與繳交狀態合併好了，這裡不重算 */
  rosterSubmissions: Submission[];
  onClose: () => void;
  /**
   * 「改用打字」那條路：老師直接打好一位的作文，同步存進 submission。
   * picFiles 在這條路上一定是空的（照片走的是背景辨識那條）。
   */
  onProxySubmit: (
    studentId: string,
    studentName: string,
    content: string,
    picFiles: string[],
    opts?: { confirmOcr?: boolean },
  ) => void;
  /** 有學生辨識完成了 —— 外面要重載繳交清單，作文才看得到 */
  onBatchChanged?: () => void;
  /** 從批改清單的「辨識中」pill 打開時，直接停在進度分頁 */
  initialTab?: Tab;
}

/** 這一位目前的照片還在這台裝置的記憶體裡（還沒傳上去） */
type PendingBlobs = Map<string, Blob[]>;

const messageOf = (e: unknown) => (e instanceof Error ? e.message : '網路或伺服器錯誤');

/**
 * 批次代繳交：老師把一整疊紙本作文登錄進系統。
 *
 * **先收照片、後台辨識。** 以前是「選一位 → 拍照 → 等 OCR（每張數十秒）→
 * 存檔 → 換下一位」，老師手上拿著一疊稿紙，卻得一位一位等機器。現在是：
 *
 *   1. 登錄分頁：拍完一位，照片**立刻上傳**、自動跳下一位，不做辨識
 *   2. 全部收完按「開始辨識」—— 由背景的 ocr-job 一位一位辨識，
 *      **可以關掉這個視窗去做別的事**
 *   3. 進度分頁：看誰完成、誰失敗；失敗的**單獨重試**（照片不必重傳）
 *
 * ⚠️ 以前這個檔頭寫著「OCR 出來的文字一定要老師確認過才存檔」。
 *    那條規則要防的是「拿錯的文本去打分數」—— 傷害發生在**批改**，不在存檔。
 *    背景辨識之後文字會先進 submission，所以關卡搬到了批改之前：
 *    批改清單標「AI 辨識未校對」、批改頁並列原稿、批次批改會先攔下未校對的。
 *    不要因為這裡不再擋，就以為沒有人擋。
 *
 * 「改用打字」這條逃生口留著：辨識一直失敗、或字跡根本認不出來時，
 * 老師還是可以直接打。
 */
export const ProxySubmitModal: React.FC<ProxySubmitModalProps> = ({
  assignment,
  rosterSubmissions,
  onClose,
  onProxySubmit,
  onBatchChanged,
  initialTab = 'register',
}) => {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [activeStudentId, setActiveStudentId] = useState<string | null>(null);

  // ── 伺服器上的辨識狀態 ────────────────────────────────────────
  const [server, setServer] = useState<ProxyStatus | null>(null);
  /**
   * 「現在幾點」—— 用**伺服器的時鐘**。逾時判斷不能信老師電腦的時間，
   * 差個幾分鐘就會把還在跑的判成失敗。每次拿到狀態時記下兩邊的差。
   */
  const clockOffsetRef = useRef(0);
  const [clockMs, setClockMs] = useState(() => Date.now());
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── 這台裝置上的上傳佇列 ──────────────────────────────────────
  /*
    佇列的真相放在 ref（非同步的上傳結束時要讀到最新的），state 只是給畫面用的鏡像。
    不用 effect 驅動上傳：effect 裡同步 setState 會多一輪 render，
    而且 StrictMode 下 effect 會跑兩次，同一位學生可能被傳兩遍。
  */
  const queueRef = useRef<UploadJob[]>([]);
  const [queue, setQueue] = useState<UploadJob[]>([]);
  const blobsRef = useRef<PendingBlobs>(new Map());
  const commitQueue = (next: UploadJob[]) => {
    queueRef.current = next;
    setQueue(next);
  };

  // ── 其他 ──────────────────────────────────────────────────────
  const [scannerOpen, setScannerOpen] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState('');
  /** 要覆蓋已經有照片的那一位之前，先問一聲 */
  const [confirmReplace, setConfirmReplace] = useState<{ studentId: string; blobs: Blob[] } | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  const rowsByStudent = useMemo(() => {
    const m = new Map<string, ProxyStatusRow>();
    for (const r of server?.rows ?? []) m.set(r.userId, r);
    return m;
  }, [server]);

  /**
   * 名單：還沒交的人，**加上**已經進了這條流程的人。
   *
   * 辨識完成之後 submission 就有了、狀態變成「待批改」—— 只列未繳交的話，
   * 他們會在老師眼前突然消失，看不出是成功還是出事了。
   */
  const students = useMemo(
    () =>
      rosterSubmissions.filter(
        (s) =>
          s.status === 'Unsubmitted' ||
          s.status === 'Draft' ||
          rowsByStudent.has(s.studentId),
      ),
    [rosterSubmissions, rowsByStudent],
  );

  const statusOf = useCallback(
    (studentId: string): ProxyOcrStatus =>
      proxyOcrStatusOf(rowsByStudent.get(studentId), {
        nowMs: clockMs,
        upload: uploadStateOf(queue, studentId),
      }),
    [rowsByStudent, clockMs, queue],
  );

  const entries = useMemo(
    () => students.map((s) => ({ studentId: s.studentId, status: statusOf(s.studentId) })),
    [students, statusOf],
  );
  const counts = useMemo(() => countStatuses(entries.map((e) => e.status)), [entries]);
  const summary = proxyBatchSummary(counts);
  const toStart = startTargets(entries);
  const toRetry = retryTargets(entries);
  const uploadingCount = counts.uploading;

  const active = students.find((s) => s.studentId === activeStudentId);
  const activeStatus = active ? statusOf(active.studentId) : 'idle';
  const activeRow = active ? rowsByStudent.get(active.studentId) : undefined;

  // ── 狀態載入與輪詢 ────────────────────────────────────────────
  /*
    ⚠️ 外面傳進來的 onBatchChanged 多半是行內箭頭函式，每次 render 都是新的。
       直接放進 refresh 的相依陣列的話：refresh 每次 render 都變 →
       載入的 effect 每次 render 都重跑 → 無窮迴圈地打 API。放進 ref。
  */
  const onBatchChangedRef = useRef(onBatchChanged);
  useEffect(() => {
    onBatchChangedRef.current = onBatchChanged;
  });
  const lastDoneRef = useRef<number | null>(null);

  /** 把一次伺服器回應套進畫面 */
  const applyStatus = useCallback((next: ProxyStatus) => {
    clockOffsetRef.current = next.nowMs - Date.now();
    setServer(next);
    setClockMs(next.nowMs);
    setLoadError(null);

    // 有人剛辨識完成 → 請外面重載繳交清單（作文要在那裡才看得到）
    const done = next.rows.filter((r) => r.ocrTime && r.hasContent).length;
    if (lastDoneRef.current !== null && done > lastDoneRef.current) onBatchChangedRef.current?.();
    lastDoneRef.current = done;
  }, []);

  const refresh = useCallback(async () => {
    try {
      applyStatus(await fetchProxyStatus(assignment.id));
    } catch (e) {
      setLoadError(`讀不到辨識進度：${messageOf(e)}`);
    }
  }, [assignment.id, applyStatus]);

  // 第一次載入。setState 要在 then 裡（非同步回呼），不能在 effect 本體同步呼叫
  useEffect(() => {
    let cancelled = false;
    fetchProxyStatus(assignment.id)
      .then((next) => { if (!cancelled) applyStatus(next); })
      .catch((e) => { if (!cancelled) setLoadError(`讀不到辨識進度：${messageOf(e)}`); });
    return () => { cancelled = true; };
  }, [assignment.id, applyStatus]);

  /*
    時鐘每 15 秒走一格：「辨識中」要能自己變成「逾時失敗」，
    就算這段時間沒有任何新的伺服器回應。
  */
  useEffect(() => {
    const t = window.setInterval(() => setClockMs(Date.now() + clockOffsetRef.current), 15000);
    return () => window.clearInterval(t);
  }, []);

  const keepPolling = shouldKeepPolling(entries.map((e) => e.status));
  useEffect(() => {
    if (!keepPolling) return;
    let attempt = 0;
    let timer: number | undefined;
    let cancelled = false;
    const tick = async () => {
      // 分頁在背景時不問 —— 老師切去別的分頁做事，這裡沒必要一直打 API
      if (document.visibilityState !== 'hidden') await refresh();
      if (cancelled) return;
      timer = window.setTimeout(tick, pollDelayMs(++attempt));
    };
    timer = window.setTimeout(tick, pollDelayMs(0));
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [keepPolling, refresh]);

  // ── 上傳 ──────────────────────────────────────────────────────
  const pump = useCallback(() => {
    for (;;) {
      const job = nextPending(queueRef.current);
      if (!job) return;
      commitQueue(markUploading(queueRef.current, job.id));
      void (async () => {
        try {
          const blobs = blobsRef.current.get(job.id) ?? [];
          // 一張一張壓，不要 Promise.all —— 八張 4000px 同時解碼，手機記憶體撐不住
          const images = [];
          for (const b of blobs) images.push(await prepareProxyImage(b));
          await uploadProxyImages(assignment.id, job.studentId, images);
          blobsRef.current.delete(job.id);
          commitQueue(markDone(queueRef.current, job.id));
          void refresh();
        } catch (e) {
          commitQueue(markFailed(queueRef.current, job.id, messageOf(e)));
        }
        pump();
      })();
    }
  }, [assignment.id, refresh]);

  /** 下一位還沒登錄的（依名單順序，從目前這位往下找） */
  const nextIdleAfter = (studentId: string): string | null => {
    const start = students.findIndex((s) => s.studentId === studentId);
    const ordered = [...students.slice(start + 1), ...students.slice(0, Math.max(0, start))];
    return ordered.find((s) => statusOf(s.studentId) === 'idle')?.studentId ?? null;
  };

  const addPhotos = (studentId: string, blobs: Blob[]) => {
    const id = `${studentId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    blobsRef.current.set(id, blobs);
    commitQueue(enqueue(queueRef.current, { id, studentId, pageCount: blobs.length }));
    pump();
    setIssues([]);
    // 省一次點擊：老師手上已經拿著下一張紙了
    setActiveStudentId(nextIdleAfter(studentId));
    setTyping(false);
    setTyped('');
  };

  /** 已經有照片（待辨識／辨識中／已完成）的，換掉之前先問 */
  const receivePhotos = (blobs: Blob[]) => {
    if (!active || !blobs.length) return;
    const st = statusOf(active.studentId);
    if (st === 'queued' || st === 'running' || st === 'done' || st === 'failed') {
      setConfirmReplace({ studentId: active.studentId, blobs });
      return;
    }
    addPhotos(active.studentId, blobs);
  };

  const handleScannedPages = (pages: ScannedPage[]) => {
    // 留檔要全解析度的那一份；壓縮在上傳前做（lib/proxy/image.ts）
    receivePhotos(pages.map((p) => p.fullBlob));
  };

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const problems: string[] = [];
    const usable = Array.from(files).filter((f) => {
      const problem = checkImageFile(f);
      if (problem) problems.push(`${f.name}：${problem}`);
      return !problem;
    });
    setIssues(problems);
    receivePhotos(usable);
  };

  const retryUpload = (studentId: string) => {
    const failed = queueRef.current.filter((j) => j.studentId === studentId && j.state === 'failed');
    let q = queueRef.current;
    for (const j of failed) q = requeue(q, j.id);
    commitQueue(q);
    pump();
  };

  // ── 開始辨識／重試 ────────────────────────────────────────────
  const start = async (studentIds?: string[], force = false) => {
    setStarting(true);
    setNotice(null);
    try {
      const r = await startProxyOcr(assignment.id, studentIds, force);
      const parts: string[] = [];
      if (r.started.length) {
        parts.push(`已送出 ${r.started.length} 位，辨識在背景進行 —— 可以關掉這個視窗，完成後批改清單會更新。`);
      }
      if (r.failed.length) parts.push(`${r.failed.length} 位送不出去，請稍後重試。`);
      if (!parts.length) parts.push('沒有需要辨識的學生。');
      setNotice(parts.join(''));
      if (r.started.length) setTab('progress');
    } catch (e) {
      setNotice(`送出辨識失敗：${messageOf(e)}`);
    } finally {
      setStarting(false);
      void refresh();
    }
  };

  // ── 改用打字 ──────────────────────────────────────────────────
  const saveTyped = () => {
    if (!active || !typed.trim()) return;
    /*
      ⚠️ 這一位若有辨識批次（多半是辨識失敗才改打字的），存檔時一起退役。
         不退役的話它還算「失敗」—— 之後按「全部重試失敗的」會再辨識一次，
         背景 job 寫回來的文字會**蓋掉老師剛打好的作文**。
    */
    const hasBatch = rowsByStudent.has(active.studentId);
    onProxySubmit(active.studentId, active.studentName, typed.trim(), [],
      hasBatch ? { confirmOcr: true } : undefined);
    setTyped('');
    setTyping(false);
    setActiveStudentId(nextIdleAfter(active.studentId));
  };

  const openTyping = (studentId: string) => {
    setActiveStudentId(studentId);
    setTab('register');
    setTyping(true);
    setTyped('');
  };

  // ── 關閉 ──────────────────────────────────────────────────────
  const unsent = hasUnsentPhotos(queue);
  /*
    照片還在記憶體裡的時候關分頁／重新整理，那幾位就白拍了。
    已經上傳的不必擋 —— 它們在伺服器上，關掉也不會不見。
  */
  useEffect(() => {
    if (!unsent) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [unsent]);

  const requestClose = () => {
    if (unsent) setConfirmClose(true);
    else onClose();
  };

  // ── 畫面 ──────────────────────────────────────────────────────
  const chip = (status: ProxyOcrStatus) => {
    if (status === 'idle') return null;
    const style = PROXY_OCR_STYLE[status];
    return (
      <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-caption ${style.badge}`}>
        {(status === 'uploading' || status === 'running') && (
          <Loader2 size={11} className="animate-spin shrink-0" />
        )}
        {style.label}
      </span>
    );
  };

  const thumbnails = (row: ProxyStatusRow | undefined) =>
    row && row.imgFiles.length > 0 ? (
      <div className="flex flex-wrap gap-2">
        {row.imgFiles.map((f) => (
          <a
            key={f}
            href={imageUrlOf(proxyImagePath(assignment.id, f))}
            target="_blank"
            rel="noreferrer"
            className="block w-16 h-20 rounded-lg overflow-hidden border border-border bg-card"
            title="開新分頁看原稿"
          >
            <img
              src={imageUrlOf(proxyImagePath(assignment.id, f))}
              alt="原稿"
              className="w-full h-full object-cover"
              loading="lazy"
            />
          </a>
        ))}
      </div>
    ) : null;

  const hasPhotos = activeStatus !== 'idle' && activeStatus !== 'upload_failed';
  const failedJob = active
    ? queue.find((j) => j.studentId === active.studentId && j.state === 'failed')
    : undefined;

  return createPortal(
    /*
      掛到 document.body，並且 z-[1100]：手機的底部導覽是 z-[1001]，
      以前這個視窗是 z-[60] 而且沒有 portal —— 頁尾的按鈕在手機上會被導覽列蓋住。
    */
    <div className="fixed inset-0 z-[1100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink-900/45 backdrop-blur-sm" onClick={requestClose} />
      <div className="relative w-full max-w-4xl bg-surface rounded-2xl shadow-2xl border border-border flex flex-col max-h-[88vh] overflow-hidden">
        {/* 標頭 */}
        <div className="p-5 border-b border-border flex items-start justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <h3 className="text-title font-bold text-text-primary flex items-center gap-2">
              <Camera size={18} className="shrink-0 text-secondary" />
              批次代繳交
            </h3>
            <p className="text-caption text-text-secondary mt-1">
              {assignment.title}
              {summary && (
                <>
                  <span className="mx-2 text-text-muted">·</span>
                  {summary}
                </>
              )}
            </p>
          </div>
          <button
            id="proxysubmit-btn-close"
            onClick={requestClose}
            className="tap-target shrink-0 p-2 rounded-full text-text-secondary hover:bg-surface-soft transition-colors"
            title="關閉"
          >
            <X size={18} />
          </button>
        </div>

        {/* 分頁 */}
        <div className="px-5 pt-3 shrink-0">
          <div className="inline-flex p-1 rounded-xl bg-surface-soft border border-border" role="tablist">
            {([
              ['register', '登錄照片', Camera],
              ['progress', '辨識進度', ListChecks],
            ] as const).map(([key, label, Icon]) => (
              <button
                key={key}
                id={`proxysubmit-tab-${key}`}
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-body transition-colors ${
                  tab === key
                    ? 'bg-card text-text-primary shadow-sm'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                <Icon size={14} className="shrink-0" />
                {label}
                {key === 'progress' && counts.failed + counts.upload_failed > 0 && (
                  <span className="ml-1 px-1.5 rounded-full text-caption bg-danger-100 text-danger-700">
                    {counts.failed + counts.upload_failed}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {(notice || loadError) && (
          <div className="px-5 pt-3 shrink-0 space-y-2">
            {notice && (
              <p className="text-caption text-info-700 bg-info-100 border border-info-200 rounded-xl px-4 py-2">
                {notice}
              </p>
            )}
            {loadError && (
              <p className="text-caption text-danger-700 bg-danger-100 border border-danger-200 rounded-xl px-4 py-2">
                {loadError}
              </p>
            )}
          </div>
        )}

        {tab === 'register' ? (
          <div className="flex-1 overflow-hidden flex flex-col md:flex-row min-h-0 mt-3 border-t border-border">
            {/* 左：名單 */}
            <div className="md:w-72 shrink-0 border-b md:border-b-0 md:border-r border-border overflow-y-auto max-h-44 md:max-h-none">
              {students.length === 0 ? (
                <p className="p-5 text-caption text-text-secondary text-center">全班都交齊了</p>
              ) : (
                <ul className="p-2 space-y-1">
                  {students.map((s) => {
                    const isActive = s.studentId === activeStudentId;
                    return (
                      <li key={s.studentId}>
                        <button
                          id={`proxysubmit-btn-student-${s.studentId}`}
                          onClick={() => {
                            setActiveStudentId(s.studentId);
                            setTyping(false);
                            setTyped('');
                            setIssues([]);
                          }}
                          className={`w-full text-left px-3 py-2 rounded-lg text-body transition-colors flex items-center gap-2 ${
                            isActive
                              ? 'bg-secondary/10 text-secondary border border-secondary/30'
                              : 'text-text-primary hover:bg-surface-soft border border-transparent'
                          }`}
                        >
                          <span className="text-caption text-text-muted font-mono shrink-0">
                            {seatText(s.seatNo)}
                          </span>
                          <span className="truncate flex-1">{s.studentName}</span>
                          {chip(statusOf(s.studentId))}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* 右：這一位 */}
            <div className="flex-1 overflow-y-auto p-5 min-w-0">
              {!active ? (
                <div className="h-full flex flex-col items-center justify-center text-center py-12 gap-2">
                  <UserCheck size={28} className="text-text-muted" />
                  <p className="text-body text-text-secondary">
                    從左邊挑一位學生，拍下他的紙本作文
                  </p>
                  <p className="text-caption text-text-muted max-w-sm">
                    拍完會自動上傳並跳到下一位，不必等辨識。全部收完再按下方的「開始辨識」。
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-caption text-text-muted font-mono">{seatText(active.seatNo)}</span>
                    <span className="text-title font-bold text-text-primary">{active.studentName}</span>
                    {chip(activeStatus)}
                  </div>

                  {hasPhotos && activeRow && (
                    <div className="space-y-2">
                      <p className="text-caption text-text-secondary">
                        已收 {activeRow.imgFiles.length} 張原稿
                        {activeStatus === 'queued' && '，等全部收完再一起辨識'}
                      </p>
                      {thumbnails(activeRow)}
                    </div>
                  )}

                  {failedJob && (
                    <div className="flex items-center gap-3 bg-danger-100 border border-danger-200 rounded-xl px-4 py-3">
                      <AlertTriangle size={16} className="text-danger-600 shrink-0" />
                      <p className="flex-1 text-caption text-danger-700">
                        {failedJob.pageCount} 張照片沒傳上去（{failedJob.error}）。照片還在，可以直接重傳。
                      </p>
                      <button
                        id="proxysubmit-btn-retry-upload"
                        onClick={() => retryUpload(active.studentId)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card border border-border text-body text-text-primary hover:bg-surface-soft whitespace-nowrap"
                      >
                        <RefreshCw size={14} className="shrink-0" />
                        重傳
                      </button>
                    </div>
                  )}

                  {/* 上傳。相機與選檔分開兩顆，手機上 capture 才會直接開相機 */}
                  <div className="flex flex-wrap gap-2">
                    <button
                      id="proxysubmit-btn-scan"
                      type="button"
                      onClick={() => setScannerOpen(true)}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-secondary text-on-accent text-body hover:opacity-90 transition-opacity whitespace-nowrap"
                    >
                      <ScanLine size={16} className="shrink-0" />
                      {hasPhotos ? '重新掃描' : '掃描稿紙'}
                    </button>
                    <label
                      id="proxysubmit-btn-camera"
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-card border border-border-strong text-text-primary text-body cursor-pointer hover:bg-surface-soft transition-colors whitespace-nowrap"
                    >
                      <Camera size={16} className="shrink-0" />
                      直接拍照
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        capture="environment"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          handleFiles(e.target.files);
                          e.target.value = '';
                        }}
                      />
                    </label>
                    <label
                      id="proxysubmit-btn-upload"
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-card border border-border text-text-primary text-body cursor-pointer hover:bg-surface-soft transition-colors whitespace-nowrap"
                    >
                      <Upload size={16} className="shrink-0" />
                      選擇照片
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          handleFiles(e.target.files);
                          e.target.value = '';
                        }}
                      />
                    </label>
                    {/*
                      辨識中不給打字：背景的 job 跑完會把文字寫回 submission，
                      老師這時候打的字會被蓋掉。等結果出來（完成或失敗）再改。
                    */}
                    <button
                      id="proxysubmit-btn-typing"
                      type="button"
                      onClick={() => setTyping((v) => !v)}
                      disabled={activeStatus === 'running'}
                      title={activeStatus === 'running' ? '這一位正在辨識，等結果出來再改' : undefined}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-body text-text-secondary hover:bg-surface-soft transition-colors whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Keyboard size={16} className="shrink-0" />
                      改用打字
                    </button>
                  </div>

                  <p className="text-caption text-text-muted">
                    同一位有好幾張稿紙時，請在掃描視窗裡一次拍完 —— 重新拍攝會取代這一位原本的照片。
                  </p>

                  {issues.length > 0 && (
                    <ul className="space-y-1 bg-warning-100 border border-warning-200 rounded-xl px-4 py-3">
                      {issues.map((msg, i) => (
                        <li key={i} className="text-caption text-warning-700">{msg}</li>
                      ))}
                    </ul>
                  )}

                  {typing && (
                    <div className="space-y-2 pt-2 border-t border-border">
                      <label
                        htmlFor="proxysubmit-textarea-content"
                        className="text-caption text-text-secondary mb-1 flex items-center gap-1.5"
                      >
                        <FileText size={12} className="shrink-0" />
                        直接打字登錄（不經過辨識，存檔後就是這一位的作文）
                      </label>
                      <textarea
                        id="proxysubmit-textarea-content"
                        value={typed}
                        onChange={(e) => setTyped(e.target.value)}
                        rows={10}
                        placeholder="照著紙本打進來。"
                        className="w-full px-4 py-3 rounded-xl bg-card border border-border text-essay font-essay text-text-primary outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-colors resize-y"
                      />
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-caption text-text-muted">{typed.trim().length} 字</span>
                        <button
                          id="proxysubmit-btn-save"
                          onClick={saveTyped}
                          disabled={!typed.trim()}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-secondary text-on-accent text-body shadow-sm hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Check size={16} className="shrink-0" />
                          存檔並換下一位
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-5 min-h-0">
            {entries.every((e) => e.status === 'idle') ? (
              <div className="py-12 text-center text-body text-text-secondary">
                還沒有收任何照片。到「登錄照片」分頁開始拍。
              </div>
            ) : (
              <div className="space-y-3">
                {toRetry.length > 1 && (
                  <button
                    id="proxysubmit-btn-retry-all"
                    onClick={() => start(toRetry)}
                    disabled={starting}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-card border border-border-strong text-body text-text-primary hover:bg-surface-soft disabled:opacity-50"
                  >
                    <RefreshCw size={14} className="shrink-0" />
                    全部重試失敗的 {toRetry.length} 位
                  </button>
                )}
                <ul className="divide-y divide-border border border-border rounded-xl bg-card">
                  {students
                    .filter((s) => statusOf(s.studentId) !== 'idle')
                    .map((s) => {
                      const st = statusOf(s.studentId);
                      const row = rowsByStudent.get(s.studentId);
                      return (
                        <li
                          key={s.studentId}
                          id={`proxysubmit-row-${s.studentId}`}
                          className="flex items-center gap-3 px-4 py-3"
                        >
                          <span className="text-caption text-text-muted font-mono shrink-0 w-10">
                            {seatText(s.seatNo)}
                          </span>
                          <span className="flex-1 min-w-0 truncate text-body text-text-primary">
                            {s.studentName}
                          </span>
                          {row && (
                            <span className="hidden sm:inline text-caption text-text-muted shrink-0">
                              {row.imgFiles.length} 張
                            </span>
                          )}
                          {chip(st)}
                          {st === 'failed' && (
                            <>
                              <button
                                id={`proxysubmit-btn-retry-${s.studentId}`}
                                onClick={() => start([s.studentId], true)}
                                disabled={starting}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-card border border-border text-caption text-text-primary hover:bg-surface-soft disabled:opacity-50 whitespace-nowrap"
                              >
                                <RefreshCw size={12} className="shrink-0" />
                                重試
                              </button>
                              <button
                                onClick={() => openTyping(s.studentId)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-caption text-text-secondary hover:bg-surface-soft whitespace-nowrap"
                              >
                                <Keyboard size={12} className="shrink-0" />
                                改用打字
                              </button>
                            </>
                          )}
                          {st === 'upload_failed' && (
                            <button
                              onClick={() => retryUpload(s.studentId)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-card border border-border text-caption text-text-primary hover:bg-surface-soft whitespace-nowrap"
                            >
                              <RefreshCw size={12} className="shrink-0" />
                              重傳
                            </button>
                          )}
                        </li>
                      );
                    })}
                </ul>
                <p className="text-caption text-text-muted">
                  辨識完成的作文會出現在批改清單，標著「AI 辨識未校對」——
                  手寫辨識一定會有錯字，批改前請先對照原稿校對。
                </p>
              </div>
            )}
          </div>
        )}

        {/* 頁尾 */}
        <div className="p-4 border-t border-border flex flex-wrap items-center justify-end gap-2 shrink-0">
          {uploadingCount > 0 && (
            <span className="mr-auto inline-flex items-center gap-1.5 text-caption text-info-700">
              <Loader2 size={13} className="animate-spin shrink-0" />
              還有 {uploadingCount} 位在上傳
            </span>
          )}
          <button
            id="proxysubmit-btn-cancel"
            onClick={requestClose}
            className="px-4 py-2 rounded-xl text-body text-text-secondary hover:bg-surface-soft transition-colors"
          >
            關閉
          </button>
          <button
            id="proxysubmit-btn-start"
            onClick={() => start()}
            disabled={toStart.length === 0 || starting || uploadingCount > 0}
            title={uploadingCount > 0 ? '等照片都傳完再開始' : undefined}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-secondary text-on-accent text-body shadow-sm hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {starting ? <Loader2 size={16} className="animate-spin shrink-0" /> : <Play size={16} className="shrink-0" />}
            開始辨識{toStart.length > 0 ? ` ${toStart.length} 位` : ''}
          </button>
        </div>
      </div>

      {scannerOpen && (
        <DocumentScannerModal
          subtitle={active ? `${seatText(active.seatNo)} ${active.studentName}` : undefined}
          onClose={() => setScannerOpen(false)}
          onPages={handleScannedPages}
        />
      )}

      {confirmReplace && (
        <ConfirmDialog
          title="取代這一位的照片？"
          message={'這一位已經有照片了。\n用新拍的取代之後，原本的照片不會再拿去辨識。'}
          confirmLabel="用新照片取代"
          onConfirm={() => {
            addPhotos(confirmReplace.studentId, confirmReplace.blobs);
            setConfirmReplace(null);
          }}
          onCancel={() => setConfirmReplace(null)}
        />
      )}

      {confirmClose && (
        <ConfirmDialog
          title="還有照片沒傳完"
          message={'有幾位的照片還在這台裝置上、還沒傳到伺服器。\n現在關掉的話，那幾位要重拍。'}
          confirmLabel="仍然關閉"
          danger
          onConfirm={onClose}
          onCancel={() => setConfirmClose(false)}
        />
      )}
    </div>,
    document.body,
  );
};
