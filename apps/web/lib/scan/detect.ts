/**
 * 從照片裡找出「紙張的四個角」。
 *
 * 移植自獨立的掃描器原型。整個掃描流程最難的就是這一段：
 * 桌面有木紋、光線不均、紙張顏色和桌子接近時，單一方法都會失手，
 * 所以這裡同時跑三條路徑再評分挑最好的那一個。
 *
 * 所有 Mat 都必須手動釋放，一律走 withMats()（見 lib/scan/opencv.ts）。
 */

import { SCAN_CONFIG } from './config';
import { getCv, withMats, type Mat } from './opencv';
import { orderClockwise, quadGeometry, type Point } from './geometry';
import { scaleCanvas } from './image';

export interface Detection {
  /** 找到的四角（順時針、左上先）。找不到就是 null */
  points: Point[] | null;
  /** 四條邊之中最差的一條，有多少比例真的貼在影像邊緣上（0~1） */
  edgeSupport: number | null;
  /** Laplacian 變異數。越小越模糊 */
  sharpness: number | null;
}

interface QuadCandidate {
  points: Point[];
  area: number;
}

/**
 * @param rgba 已經縮小過的 RGBA 影像
 * @param opts.sharpness 是否一併算模糊度。即時取景時不要開 ——
 *   它只在四角都合格、快要自動快門時才用得到，每幀都算是白花的
 * @param opts.fast 跳過最貴的色彩遮罩路徑（見 findDocumentQuad）。
 *   即時取景用，一般桌面效果相同
 */
export function detectDocument(
  rgba: Mat,
  opts: { sharpness?: boolean; fast?: boolean } = {},
): Detection {
  const cv = getCv();
  const gray = new cv.Mat();
  try {
    cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
    const sharpness = opts.sharpness ? laplacianVariance(gray) : null;
    const best = findDocumentQuad(rgba, gray, opts.fast === true);
    return {
      points: best ? best.points : null,
      edgeSupport: best ? best.edgeSupport : null,
      sharpness,
    };
  } finally {
    gray.delete();
  }
}

/**
 * 三條路徑各自找出合理的四邊形候選，再以「框內比框外亮多少 × 面積」評分：
 *
 *   A. Canny 邊緣 —— 一般情況
 *   B. 白紙色彩遮罩（高亮度、低飽和度）—— 木紋等花紋桌面比 Canny 穩定
 *   C. 強模糊 ＋ 低門檻 Canny —— 白紙放在淺色桌面、邊緣對比很弱時
 *
 * `fast` 會跳過 B。B 是三條裡最貴的（RGBA→RGB→HSV 兩次色彩空間轉換、
 * 拆三個通道、Otsu、兩次 7×7 形態學），而它要救的是木紋桌面這種特定情況。
 * 即時取景每秒跑好幾次，付不起；手機上框線會明顯跟不上手。
 * 連續找不到紙張時，呼叫端會改用完整三條再試一次（見 ScannerCamera）。
 *
 * **B 跳過、C 不跳過**是有原因的：邊緣支持度的參考圖是強、弱兩種 Canny 的
 * 聯集，C 不跑的話 support 會變稀疏，edgeSupport 整個下修，
 * `minEdgeSupport` 這個門檻就得跟著改 —— 兩套門檻遲早會對不起來。
 */
function findDocumentQuad(
  rgba: Mat,
  gray: Mat,
  fast: boolean,
): (QuadCandidate & { contrast: number; edgeSupport: number; score: number }) | null {
  const cv = getCv();
  const frameArea = gray.cols * gray.rows;
  const candidates: QuadCandidate[] = [];
  let best: (QuadCandidate & { contrast: number; edgeSupport: number; score: number }) | null = null;

  withMats((track) => {
    // A. Canny
    const blur = track(new cv.Mat());
    const edges = track(new cv.Mat());
    const k5 = track(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5)));
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
    cv.Canny(blur, edges, 40, 120);
    cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, k5, new cv.Point(-1, -1), 2);
    /*
      RETR_LIST：紙張邊緣與桌面紋路相連時，外側輪廓不會是四邊形，
      但那條邊緣帶的「內側輪廓」仍然是紙張本身。
    */
    collectQuads(edges, frameArea, cv.RETR_LIST, candidates);

    // B. 白紙色彩遮罩（fast 時跳過，見上面的說明）
    if (!fast) {
      const rgb = track(new cv.Mat());
      const hsv = track(new cv.Mat());
      const planes = track(new cv.MatVector());
      const sMask = track(new cv.Mat());
      const vMask = track(new cv.Mat());
      const mask = track(new cv.Mat());
      const k7 = track(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(7, 7)));
      cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB);
      cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
      cv.split(hsv, planes);
      const s = track(planes.get(1));
      const v = track(planes.get(2));
      cv.threshold(s, sMask, 70, 255, cv.THRESH_BINARY_INV);
      /*
        亮度門檻取 Otsu 值的 55%：陰影下的紙張仍然保留（它的飽和度低），
        高飽和度的桌面已經被 sMask 排除掉了。
      */
      const otsu = cv.threshold(v, vMask, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
      cv.threshold(v, vMask, Math.max(50, otsu * 0.55), 255, cv.THRESH_BINARY);
      cv.bitwise_and(sMask, vMask, mask);
      cv.morphologyEx(mask, mask, cv.MORPH_OPEN, k7);
      cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, k7, new cv.Point(-1, -1), 2);
      collectQuads(mask, frameArea, cv.RETR_EXTERNAL, candidates);
    }

    // C. 弱邊緣
    const blur9 = track(new cv.Mat());
    const edgesWeak = track(new cv.Mat());
    cv.GaussianBlur(gray, blur9, new cv.Size(9, 9), 0);
    cv.Canny(blur9, edgesWeak, 12, 36);
    cv.morphologyEx(edgesWeak, edgesWeak, cv.MORPH_CLOSE, k5, new cv.Point(-1, -1), 2);
    collectQuads(edgesWeak, frameArea, cv.RETR_LIST, candidates);

    // 邊緣支持度的參考圖：強、弱兩種 Canny 取聯集後膨脹，容許 ±2px 誤差
    const support = track(new cv.Mat());
    cv.bitwise_or(edges, edgesWeak, support);
    cv.dilate(support, support, k5);

    // 只評估面積最大的幾個，控制即時偵測的運算量
    candidates.sort((a, b) => b.area - a.area);
    for (const cand of candidates.slice(0, 8)) {
      const contrast = quadContrast(gray, cand.points, cand.area / frameArea);
      if (contrast < SCAN_CONFIG.minContrast) continue;
      // 四條邊都要真的貼在邊緣上，才不會把畫面邊界或桌面紋路湊成的假四邊形當成紙張
      const edgeSupport = quadEdgeSupport(support, cand.points);
      const score = Math.sqrt(cand.area / frameArea) * contrast * (0.5 + edgeSupport);
      if (!best || score > best.score) {
        best = { ...cand, contrast, edgeSupport, score };
      }
    }
  });

  return best;
}

/**
 * 四邊形的「邊緣支持度」：沿每條邊取樣，檢查該點是否落在真實邊緣上，
 * 回傳四條邊之中**最差**那一條的貼合比例。
 * 只有上緣對齊、其餘三邊是假的時候，最差的那條會很低。
 */
function quadEdgeSupport(edges: Mat, points: Point[]): number {
  const cols = edges.cols;
  const rows = edges.rows;
  const data = edges.data;
  let worst = 1;

  for (let i = 0; i < 4; i++) {
    const a = points[i];
    const b = points[(i + 1) % 4];
    let hit = 0;
    let total = 0;
    for (let s = 0; s <= SCAN_CONFIG.edgeSamples; s++) {
      // 跳過端點附近 8%，避開角點本身造成的誤判
      const t = 0.08 + (0.84 * s) / SCAN_CONFIG.edgeSamples;
      const x = Math.round(a.x + (b.x - a.x) * t);
      const y = Math.round(a.y + (b.y - a.y) * t);
      total++;
      // 超出畫面的取樣點算未貼合：紙張有一邊跑出鏡頭時，支持度會明顯偏低
      if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
      if (data[y * cols + x]) hit++;
    }
    worst = Math.min(worst, total ? hit / total : 0);
  }
  return worst;
}

/** 從二值影像的輪廓中找出所有「形狀像紙張」的四邊形 */
function collectQuads(
  binary: Mat,
  frameArea: number,
  retrieval: number,
  out: QuadCandidate[],
): void {
  const cv = getCv();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  try {
    cv.findContours(binary, contours, hierarchy, retrieval, cv.CHAIN_APPROX_SIMPLE);
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      try {
        const area = cv.contourArea(cnt);
        if (area < frameArea * SCAN_CONFIG.minDocAreaRatio) continue;

        let pts = approxQuad(cnt);
        if (!pts) {
          // 紙角折到、被手指遮住時，凸包通常仍能近似成四邊形
          const hull = new cv.Mat();
          cv.convexHull(cnt, hull, false, true);
          pts = approxQuad(hull);
          hull.delete();
        }
        if (!pts) continue;

        const o = orderClockwise(pts);
        const g = quadGeometry(o);
        if (!g.convex || g.area < frameArea * SCAN_CONFIG.minDocAreaRatio) continue;
        if (g.ratio > SCAN_CONFIG.maxAspect || g.minAngle < 45 || g.maxAngle > 135) continue;

        /*
          三個以上角點貼齊畫面邊框 → 那通常是「整個畫面」
          （例如淺色桌面整片被當成白紙），不是紙張。
        */
        const margin = Math.max(binary.cols, binary.rows) * 0.01;
        const onBorder = o.filter(
          (p) =>
            p.x <= margin ||
            p.y <= margin ||
            p.x >= binary.cols - 1 - margin ||
            p.y >= binary.rows - 1 - margin,
        ).length;
        if (onBorder >= 3) continue;

        out.push({ points: o, area: g.area });
      } finally {
        cnt.delete();
      }
    }
  } finally {
    contours.delete();
    hierarchy.delete();
  }
}

function approxQuad(contour: Mat): Point[] | null {
  const cv = getCv();
  const peri = cv.arcLength(contour, true);
  for (const eps of [0.02, 0.035, 0.05, 0.08]) {
    const approx = new cv.Mat();
    try {
      cv.approxPolyDP(contour, approx, eps * peri, true);
      if (approx.rows === 4) {
        const pts: Point[] = [];
        for (let j = 0; j < 4; j++) {
          pts.push({ x: approx.data32S[j * 2], y: approx.data32S[j * 2 + 1] });
        }
        return pts;
      }
      if (approx.rows < 4) return null;
    } finally {
      approx.delete();
    }
  }
  return null;
}

/** 四邊形內部平均亮度 − 外部平均亮度（紙張應該比桌面亮） */
function quadContrast(gray: Mat, points: Point[], areaRatio: number): number {
  const cv = getCv();
  const mask = cv.Mat.zeros(gray.rows, gray.cols, cv.CV_8UC1);
  const inv = new cv.Mat();
  const poly = cv.matFromArray(
    4,
    1,
    cv.CV_32SC2,
    points.flatMap((p) => [Math.round(p.x), Math.round(p.y)]),
  );
  const polys = new cv.MatVector();
  try {
    polys.push_back(poly);
    cv.fillPoly(mask, polys, new cv.Scalar(255));
    const inside = cv.mean(gray, mask)[0];
    // 紙張幾乎佔滿畫面時外部像素太少、不可靠，改與固定亮度比較
    if (areaRatio > 0.9) return inside - 150;
    cv.bitwise_not(mask, inv);
    return inside - cv.mean(gray, inv)[0];
  } finally {
    mask.delete();
    inv.delete();
    poly.delete();
    polys.delete();
  }
}

/**
 * 一張 RGBA 影像的清晰度（Laplacian 變異數，越小越模糊）。
 *
 * 給即時取景用：那裡不在每一幀都算模糊度，只有四角都合格、
 * 快要按下自動快門時才問這一次（見 ScannerCamera）。
 */
export function imageSharpness(rgba: Mat): number {
  const cv = getCv();
  const gray = new cv.Mat();
  try {
    cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
    return laplacianVariance(gray);
  } finally {
    gray.delete();
  }
}

function laplacianVariance(gray: Mat): number {
  const cv = getCv();
  const lap = new cv.Mat();
  const mean = new cv.Mat();
  const std = new cv.Mat();
  const mask = new cv.Mat();
  try {
    cv.Laplacian(gray, lap, cv.CV_64F);
    cv.meanStdDev(lap, mean, std, mask);
    const sd = std.data64F[0];
    return sd * sd;
  } finally {
    lap.delete();
    mean.delete();
    std.delete();
    mask.delete();
  }
}

/**
 * 對「拍好的靜態照片」偵測。
 * 解析度比即時預覽高一些（1280），準度較好但仍不必用原尺寸。
 */
export function detectOnSource(canvas: HTMLCanvasElement): Detection {
  const cv = getCv();
  const scale = Math.min(
    1,
    SCAN_CONFIG.stillDetectLongSide / Math.max(canvas.width, canvas.height),
  );
  const small = scaleCanvas(canvas, scale);
  const mat = cv.imread(small);
  try {
    const det = detectDocument(mat);
    if (det.points) {
      det.points = det.points.map((p) => ({ x: p.x / scale, y: p.y / scale }));
    }
    return det;
  } finally {
    mat.delete();
  }
}
