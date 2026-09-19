/**
 * 掃描流程用到的 canvas／Blob 工具。
 *
 * 與 lib/fileToBase64.ts 的差別：那一支是把使用者選的原始檔案直接轉成
 * base64 交給 AI；這裡處理的是**程式產生的影像**（拍到的畫格、校正後的
 * 結果），需要控制尺寸與壓縮率。
 */

/** 等畫面更新一次，讓「處理中」的遮罩先畫出來 */
export function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    requestAnimationFrame(() => requestAnimationFrame(finish));
    // rAF 在背景分頁會被節流，最多只等 150ms，不要讓整個流程卡死
    setTimeout(finish, 150);
  });
}

export function scaleCanvas(src: HTMLCanvasElement, scale: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(src.width * scale));
  c.height = Math.max(1, Math.round(src.height * scale));
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, c.width, c.height);
  }
  return c;
}

function loadImageElement(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('無法讀取圖片'));
    };
    img.src = url;
  });
}

/**
 * Blob → canvas，並限制長邊。
 *
 * 優先用 createImageBitmap 並指定 imageOrientation: 'from-image' ——
 * 手機拍的照片帶 EXIF 旋轉資訊，不處理的話橫拍的稿紙會變成躺著的。
 */
export async function blobToCanvas(
  blob: Blob,
  maxLongSide: number,
): Promise<HTMLCanvasElement> {
  let source: ImageBitmap | HTMLImageElement | null = null;
  if ('createImageBitmap' in window) {
    try {
      source = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch {
      source = null;
    }
  }
  if (!source) source = await loadImageElement(blob);

  const w = source.width || (source as HTMLImageElement).naturalWidth;
  const h = source.height || (source as HTMLImageElement).naturalHeight;
  const scale = Math.min(1, maxLongSide / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  }
  if ('close' in source && typeof source.close === 'function') source.close();
  return canvas;
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  mime: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('影像轉檔失敗'))),
      mime,
      quality,
    );
  });
}

/** Blob → base64（不含 data: 前綴），給 AI 辨識用 */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error ?? new Error('影像轉檔失敗'));
    reader.readAsDataURL(blob);
  });
}

/** 影像尺寸（給畫面顯示「這張掃出來多大」用） */
export function describeSize(width: number, height: number): string {
  // A3 長邊 420mm。換算成 DPI，畫質不夠時一眼看得出來
  const dpi = Math.round((width / 420) * 25.4);
  return `${width}×${height}px（A3 約 ${dpi} DPI）`;
}
