import { blobToBase64, blobToCanvas, canvasToBlob } from '../scan/image';
import type { ProxyImage } from '../../api/proxySubmissions';

/**
 * 代繳交照片要上傳前先壓一下。
 *
 * 一位學生的整份照片是**一次請求**送完的（見 queue.ts），而 API 的
 * body 上限是 20MB（apps/api/src/app.ts）。掃描出來的全解析度原稿長邊 3500px，
 * 手機直接拍的更大（4000px 以上、base64 後一張 6–8MB）——三頁就爆了。
 *
 * 3000px／JPEG 0.85 一張約 1–1.5MB，八頁也遠低於上限；
 * 而辨識用的影像本來就只要 2000px（SCAN_CONFIG.ocrLongSide），畫質綽綽有餘。
 *
 * blobToCanvas 會照 EXIF 轉正 —— 手機直拍的照片不處理的話會躺著上傳。
 */
export const PROXY_UPLOAD_LONG_SIDE = 3000;
export const PROXY_UPLOAD_QUALITY = 0.85;

export async function prepareProxyImage(blob: Blob): Promise<ProxyImage> {
  const canvas = await blobToCanvas(blob, PROXY_UPLOAD_LONG_SIDE);
  const jpeg = await canvasToBlob(canvas, 'image/jpeg', PROXY_UPLOAD_QUALITY);
  // 釋放 canvas 的像素記憶體 —— 老師一口氣收一整班，手機記憶體撐不住
  canvas.width = 0;
  canvas.height = 0;
  return { base64Image: await blobToBase64(jpeg), mimeType: 'image/jpeg' };
}
