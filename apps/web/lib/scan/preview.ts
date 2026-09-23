import { SCAN_CONFIG } from './config';

/**
 * 取景串流要開多大。
 *
 * 抽成純函式的理由：這段算式踩過兩個坑，而且兩個都不會當掉、只會靜默地壞掉，
 * 沒有測試就只能靠在手機上肉眼發現：
 *
 *   1. **長寬比一定要照感光元件**。預覽若設成 16:9 而照片是 4:3，
 *      DocumentScannerModal 那條「照片偵測失敗時沿用預覽框到的四角」
 *      的救援路徑會永遠不成立（它要求兩者相差 2% 以內）——
 *      使用者預覽裡看得到綠框，按下快門卻被丟去手動拖四角。
 *   2. **不可以把串流反而拉大**。低階鏡頭本來就只有 1280×960，
 *      硬要 1440 只會讓它插值放大：更慢，而且邊緣更糊。
 *
 * trusted＝按快門走 takePhoto 且拿得到高解析（與 video track 尺寸無關），
 * 這時預覽只是拿來取景與偵測的，壓小才不會每一幀都在降採樣一張 12M 的圖。
 * 不可信時串流本身就是成品畫質，只夾在 maxSourceLongSide（再大也會在拍照時被縮掉）。
 */
export function previewTargetSize(
  maxW: number,
  maxH: number,
  trusted: boolean,
): { width: number; height: number } {
  const aspect = maxW / maxH;
  if (!trusted) {
    const shrink = Math.min(1, SCAN_CONFIG.maxSourceLongSide / Math.max(maxW, maxH));
    return { width: Math.round(maxW * shrink), height: Math.round(maxH * shrink) };
  }
  // 感光元件本來就比目標小就照原樣 —— 不要放大
  const longSide = Math.min(SCAN_CONFIG.previewLongSide, Math.max(maxW, maxH));
  return aspect >= 1
    ? { width: Math.round(longSide), height: Math.round(longSide / aspect) }
    : { width: Math.round(longSide * aspect), height: Math.round(longSide) };
}

/** 目前的串流已經符合（或小於）目標，就不要再動它 —— 有些機器切換時畫面會黑一下 */
export function shouldApplyPreview(
  current: { width?: number; height?: number },
  target: { width: number; height: number },
  trusted: boolean,
): boolean {
  const w = current.width ?? 0;
  const h = current.height ?? 0;
  if (w === target.width && h === target.height) return false;
  if (trusted && w > 0 && h > 0 && w <= target.width && h <= target.height) return false;
  return true;
}
