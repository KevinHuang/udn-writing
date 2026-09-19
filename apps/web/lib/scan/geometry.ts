/**
 * 掃描用的純幾何計算。
 *
 * 這一支完全不碰 OpenCV 也不碰 DOM，可以直接在 console 驗證 ——
 * 四邊形的判斷是整個偵測流程最容易出錯的地方，要能單獨測。
 */

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
