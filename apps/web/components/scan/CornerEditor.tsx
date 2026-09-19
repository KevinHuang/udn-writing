import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, RefreshCw, RotateCcw } from 'lucide-react';
import { SCAN_CONFIG } from '../../lib/scan/config';
import { clamp, defaultCorners, type Point } from '../../lib/scan/geometry';

interface CornerEditorProps {
  /** 拍到的原始影像 */
  source: HTMLCanvasElement;
  /** 自動偵測到的四角。null 代表沒偵測到，給一個內縮的預設框讓使用者自己拖 */
  detected: Point[] | null;
  onRetake: () => void;
  /** 重新偵測，由上層負責跑（它才有 OpenCV 的載入狀態） */
  onRedetect: () => Point[] | null;
  onConfirm: (points: Point[]) => void;
}

interface View {
  scale: number;
  offX: number;
  offY: number;
}

/**
 * 四角微調。
 *
 * 自動偵測失手時的唯一退路，所以一定要好拖：手指會擋住角落，
 * 拖曳時右上（或左上）會出現放大鏡顯示原圖細節。
 */
export const CornerEditor: React.FC<CornerEditorProps> = ({
  source,
  detected,
  onRetake,
  onRedetect,
  onConfirm,
}) => {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loupeRef = useRef<HTMLCanvasElement>(null);

  const [points, setPoints] = useState<Point[]>(
    () => detected?.map((p) => ({ ...p })) ?? defaultCorners(source.width, source.height),
  );
  const [view, setView] = useState<View>({ scale: 1, offX: 0, offY: 0 });
  const [found, setFound] = useState(Boolean(detected));
  const [dragIndex, setDragIndex] = useState(-1);
  /** 舞台寬度。放大鏡要靠哪一邊得看它，但 render 階段不能讀 ref */
  const [stageWidth, setStageWidth] = useState(0);
  const grabRef = useRef<Point>({ x: 0, y: 0 });

  /* 把原圖畫進 canvas（縮小到預覽尺寸就夠，手機重繪大畫布會卡） */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scale = Math.min(
      1,
      SCAN_CONFIG.editorPreviewLongSide / Math.max(source.width, source.height),
    );
    canvas.width = Math.round(source.width * scale);
    canvas.height = Math.round(source.height * scale);
    canvas.getContext('2d')?.drawImage(source, 0, 0, canvas.width, canvas.height);
  }, [source]);

  /* 依舞台大小算出縮放與置中位移 */
  const layout = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const sw = stage.clientWidth;
    const sh = stage.clientHeight;
    if (!sw || !sh) return;
    setStageWidth(sw);
    const pad = 26;
    const scale = Math.min((sw - pad * 2) / source.width, (sh - pad * 2) / source.height);
    setView({
      scale,
      offX: (sw - source.width * scale) / 2,
      offY: (sh - source.height * scale) / 2,
    });
  }, [source]);

  useEffect(() => {
    layout();
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', layout);
      return () => window.removeEventListener('resize', layout);
    }
    const ro = new ResizeObserver(layout);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [layout]);

  const toScreen = (p: Point): Point => ({
    x: view.offX + p.x * view.scale,
    y: view.offY + p.y * view.scale,
  });

  /* 放大鏡：手指擋住角落時看不到自己在對什麼 */
  const drawLoupe = useCallback(
    (index: number, pts: Point[]) => {
      const loupe = loupeRef.current;
      if (!loupe || index < 0) return;
      const p = pts[index];
      const size = loupe.width;
      const region = size / (SCAN_CONFIG.loupeZoom * view.scale);
      const ctx = loupe.getContext('2d');
      if (!ctx) return;

      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, size, size);

      // 手動裁切來源範圍：Safari 對超出邊界的 drawImage 來源矩形處理不一致
      const sx0 = p.x - region / 2;
      const sy0 = p.y - region / 2;
      const cx0 = Math.max(0, sx0);
      const cy0 = Math.max(0, sy0);
      const cx1 = Math.min(source.width, sx0 + region);
      const cy1 = Math.min(source.height, sy0 + region);
      if (cx1 > cx0 && cy1 > cy0) {
        const k = size / region;
        ctx.drawImage(
          source,
          cx0,
          cy0,
          cx1 - cx0,
          cy1 - cy0,
          (cx0 - sx0) * k,
          (cy0 - sy0) * k,
          (cx1 - cx0) * k,
          (cy1 - cy0) * k,
        );
      }
      ctx.strokeStyle = '#9E3D32';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(size / 2, 0);
      ctx.lineTo(size / 2, size);
      ctx.moveTo(0, size / 2);
      ctx.lineTo(size, size / 2);
      ctx.stroke();
    },
    [source, view.scale],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>, index: number) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sp = toScreen(points[index]);
    grabRef.current = { x: e.clientX - rect.left - sp.x, y: e.clientY - rect.top - sp.y };
    setDragIndex(index);
    drawLoupe(index, points);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (dragIndex < 0) return;
    e.preventDefault();
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX - rect.left - grabRef.current.x;
    const sy = e.clientY - rect.top - grabRef.current.y;
    const next = points.slice();
    next[dragIndex] = {
      x: clamp((sx - view.offX) / view.scale, 0, source.width),
      y: clamp((sy - view.offY) / view.scale, 0, source.height),
    };
    setPoints(next);
    drawLoupe(dragIndex, next);
  };

  const endDrag = () => setDragIndex(-1);

  const redetect = () => {
    const pts = onRedetect();
    if (pts) {
      setPoints(pts.map((p) => ({ ...p })));
      setFound(true);
    } else {
      setFound(false);
    }
  };

  const screenPoints = points.map(toScreen);
  const loupeOnRight = dragIndex >= 0 && screenPoints[dragIndex].x < stageWidth / 2;

  return (
    <div className="absolute inset-0 bg-black flex flex-col">
      <div className="shrink-0 px-4 py-3">
        <p
          className={`text-caption text-center ${found ? 'text-success-300' : 'text-warning-300'}`}
        >
          {found ? '已自動框出稿紙，可拖曳四角微調' : '沒有偵測到稿紙，請拖曳四角對準紙張邊緣'}
        </p>
      </div>

      <div ref={stageRef} className="relative flex-1 min-h-0 touch-none">
        <canvas
          ref={canvasRef}
          className="absolute"
          style={{
            width: source.width * view.scale,
            height: source.height * view.scale,
            left: view.offX,
            top: view.offY,
          }}
        />
        <svg className="absolute inset-0 w-full h-full pointer-events-none">
          <polygon
            points={screenPoints.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="rgba(126,157,191,.18)"
            stroke="#7E9DBF"
            strokeWidth={2}
          />
        </svg>

        {points.map((_, i) => (
          <button
            key={i}
            id={`scanner-corner-${i}`}
            aria-label={`第 ${i + 1} 個角`}
            onPointerDown={(e) => onPointerDown(e, i)}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            className={`absolute w-11 h-11 -ml-[22px] -mt-[22px] rounded-full border-2 transition-colors ${
              dragIndex === i
                ? 'bg-primary/40 border-primary'
                : 'bg-white/20 border-white/80'
            }`}
            style={{ left: screenPoints[i].x, top: screenPoints[i].y }}
          >
            <span className="block w-2.5 h-2.5 rounded-full bg-white mx-auto" />
          </button>
        ))}

        <canvas
          ref={loupeRef}
          width={128}
          height={128}
          hidden={dragIndex < 0}
          className={`absolute top-3 w-32 h-32 rounded-xl border-2 border-white/70 shadow-lg pointer-events-none ${
            loupeOnRight ? 'right-3' : 'left-3'
          }`}
        />
      </div>

      <div className="shrink-0 flex items-center justify-center gap-2 p-4">
        <button
          id="scanner-btn-retake"
          onClick={onRetake}
          className="tap-target inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-white/12 text-white text-body whitespace-nowrap"
        >
          <RotateCcw size={15} />
          重拍
        </button>
        <button
          id="scanner-btn-redetect"
          onClick={redetect}
          className="tap-target inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-white/12 text-white text-body whitespace-nowrap"
        >
          <RefreshCw size={15} />
          重新偵測
        </button>
        <button
          id="scanner-btn-confirm-corners"
          onClick={() => onConfirm(points)}
          className="tap-target inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-primary text-on-accent text-body whitespace-nowrap"
        >
          <Check size={15} />
          確認校正
        </button>
      </div>
    </div>
  );
};
