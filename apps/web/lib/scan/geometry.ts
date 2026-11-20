/**
 * 掃描用的純幾何計算。
 *
 * 這一支完全不碰 OpenCV 也不碰 DOM，可以直接在 console 驗證 ——
 * 四邊形的判斷是整個偵測流程最容易出錯的地方，要能單獨測。
 */

import { SCAN_CONFIG } from './config';

export interface Point {
  x: number;
  y: number;
}

export const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v));

export const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * 依角度排序成順時針，並從左上角（x + y 最小）開始：TL, TR, BR, BL。
 *
 * 四個角的順序固定下來，後面的透視變換才不會把紙張轉 90° 或鏡射。
 */
export function orderClockwise(pts: Point[]): Point[] {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const sorted = pts
    .slice()
    .sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  let start = 0;
  let min = Infinity;
  sorted.forEach((p, i) => {
    if (p.x + p.y < min) {
      min = p.x + p.y;
      start = i;
    }
  });
  return sorted.slice(start).concat(sorted.slice(0, start));
}

export interface QuadGeometry {
  area: number;
  /** 是不是凸四邊形。凹的通常是桌面紋路湊出來的假框 */
  convex: boolean;
  minAngle: number;
  maxAngle: number;
  /** 長邊 ÷ 短邊 */
  ratio: number;
}

export function quadGeometry(o: Point[]): QuadGeometry {
  let area = 0;
  let sign = 0;
  let convex = true;
  let minAngle = 180;
  let maxAngle = 0;

  for (let i = 0; i < 4; i++) {
    const p0 = o[(i + 3) % 4];
    const p1 = o[i];
    const p2 = o[(i + 1) % 4];
    area += p1.x * p2.y - p2.x * p1.y;

    const cross = (p1.x - p0.x) * (p2.y - p1.y) - (p1.y - p0.y) * (p2.x - p1.x);
    const s = Math.sign(cross);
    if (s === 0) convex = false;
    else if (sign === 0) sign = s;
    else if (s !== sign) convex = false;

    const v1x = p0.x - p1.x;
    const v1y = p0.y - p1.y;
    const v2x = p2.x - p1.x;
    const v2y = p2.y - p1.y;
    const denom = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y) || 1;
    const angle =
      (Math.acos(clamp((v1x * v2x + v1y * v2y) / denom, -1, 1)) * 180) / Math.PI;
    minAngle = Math.min(minAngle, angle);
    maxAngle = Math.max(maxAngle, angle);
  }

  const sides = [0, 1, 2, 3].map((i) => dist(o[i], o[(i + 1) % 4]));
  const a = (sides[0] + sides[2]) / 2;
  const b = (sides[1] + sides[3]) / 2;

  return {
    area: Math.abs(area) / 2,
    convex,
    minAngle,
    maxAngle,
    ratio: Math.max(a, b) / Math.max(1e-6, Math.min(a, b)),
  };
}

/** 兩組四角之間位移最大的那一個角移動了多少 */
export function maxDisplacement(a: Point[], b: Point[]): number {
  let m = 0;
  for (let i = 0; i < 4; i++) m = Math.max(m, dist(a[i], b[i]));
  return m;
}

/**
 * 畫面上的框線平滑：新舊位置各取六四分。
 * 不平滑的話偵測結果每幀都在抖，看起來像壞掉。
 */
export function smoothPoints(prev: Point[] | null, pts: Point[] | null): Point[] | null {
  if (!pts) return null;
  if (!prev) return pts.map((p) => ({ ...p }));
  return pts.map((p, i) => ({
    x: prev[i].x * 0.4 + p.x * 0.6,
    y: prev[i].y * 0.4 + p.y * 0.6,
  }));
}

/**
 * 透視校正後的成品尺寸（寬、高，單位 px）。
 *
 * **保留紙張拍到的方向**：量到的寬比高大就輸出橫的，否則輸出直的。
 * 以前 warpDocument 一律把長邊擺水平，直式稿紙拍完就躺著，學生得自己按旋轉鍵。
 * 校園版（1Campus Write）曾經反過來對國文「拍到直的就轉成橫的」，上線後
 * 手機轉錯邊或拍直式紙時照片被存成轉 90° 或上下顛倒，中文直書辨識大量失敗，
 * 最後撤回成這裡的做法：**不猜方向**，方向不對由使用者在結果頁轉正。
 *
 * 長寬比接近 A3／B4（1.414）就直接採用標準比例，避免每張掃出來都差一點；
 * 長邊取「量到的長邊 × 1.2」，夾在 1000 與 outputLongSide 之間。
 * 橫的紙算出來的尺寸和以前完全一樣。
 */
export function warpTargetSize(
  measuredWidth: number,
  measuredHeight: number,
): { width: number; height: number } {
  const landscape = measuredWidth >= measuredHeight;
  const long = Math.max(measuredWidth, measuredHeight);
  const short = Math.max(1, Math.min(measuredWidth, measuredHeight));
  let ratio = long / short;
  if (Math.abs(ratio - SCAN_CONFIG.paperRatio) / SCAN_CONFIG.paperRatio < SCAN_CONFIG.snapTolerance) {
    ratio = SCAN_CONFIG.paperRatio;
  }
  const longSide = Math.round(clamp(long * 1.2, 1000, SCAN_CONFIG.outputLongSide));
  const shortSide = Math.round(longSide / ratio);
  return landscape
    ? { width: longSide, height: shortSide }
    : { width: shortSide, height: longSide };
}

export interface GuideRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 稿紙的方向：決定對齊框是橫框還是直框（見 lib/scan/paperOrientation.ts） */
export type PaperOrientation = 'landscape' | 'portrait';

/**
 * 相機影像在畫面上實際佔的範圍（畫面座標）：把整張影像**完整**縮進可用的區域（object-fit: contain）。
 *
 * 可用的區域是整個畫面扣掉快門那一排：直的畫面扣掉下方 `reserve`、橫的畫面扣掉右側 `reserve`。
 * 還不知道影像尺寸（相機還在啟動）時，就當影像填滿可用區域。
 *
 * ⚠️ 不要改回 object-fit: cover。cover 會把影像左右（或上下）裁掉：iPhone 直拿時只看得到
 *    相機畫面中間約六成寬。自動拍照的條件（紙至少佔畫面 30%、四角離邊緣 2%）看的是**整個相機畫面**，
 *    使用者把稿紙對準螢幕上的框，實際只佔相機畫面一成多，系統一直說「請靠近一點」；
 *    要靠到稿紙幾乎碰到螢幕外、看不見的相機邊緣才拍得到（2026-11-20 使用者手機實測）。
 *    完整顯示之後，畫面上看到的邊就是相機的邊。
 */
export function videoRect(
  vw: number,
  vh: number,
  cw: number,
  ch: number,
  reserve = 100,
): GuideRect {
  const availW = cw >= ch ? cw - reserve : cw;
  const availH = cw >= ch ? ch : ch - reserve;
  if (!vw || !vh) return { x: 0, y: 0, w: availW, h: availH };
  const s = Math.min(availW / vw, availH / vh);
  const w = vw * s;
  const h = vh * s;
  return { x: (availW - w) / 2, y: (availH - h) / 2, w, h };
}

/**
 * 相機影像上的對齊框（畫面座標，A3／B4 比例），畫在 videoRect 裡面。
 *
 * - **形狀跟著稿紙，不跟著手機**：橫式稿紙一律給橫框，手機直拿也一樣。以前跟著手機方向，
 *   直拿時是大直框，橫式稿紙放進去只佔中間一條，等於逼使用者把手機轉橫（2026-11-20 使用者回報）。
 * - **大小是相機影像的 `fill`（預設 SCAN_CONFIG.guideFill）**：稿紙填滿這個框，就一定過得了
 *   自動拍照的門檻（test/scanGeometry.test.tsx 對四種「手機方向 × 稿紙方向」都有釘住）。
 *   框是使用者唯一的參考，它和真正的條件對不上，使用者就只能亂猜要多靠近。
 */
export function guideRect(
  frame: GuideRect,
  paper: PaperOrientation,
  ratio: number = SCAN_CONFIG.paperRatio,
  fill: number = SCAN_CONFIG.guideFill,
): GuideRect {
  const long = paper === 'landscape' ? frame.w : frame.h;
  const short = paper === 'landscape' ? frame.h : frame.w;
  const longSide = Math.min(long, short * ratio) * fill;
  const shortSide = longSide / ratio;
  const w = paper === 'landscape' ? longSide : shortSide;
  const h = paper === 'landscape' ? shortSide : longSide;
  return { x: frame.x + (frame.w - w) / 2, y: frame.y + (frame.h - h) / 2, w, h };
}

/**
 * 「上方」小標的位置：貼在對齊框上緣的**外面**（不擋框線、不佔框內空間）；
 * 框上面的空間不夠放時，才改放到框內左上角。
 *
 * `minTop`：畫面頂端被別的東西佔住的高度（直的畫面頂端有關閉鈕與對齊狀態那一條）。
 * 小標不能放進那裡 —— 以前只看 0，iPhone 直拿時「上方」被「請靠近一點」蓋掉一半。
 * @returns 標籤左上角座標，以及是否放在框內
 */
export function topLabelPosition(
  g: GuideRect,
  label: { w: number; h: number },
  gap = 4,
  minTop = 0,
): { x: number; y: number; inside: boolean } {
  const x = g.x + (g.w - label.w) / 2;
  if (g.y - gap - label.h >= minTop) return { x, y: g.y - gap - label.h, inside: false };
  return { x: g.x + gap * 2, y: g.y + gap * 2, inside: true };
}

/** 偵測不到紙張時，先給一個內縮 10% 的方框讓使用者自己拖 */
export function defaultCorners(width: number, height: number): Point[] {
  const mx = width * 0.1;
  const my = height * 0.1;
  return [
    { x: mx, y: my },
    { x: width - mx, y: my },
    { x: width - mx, y: height - my },
    { x: mx, y: height - my },
  ];
}
