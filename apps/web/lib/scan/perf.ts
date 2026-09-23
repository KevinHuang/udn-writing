/**
 * 掃描偵測迴圈的耗時統計。
 *
 * 為什麼要有這支：Android 上的即時對邊明顯比 iOS 慢，但「慢」在哪一段
 * （抓影格？回讀像素？OpenCV？疊圖？）憑感覺是查不出來的 ——
 * 使用者的手機也接不到桌機的 devtools。所以把每一段的耗時收集起來，
 * 讓掃描畫面自己把數字顯示出來（見 components/scan/ScanDebugHud.tsx）。
 *
 * ⚠ 用**中位數**不要用平均：手機的 GC 與相機自動曝光會偶發幾百毫秒的尖峰，
 *   平均會被單一尖峰拉走，看起來像整體都很慢。p95 另外看，那才是尖峰。
 *
 * 這裡刻意只放純函式與純資料，不碰 OpenCV 也不碰 DOM —— 才測得到（test/scanPerf.test.tsx）。
 */

/** 一幀的四段耗時（毫秒）。total 是 step() 整支的耗時，不是三段相加 */
export interface FrameTiming {
  /** drawImage：把 video 縮到偵測用的小圖 */
  draw: number;
  /** getImageData：GPU→CPU 回讀像素 */
  read: number;
  /** detectDocument：OpenCV 找四邊形 */
  detect: number;
  /** drawOverlay：疊圖重畫 */
  overlay: number;
  total: number;
  /** 這一幀有沒有跑完整偵測（含色彩遮罩那條最貴的路徑） */
  full: boolean;
  /** 這一幀有沒有框到紙張 */
  hit: boolean;
  /** 這一幀開始的時間（performance.now） */
  at: number;
}

export type TimingKey = 'draw' | 'read' | 'detect' | 'overlay' | 'total';

/**
 * 百分位數。
 *
 * 用最接近的排名（nearest-rank）而不是內插 —— 樣本只有幾十筆，
 * 內插出來的小數只是假的精度，而且會讓測試的期望值難寫。
 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export interface PerfSummary {
  /** 樣本數 */
  frames: number;
  /** 每一段的中位數 */
  p50: Record<TimingKey, number>;
  /** step() 整支的 p95 —— 尖峰有多痛 */
  totalP95: number;
  /** 實際的偵測頻率（每秒幾次），由第一幀與最後一幀的時間差推出 */
  fps: number;
  /** 跑完整偵測的幀數佔比（0~1）。越高代表越常框不到，也是最卡的情境 */
  fullRatio: number;
  /** 框到紙張的幀數佔比（0~1） */
  hitRatio: number;
}

/**
 * 最近 N 幀的耗時。
 *
 * 環形緩衝：手機上這支每秒會被寫 9 次、跑好幾分鐘，不能無限成長。
 */
export class FrameTimings {
  private readonly buf: FrameTiming[] = [];

  constructor(private readonly capacity = 30) {}

  push(t: FrameTiming) {
    this.buf.push(t);
    if (this.buf.length > this.capacity) this.buf.shift();
  }

  get size() {
    return this.buf.length;
  }

  clear() {
    this.buf.length = 0;
  }

  summary(): PerfSummary {
    const frames = this.buf.length;
    const pick = (k: TimingKey) => this.buf.map((t) => t[k]);
    const p50 = {
      draw: percentile(pick('draw'), 50),
      read: percentile(pick('read'), 50),
      detect: percentile(pick('detect'), 50),
      overlay: percentile(pick('overlay'), 50),
      total: percentile(pick('total'), 50),
    };
    /*
      fps 用「第一幀到最後一幀的實際時間」算，不要用 1000/p50 ——
      排程間隔（detectIntervalMs）與單幀耗時是兩回事，後者只是前者的下限。
      少於兩幀就沒有時間差可算，回 0 而不是 Infinity。
    */
    const span = frames >= 2 ? this.buf[frames - 1].at - this.buf[0].at : 0;
    const fps = span > 0 ? ((frames - 1) * 1000) / span : 0;

    return {
      frames,
      p50,
      totalP95: percentile(pick('total'), 95),
      fps,
      fullRatio: frames ? this.buf.filter((t) => t.full).length / frames : 0,
      hitRatio: frames ? this.buf.filter((t) => t.hit).length / frames : 0,
    };
  }
}

/** 給人看的一行摘要。使用者會把它複製下來貼給我們，所以要自帶單位 */
export function formatSummary(
  s: PerfSummary,
  extra: { stream?: string; shutter?: string; dpr?: number; overlay?: string } = {},
): string {
  const ms = (n: number) => `${Math.round(n)}ms`;
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return [
    `串流 ${extra.stream ?? '?'}  快門 ${extra.shutter ?? '?'}`,
    `偵測 ${s.fps.toFixed(1)} fps（${s.frames} 幀）`,
    `每幀 p50 ${ms(s.p50.total)} / p95 ${ms(s.totalP95)}`,
    `  抓圖 ${ms(s.p50.draw)}  回讀 ${ms(s.p50.read)}  偵測 ${ms(s.p50.detect)}  疊圖 ${ms(s.p50.overlay)}`,
    `完整偵測 ${pct(s.fullRatio)}  框到 ${pct(s.hitRatio)}`,
    `dpr ${extra.dpr ?? '?'}  疊圖畫布 ${extra.overlay ?? '?'}`,
  ].join('\n');
}
