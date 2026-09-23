import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Flashlight, RefreshCw, X } from 'lucide-react';
import { SCAN_CONFIG, VIRTUAL_CAMERA_PATTERN } from '../../lib/scan/config';
import { getCv, isCvReady, cvErrorMessage, type Mat } from '../../lib/scan/opencv';
import { detectDocument, imageSharpness } from '../../lib/scan/detect';
import {
  clamp,
  maxDisplacement,
  quadGeometry,
  smoothPoints,
  type Point,
} from '../../lib/scan/geometry';
import { FrameTimings, type PerfSummary } from '../../lib/scan/perf';
import { previewTargetSize, shouldApplyPreview } from '../../lib/scan/preview';
import { isScanDebug, toggleScanDebug } from '../../lib/scan/debug';
import { ScanDebugHud } from './ScanDebugHud';

/** 拍照當下預覽畫面最後框到的四角。高解析照片偵測失敗時可以沿用 */
export interface LiveHint {
  points: Point[];
  vw: number;
  vh: number;
}

interface ScannerCameraProps {
  /** 已經掃好幾頁了。連拍第二、三張時要讓人知道自己拍到哪 */
  pageCount: number;
  autoCapture: boolean;
  onToggleAuto: () => void;
  onCapture: (canvas: HTMLCanvasElement, live: LiveHint | null) => void;
  onClose: () => void;
  onError: (message: string) => void;
}

function cameraErrorMessage(e: unknown): string {
  const name = (e as { name?: string })?.name;
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return '相機權限被拒絕，請到瀏覽器設定允許本網站使用相機';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return '找不到可用的後鏡頭';
    case 'NotReadableError':
      return '相機正被其他 App 使用中，請關閉後再試';
    default:
      return '無法開啟相機：' + cvErrorMessage(e);
  }
}

const isVirtualCamera = (label: string) => VIRTUAL_CAMERA_PATTERN.test(label);

/**
 * 沒指定鏡頭時要開哪一顆。回 undefined＝交給 facingMode 決定（手機的預設行為）。
 *
 * 只在「已經有相機權限（拿得到名稱）而且清單裡混了虛擬鏡頭」時才出手：
 * 名稱帶 back／rear／後 的優先，否則第一顆實體鏡頭。沒有虛擬鏡頭的裝置
 * （絕大多數手機）完全不動，維持 facingMode: environment 挑後鏡頭。
 */
async function preferredCamera(): Promise<string | undefined> {
  let cams: MediaDeviceInfo[];
  try {
    cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  } catch {
    return undefined;
  }
  if (!cams.some((c) => c.label)) return undefined; // 還沒授權，看不到名稱
  const real = cams.filter((c) => !isVirtualCamera(c.label));
  if (!real.length || real.length === cams.length) return undefined;
  const back = real.find((c) => /back|rear|environment|後/i.test(c.label));
  return (back ?? real[0]).deviceId;
}

function waitForVideo(video: HTMLVideoElement): Promise<void> {
  if (video.videoWidth > 0) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener('loadedmetadata', done);
      clearTimeout(t);
      resolve();
    };
    const t = setTimeout(done, 5000);
    video.addEventListener('loadedmetadata', done);
  });
}

/**
 * 探測說可信、實際拍出來卻只有預覽解析度的鏡頭（見 capture 的保護 A）。
 *
 * 放模組層而不是元件裡：掃第二張時 ScannerCamera 會重新掛載，
 * 記在元件裡的話每開一次相機都要再浪費一張照片才學到同一件事。
 */
const untrustedPhotoDevices = new Set<string>();

/** 這個瀏覽器有沒有 ImageCapture（按快門時能拿感光元件全解析度） */
function imageCaptureCtor():
  | (new (t: MediaStreamTrack) => {
      takePhoto(): Promise<Blob>;
      getPhotoCapabilities?: () => Promise<{ imageWidth?: { max?: number } }>;
    })
  | undefined {
  if (!SCAN_CONFIG.useTakePhoto) return undefined;
  return (
    window as unknown as {
      ImageCapture?: new (t: MediaStreamTrack) => {
        takePhoto(): Promise<Blob>;
        getPhotoCapabilities?: () => Promise<{ imageWidth?: { max?: number } }>;
      };
    }
  ).ImageCapture;
}

/**
 * 拍照管線可不可信 —— 決定了能不能把取景串流壓小。
 *
 * 規格上 takePhoto() 拿的是 still-capture 管線的成品，與 video track 的
 * 尺寸無關；但部分 Android（沒有獨立 still pipeline 的舊 camera HAL）
 * 實際上只是把預覽畫格回傳。那種裝置一旦壓低預覽，存檔的稿紙就從
 * 12M 像素掉到 1.5M，A3 只剩約 87 DPI —— 辨識率會直接崩。
 *
 * 所以開相機時先問一次 getPhotoCapabilities：說得出夠大的尺寸才算數。
 * **問不到就當作不可信**（這支 API 在某些機種會 throw 或回空物件）。
 * 寧可慢，也不能毀畫質。
 */
async function photoPipelineTrusted(track: MediaStreamTrack): Promise<boolean> {
  const Ctor = imageCaptureCtor();
  if (!Ctor) return false;
  try {
    const ic = new Ctor(track);
    if (!ic.getPhotoCapabilities) return false;
    const caps = await withTimeout(ic.getPhotoCapabilities(), 2000);
    return (caps?.imageWidth?.max ?? 0) >= SCAN_CONFIG.trustedPhotoMinWidth;
  } catch {
    return false;
  }
}

/**
 * 取景串流要開多大。
 *
 * ⚠️ 這裡原本是**無條件** `applyConstraints({ width: caps.width.max, … })`，
 *    理由寫著「有些裝置會忽略 getUserMedia 的 ideal 值」。但它把上面
 *    刻意做的分流整個洗掉了：Android Chrome 的預覽因此被拉到感光元件最大
 *    （常見 4000×3000＝12M 像素），而每一幀都要把它縮到 512 再 getImageData
 *    回讀 —— 加上那個 canvas 用了 willReadFrequently（Chrome 會改走 CPU 光柵化），
 *    等於每秒九次在 CPU 上降採樣 12M 像素。**這就是 Android 對邊比 iOS 慢的主因。**
 *
 * 現在依快門路徑決定：
 *   - 拍照管線可信（takePhoto 拿得到高解析）→ 預覽壓到 previewLongSide，
 *     而且**照感光元件的長寬比**算寬高（理由見 config 的 previewLongSide）。
 *   - 其餘（iOS Safari、takePhoto 不可信的 Android）→ 串流就是成品畫質，
 *     維持原本「要最大」的行為，只夾在 maxSourceLongSide，再大也會在 capture 被縮掉。
 *
 * 已經符合目標就整段跳過 —— 有些機器 applyConstraints 會讓畫面黑一下。
 */
async function applyTrackResolution(
  track: MediaStreamTrack,
  caps: MediaTrackCapabilities,
  trusted: boolean,
): Promise<void> {
  const maxW = caps.width?.max;
  const maxH = caps.height?.max;
  if (!maxW || !maxH) return;

  const target = previewTargetSize(maxW, maxH, trusted);
  if (!shouldApplyPreview(track.getSettings(), target, trusted)) return;

  try {
    await track.applyConstraints({
      width: { ideal: target.width },
      height: { ideal: target.height },
    });
  } catch {
    /* 套不上就沿用原本的 */
  }
}

/**
 * 等影片畫格真的換成新解析度。
 *
 * applyConstraints 的 promise resolve 得比實際生效早 ——
 * 馬上讀 video.videoWidth 拿到的還是舊值，直接 drawImage 就會拍到舊尺寸。
 */
function waitFrames(count = 2): Promise<void> {
  return new Promise((resolve) => {
    let left = count;
    const tick = () => (--left <= 0 ? resolve() : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('逾時')), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * 相機畫面：即時框出稿紙、對齊良好就自動拍照。
 *
 * 為什麼要即時偵測：學生與老師拍稿紙時最常見的失敗是「拍歪」與「拍糊」，
 * 拍完才發現就要重來。這裡在按下快門前就把條件檢查完
 * （夠大、四角都入鏡、不太斜、夠清晰），不合格會直接告訴他要怎麼調。
 *
 * 影像處理的迴圈刻意用 setTimeout 而不是 requestAnimationFrame：
 * 這段運算比一個畫格久，用 rAF 會把畫面卡住。
 */
export const ScannerCamera: React.FC<ScannerCameraProps> = ({
  pageCount,
  autoCapture,
  onToggleAuto,
  onCapture,
  onClose,
  onError,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const frameCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameMatRef = useRef<Mat | null>(null);
  const timerRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const capturingRef = useRef(false);

  /** 連續幾幀沒找到紙張。累積到門檻就改跑完整偵測（見 step） */
  const missesRef = useRef(0);

  /*
    效能診斷（?scandebug=1 才看得到，見 lib/scan/debug.ts）。
    計時本身常駐 —— 一幀 8 次 performance.now() 的成本可以忽略，
    但「算百分位 + setState」只在開啟時做，而且限制在每 500ms 一次：
    step() 已經每幀兩次 setState，不能再多一次每幀的。
  */
  const timingsRef = useRef(new FrameTimings(30));
  const hudAtRef = useRef(0);
  const debugRef = useRef(isScanDebug());
  /** 快門走哪一條。開相機時決定，拍照失敗退回影片畫格時會改（見 capture） */
  const shutterPathRef = useRef<'takePhoto' | '影片畫格'>('影片畫格');
  /**
   * 這台裝置的 takePhoto 拿不拿得到高解析。false 就不壓預覽，
   * 拍照也直接走影片畫格（那時串流本身就是成品畫質）。
   */
  const photoTrustedRef = useRef(false);
  /** 鏡頭能力。拍照要暫時把串流拉回最大時要用（見 capture 的保護 A／B） */
  const capsRef = useRef<MediaTrackCapabilities | null>(null);
  /** 疊圖畫布的實際像素大小，只給診斷顯示用 */
  const overlaySizeRef = useRef('');
  const anchorRef = useRef<Point[] | null>(null);
  const smoothRef = useRef<Point[] | null>(null);
  const lastLiveRef = useRef<(LiveHint & { at: number }) | null>(null);
  const stableSinceRef = useRef(0);
  const startedAtRef = useRef(0);
  const autoRef = useRef(autoCapture);

  const [status, setStatus] = useState('啟動相機中…');
  const [aligned, setAligned] = useState(false);
  const [info, setInfo] = useState('');
  const [hasTorch, setHasTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  /** 這台裝置的鏡頭清單（有權限後才拿得到名稱）。多於一顆時可以切換 */
  const [lenses, setLenses] = useState<MediaDeviceInfo[]>([]);
  /**
   * 指定要開的鏡頭。undefined＝自動挑（見 preferredCamera）。
   * 使用者按「切換鏡頭」、或自動挑到虛擬鏡頭時會設定它，啟動流程依它重來一次。
   */
  const [deviceId, setDeviceId] = useState<string | undefined>(undefined);
  /** 目前實際開著的是哪一顆 */
  const [activeDeviceId, setActiveDeviceId] = useState<string | undefined>(undefined);
  /** 效能診斷：開關與最近一次的統計。關閉時 summary 永遠是 null，HUD 整個不 render */
  const [debug, setDebug] = useState(isScanDebug);
  /**
   * 要顯示的診斷數字。**整包一起進 state**：ref 不能在 render 階段讀
   * （React 的 lint 會擋，而且讀到的值本來就不保證是這次 render 的），
   * 所以快門路徑與疊圖尺寸也在這裡一起帶出來。
   */
  const [hud, setHud] = useState<{
    summary: PerfSummary;
    stream: string;
    shutter: string;
    overlay: string;
    dpr: number;
  } | null>(null);
  /** 串流實際跑在多大、幾 fps。診斷用，也是驗證取景解析度有沒有壓下去的依據 */
  const streamInfoRef = useRef('');

  /* 長按解析度標籤 800ms 切換診斷顯示 */
  const debugPressRef = useRef<number | null>(null);
  const startDebugPress = useCallback(() => {
    if (debugPressRef.current) window.clearTimeout(debugPressRef.current);
    debugPressRef.current = window.setTimeout(() => {
      const next = toggleScanDebug();
      debugRef.current = next;
      if (!next) setHud(null);
      setDebug(next);
    }, 800);
  }, []);
  const cancelDebugPress = useCallback(() => {
    if (debugPressRef.current) window.clearTimeout(debugPressRef.current);
    debugPressRef.current = null;
  }, []);
  useEffect(() => cancelDebugPress, [cancelDebugPress]);

  /*
    ⚠️ **上層的回呼一律經過 ref 呼叫，不要放進 effect 的依賴。**
       DocumentScannerModal 傳進來的 onCapture／onError 是 inline 函式，
       它每 render 一次就換一個新的。以前啟動相機的 effect 依賴它們（經由
       capture → step），掃描視窗只要重新 render —— 在代繳交視窗裡，全站狀態
       任何變動都會 —— 相機就被關掉重開。遇上開一次要 9 秒的鏡頭，就永遠開不起來。
  */
  const onCaptureRef = useRef(onCapture);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onCaptureRef.current = onCapture;
    onErrorRef.current = onError;
  });

  useEffect(() => {
    autoRef.current = autoCapture;
    anchorRef.current = null;
  }, [autoCapture]);

  /* ── 畫面疊圖 ─────────────────────────────────────────── */
  const drawOverlay = useCallback((points: Point[] | null, progress: number, good: boolean) => {
    const canvas = overlayRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (!cw || !ch) return;

    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
      overlaySizeRef.current = `${canvas.width}×${canvas.height}`;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    // A3 比例的對齊框，外圍壓暗
    const ratio = SCAN_CONFIG.paperRatio;
    const reserve = 100;
    let g: { x: number; y: number; w: number; h: number };
    if (cw >= ch) {
      const availW = cw - reserve;
      const w = Math.min(availW * 0.9, ch * 0.86 * ratio);
      g = { x: (availW - w) / 2, y: (ch - w / ratio) / 2, w, h: w / ratio };
    } else {
      const availH = ch - reserve;
      const h = Math.min(availH * 0.9, cw * 0.86 * ratio);
      g = { x: (cw - h / ratio) / 2, y: (availH - h) / 2, w: h / ratio, h };
    }

    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.beginPath();
    ctx.rect(0, 0, cw, ch);
    ctx.rect(g.x, g.y, g.w, g.h);
    ctx.fill('evenodd');

    ctx.strokeStyle = 'rgba(126,157,191,.9)';
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 8]);
    ctx.strokeRect(g.x, g.y, g.w, g.h);
    ctx.setLineDash([]);

    const len = Math.min(34, g.w * 0.12);
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#7E9DBF';
    ctx.lineCap = 'round';
    (
      [
        [g.x, g.y, 1, 1],
        [g.x + g.w, g.y, -1, 1],
        [g.x + g.w, g.y + g.h, -1, -1],
        [g.x, g.y + g.h, 1, -1],
      ] as const
    ).forEach(([x, y, dx, dy]) => {
      ctx.beginPath();
      ctx.moveTo(x, y + dy * len);
      ctx.lineTo(x, y);
      ctx.lineTo(x + dx * len, y);
      ctx.stroke();
    });

    if (!points) return;

    // 影片座標 → 畫面座標（video 用 object-fit: cover）
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;
    const s = Math.max(cw / vw, ch / vh);
    const dx = (cw - vw * s) / 2;
    const dy = (ch - vh * s) / 2;
    const sp = points.map((p) => ({ x: p.x * s + dx, y: p.y * s + dy }));

    // 對齊良好是石綠，框到但還不夠好是赭石
    const color = good ? '#5C7A63' : '#BE8B5D';
    ctx.beginPath();
    sp.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = good ? `rgba(92,122,99,${0.16 + progress * 0.22})` : 'rgba(190,139,93,.16)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = color;
    ctx.stroke();
    sp.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    });

    if (progress > 0 && progress < 1) {
      const cx = sp.reduce((a, p) => a + p.x, 0) / 4;
      const cy = sp.reduce((a, p) => a + p.y, 0) / 4;
      ctx.beginPath();
      ctx.arc(cx, cy, 34, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,.5)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy, 28, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
      ctx.lineWidth = 6;
      ctx.strokeStyle = '#5C7A63';
      ctx.stroke();
    }
  }, []);

  /* ── 拍照 ─────────────────────────────────────────────── */
  const capture = useCallback(
    async (trigger: 'auto' | 'manual') => {
      const video = videoRef.current;
      const track = trackRef.current;
      if (capturingRef.current || !video || !track) return;
      capturingRef.current = true;
      runningRef.current = false;
      if (timerRef.current) window.clearTimeout(timerRef.current);

      setStatus(trigger === 'auto' ? '自動拍照中，請勿移動…' : '拍照中…');
      try {
        if (navigator.vibrate && navigator.userActivation?.hasBeenActive !== false) {
          navigator.vibrate(40);
        }
      } catch {
        /* 有些瀏覽器不允許，忽略 */
      }

      const live =
        lastLiveRef.current && performance.now() - lastLiveRef.current.at < 1000
          ? lastLiveRef.current
          : null;

      try {
        let canvas: HTMLCanvasElement | null = null;

        // 優先用 ImageCapture 取得感光元件全解析度，失敗再退回擷取影片畫格
        const ImageCaptureCtor = imageCaptureCtor();
        if (ImageCaptureCtor && photoTrustedRef.current) {
          try {
            const ic = new ImageCaptureCtor(track);
            const blob = await withTimeout(ic.takePhoto(), SCAN_CONFIG.takePhotoTimeoutMs);
            const { blobToCanvas } = await import('../../lib/scan/image');
            canvas = await blobToCanvas(blob, SCAN_CONFIG.maxSourceLongSide);
            /*
              保護 A：說好的高解析沒有兌現。
              有些 Android 的 takePhoto 其實只是回傳預覽畫格 —— 事前探測
              （photoPipelineTrusted）攔不到全部。成品明顯小於預期就整張作廢，
              把串流拉回最大、改用影片畫格重拍，並記下這台裝置之後都不壓預覽。
              慢一點沒關係，交出一張 87 DPI 的稿紙才是真的壞掉。
            */
            if (
              Math.max(canvas.width, canvas.height) <
              SCAN_CONFIG.previewLongSide * SCAN_CONFIG.trustedPhotoRatio
            ) {
              console.warn('[camera] takePhoto 只拿到預覽解析度，改用影片畫格重拍');
              photoTrustedRef.current = false;
              shutterPathRef.current = '影片畫格';
              const id = track.getSettings().deviceId;
              if (id) untrustedPhotoDevices.add(id);
              canvas = null;
            }
          } catch (e) {
            console.warn('[camera] takePhoto 失敗，改用影片畫格：', e);
          }
        }

        if (!canvas) {
          /*
            保護 B：走影片畫格時，串流就是成品畫質。
            取景可能被壓到 previewLongSide，這裡要先把它拉回感光元件最大，
            而且要等畫格真的換過去（applyConstraints 比實際生效早 resolve）。
          */
          if (capsRef.current) {
            await applyTrackResolution(track, capsRef.current, false);
            await waitFrames(2);
          }
          const w = video.videoWidth;
          const h = video.videoHeight;
          if (!w || !h) throw new Error('相機畫面尚未就緒');
          const scale = Math.min(1, SCAN_CONFIG.maxSourceLongSide / Math.max(w, h));
          canvas = document.createElement('canvas');
          canvas.width = Math.round(w * scale);
          canvas.height = Math.round(h * scale);
          canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
        }

        onCaptureRef.current(canvas, live ? { points: live.points, vw: live.vw, vh: live.vh } : null);
      } catch (e) {
        console.error(e);
        onErrorRef.current('拍照失敗：' + cvErrorMessage(e));
        runningRef.current = true;
      } finally {
        capturingRef.current = false;
      }
    },
    // 回呼走 ref（見 onCaptureRef），這支因此是穩定的 —— step 與啟動 effect 才不會跟著重來
    [],
  );

  /* ── 即時偵測迴圈 ─────────────────────────────────────── */
  const step = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) {
      drawOverlay(null, 0, false);
      return;
    }
    if (!isCvReady()) {
      setStatus('影像引擎載入中，可先手動拍照');
      drawOverlay(null, 0, false);
      return;
    }

    const cv = getCv();
    const frameStart = performance.now();
    /*
      Math.min(1, …)：預覽解析度被壓低之後（見 applyTrackResolution），
      串流有可能比 detectLongSide 還小 —— 沒有夾值就會變成放大重採樣，
      白花時間又不會讓邊緣更清楚。
    */
    const scale = Math.min(1, SCAN_CONFIG.detectLongSide / Math.max(vw, vh));
    const w = Math.round(vw * scale);
    const h = Math.round(vh * scale);

    if (!frameCanvasRef.current) {
      frameCanvasRef.current = document.createElement('canvas');
    }
    const fc = frameCanvasRef.current;
    if (fc.width !== w || fc.height !== h) {
      fc.width = w;
      fc.height = h;
    }
    const fctx = fc.getContext('2d', { willReadFrequently: true });
    if (!fctx) return;
    const tDraw0 = performance.now();
    fctx.drawImage(video, 0, 0, w, h);
    const tDraw1 = performance.now();
    const imageData = fctx.getImageData(0, 0, w, h);
    const tRead1 = performance.now();

    // 重複使用同一個 Mat，不要每幀配置記憶體
    if (!frameMatRef.current || frameMatRef.current.cols !== w || frameMatRef.current.rows !== h) {
      frameMatRef.current?.delete();
      frameMatRef.current = new cv.Mat(h, w, cv.CV_8UC4);
    }
    frameMatRef.current.data.set(imageData.data);

    /*
      即時取景用快的那條（跳過色彩遮罩）。連續找不到紙張一陣子，
      才付一次完整偵測的成本 —— 木紋桌面就是靠這一下救回來的。
      模糊度也不在這裡算：它只在四角都合格、快要自動快門時才用得到。
    */
    const useFull = missesRef.current >= SCAN_CONFIG.fullDetectAfterMisses;
    const tDet0 = performance.now();
    const det = detectDocument(frameMatRef.current, { fast: !useFull });
    const tDet1 = performance.now();
    missesRef.current = det.points ? 0 : missesRef.current + 1;
    const pts = det.points ? det.points.map((p) => ({ x: p.x / scale, y: p.y / scale })) : null;
    const now = performance.now();
    if (pts) lastLiveRef.current = { points: pts, vw, vh, at: now };

    const diag = Math.hypot(vw, vh);
    const warmupEnd = startedAtRef.current + SCAN_CONFIG.warmupMs;

    let problem: string | null = null;
    if (!pts) {
      problem = '請將稿紙放入框內';
    } else {
      const g = quadGeometry(pts);
      const margin = Math.min(vw, vh) * SCAN_CONFIG.frameMarginRatio;
      const cutOff = pts.some((p) => p.x < margin || p.y < margin || p.x > vw - margin || p.y > vh - margin);
      if (g.area < vw * vh * SCAN_CONFIG.minCaptureAreaRatio) problem = '請靠近一點';
      else if (cutOff) problem = '請讓整張稿紙入鏡';
      else if (g.minAngle < 90 - SCAN_CONFIG.maxSkewDeg || g.maxAngle > 90 + SCAN_CONFIG.maxSkewDeg)
        problem = '請將手機與紙面平行';
      else if (det.edgeSupport != null && det.edgeSupport < SCAN_CONFIG.minEdgeSupport)
        problem = '四邊沒有對齊，請調整角度';
      // 其他條件都過了才問模糊度 —— 全圖 Laplacian 很貴，不值得每幀算
      else if (imageSharpness(frameMatRef.current) < SCAN_CONFIG.minSharpness)
        problem = '畫面模糊，請拿穩';
    }

    let progress = 0;
    let text: string;
    if (problem || !pts) {
      anchorRef.current = null;
      text = problem ?? '請將稿紙放入框內';
    } else {
      // 與「開始穩定時」的位置比較，避免緩慢漂移被誤判成穩定
      if (!anchorRef.current || maxDisplacement(anchorRef.current, pts) > SCAN_CONFIG.stableTolerance * diag) {
        anchorRef.current = pts;
        stableSinceRef.current = now;
      }
      const stableFor = now - Math.max(stableSinceRef.current, warmupEnd);
      progress = clamp(stableFor / SCAN_CONFIG.stableDurationMs, 0, 1);
      if (!autoRef.current) text = '對齊良好，請按快門';
      else if (now < warmupEnd) text = '對焦中…';
      else text = '對齊良好，保持不動…';
    }

    smoothRef.current = smoothPoints(smoothRef.current, pts);
    const tOvl0 = performance.now();
    drawOverlay(smoothRef.current, autoRef.current ? progress : 0, !problem);
    const tOvl1 = performance.now();
    setStatus(text);
    setAligned(!problem);

    timingsRef.current.push({
      draw: tDraw1 - tDraw0,
      read: tRead1 - tDraw1,
      detect: tDet1 - tDet0,
      overlay: tOvl1 - tOvl0,
      total: tOvl1 - frameStart,
      full: useFull,
      hit: Boolean(det.points),
      at: frameStart,
    });
    // 只有開著診斷時才付「算百分位 + setState」的成本，而且最多每 500ms 一次
    if (debugRef.current && tOvl1 - hudAtRef.current > 500) {
      hudAtRef.current = tOvl1;
      setHud({
        summary: timingsRef.current.summary(),
        stream: streamInfoRef.current,
        shutter: shutterPathRef.current,
        overlay: overlaySizeRef.current,
        dpr: window.devicePixelRatio || 1,
      });
    }

    if (autoRef.current && progress >= 1) void capture('auto');
  }, [capture, drawOverlay]);

  /* ── 啟動與收拾 ───────────────────────────────────────── */
  useEffect(() => {
    let cancelled = false;

    const tick = () => {
      if (!runningRef.current) return;
      const t0 = performance.now();
      try {
        step();
      } catch (e) {
        console.warn('[scanner]', cvErrorMessage(e));
      }
      if (!runningRef.current) return;
      const elapsed = performance.now() - t0;
      timerRef.current = window.setTimeout(tick, Math.max(30, SCAN_CONFIG.detectIntervalMs - elapsed));
    };

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        onErrorRef.current('此瀏覽器不支援相機存取');
        return;
      }
      // 使用者指定的優先；沒有就自動挑（避開虛擬鏡頭）
      const chosen = deviceId ?? (await preferredCamera());
      if (cancelled) return;
      const lens: MediaTrackConstraints = chosen
        ? { deviceId: { exact: chosen } }
        : { facingMode: { ideal: 'environment' } };
      /*
        取景要多大，看快門走哪條路：
        支援 ImageCapture 的瀏覽器按快門時用 takePhoto() 拿感光元件全解析度，
        串流只是拿來取景與偵測的，開 4K 只會讓每一幀的縮放與回讀變貴、
        框線跟不上手。不支援的（iOS Safari）從影片畫格擷取，串流就是畫質本身。
      */
      const hasImageCapture =
        SCAN_CONFIG.useTakePhoto &&
        typeof (window as unknown as { ImageCapture?: unknown }).ImageCapture === 'function';
      const base: MediaTrackConstraints = {
        width: { ideal: hasImageCapture ? SCAN_CONFIG.previewWidth : SCAN_CONFIG.idealWidth },
        height: { ideal: hasImageCapture ? SCAN_CONFIG.previewHeight : SCAN_CONFIG.idealHeight },
        frameRate: { ideal: 30 },
        ...lens,
      };
      const attempts: MediaTrackConstraints[] = [
        { ...base, advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] },
        base,
        lens,
      ];

      let stream: MediaStream | null = null;
      let lastError: unknown = null;
      for (const video of attempts) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: false, video });
          break;
        } catch (e) {
          lastError = e;
          const name = (e as { name?: string })?.name;
          if (name === 'NotAllowedError' || name === 'SecurityError') break;
        }
      }
      if (cancelled) {
        stream?.getTracks().forEach((t) => t.stop());
        return;
      }
      if (!stream) {
        onErrorRef.current(cameraErrorMessage(lastError));
        return;
      }

      const track = stream.getVideoTracks()[0];

      /*
        第一次開相機時還沒有權限、看不到鏡頭名稱，preferredCamera 只能交給瀏覽器挑。
        開起來之後名稱就看得到了：挑到虛擬鏡頭、又有實體鏡頭可用，就換過去。
        使用者自己指定的（按了切換）不動。
      */
      if (!deviceId && isVirtualCamera(track.label)) {
        const better = await preferredCamera();
        if (better && better !== track.getSettings().deviceId) {
          stream.getTracks().forEach((t) => t.stop());
          if (!cancelled) setDeviceId(better);
          return;
        }
      }

      streamRef.current = stream;
      trackRef.current = track;

      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        try {
          await video.play();
        } catch {
          /* autoplay 被擋時，loadedmetadata 之後仍會播放 */
        }
        await waitForVideo(video);
      }

      const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & {
        torch?: boolean;
        exposureCompensation?: { min: number; max: number };
      };

      /*
        取景要開多大，取決於按快門時拿得到什麼（見 applyTrackResolution）。
        先探測拍照管線可不可信，可信才把預覽壓小 —— 那是 Android 上
        即時對邊跟不上手的主因，但壓錯機器會毀掉存檔畫質。
      */
      const settingsDeviceId = track.getSettings().deviceId;
      const trusted =
        !(settingsDeviceId && untrustedPhotoDevices.has(settingsDeviceId)) &&
        (await photoPipelineTrusted(track));
      if (cancelled) return;
      photoTrustedRef.current = trusted;
      shutterPathRef.current = trusted ? 'takePhoto' : '影片畫格';
      capsRef.current = caps;
      await applyTrackResolution(track, caps, trusted);
      if (cancelled) return;
      // 整片白紙會讓自動曝光過亮、字跡變淡
      if (caps.exposureCompensation) {
        try {
          await track.applyConstraints({
            advanced: [
              {
                exposureCompensation: clamp(
                  SCAN_CONFIG.exposureCompensation,
                  caps.exposureCompensation.min,
                  caps.exposureCompensation.max,
                ),
              } as MediaTrackConstraintSet,
            ],
          });
        } catch {
          /* 不支援就算了 */
        }
      }
      setHasTorch(Boolean(caps.torch));

      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        setLenses(devices.filter((d) => d.kind === 'videoinput'));
      } catch {
        setLenses([]);
      }
      setActiveDeviceId(track.getSettings().deviceId);

      const s = track.getSettings();
      setInfo(`${s.width ?? '?'}×${s.height ?? '?'}`);
      streamInfoRef.current =
        `${s.width ?? '?'}×${s.height ?? '?'}@${s.frameRate ? Math.round(s.frameRate) : '?'}`;
      timingsRef.current.clear();

      startedAtRef.current = performance.now();
      stableSinceRef.current = startedAtRef.current;
      runningRef.current = true;
      tick();
    };

    void start();

    return () => {
      cancelled = true;
      runningRef.current = false;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      trackRef.current = null;
      // WebAssembly 的記憶體不會自己回收
      frameMatRef.current?.delete();
      frameMatRef.current = null;
    };
    // 只有換鏡頭才重開相機。step 是穩定的（見 onCaptureRef）
  }, [step, deviceId]);

  // 切到背景就停止偵測，回來再繼續（手機上這是很明顯的耗電來源）
  useEffect(() => {
    const onVisibility = () => {
      runningRef.current = !document.hidden && Boolean(trackRef.current);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const toggleTorch = async () => {
    const track = trackRef.current;
    if (!track) return;
    const want = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: want } as MediaTrackConstraintSet] });
      setTorchOn(want);
    } catch {
      onError('此鏡頭不支援閃光燈');
    }
  };

  return (
    <div className="absolute inset-0 bg-black">
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className="absolute inset-0 w-full h-full object-cover"
      />
      <canvas ref={overlayRef} className="absolute inset-0 w-full h-full" />

      {/* 狀態列 */}
      <div className="absolute top-0 inset-x-0 flex items-start justify-between gap-3 p-3 sm:p-4">
        <button
          id="scanner-btn-close-camera"
          onClick={onClose}
          title="關閉相機"
          className="tap-target w-10 h-10 shrink-0 rounded-full bg-black/50 text-white flex items-center justify-center backdrop-blur-sm"
        >
          <X size={18} />
        </button>
        <div
          className={`px-3 py-1.5 rounded-full text-caption backdrop-blur-sm whitespace-nowrap ${
            aligned ? 'bg-success-600 text-on-solid' : 'bg-black/55 text-white'
          }`}
        >
          {status}
        </div>
        {/*
          頁數優先；解析度留在 title 裡，除錯時用得到。
          長按 800ms 切換效能診斷 —— 現場遇到「這支手機特別慢」時，
          不必重打網址就能把數字叫出來（另一條是 ?scandebug=1）。
        */}
        <div
          id="scanner-camera-pagecount"
          title={info}
          onPointerDown={startDebugPress}
          onPointerUp={cancelDebugPress}
          onPointerLeave={cancelDebugPress}
          onPointerCancel={cancelDebugPress}
          onContextMenu={(e) => e.preventDefault()}
          className="px-2 py-1.5 rounded-full bg-black/40 text-white text-caption tabular-nums whitespace-nowrap select-none"
        >
          {pageCount > 0 ? `已掃 ${pageCount} 頁` : info}
        </div>
      </div>

      {/*
        控制列。底部多留 iPhone 的安全區（home indicator 那一條），
        不留的話快門會壓在橫線上，按下去常常變成滑回主畫面。
      */}
      <div className="absolute bottom-0 inset-x-0 flex items-center justify-center gap-5 sm:gap-8 p-5 sm:p-6 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
        <button
          id="scanner-btn-torch"
          onClick={toggleTorch}
          disabled={!hasTorch}
          title={hasTorch ? '閃光燈' : '此鏡頭不支援閃光燈'}
          className={`tap-target w-11 h-11 rounded-full flex items-center justify-center backdrop-blur-sm transition-colors ${
            torchOn ? 'bg-warning-500 text-on-solid' : 'bg-black/50 text-white'
          } disabled:opacity-35`}
        >
          <Flashlight size={18} />
        </button>

        <button
          id="scanner-btn-shutter"
          onClick={() => void capture('manual')}
          title="拍照"
          className="w-16 h-16 rounded-full bg-white/95 border-4 border-white/60 shadow-lg active:scale-95 transition-transform"
        />

        <button
          id="scanner-btn-auto"
          onClick={onToggleAuto}
          title="對齊良好並保持穩定約 1 秒後自動拍攝"
          className={`tap-target px-3 h-11 rounded-full text-caption whitespace-nowrap backdrop-blur-sm transition-colors ${
            autoCapture ? 'bg-primary text-on-accent' : 'bg-black/50 text-white'
          }`}
        >
          自動 {autoCapture ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* 效能診斷。只有 ?scandebug=1 或長按解析度標籤才會出現 */}
      {debug && hud && (
        <ScanDebugHud
          summary={hud.summary}
          stream={hud.stream}
          shutter={hud.shutter}
          dpr={hud.dpr}
          overlay={hud.overlay}
        />
      )}

      {/*
        控制列上方的兩個小標。排成一欄而不是各自 absolute ——
        原本「稿紙請橫持拍攝」置中、「切換鏡頭」靠右，都在 bottom-24，
        手機寬度（390px）兩者直接疊在一起，鏡頭名稱被蓋掉一半。
      */}
      <div className="absolute inset-x-3 bottom-24 flex flex-col items-center gap-2 pointer-events-none">
        {/* 橫持提示：A3 稿紙橫拍才有足夠解析度 */}
        <span className="sm:hidden inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/55 text-white text-caption whitespace-nowrap">
          <Camera size={12} />
          稿紙請橫持拍攝
        </span>
        {/*
          切換鏡頭。以前只寫「偵測到 N 顆鏡頭」，挑錯了（例如筆電的虛擬鏡頭）也換不了。
          寫出目前這顆的名稱，老師看得出是不是開錯了。
        */}
        {lenses.length > 1 && (
          <button
            id="scanner-btn-switch-lens"
            onClick={() => {
              const i = lenses.findIndex((l) => l.deviceId === activeDeviceId);
              setDeviceId(lenses[(i + 1) % lenses.length].deviceId);
            }}
            title="切換鏡頭"
            className="pointer-events-auto self-center sm:self-end max-w-full inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/55 text-white text-caption backdrop-blur-sm"
          >
            <RefreshCw size={12} className="shrink-0" />
            <span className="truncate">
              切換鏡頭（{lenses.find((l) => l.deviceId === activeDeviceId)?.label || `共 ${lenses.length} 顆`}）
            </span>
          </button>
        )}
      </div>
    </div>
  );
};
