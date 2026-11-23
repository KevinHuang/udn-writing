/**
 * 掃描畫面怎麼擺：**只跟著瀏覽器實際的方向**，不猜手機怎麼拿。
 *  - portrait：直的畫面（手機直拿），快門那一排在底部
 *  - landscape：橫的畫面（手機開著自動旋轉橫拿、平板橫放、電腦），快門那一排在右手邊
 *
 * ⚠️ 不要做「瀏覽器是直的，就把橫向介面轉 90° 畫」：校園版（1Campus Write）試過，
 *    假設使用者會把手機頂端朝左橫拿，結果手機往右轉、或拍直式的紙時，
 *    照片被存成上下顛倒或轉 90°，中文直書辨識大量失敗，已撤回。
 *    網頁拿不到手機實際的方向；照片照拍到的方向存（見 enhance.ts 的 warpDocument），
 *    方向不對時由使用者在結果頁用左轉／右轉轉正。
 */
export type ScanViewMode = 'portrait' | 'landscape';

export const scanViewMode = (viewportWidth: number, viewportHeight: number): ScanViewMode =>
  viewportWidth >= viewportHeight ? 'landscape' : 'portrait';

/**
 * 手機橫拿那種「又寬又矮」的畫面（高度不到 600px 的橫向畫面）。
 * 結果頁在這種畫面上改成照片在左、按鈕一欄在右 —— 照原本上下排，
 * 標題列、工具列、照片、按鈕疊起來，照片只剩一條、要一直捲。
 * 電腦與平板橫放時高度夠，維持原本的上下排。
 */
export const isCompactLandscape = (viewportWidth: number, viewportHeight: number): boolean =>
  scanViewMode(viewportWidth, viewportHeight) === 'landscape' && viewportHeight < 600;
