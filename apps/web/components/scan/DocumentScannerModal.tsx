import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  Camera,
  Check,
  Image as ImageIcon,
  Loader2,
  Plus,
  RotateCcw,
  RotateCw,
  ScanLine,
  Sliders,
  X,
} from 'lucide-react';
import { SCAN_CONFIG } from '../../lib/scan/config';
import { cvErrorMessage, isCvReady, loadOpenCv } from '../../lib/scan/opencv';
import { detectOnSource } from '../../lib/scan/detect';
import {
  buildScanResult,
  VARIANT_LABEL,
  type ScanResult,
  type ScanVariant,
} from '../../lib/scan/enhance';
import { blobToCanvas, describeSize, nextFrame } from '../../lib/scan/image';
import { type Point } from '../../lib/scan/geometry';
import { canAddMore, limitHint, pagesButtonLabel, trayFull } from '../../lib/scan/pages';
import { ScannerCamera, type LiveHint } from './ScannerCamera';
import { CornerEditor } from './CornerEditor';
import { ScanTray } from './ScanTray';
import { ConfirmDialog } from '../ConfirmDialog';

/** 掃好的一頁 */
export interface ScannedPage {
  /** 縮到 2000px 的影像，送 AI 辨識用 */
  ocrBlob: Blob;
  /** 全解析度影像，保存原稿用 */
  fullBlob: Blob;
  variant: ScanVariant;
  width: number;
  height: number;
}

/** 托盤裡的一張：交出去的那份，加上只給這個視窗用的縮圖 */
interface PendingPage {
  id: string;
  page: ScannedPage;
  /** 240px 縮圖的 objectURL，刪除與卸載時要 revoke */
  thumbUrl: string;
}

interface DocumentScannerModalProps {
  /** 標題列的說明，例如「掃描稿紙 · 王小明」 */
  subtitle?: string;
  onClose: () => void;
  /**
   * 使用者按下「使用這 N 張」。依拍攝順序，不會是空陣列。
   *
   * ⚠️ 這支**不會被 await** —— 按下去要馬上關窗，辨識在呼叫端自己的
   *    進度遮罩下跑（見 StudentEssayEditor 的 isOcrLoading）。
   *    在這裡 await 等於把掃描視窗當成辨識的載入畫面，那是舊行為：
   *    以前一張一張送，人就得盯著「準備影像…」等網路回來才能拍下一張。
   */
  onPages: (pages: ScannedPage[]) => void | Promise<void>;
}

type Step = 'home' | 'camera' | 'editor' | 'result';

/**
 * 稿紙掃描。
 *
 * 移植自獨立的「網頁拍照掃描器」原型：拍照 → 自動框出紙張 → 梯形校正 →
 * 去陰影與色階拉伸。校正過的影像再送去 AI 辨識，比直接拍照的辨識率高很多。
 *
 * 老師的代繳交與學生的繳交共用這一支，只有標題與回呼不同。
 */
export const DocumentScannerModal: React.FC<DocumentScannerModalProps> = ({
  subtitle,
  onClose,
  onPages,
}) => {
  const [step, setStep] = useState<Step>('home');
  const [cvState, setCvState] = useState<'loading' | 'ready' | 'error'>(
    isCvReady() ? 'ready' : 'loading',
  );
  const [cvError, setCvError] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [autoCapture, setAutoCapture] = useState(true);
  const [variant, setVariant] = useState<ScanVariant>('gray');
  const [resultInfo, setResultInfo] = useState('');
  const [adding, setAdding] = useState(false);

  /*
    來源影像與偵測到的四角同時放在 ref 與 state：
    非同步流程（拍照 → 偵測 → 校正）要馬上讀得到最新值，所以用 ref；
    但畫面不能在 render 階段讀 ref，所以另外放一份 state 給 JSX 用。
  */
  const sourceRef = useRef<HTMLCanvasElement | null>(null);
  const detectedRef = useRef<Point[] | null>(null);
  const [source, setSource] = useState<HTMLCanvasElement | null>(null);
  const [detected, setDetected] = useState<Point[] | null>(null);
  const resultRef = useRef<ScanResult | null>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  /*
    托盤：已經收下、還沒送去辨識的稿紙。

    同時放在 state 與 ref —— state 給畫面用；ref 給「卸載時把 objectURL
    全部撤掉」與 finish() 用，因為那個 cleanup 的 deps 是 []，
    閉包裡抓到的永遠是最初的空陣列。
  */
  const [pending, setPending] = useState<PendingPage[]>([]);
  const pendingRef = useRef<PendingPage[]>([]);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);
  /** 托盤非空時按右上角的 × 會先問一次 */
  const [showDiscard, setShowDiscard] = useState(false);
  /*
    縮圖的 id。不要用 crypto.randomUUID() —— 它只在安全來源存在，
    而這個視窗有一整條非 https 的相簿路徑（見下面的 insecure），
    在那裡呼叫會直接 throw。
  */
  const nextId = useRef(0);

  /*
    首頁的兩個入口什麼時候要關掉。

    用 trayFull 不用 canAddMore：從首頁拍的那張會變成「畫面上這張」，
    托盤張數不變 —— 用 canAddMore 會在托盤 7 張時就不給拍，但第 8 張是合法的。
  */
  const atLimit = trayFull(pending.length);

  const insecure = typeof window !== 'undefined' && !window.isSecureContext;
  const inAppBrowser =
    typeof navigator !== 'undefined' &&
    /\bLine\/|FBAN|FBAV|FB_IAB|Instagram|MicroMessenger/i.test(navigator.userAgent);

  /* OpenCV 只在真的打開掃描器時才載入 —— 這個檔約 10MB */
  useEffect(() => {
    let alive = true;
    loadOpenCv().then(
      () => alive && setCvState('ready'),
      (e) => {
        if (!alive) return;
        setCvState('error');
        setCvError(cvErrorMessage(e));
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  /* 離開時把 WebAssembly 的影像記憶體釋放掉 */
  useEffect(
    () => () => {
      resultRef.current?.dispose();
      resultRef.current = null;
    },
    [],
  );

  /*
    離開時撤掉所有縮圖的 objectURL。

    只有縮圖走 createObjectURL —— **絕對不要對 ocrBlob／fullBlob 這麼做**，
    那兩份會交給上層，撤銷時機就會變成跨元件的合約，撤早了圖就破、
    撤晚了等於沒撤。
  */
  useEffect(
    () => () => {
      pendingRef.current.forEach((p) => URL.revokeObjectURL(p.thumbUrl));
      pendingRef.current = [];
    },
    [],
  );

  const renderPreview = useCallback(
    (v: ScanVariant) => {
      const result = resultRef.current;
      const canvas = previewRef.current;
      if (!result || !canvas) return;
      result.drawTo(canvas, v, SCAN_CONFIG.resultPreviewLongSide);
      setResultInfo(describeSize(result.width, result.height));
    },
    [],
  );

  /** 校正並進入結果頁 */
  const process = useCallback(
    async (points: Point[]) => {
      const source = sourceRef.current;
      if (!source) return;
      setBusy('梯形校正與影像優化中…');
      await nextFrame();
      try {
        resultRef.current?.dispose();
        resultRef.current = buildScanResult(source, points);
        setStep('result');
        // 等結果頁的 canvas 掛上去再畫
        await nextFrame();
        renderPreview(variant);
      } catch (e) {
        console.error(e);
        setMessage('影像處理失敗：' + cvErrorMessage(e));
      } finally {
        setBusy('');
      }
    },
    [renderPreview, variant],
  );

  /** 拍到照片（或選了檔案）之後 */
  const openCaptured = useCallback(
    async (canvas: HTMLCanvasElement, live: LiveHint | null) => {
      sourceRef.current = canvas;
      setSource(canvas);
      detectedRef.current = null;
      setDetected(null);
      setMessage('');

      let points: Point[] | null = null;
      if (isCvReady()) {
        setBusy('偵測稿紙外框…');
        await nextFrame();
        try {
          points = detectOnSource(canvas).points;
        } catch (e) {
          console.error('[scan]', cvErrorMessage(e));
        } finally {
          setBusy('');
        }
        /*
          高解析照片上沒偵測到時，沿用預覽畫面已經框好的四角
          （兩者長寬比相同才能直接換算）。
        */
        if (!points && live) {
          const liveAspect = live.vw / live.vh;
          if (Math.abs(canvas.width / canvas.height - liveAspect) / liveAspect < 0.02) {
            points = live.points.map((p) => ({
              x: (p.x * canvas.width) / live.vw,
              y: (p.y * canvas.height) / live.vh,
            }));
          }
        }
      } else {
        setMessage('影像引擎還沒載入完成，請手動拖曳四角');
      }

      detectedRef.current = points;
      setDetected(points);
      if (points) {
        // 框到了就直接給結果，像 Google 雲端硬碟那樣；要調整再從結果頁進微調
        await process(points);
        return;
      }
      setStep('editor');
    },
    [process],
  );

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy('讀取照片…');
    try {
      const canvas = await blobToCanvas(file, SCAN_CONFIG.maxSourceLongSide);
      setBusy('');
      await openCaptured(canvas, null);
    } catch (err) {
      setBusy('');
      setMessage(cvErrorMessage(err));
    }
  };

  const changeVariant = async (v: ScanVariant) => {
    setVariant(v);
    setBusy('處理中…');
    await nextFrame();
    try {
      renderPreview(v);
    } catch (e) {
      setMessage(cvErrorMessage(e));
    } finally {
      setBusy('');
    }
  };

  const rotate = async (clockwise: boolean) => {
    if (!resultRef.current) return;
    setBusy('旋轉中…');
    await nextFrame();
    try {
      resultRef.current.rotate(clockwise);
      renderPreview(variant);
    } catch (e) {
      setMessage(cvErrorMessage(e));
    } finally {
      setBusy('');
    }
  };

  /**
   * 把托盤裡的全部交出去，然後關窗。
   *
   * 刻意**不 await onPages** —— 按下去視窗就要消失，辨識在呼叫端的
   * 進度遮罩底下跑（「正在辨識第 N / M 張」）。呼叫端的 handler 會在
   * 第一個 await 之前就打開遮罩，跟這裡的 onClose 是同一批 render，
   * 所以不會出現「視窗關了但什麼都沒發生」的空窗。
   */
  const finish = (pages: PendingPage[]) => {
    if (!pages.length) {
      onClose();
      return;
    }
    void onPages(pages.map((p) => p.page));
    onClose();
  };

  /**
   * 收下目前這一張放進托盤。**不送辨識**。
   *
   * ⚠️ 三份影像都要在 dispose() 之前榨出來（Mat 還活著），而且要**序列**產生：
   *    三個一起 Promise.all 會同時存在三個 canvas，其中全解析度那個
   *    就是 34MB，手機上很容易被系統砍掉分頁。
   *
   * ⚠️ 榨完就 dispose：托盤裡只留 blob（瀏覽器可以換頁到磁碟），
   *    不留 ScanResult。這是「連拍八張也不會比拍一張更吃記憶體」的關鍵 ——
   *    同一時間只有一個 ScanResult 與一個 source canvas 活著。
   *
   * @param next 收完之後去哪：
   *   'camera' 直接回相機拍下一張（一篇作文常常兩三張稿紙，
   *            拍完被丟回首頁、還要再點一次「開啟相機掃描」很惱人）；
   *   'done'   送出托盤裡的全部，關掉掃描器。
   */
  const acceptCurrent = async (next: 'camera' | 'done') => {
    const result = resultRef.current;
    if (!result || adding) return;
    setAdding(true);
    setBusy('收下這一張…');
    await nextFrame();
    try {
      const ocrBlob = await result.toBlob(variant, SCAN_CONFIG.ocrLongSide);
      const fullBlob = await result.toBlob(variant, 0);
      const thumbBlob = await result.toBlob(variant, SCAN_CONFIG.thumbLongSide);
      /*
        ⚠️ 尺寸要在 dispose() **之前**讀完。
           result.width 讀的是 warped.cols，而 dispose() 會把那個 Mat delete 掉 ——
           在之後讀等於碰已經釋放的 WASM 記憶體，會直接 throw，
           整張就被 catch 吞進「處理失敗」，托盤永遠是空的（實測踩過）。
      */
      const width = result.width;
      const height = result.height;

      result.dispose();
      resultRef.current = null;
      sourceRef.current = null;
      setSource(null);
      detectedRef.current = null;
      setDetected(null);

      const taken: PendingPage = {
        id: `p${nextId.current++}`,
        page: { ocrBlob, fullBlob, variant, width, height },
        thumbUrl: URL.createObjectURL(thumbBlob),
      };
      // setPending 是非同步的，所以自己組出新陣列，不要等 state 更新
      const all = [...pendingRef.current, taken];
      pendingRef.current = all;
      setPending(all);
      setMessage('');

      if (next === 'done') {
        finish(all);
        return;
      }
      // 不能開相機的環境（非 https、沒給權限）回首頁，那裡還有「從相簿選擇」
      setStep(insecure ? 'home' : 'camera');
    } catch (e) {
      console.error(e);
      setMessage('處理失敗：' + cvErrorMessage(e));
    } finally {
      setBusy('');
      setAdding(false);
    }
  };

  /** 刪掉托盤裡的某一張。還沒送出，所以不問第二次，只在訊息列說一聲 */
  const removePage = (id: string) => {
    const i = pendingRef.current.findIndex((p) => p.id === id);
    if (i < 0) return;
    URL.revokeObjectURL(pendingRef.current[i].thumbUrl);
    const rest = pendingRef.current.filter((p) => p.id !== id);
    pendingRef.current = rest;
    setPending(rest);
    setMessage(`已刪掉第 ${i + 1} 張，可以再拍一張補上`);
  };

  /** 右上角的 ×。托盤裡有東西就先問 —— 關掉就真的沒了，blob 還沒交給任何人 */
  const requestClose = () => {
    if (pendingRef.current.length > 0) {
      setShowDiscard(true);
      return;
    }
    onClose();
  };

  const cvBadge = {
    loading: { text: '影像處理引擎載入中…（約 10MB）', cls: 'text-text-secondary' },
    ready: { text: '影像處理引擎已就緒', cls: 'text-success-700' },
    error: { text: '影像引擎載入失敗：' + cvError, cls: 'text-danger-700' },
  }[cvState];

  /*
    整個視窗掛到 document.body（createPortal），而且 z-[1100]。兩件事都是必要的：

    z-[1100] —— 手機的底部導覽是 z-[1001]（StudentPortal / Navigation），
    這個視窗原本 z-[120]，相機畫面最下面那排「閃光燈／快門／自動」
    整條被導覽列蓋住，學生按不到快門（iPhone 與 Android 的直式畫面都是）。
    SettingsModal 為了同一個原因也是 z-[1100]。

    portal —— 原本掛在學生作文頁那個 `space-y-6` 容器裡，Tailwind v4 的
    space-y 會給「不是最後一個」的子項一段 margin-bottom，fixed inset-0
    因此短了 24px：畫面最下緣露出一條，底部導覽從那條縫透出來（實測 390×844
    量到視窗只有 820px 高）。掛到 body 底下就不受任何版面容器影響。
  */
  return createPortal(
    <div className="fixed inset-0 z-[1100] bg-surface flex flex-col">
      {/* 標題列。相機與微調是全黑畫面，那兩步自己有控制列，不重複顯示 */}
      {(step === 'home' || step === 'result') && (
        <div className="shrink-0 flex items-start justify-between gap-3 px-4 sm:px-6 py-4 border-b border-border bg-card/60">
          <div className="min-w-0">
            <h2 className="text-title font-bold text-text-primary flex items-center gap-2">
              <ScanLine size={18} className="shrink-0 text-primary" />
              稿紙掃描
            </h2>
            {subtitle && (
              <p className="text-caption text-text-secondary mt-0.5 truncate">{subtitle}</p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {pending.length > 0 && (
              <span className="px-2.5 py-1 rounded-lg bg-success-100 text-success-700 border border-success-200 text-caption whitespace-nowrap">
                已收 {pending.length} 張
              </span>
            )}
            <button
              id="scanner-btn-close"
              onClick={requestClose}
              title="關閉掃描"
              className="tap-target p-2 rounded-full text-text-secondary hover:bg-surface-soft transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>
      )}

      <div className="relative flex-1 min-h-0 overflow-y-auto">
        {/* ── 首頁 ── */}
        {step === 'home' && (
          <div className="max-w-xl mx-auto px-4 sm:px-6 py-5 flex flex-col gap-4">
            <p className="text-body text-text-secondary">
              拍攝 A3／B4 稿紙，系統會自動框出紙張、拉正、提高對比，再送去辨識文字。
            </p>

            {insecure && (
              <p className="flex items-start gap-2 text-caption text-danger-700 bg-danger-50 border border-danger-200 rounded-brand px-3.5 py-3">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                相機功能需要 HTTPS 連線。請用 https:// 的網址開啟（本機測試用 localhost 可以）。
              </p>
            )}
            {inAppBrowser && (
              <p className="flex items-start gap-2 text-caption text-warning-700 bg-warning-100 border border-warning-200 rounded-brand px-3.5 py-3">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                你正在 LINE／Facebook 的內建瀏覽器中，相機可能無法使用。請點右上角選單改用瀏覽器開啟，或改用下方的「從相簿選擇照片」。
              </p>
            )}

            <p className={`text-caption ${cvBadge.cls}`}>{cvBadge.text}</p>

            <div className="flex flex-col gap-2.5">
              <button
                id="scanner-btn-open-camera"
                onClick={() => setStep('camera')}
                disabled={insecure || atLimit}
                className="inline-flex items-center justify-center gap-2 px-5 py-3.5 rounded-brand bg-primary text-on-accent text-ui shadow-sm hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
              >
                <Camera size={18} />
                開啟相機掃描
              </button>

              <label
                id="scanner-btn-gallery"
                className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-brand bg-card border border-border-strong text-text-primary text-body cursor-pointer hover:bg-surface-soft transition-colors"
              >
                <ImageIcon size={16} />
                從相簿選擇照片
                <input
                  ref={galleryInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  disabled={atLimit}
                  onChange={onPickFile}
                />
              </label>
            </div>

            {atLimit && (
              <p className="text-caption text-warning-700 bg-warning-100 border border-warning-200 rounded-brand px-3.5 py-2.5">
                {limitHint(pending.length)}
              </p>
            )}

            <ScanTray pages={pending} onRemove={removePage} />

            {/*
              掃到一半回到這裡時的出口。

              ⚠️ 這顆以前是 onClose ——「完成，回去繼續打字」其實什麼都沒做，
                 因為那時候每一張早就各自送出去了。現在張數留在托盤裡，
                 按 onClose 等於把學生拍的全部丟掉，所以一定要走 finish()。
                 非 https 的環境只能用相簿一張一張累積，**這是那條路唯一的出口**。
            */}
            {pending.length > 0 && (
              <button
                id="scanner-btn-use-pages-home"
                onClick={() => finish(pending)}
                className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-brand bg-secondary text-on-accent text-ui shadow-sm hover:opacity-90 transition-opacity"
              >
                <Check size={16} />
                {pagesButtonLabel(pending.length)}
              </button>
            )}

            <div className="rounded-brand border border-border bg-card/40 px-4 py-3.5">
              <h3 className="text-caption text-text-secondary mb-2">拍攝小提醒</h3>
              <ul className="text-caption text-text-secondary space-y-1 list-disc list-inside">
                <li>稿紙放在顏色不同的桌面上，四個角都要入鏡</li>
                <li>光線均勻，避開手機的影子與反光</li>
                <li>不必完全對正，系統會自動拉直；框不準可以手動拖四角</li>
                {/*
                  ⚠️ 這一條原本寫「A3 稿紙請橫持手機拍」—— 只對橫式稿紙成立。
                     國文作文用的是**直式稿紙**，照那句橫著拍，紙在畫面裡只剩三成，
                     剛好卡在 minCaptureAreaRatio(0.3) 的邊緣，反而更容易框不到
                     （實測：直握 63%、橫握 29.7%）。重點是「讓稿紙填滿畫面」。
                */}
                <li>稿紙是直的就直握手機、橫的就橫握，讓稿紙填滿畫面</li>
              </ul>
            </div>

            <label className="flex items-center justify-between gap-3 rounded-brand border border-border bg-card/40 px-4 py-3">
              <span className="text-body text-text-primary">
                防手震自動拍照
                <span className="block text-caption text-text-secondary">
                  對齊良好並保持穩定約 1 秒後自動拍攝
                </span>
              </span>
              <input
                id="scanner-input-auto"
                type="checkbox"
                checked={autoCapture}
                onChange={(e) => setAutoCapture(e.target.checked)}
                className="w-5 h-5 accent-primary shrink-0"
              />
            </label>
          </div>
        )}

        {/* ── 相機 ── */}
        {step === 'camera' && (
          <ScannerCamera
            pageCount={pending.length}
            autoCapture={autoCapture}
            onToggleAuto={() => setAutoCapture((v) => !v)}
            onCapture={(canvas, live) => void openCaptured(canvas, live)}
            onClose={() => setStep('home')}
            onError={(m) => {
              setMessage(m);
              setStep('home');
            }}
          />
        )}

        {/* ── 四角微調 ── */}
        {step === 'editor' && source && (
          <CornerEditor
            source={source}
            detected={detected}
            onRetake={() => setStep('camera')}
            onRedetect={() => {
              if (!sourceRef.current || !isCvReady()) return null;
              try {
                const pts = detectOnSource(sourceRef.current).points;
                detectedRef.current = pts;
                setDetected(pts);
                return pts;
              } catch {
                return null;
              }
            }}
            onConfirm={(points) => void process(points)}
          />
        )}

        {/* ── 結果 ── */}
        {step === 'result' && (
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-5 flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="inline-flex rounded-brand border border-border-strong overflow-hidden">
                {(['color', 'gray', 'binary'] as ScanVariant[]).map((v) => (
                  <button
                    key={v}
                    id={`scanner-btn-variant-${v}`}
                    onClick={() => void changeVariant(v)}
                    className={`px-3.5 py-2 text-caption whitespace-nowrap transition-colors ${
                      variant === v
                        ? 'bg-primary text-on-accent'
                        : 'bg-card text-text-secondary hover:bg-surface-soft'
                    }`}
                  >
                    {VARIANT_LABEL[v]}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  id="scanner-btn-rotate-left"
                  onClick={() => void rotate(false)}
                  title="向左旋轉"
                  className="tap-target p-2 rounded-lg border border-border text-text-secondary hover:text-primary hover:border-primary transition-colors"
                >
                  <RotateCcw size={16} />
                </button>
                <button
                  id="scanner-btn-rotate-right"
                  onClick={() => void rotate(true)}
                  title="向右旋轉"
                  className="tap-target p-2 rounded-lg border border-border text-text-secondary hover:text-primary hover:border-primary transition-colors"
                >
                  <RotateCw size={16} />
                </button>
              </div>
            </div>

            <div className="rounded-brand border border-border bg-card p-2 overflow-hidden">
              <canvas ref={previewRef} className="w-full h-auto block" />
            </div>
            <p className="text-caption text-text-muted tabular-nums">{resultInfo}</p>

            <ScanTray pages={pending} onRemove={removePage} />

            <div className="flex flex-wrap items-center gap-2">
              <button
                id="scanner-btn-result-retake"
                onClick={() => setStep('camera')}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-brand border border-border text-text-secondary text-body hover:bg-surface-soft transition-colors whitespace-nowrap"
              >
                <RotateCcw size={15} />
                這張重拍
              </button>
              <button
                id="scanner-btn-result-adjust"
                onClick={() => setStep('editor')}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-brand border border-border text-text-secondary text-body hover:bg-surface-soft transition-colors whitespace-nowrap"
              >
                <Sliders size={15} />
                調整四角
              </button>
              {/*
                兩個出口都要明擺著。一篇作文常常不只一張稿紙，
                只給一顆「使用這一張」的話，人不知道還能不能再拍。

                「再拍下一張」只是把這張收進托盤 —— **不送辨識**。
                整批要等按下右邊那顆才一起送。
              */}
              <button
                id="scanner-btn-add-more"
                onClick={() => void acceptCurrent('camera')}
                disabled={adding || !canAddMore(pending.length)}
                title={limitHint(pending.length) || undefined}
                className="ml-auto inline-flex items-center gap-1.5 px-4 py-2.5 rounded-brand border border-border-strong text-text-primary text-body hover:bg-surface-soft disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                <Plus size={15} />
                再拍下一張
              </button>
              <button
                id="scanner-btn-use-pages"
                onClick={() => void acceptCurrent('done')}
                disabled={adding}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-brand bg-secondary text-on-accent text-ui shadow-sm hover:opacity-90 disabled:opacity-50 transition-opacity whitespace-nowrap"
              >
                {adding ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                {pagesButtonLabel(pending.length + 1)}
              </button>
            </div>
          </div>
        )}

        {/* 處理中遮罩 */}
        {busy && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-surface/80 backdrop-blur-sm">
            <Loader2 size={26} className="animate-spin text-primary" />
            <p className="text-body text-text-secondary">{busy}</p>
          </div>
        )}
      </div>

      {message && (
        <div className="shrink-0 px-4 sm:px-6 py-3 border-t border-border bg-warning-100">
          <p className="text-caption text-warning-700 flex items-start gap-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            {message}
          </p>
        </div>
      )}

      {/*
        托盤裡還有東西就按了 ×。關掉是真的丟掉 —— 那些 blob 還沒交給任何人。

        ⚠️ ConfirmDialog 與這個視窗**都是 z-[1100] 且都 portal 到 body**，
           同層級時靠 DOM 掛載順序決勝負：它是在掃描視窗之後才掛上去的，
           所以蓋得住。成立，但不是自動成立的 —— 誰動了掛載順序就會壞。
      */}
      {showDiscard && (
        <ConfirmDialog
          title={`要丟掉已經拍好的 ${pending.length} 張嗎？`}
          message={`這 ${pending.length} 張還沒有送去辨識，關掉就沒有了。\n\n想留下的話請按「取消」，再按「${pagesButtonLabel(pending.length)}」。`}
          confirmLabel="丟掉並關閉"
          danger
          onConfirm={onClose}
          onCancel={() => setShowDiscard(false)}
        />
      )}
    </div>,
    document.body,
  );
};
