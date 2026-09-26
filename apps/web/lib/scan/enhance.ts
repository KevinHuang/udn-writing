/**
 * 梯形校正與影像優化。
 *
 * 拍到的照片 → 拉正成正對的矩形 → 去陰影、拉色階，
 * 讓 AI 辨識拿到的是「像掃描機掃出來的」而不是「桌上拍的照片」。
 * 這一步對手寫稿紙的辨識率影響很大。
 */

import { SCAN_CONFIG } from './config';
import { getCv, type Mat } from './opencv';
import { clamp, dist, orderClockwise, type Point } from './geometry';
import { canvasToBlob } from './image';

/** 結果要用哪一種樣式 */
export type ScanVariant = 'color' | 'gray' | 'binary';

export const VARIANT_LABEL: Record<ScanVariant, string> = {
  color: '原色',
  gray: '灰階',
  binary: '黑白',
};

/**
 * 透視變換：把四邊形拉正成矩形。
 *
 * ⚠️ **一律轉成橫的**：長邊擺水平，直的稿紙就把右緣當上緣轉 90°。
 *    這是為 A3／B4 橫式稿紙寫的，直式作文稿紙拍完會變成躺著的
 *    —— 使用者得自己按結果頁的旋轉鍵轉正。要改的是這裡的假設
 *    （改成保留原方向），但那會動到既有橫式稿紙的裁切與 OCR 輸入，
 *    所以先留著，畫面上以旋轉鍵補救。
 */
export function warpDocument(srcMat: Mat, points: Point[]): Mat {
  const cv = getCv();
  let o = orderClockwise(points);
  let width = Math.max(dist(o[0], o[1]), dist(o[3], o[2]));
  let height = Math.max(dist(o[0], o[3]), dist(o[1], o[2]));

  if (height > width) {
    o = [o[1], o[2], o[3], o[0]];
    [width, height] = [height, width];
  }

  let ratio = width / height;
  // 量出來的比例接近 A3／B4 就直接採用標準比例，避免每張掃出來都差一點
  if (Math.abs(ratio - SCAN_CONFIG.paperRatio) / SCAN_CONFIG.paperRatio < SCAN_CONFIG.snapTolerance) {
    ratio = SCAN_CONFIG.paperRatio;
  }
  const W = Math.round(clamp(width * 1.2, 1000, SCAN_CONFIG.outputLongSide));
  const H = Math.round(W / ratio);

  const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, o.flatMap((p) => [p.x, p.y]));
  const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, W, 0, W, H, 0, H]);
  const M = cv.getPerspectiveTransform(srcTri, dstTri);
  const out = new cv.Mat();
  try {
    cv.warpPerspective(
      srcMat,
      out,
      M,
      new cv.Size(W, H),
      cv.INTER_LINEAR,
      cv.BORDER_REPLICATE,
      new cv.Scalar(),
    );
    return out;
  } catch (e) {
    out.delete();
    throw e;
  } finally {
    srcTri.delete();
    dstTri.delete();
    M.delete();
  }
}

/** 旋轉 90°。回傳新的 Mat，呼叫端負責刪掉舊的 */
export function rotateMat90(mat: Mat, clockwise: boolean): Mat {
  const cv = getCv();
  const out = new cv.Mat();
  cv.transpose(mat, out);
  cv.flip(out, out, clockwise ? 1 : 0);
  return out;
}

/**
 * 去陰影：縮小 → 膨脹去掉字 → 中值模糊得到「背景光照」→ 原圖 ÷ 背景。
 * 整張紙的背景亮度一致之後，字跡才不會在陰影處糊成一團。
 */
function normalizeBackground(src: Mat): Mat {
  const cv = getCv();
  const small = new cv.Mat();
  const bg = new cv.Mat();
  const norm = new cv.Mat();
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(7, 7));
  try {
    const f = SCAN_CONFIG.bgDownscale;
    cv.resize(
      src,
      small,
      new cv.Size(Math.max(1, Math.round(src.cols / f)), Math.max(1, Math.round(src.rows / f))),
      0,
      0,
      cv.INTER_AREA,
    );
    cv.dilate(small, small, kernel);
    cv.medianBlur(small, small, 21);
    cv.resize(small, bg, new cv.Size(src.cols, src.rows), 0, 0, cv.INTER_LINEAR);
    cv.divide(src, bg, norm, 255);
    return norm;
  } catch (e) {
    norm.delete();
    throw e;
  } finally {
    small.delete();
    bg.delete();
    kernel.delete();
  }
}

/** 灰階直方圖的第 p 百分位亮度（取樣計算，大圖也很快） */
function percentileBrightness(gray: Mat, p: number): number {
  const hist = new Array<number>(256).fill(0);
  const d = gray.data;
  const step = Math.max(1, Math.floor(d.length / 200000));
  let total = 0;
  for (let i = 0; i < d.length; i += step) {
    hist[d[i]]++;
    total++;
  }
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= total * p) return i;
  }
  return 255;
}

/**
 * 色階拉伸：把最暗的 2%（字跡）拉到接近黑，紙張維持純白。
 *
 * 只做背景除法的話，字和紙會一起變亮，字看起來仍然很淡。
 * 整張幾乎空白時（黑點很亮）不動，否則空白頁會被拉成一片黑。
 */
function stretchLevels(mat: Mat): void {
  const cv = getCv();
  const gray = new cv.Mat();
  try {
    if (mat.channels() === 1) mat.copyTo(gray);
    else cv.cvtColor(mat, gray, mat.channels() === 4 ? cv.COLOR_RGBA2GRAY : cv.COLOR_RGB2GRAY);

    const black = percentileBrightness(gray, SCAN_CONFIG.inkPercentile);
    if (black > SCAN_CONFIG.skipStretchAbove) return;

    const alpha = clamp(
      (255 - SCAN_CONFIG.inkTarget) / Math.max(20, 255 - black),
      1,
      SCAN_CONFIG.maxLevelGain,
    );
    // beta 讓白點固定落在 255，紙張不會變灰
    mat.convertTo(mat, -1, alpha, 255 * (1 - alpha));
  } finally {
    gray.delete();
  }
}

/** 灰階化 ＋ 去陰影 ＋ 色階拉伸 */
export function buildGray(rgba: Mat): Mat {
  const cv = getCv();
  const gray = new cv.Mat();
  try {
    cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
    const norm = normalizeBackground(gray);
    stretchLevels(norm);
    return norm;
  } finally {
    gray.delete();
  }
}

/**
 * 彩色優化：逐通道做背景除法（等於同時完成去陰影與白平衡，
 * 偏黃燈光造成的色偏也會被校正），再做色階拉伸。
 * 紙張變白、字跡變實，紅筆藍筆的顏色仍然保留。
 */
export function buildColor(rgba: Mat): Mat {
  const cv = getCv();
  const rgb = new cv.Mat();
  const planes = new cv.MatVector();
  const normalized = new cv.MatVector();
  const temps: Mat[] = [];
  const out = new cv.Mat();
  try {
    cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB);
    cv.split(rgb, planes);
    for (let i = 0; i < 3; i++) {
      const ch = planes.get(i);
      temps.push(ch);
      const norm = normalizeBackground(ch);
      temps.push(norm);
      normalized.push_back(norm);
    }
    cv.merge(normalized, out);
    stretchLevels(out);
    return out;
  } catch (e) {
    out.delete();
    throw e;
  } finally {
    rgb.delete();
    planes.delete();
    normalized.delete();
    temps.forEach((m) => m.delete());
  }
}

/** 自適應二值化：背景純白、字跡純黑 */
export function buildBinary(gray: Mat): Mat {
  const cv = getCv();
  const tmp = new cv.Mat();
  const bin = new cv.Mat();
  try {
    cv.medianBlur(gray, tmp, 3);
    cv.adaptiveThreshold(
      tmp,
      bin,
      255,
      cv.ADAPTIVE_THRESH_MEAN_C,
      cv.THRESH_BINARY,
      SCAN_CONFIG.blockSize,
      SCAN_CONFIG.thresholdC,
    );
    return bin;
  } catch (e) {
    bin.delete();
    throw e;
  } finally {
    tmp.delete();
  }
}

/**
 * 校正後的三種樣式。
 *
 * 一次校正、三種樣式**用到才算**（切換樣式時才做那一種），
 * 因為彩色優化在手機上要花一兩秒。
 */
export class ScanResult {
  /** 純粹拉正、還沒做任何優化的原圖。旋轉與重算樣式都從它出發 */
  private warped: Mat;
  private cache: Partial<Record<ScanVariant, Mat>> = {};

  constructor(warped: Mat) {
    this.warped = warped;
  }

  get width(): number {
    return this.warped.cols;
  }

  get height(): number {
    return this.warped.rows;
  }

  mat(variant: ScanVariant): Mat {
    const cached = this.cache[variant];
    if (cached) return cached;

    if (variant === 'color') {
      const m = buildColor(this.warped);
      this.cache.color = m;
      return m;
    }
    if (!this.cache.gray) this.cache.gray = buildGray(this.warped);
    if (variant === 'gray') return this.cache.gray;
    if (!this.cache.binary) this.cache.binary = buildBinary(this.cache.gray);
    return this.cache.binary;
  }

  /** 旋轉 90°。樣式快取全部作廢，重新從拉正後的原圖算 */
  rotate(clockwise: boolean): void {
    const rotated = rotateMat90(this.warped, clockwise);
    this.warped.delete();
    this.clearCache();
    this.warped = rotated;
  }

  /** 畫到 canvas 上。畫面不需要全解析度，手機重繪大畫布會明顯卡頓 */
  drawTo(canvas: HTMLCanvasElement, variant: ScanVariant, maxLongSide: number): void {
    const cv = getCv();
    const mat = this.mat(variant);
    const long = Math.max(mat.cols, mat.rows);
    if (long <= maxLongSide) {
      cv.imshow(canvas, mat);
      return;
    }
    const scale = maxLongSide / long;
    const preview = new cv.Mat();
    try {
      cv.resize(
        mat,
        preview,
        new cv.Size(Math.round(mat.cols * scale), Math.round(mat.rows * scale)),
        0,
        0,
        cv.INTER_AREA,
      );
      cv.imshow(canvas, preview);
    } finally {
      preview.delete();
    }
  }

  /**
   * 轉成圖檔。
   *
   * @param maxLongSide 縮到這個長邊以內。送 AI 辨識時用 2000，
   *                    要保存原稿時用 0（不縮）。
   */
  async toBlob(variant: ScanVariant, maxLongSide = 0): Promise<Blob> {
    const cv = getCv();
    const mat = this.mat(variant);
    const canvas = document.createElement('canvas');
    const long = Math.max(mat.cols, mat.rows);

    if (maxLongSide > 0 && long > maxLongSide) {
      const scale = maxLongSide / long;
      const small = new cv.Mat();
      try {
        cv.resize(
          mat,
          small,
          new cv.Size(Math.round(mat.cols * scale), Math.round(mat.rows * scale)),
          0,
          0,
          cv.INTER_AREA,
        );
        cv.imshow(canvas, small);
      } finally {
        small.delete();
      }
    } else {
      cv.imshow(canvas, mat);
    }

    // 黑白只有兩個顏色，PNG 又小又不會有 JPEG 的雜訊
    const mime = variant === 'binary' ? 'image/png' : 'image/jpeg';
    const blob = await canvasToBlob(canvas, mime, SCAN_CONFIG.ocrJpegQuality);
    /*
      把 canvas 歸零，backing store 才會馬上還給系統。
      單張時丟給 GC 慢慢收無所謂；連拍多張時這裡一張全解析度的 canvas
      就是 3500×2475×4 ≈ 34MB，iOS Safari 不會即時釋放，會一路累積到
      分頁被系統砍掉。
    */
    canvas.width = 0;
    canvas.height = 0;
    return blob;
  }

  private clearCache(): void {
    (Object.keys(this.cache) as ScanVariant[]).forEach((k) => {
      this.cache[k]?.delete();
    });
    this.cache = {};
  }

  /** 用完一定要呼叫，否則 WebAssembly 的記憶體不會被釋放 */
  dispose(): void {
    this.clearCache();
    this.warped.delete();
  }
}

/** 拍到的照片 ＋ 四個角 → 校正後的結果 */
export function buildScanResult(source: HTMLCanvasElement, points: Point[]): ScanResult {
  const cv = getCv();
  const src = cv.imread(source);
  try {
    return new ScanResult(warpDocument(src, points));
  } finally {
    src.delete();
  }
}
