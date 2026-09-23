import React from 'react';
import { Copy, Check } from 'lucide-react';
import { formatSummary, type PerfSummary } from '../../lib/scan/perf';

interface ScanDebugHudProps {
  summary: PerfSummary;
  /** 串流實際跑在多大、幾 fps（track.getSettings） */
  stream: string;
  /** 快門走哪一條：takePhoto（感光元件全解析度）或影片畫格 */
  shutter: string;
  dpr: number;
  /** 疊圖畫布的實際像素大小 */
  overlay: string;
}

/**
 * 掃描效能診斷。**只在 ?scandebug=1 時出現**（見 lib/scan/debug.ts）。
 *
 * 為什麼要做在畫面上而不是 console：回報問題的是拿著手機的老師與學生，
 * 他們接不到桌機的 devtools。數字直接顯示出來、再給一顆複製鈕，
 * 現場就能把改善前後的數據貼過來比對。
 *
 * 配色刻意只用黑底白字（不是主題色）—— 它疊在相機畫面上，要在任何
 * 背景下都讀得到，而且不該跟產品的視覺語言混在一起。
 */
export const ScanDebugHud: React.FC<ScanDebugHudProps> = ({
  summary,
  stream,
  shutter,
  dpr,
  overlay,
}) => {
  const [copied, setCopied] = React.useState(false);

  const text = formatSummary(summary, { stream, shutter, dpr, overlay });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* http 或權限不給時沒辦法，數字本來就看得到 */
    }
  };

  const ms = (n: number) => Math.round(n);

  return (
    <div
      id="scanner-debug-hud"
      className="absolute left-3 bottom-40 max-w-[85%] pointer-events-none rounded-xl bg-black/60 px-3 py-2 text-white backdrop-blur-sm"
    >
      <pre className="text-[11px] leading-relaxed font-mono whitespace-pre-wrap">
{`串流 ${stream}  快門 ${shutter}
偵測 ${summary.fps.toFixed(1)} fps（${summary.frames} 幀）
每幀 p50 ${ms(summary.p50.total)}ms / p95 ${ms(summary.totalP95)}ms
 抓圖 ${ms(summary.p50.draw)}  回讀 ${ms(summary.p50.read)}  偵測 ${ms(summary.p50.detect)}  疊圖 ${ms(summary.p50.overlay)}
完整偵測 ${Math.round(summary.fullRatio * 100)}%  框到 ${Math.round(summary.hitRatio * 100)}%
dpr ${dpr}  疊圖畫布 ${overlay}`}
      </pre>
      <button
        id="scanner-debug-copy"
        onClick={copy}
        className="pointer-events-auto mt-1.5 inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-2 py-1 text-[11px] text-white"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
        {copied ? '已複製' : '複製診斷'}
      </button>
    </div>
  );
};
