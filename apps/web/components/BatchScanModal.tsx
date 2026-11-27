import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Check, FileText, Loader2, ScanLine, Send, Upload, X } from 'lucide-react';
import { scanSeats } from '../api/batchScan';
import { seatText } from '../lib/gradingQueue';
import { blobToBase64, blobToCanvas, canvasToBlob } from '../lib/scan/image';
import { PROXY_UPLOAD_LONG_SIDE, PROXY_UPLOAD_QUALITY } from '../lib/proxy/image';
import { PdfPagesError, isPdfFile, renderPdfToJpegs } from '../lib/pdfPages';
import {
  BATCH_SCAN_MAX_PAGES,
  ISSUE_TEXT,
  SEAT_SCAN_CHUNK,
  buildGroups,
  canAssign,
  canAutoMatch,
  choicesFor,
  chunk,
  duplicateRosterSeats,
  matchGroups,
  planBatch,
  seatReadText,
  studentsWithoutSeat,
  type BatchScanResult,
  type Picks,
  type RosterStudent,
  type ScanGroup,
  type ScanPage,
} from '../lib/batchScan';

/** 整疊掃描送出的一份：這位學生的每一頁（照掃描順序） */
export interface BatchScanSend {
  studentId: string;
  blobs: Blob[];
}

interface BatchScanModalProps {
  assignmentId: string;
  assignmentTitle: string;
  /** 這個班的名單（含座號）：塗的座號對到誰 */
  roster: RosterStudent[];
  /** 還可以代繳交的學生（沒交、只有草稿，而且還沒有登錄照片） */
  candidates: RosterStudent[];
  /** 老師核對完按下送出。之後的上傳、辨識由批次代繳交視窗接手 */
  onSend: (sends: BatchScanSend[]) => void;
  onClose: () => void;
}

type Step = 'pick' | 'working' | 'check';
interface Progress {
  label: string;
  done: number;
  total: number;
}

/** PDF 一份最大多少：只在瀏覽器裡展開、不上傳，所以放得很寬（彩色雙面一班約 100MB） */
const MAX_PDF_BYTES = 200 * 1024 * 1024;
/** 同時送幾批去讀座號：辨識服務一次處理 4 個請求，留一半給同時在用的其他老師 */
const SCAN_CONCURRENCY = 2;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const messageOf = (e: unknown) => (e instanceof Error && e.message ? e.message : '網路或伺服器錯誤');

/** 一份「還不能送」的時候，告訴老師為什麼 */
function reasonOf(group: ScanGroup, nameOf: (id: string) => string): string {
  if (group.issue) return ISSUE_TEXT[group.issue];
  if (group.takenStudentId) return `${seatReadText(group)}，但${nameOf(group.takenStudentId)}已經有作文或照片了`;
  return seatReadText(group);
}

/**
 * 整疊掃描：全班的稿紙用掃描機掃成一份 PDF，系統照學生塗的座號分好人，老師核對後一次送出。
 *
 * 三步：選檔 → 展開並讀座號（顯示進度）→ 核對。
 *
 * ⚠️ 核對那一步不能省，也不能做成「全部自動送出」：座號是學生自己塗的，塗錯、撞號、漏塗都會發生；
 *    送出去之後每一份都會變成某位學生的作文，分錯了要一份一份清掉重來。
 *    所以沒把握的（lib/batchScan.ts 的每一種 issue）一律停在這裡等老師點，**全部決定完才能送**。
 */
export const BatchScanModal: React.FC<BatchScanModalProps> = ({
  assignmentId,
  assignmentTitle,
  roster,
  candidates,
  onSend,
  onClose,
}) => {
  const [step, setStep] = useState<Step>('pick');
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [blobs, setBlobs] = useState<Blob[]>([]);
  const [result, setResult] = useState<BatchScanResult | null>(null);
  const [picks, setPicks] = useState<Picks>({});
  const fileRef = useRef<HTMLInputElement>(null);
  /** 每開始一次就換一個號碼：老師按了取消或關掉之後，還在路上的結果回來時不要再動畫面 */
  const runRef = useRef(0);

  const autoMatch = canAutoMatch(roster);
  const noSeat = studentsWithoutSeat(roster);
  const dupSeats = duplicateRosterSeats(roster);
  const nameOf = (id: string) => roster.find((s) => s.studentId === id)?.name ?? '這位學生';

  // 縮圖用的 object URL：換一批或關掉時要收回，不然整疊的像素都留在記憶體裡
  const urls = useMemo(() => blobs.map((b) => URL.createObjectURL(b)), [blobs]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
  useEffect(() => () => { runRef.current += 1; }, []);

  const groups = useMemo(
    () => (result ? matchGroups(result.groups, roster, candidates.map((c) => c.studentId)) : []),
    [result, roster, candidates],
  );
  const plan = useMemo(() => planBatch(groups, candidates, picks), [groups, candidates, picks]);
  // 分區看的是「一開始有沒有自動配好」，不是現在的狀態 —— 不然老師每點一份，那一列就跳到另一區去
  const needLook = groups.filter((g) => !g.autoStudentId);
  const autoDone = groups.filter((g) => g.autoStudentId);

  const cancelRun = () => {
    runRef.current += 1;
    setStep('pick');
    setProgress(null);
  };

  /** 圖片檔：照 EXIF 轉正、縮到和代繳交一樣的長邊（掃描機的 JPEG 常常一張十幾 MB） */
  const normalizeImage = async (file: File): Promise<Blob> => {
    const canvas = await blobToCanvas(file, PROXY_UPLOAD_LONG_SIDE);
    const jpeg = await canvasToBlob(canvas, 'image/jpeg', PROXY_UPLOAD_QUALITY);
    canvas.width = 0;
    canvas.height = 0;
    return jpeg;
  };

  const run = async (files: File[]) => {
    const token = (runRef.current += 1);
    const alive = () => runRef.current === token;
    setError(null);
    setPicks({});
    setResult(null);
    setFileName(files.length === 1 ? files[0].name : `${files.length} 個圖片檔`);
    setStep('working');
    try {
      // ---- 1. 展開成一頁一張圖 ----
      let pages: Blob[] = [];
      if (files.length === 1 && isPdfFile(files[0])) {
        if (files[0].size > MAX_PDF_BYTES) {
          throw new PdfPagesError(`這份 PDF 有 ${Math.round(files[0].size / 1024 / 1024)}MB，太大了。請分成兩份掃描，或把掃描解析度調到 200dpi。`);
        }
        setProgress({ label: '正在打開 PDF', done: 0, total: 0 });
        pages = await renderPdfToJpegs(files[0], {
          maxDimension: PROXY_UPLOAD_LONG_SIDE,
          quality: PROXY_UPLOAD_QUALITY,
          maxPages: BATCH_SCAN_MAX_PAGES,
          onProgress: (done, total) => { if (alive()) setProgress({ label: '正在展開每一頁', done, total }); },
          shouldStop: () => !alive(),
        });
      } else {
        if (files.some((f) => !IMAGE_TYPES.includes(f.type))) {
          throw new PdfPagesError('請選一份掃描機掃出來的 PDF，或一次選好全部的圖片檔（JPG、PNG）。PDF 和圖片不能混著選。');
        }
        if (files.length > BATCH_SCAN_MAX_PAGES) {
          throw new PdfPagesError(`一次最多 ${BATCH_SCAN_MAX_PAGES} 張，這次選了 ${files.length} 張。`);
        }
        // 掃描機的檔名是流水號：照檔名排，才是掃描的順序（選檔視窗回來的順序不一定）
        const ordered = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        for (let i = 0; i < ordered.length; i += 1) {
          if (!alive()) return;
          pages.push(await normalizeImage(ordered[i]));
          setProgress({ label: '正在處理每一張圖', done: i + 1, total: ordered.length });
        }
      }
      if (!alive()) return;

      // ---- 2. 分批讀座號 ----
      const batches = chunk(pages.map((blob, index) => ({ blob, index })), SEAT_SCAN_CHUNK);
      const scanned: ScanPage[] = [];
      let done = 0;
      setProgress({ label: '正在讀每一頁的座號', done: 0, total: pages.length });
      let next = 0;
      const worker = async () => {
        while (next < batches.length && alive()) {
          const batch = batches[next];
          next += 1;
          const images = [];
          for (const { blob } of batch) images.push({ base64Image: await blobToBase64(blob), mimeType: 'image/jpeg' });
          scanned.push(...(await scanSeats(assignmentId, images, batch[0].index)));
          done += batch.length;
          if (alive()) setProgress({ label: '正在讀每一頁的座號', done, total: pages.length });
        }
      };
      await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, batches.length) }, worker));
      if (!alive()) return;

      setBlobs(pages);
      setResult(buildGroups(scanned));
      setStep('check');
    } catch (e) {
      if (!alive()) return;
      setError(messageOf(e));
      setStep('pick');
    } finally {
      if (alive()) setProgress(null);
    }
  };

  const handleFiles = (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (files.length) void run(files);
  };

  const pick = (group: ScanGroup, value: string) => {
    setPicks((prev) => ({
      ...prev,
      [group.id]: value === '' ? undefined : value === 'drop' ? { drop: true } : { studentId: value },
    }));
  };

  const send = () => {
    if (!plan.sends.length || plan.unresolved.length) return;
    onSend(plan.sends.map(({ group, studentId }) => ({ studentId, blobs: group.pages.map((i) => blobs[i]) })));
  };

  const valueOf = (group: ScanGroup): string => {
    const p = picks[group.id];
    if (p && 'drop' in p) return 'drop';
    if (!canAssign(group)) return '';
    if (p && 'studentId' in p) return p.studentId;
    return group.autoStudentId ?? '';
  };

  const row = (group: ScanGroup) => {
    const value = valueOf(group);
    const choices = choicesFor(group, candidates, plan, picks);
    const undecided = plan.unresolved.includes(group);
    return (
      <li
        key={group.id}
        id={`batchscan-row-${group.id}`}
        className={`flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3 ${undecided ? 'bg-warning-50' : ''}`}
      >
        <div className="flex items-center gap-2 shrink-0">
          {group.pages.map((i) => (
            <a
              key={i}
              href={urls[i]}
              target="_blank"
              rel="noreferrer"
              title={`整疊的第 ${i + 1} 張，開新分頁看大圖`}
              className="block w-14 h-10 rounded border border-border bg-card overflow-hidden"
            >
              <img src={urls[i]} alt={`第 ${i + 1} 張`} className="w-full h-full object-cover" loading="lazy" />
            </a>
          ))}
        </div>
        <div className="flex-1 min-w-0 space-y-1.5">
          {/* 表頭截圖：學生自己寫的姓名、座號。老師認人靠的是這個，所以給它夠大的位置 */}
          {(group.seatPage?.crops?.length ?? 0) > 0 && (
            <div className="flex flex-wrap items-start gap-2">
              {group.seatPage!.crops!.map((src, i) => (
                <img
                  key={i}
                  src={src}
                  alt="稿紙表頭"
                  className="max-h-24 max-w-full rounded border border-border bg-card"
                />
              ))}
            </div>
          )}
          <p className={`text-caption ${undecided ? 'text-warning-700' : 'text-text-secondary'}`}>
            第 {group.pages.map((i) => i + 1).join('、')} 張 · {reasonOf(group, nameOf)}
          </p>
        </div>
        <label className="shrink-0 flex items-center gap-2">
          <span className="sr-only">這一份是誰的</span>
          <select
            id={`batchscan-select-${group.id}`}
            value={value}
            onChange={(e) => pick(group, e.target.value)}
            className="w-full sm:w-48 px-3 py-2 rounded-lg bg-card border border-border-strong text-body text-text-primary outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="">{canAssign(group) ? '請選擇是誰的' : '要重掃這一張'}</option>
            {canAssign(group) &&
              choices.map(({ student, suggested }) => (
                <option key={student.studentId} value={student.studentId}>
                  {seatText(student.seatNo)} {student.name}
                  {suggested ? '（塗的座號）' : ''}
                </option>
              ))}
            <option value="drop">這一份不送</option>
          </select>
        </label>
      </li>
    );
  };

  const notes: string[] = [];
  if (result) {
    if (result.blankPages) notes.push(`略過 ${result.blankPages} 張空白頁。`);
    if (result.otherPages.length) {
      notes.push(`第 ${result.otherPages.map((p) => p.index + 1).join('、')} 張認不出是哪一種稿紙（不是「我的稿紙」印的，或四角的黑色小方塊沒掃到），不會送出。`);
    }
    if (result.frontOnly && groups.length > 0) notes.push('整疊都只有第一頁。如果學生有寫到背面，請確認掃描機有開「雙面掃描」後重掃。');
    if (result.twoQuestions) notes.push('學測稿紙的第一、二大題混在一起了。一份作業只收一題，請把另一題的那幾份選「不送」。');
    if (result.templates.length > 1) notes.push('這一疊混了不同種類的稿紙，請確認是不是放錯了。');
  }

  return (
    <div className="fixed inset-0 z-[1110] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink-900/45 backdrop-blur-sm" />
      <div
        id="batchscan-modal"
        role="dialog"
        aria-label="整疊掃描"
        className="relative w-full max-w-4xl bg-surface rounded-2xl shadow-2xl border border-border flex flex-col max-h-[90vh] overflow-hidden"
      >
        <div className="p-5 border-b border-border flex items-start justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <h3 className="text-title font-bold text-text-primary flex items-center gap-2">
              <ScanLine size={18} className="shrink-0 text-secondary" />
              整疊掃描
            </h3>
            <p className="text-caption text-text-secondary mt-1 truncate">
              {assignmentTitle}
              {fileName && step !== 'pick' && (
                <>
                  <span className="mx-2 text-text-muted">·</span>
                  {fileName}
                </>
              )}
            </p>
          </div>
          <button
            id="batchscan-btn-close"
            onClick={onClose}
            className="tap-target shrink-0 p-2 rounded-full text-text-secondary hover:bg-surface-soft transition-colors"
            title="關閉"
          >
            <X size={18} />
          </button>
        </div>

        {step === 'pick' && (
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            <ol className="space-y-2 text-body text-text-primary list-decimal list-inside">
              <li>全班的稿紙疊好，用掃描機掃成<strong>一份 PDF</strong>（有寫背面要開雙面掃描，建議 200dpi）。</li>
              <li>系統照每張稿紙上塗的座號分給學生。</li>
              <li>你核對一次，再一次送出。</li>
            </ol>

            {!autoMatch && (
              <div className="flex items-start gap-3 bg-warning-100 border border-warning-200 rounded-xl px-4 py-3">
                <AlertTriangle size={16} className="text-warning-700 shrink-0 mt-0.5" />
                <p className="text-caption text-warning-700">
                  {roster.length === 0
                    ? '這個班還沒有學生名單。'
                    : noSeat.length > 0
                      ? `這個班有 ${noSeat.length} 位學生沒有座號（${noSeat.slice(0, 3).map((s) => s.name).join('、')}${noSeat.length > 3 ? '…' : ''}），`
                      : `這個班有重複的座號（${dupSeats.join('、')} 號），`}
                  {roster.length > 0 && '所以不會照座號自動認人：系統仍然會把整疊分成一人一份，再請你看表頭的姓名逐份指定。'}
                </p>
              </div>
            )}

            {error && (
              <div id="batchscan-error" className="flex items-start gap-3 bg-danger-100 border border-danger-200 rounded-xl px-4 py-3">
                <AlertTriangle size={16} className="text-danger-600 shrink-0 mt-0.5" />
                <p className="text-caption text-danger-700">{error}</p>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <button
                id="batchscan-btn-pick"
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={candidates.length === 0}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-secondary text-on-accent text-body shadow-sm hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Upload size={16} className="shrink-0" />
                選擇掃描檔
              </button>
              <span className="text-caption text-text-muted">
                {candidates.length === 0
                  ? '全班都已經有作文或照片了，沒有可以代繳交的學生。'
                  : 'PDF 一份，或一次選好全部的圖片檔。檔案只在這台電腦上展開，不會整份上傳。'}
              </span>
            </div>
            <p className="text-caption text-text-muted">
              稿紙要是「我的稿紙」印的（四角有黑色小方塊）。會考、學測、聯合報國中稿紙有座號劃記；聯合盃稿紙沒有，會請你逐份指定。
            </p>
          </div>
        )}

        {step === 'working' && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 p-10 text-center">
            <Loader2 size={28} className="animate-spin text-secondary" />
            <p id="batchscan-progress" className="text-body text-text-primary">
              {progress?.label ?? '準備中'}
              {progress && progress.total > 0 && `（${progress.done} / ${progress.total}）`}
            </p>
            <div className="w-full max-w-sm h-2 rounded-full bg-surface-soft border border-border overflow-hidden">
              <div
                className="h-full bg-secondary transition-all"
                style={{ width: `${progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0}%` }}
              />
            </div>
            <p className="text-caption text-text-muted">一班大約一兩分鐘。這段時間請不要關掉這個分頁。</p>
            <button
              id="batchscan-btn-cancel-run"
              onClick={cancelRun}
              className="px-4 py-2 rounded-xl text-body text-text-secondary hover:bg-surface-soft transition-colors"
            >
              取消
            </button>
          </div>
        )}

        {step === 'check' && result && (
          <>
            <div className="flex-1 overflow-y-auto p-5 space-y-4 min-h-0">
              <p id="batchscan-summary" className="text-body text-text-primary">
                共 {blobs.length} 張，分成 <strong>{groups.length}</strong> 份：
                自動配好 {autoDone.length} 份、要請你看 {needLook.length} 份。
              </p>
              {notes.length > 0 && (
                <ul className="space-y-1 bg-info-100 border border-info-200 rounded-xl px-4 py-3">
                  {notes.map((n) => (
                    <li key={n} className="text-caption text-info-700">{n}</li>
                  ))}
                </ul>
              )}
              {groups.length === 0 && (
                <p className="py-8 text-center text-body text-text-secondary">
                  這一疊裡沒有認得出來的稿紙。請確認是用「我的稿紙」印的，而且四角的黑色小方塊都有掃進去。
                </p>
              )}

              {needLook.length > 0 && (
                <section className="space-y-2">
                  <h4 className="text-body font-bold text-text-primary flex items-center gap-2">
                    <AlertTriangle size={15} className="shrink-0 text-warning-600" />
                    請你確認（{needLook.length} 份）
                  </h4>
                  <ul className="divide-y divide-border border border-border-card rounded-xl bg-card overflow-hidden">
                    {needLook.map(row)}
                  </ul>
                </section>
              )}

              {autoDone.length > 0 && (
                <section className="space-y-2">
                  <h4 className="text-body font-bold text-text-primary flex items-center gap-2">
                    <Check size={15} className="shrink-0 text-success-600" />
                    照座號配好的（{autoDone.length} 份）
                  </h4>
                  <p className="text-caption text-text-muted">座號是學生自己塗的。請掃一眼表頭的姓名，不對的直接改。</p>
                  <ul className="divide-y divide-border border border-border-card rounded-xl bg-card overflow-hidden">
                    {autoDone.map(row)}
                  </ul>
                </section>
              )}

              {groups.length > 0 && plan.absent.length > 0 && (
                <p id="batchscan-absent" className="text-caption text-text-secondary flex items-start gap-1.5">
                  <FileText size={13} className="shrink-0 mt-0.5" />
                  <span>
                    這一疊裡沒有這 {plan.absent.length} 位的作文：
                    {plan.absent.map((s) => `${seatText(s.seatNo)} ${s.name}`).join('、')}
                  </span>
                </p>
              )}
            </div>

            <div className="p-4 border-t border-border flex flex-wrap items-center justify-end gap-2 shrink-0">
              <button
                id="batchscan-btn-back"
                onClick={() => { setStep('pick'); setResult(null); setBlobs([]); }}
                className="mr-auto inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-body text-text-secondary hover:bg-surface-soft transition-colors"
              >
                <ArrowLeft size={15} className="shrink-0" />
                換一份檔案
              </button>
              {plan.unresolved.length > 0 && (
                <span className="text-caption text-warning-700">還有 {plan.unresolved.length} 份沒決定（指定一位，或選「不送」）</span>
              )}
              <button
                id="batchscan-btn-send"
                onClick={send}
                disabled={plan.sends.length === 0 || plan.unresolved.length > 0}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-secondary text-on-accent text-body shadow-sm hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send size={16} className="shrink-0" />
                送出 {plan.sends.length} 份
              </button>
            </div>
          </>
        )}

        <input
          ref={fileRef}
          id="batchscan-input-file"
          type="file"
          accept="application/pdf,.pdf,image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
};
