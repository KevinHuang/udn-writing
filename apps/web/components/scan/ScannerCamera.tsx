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
        const ImageCaptureCtor = (
          window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => { takePhoto(): Promise<Blob> } }
        ).ImageCapture;
        if (SCAN_CONFIG.useTakePhoto && ImageCaptureCtor) {
          try {
            const ic = new ImageCaptureCtor(track);
            const blob = await withTimeout(ic.takePhoto(), SCAN_CONFIG.takePhotoTimeoutMs);
            const { blobToCanvas } = await import('../../lib/scan/image');
            canvas = await blobToCanvas(blob, SCAN_CONFIG.maxSourceLongSide);
          } catch (e) {
            console.warn('[camera] takePhoto 失敗，改用影片畫格：', e);
          }
        }

        if (!canvas) {
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
    const scale = SCAN_CONFIG.detectLongSide / Math.max(vw, vh);
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
    fctx.drawImage(video, 0, 0, w, h);
    const imageData = fctx.getImageData(0, 0, w, h);

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
    const det = detectDocument(frameMatRef.current, { fast: !useFull });
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
    drawOverlay(smoothRef.current, autoRef.current ? progress : 0, !problem);
    setStatus(text);
    setAligned(!problem);

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

      // 有些裝置會忽略 getUserMedia 的 ideal 值，取得能力之後再要求一次最高畫質
      if (caps.width?.max && caps.height?.max) {
        try {
          await track.applyConstraints({
            width: { ideal: caps.width.max },
            height: { ideal: caps.height.max },
          });
        } catch {
          /* 套不上就沿用原本的 */
        }
      }
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
        {/* 頁數優先；解析度留在 title 裡，除錯時用得到 */}
        <div
          id="scanner-camera-pagecount"
          title={info}
          className="px-2 py-1.5 rounded-full bg-black/40 text-white text-caption tabular-nums whitespace-nowrap"
        >
          {pageCount > 0 ? `已掃 ${pageCount} 頁` : info}
        </div>
      </div>

      {/* 控制列 */}
      <div className="absolute bottom-0 inset-x-0 flex items-center justify-center gap-5 sm:gap-8 p-5 sm:p-6">
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
          className="absolute right-3 bottom-24 max-w-[60%] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/55 text-white text-caption backdrop-blur-sm"
        >
          <RefreshCw size={12} className="shrink-0" />
          <span className="truncate">
            切換鏡頭（{lenses.find((l) => l.deviceId === activeDeviceId)?.label || `共 ${lenses.length} 顆`}）
          </span>
        </button>
      )}

      {/* 橫持提示：A3 稿紙橫拍才有足夠解析度 */}
      <div className="absolute left-1/2 -translate-x-1/2 bottom-24 sm:hidden pointer-events-none">
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/55 text-white text-caption whitespace-nowrap">
          <Camera size={12} />
          稿紙請橫持拍攝
        </span>
      </div>
    </div>
  );
};
