/**
 * 把掃描機掃出來的 PDF 在瀏覽器裡展開成每頁一張 JPEG（整疊掃描用，docs/batch-scan.md）。
 * 移植自 1Campus Write 的 hosting/utils/pdfPages.ts。
 *
 * PDF 本身不上傳：一班雙面掃描常常 40MB 以上，超過 API 的 20MB；
 * 而且後面的流程（讀座號、代繳交、逐格辨識）本來就是一頁一張圖。
 *
 * pdfjs-dist 很大（另有一支 worker），所以一律動態 import —— 只有真的選了 PDF 的老師才會下載。
 */

/** 渲染縮放的合理範圍：避免異常小的頁面被放大成佔滿記憶體的畫布 */
const MIN_RENDER_SCALE = 0.1;
const MAX_RENDER_SCALE = 4;

/**
 * 依 PDF 頁面原始尺寸算出渲染縮放比，使長邊約等於 maxDimension（純函式）。
 * scale 1 的 A3 只有 1191px，對手寫稿太小，所以會放大（上限 MAX_RENDER_SCALE）。
 */
export function pdfRenderScale(width: number, height: number, maxDimension: number): number {
  const longest = Math.max(width, height);
  if (!Number.isFinite(longest) || longest <= 0) return 1;
  return Math.min(MAX_RENDER_SCALE, Math.max(MIN_RENDER_SCALE, maxDimension / longest));
}

export const isPdfFile = (file: File): boolean =>
  file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

/** 給老師看的錯誤（訊息可以直接顯示） */
export class PdfPagesError extends Error {}

const toJpeg = (canvas: HTMLCanvasElement, quality: number): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new PdfPagesError('PDF 轉成圖片時失敗，請再試一次。'))),
      'image/jpeg',
      quality,
    );
  });

/**
 * 把 PDF 展開成每頁一張 JPEG，依原始頁序回傳。
 *
 * @param onProgress 每畫完一頁回報一次
 * @param shouldStop 老師按了取消：下一頁開始前停下來（回傳到目前為止的頁，呼叫端自己丟掉）
 */
export async function renderPdfToJpegs(
  file: File,
  opts: {
    maxDimension: number;
    quality: number;
    maxPages: number;
    onProgress?: (done: number, total: number) => void;
    shouldStop?: () => boolean;
  },
): Promise<Blob[]> {
  const pdfjs = await import('pdfjs-dist');
  // worker 以 URL 交給 pdf.js，讓 Vite 產出獨立的檔案（裸字串路徑打包後會找不到）
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

  // 保留 loading task：釋放 worker 的 destroy() 在 task 上
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  let doc;
  try {
    doc = await loadingTask.promise;
  } catch {
    throw new PdfPagesError('這份 PDF 打不開，可能有密碼或檔案壞了。請重新掃描，或改選圖片檔。');
  }

  try {
    const total = doc.numPages;
    if (total === 0) throw new PdfPagesError('這份 PDF 沒有任何一頁。');
    if (total > opts.maxPages) {
      throw new PdfPagesError(`這份 PDF 有 ${total} 頁，一次最多 ${opts.maxPages} 頁。請分成兩份掃描。`);
    }
    const pages: Blob[] = [];
    for (let n = 1; n <= total; n += 1) {
      if (opts.shouldStop?.()) break;
      const page = await doc.getPage(n);
      try {
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: pdfRenderScale(base.width, base.height, opts.maxDimension) });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));
        /*
          background 白底：PDF 頁面可能是透明的，直接轉 JPEG 會變黑。
          intent 用 print 不是為了列印，是為了排程：預設的 display 用 requestAnimationFrame 推進，
          分頁一切到背景 rAF 就不跑，展開會無聲卡死；print 用 microtask，背景也跑得完。
        */
        await page.render({ canvas, viewport, background: '#FFFFFF', intent: 'print' }).promise;
        pages.push(await toJpeg(canvas, opts.quality));
        // 釋放像素記憶體：一班八十頁、每頁 3000px，不放掉瀏覽器會撐不住
        canvas.width = 0;
        canvas.height = 0;
      } finally {
        page.cleanup();
      }
      opts.onProgress?.(n, total);
    }
    return pages;
  } finally {
    await loadingTask.destroy();
  }
}
