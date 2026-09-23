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
import { ScannerCamera, type LiveHint } from './ScannerCamera';
import { CornerEditor } from './CornerEditor';

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

interface DocumentScannerModalProps {
  /** 標題列的說明，例如「掃描稿紙 · 王小明」 */
  subtitle?: string;
  /** 已經掃好幾頁了。作文常常是兩張稿紙 */
  pageCount?: number;
  onClose: () => void;
  /** 掃好一頁。回傳後畫面會回到首頁，可以接著掃下一張 */
  onPage: (page: ScannedPage) => void | Promise<void>;
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
  pageCount = 0,
  onClose,
  onPage,
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

  /** 這一頁完成：產生兩份影像交給上層（辨識用的縮圖、保存用的全圖） */
  /**
   * 收下目前這一張。
   *
   * @param next 收完之後去哪：
   *   'camera' 直接回相機拍下一張（一篇作文常常兩三張稿紙，
   *            拍完被丟回首頁、還要再點一次「開啟相機掃描」很惱人）；
   *   'done'   關掉掃描器，回去繼續打字。
   */
  const addPage = async (next: 'camera' | 'done') => {
    const result = resultRef.current;
    if (!result || adding) return;
    setAdding(true);
    setBusy('準備影像…');
    await nextFrame();
    try {
      const ocrBlob = await result.toBlob(variant, SCAN_CONFIG.ocrLongSide);
      const fullBlob = await result.toBlob(variant, 0);
      await onPage({
        ocrBlob,
        fullBlob,
        variant,
        width: result.width,
        height: result.height,
      });
      result.dispose();
      resultRef.current = null;
      sourceRef.current = null;
      setSource(null);
      detectedRef.current = null;
      setDetected(null);
      if (next === 'done') {
        onClose();
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
            {pageCount > 0 && (
              <span className="px-2.5 py-1 rounded-lg bg-success-100 text-success-700 border border-success-200 text-caption whitespace-nowrap">
                已掃 {pageCount} 頁
              </span>
            )}
            <button
              id="scanner-btn-close"
              onClick={onClose}
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
                disabled={insecure}
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
                  onChange={onPickFile}
                />
              </label>
            </div>

            {/* 掃到一半回到這裡時，要有一條明確的路走掉，不是只能按右上角的 × */}
            {pageCount > 0 && (
              <button
                id="scanner-btn-finish"
                onClick={onClose}
                className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-brand bg-secondary text-on-accent text-ui shadow-sm hover:opacity-90 transition-opacity"
              >
                <Check size={16} />
                完成，回去繼續打字（共 {pageCount} 張）
              </button>
            )}

            <div className="rounded-brand border border-border bg-card/40 px-4 py-3.5">
              <h3 className="text-caption text-text-secondary mb-2">拍攝小提醒</h3>
              <ul className="text-caption text-text-secondary space-y-1 list-disc list-inside">
                <li>稿紙放在顏色不同的桌面上，四個角都要入鏡</li>
                <li>光線均勻，避開手機的影子與反光</li>
                <li>不必完全對正，系統會自動拉直；框不準可以手動拖四角</li>
                <li>A3 稿紙請橫持手機拍，解析度才夠</li>
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
            pageCount={pageCount}
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

            <div className="flex flex-wrap items-center gap-2">
              <button
                id="scanner-btn-result-retake"
                onClick={() => setStep('camera')}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-brand border border-border text-text-secondary text-body hover:bg-surface-soft transition-colors whitespace-nowrap"
              >
                <RotateCcw size={15} />
                重拍
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
              */}
              <button
                id="scanner-btn-add-more"
                onClick={() => void addPage('camera')}
                disabled={adding}
                className="ml-auto inline-flex items-center gap-1.5 px-4 py-2.5 rounded-brand border border-border-strong text-text-primary text-body hover:bg-surface-soft disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                <Plus size={15} />
                再拍下一張
              </button>
              <button
                id="scanner-btn-add-page"
                onClick={() => void addPage('done')}
                disabled={adding}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-brand bg-secondary text-on-accent text-ui shadow-sm hover:opacity-90 disabled:opacity-50 transition-opacity whitespace-nowrap"
              >
                {adding ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                {pageCount > 0 ? `完成（共 ${pageCount + 1} 張）` : '使用這一張'}
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
    </div>,
    document.body,
  );
};
