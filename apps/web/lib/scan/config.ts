/**
 * 稿紙掃描的參數。
 *
 * 移植自獨立的「網頁拍照掃描器」原型，數值都是實際拿 A3／B4 稿紙
 * 在不同桌面與光線下調出來的，**不要憑感覺改**：每一項下面都寫了
 * 它在防止什麼情況。
 */

/**
 * OpenCV.js 的來源，依序嘗試。
 *
 * ⚠ 這個檔約 10MB，而且是從 CDN 下載的。正式上線前應該把 opencv.js
 * 放進專案自行託管（放在 public/ 之下），並把它排在第一個 ——
 * 學校網路擋掉 CDN 或離線時，掃描功能會整個不能用。
 */
export const OPENCV_URLS = [
  'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js',
  'https://docs.opencv.org/4.x/opencv.js',
];

/**
 * 虛擬鏡頭的名稱。
 *
 * 筆電的鏡頭沒有「後鏡頭」，`facingMode: environment` 對它沒有作用，瀏覽器就開
 * **清單第一顆** —— 而那常常是某個軟體裝的虛擬鏡頭。實測一台聯想筆電的第一顆是
 * 「Mirametrix Virtual Camera」（眼動追蹤用），開啟要 9–15 秒、畫面幾乎全黑，
 * 掃描視窗看起來就是「相機開不起來」；真正的鏡頭（LGE Camera）排在第二。
 * 有別的實體鏡頭可選時，名稱符合這裡的一律不用（見 ScannerCamera 的 preferredCamera）。
 */
export const VIRTUAL_CAMERA_PATTERN =
  /virtual|mirametrix|obs|streaming|manycam|snap camera|xsplit|broadcast|droidcam|iriun|epoccam/i;

export const SCAN_CONFIG = {
  opencvTimeoutMs: 90000,

  /* ---------- 相機 ---------- */
  idealWidth: 3840,
  idealHeight: 2160,
  /**
   * 取景用的串流解析度。**只有支援 ImageCapture 的瀏覽器才會用這一組。**
   *
   * 那些瀏覽器按快門走 takePhoto()，拿的是感光元件的全解析度，
   * 跟串流開多大無關 —— 取景卻要為每一幀付出縮放與 getImageData 的成本，
   * 開 4K 等於白白讓框線跟不上手。
   *
   * 不支援 ImageCapture 的（iOS Safari）維持上面的 idealWidth／idealHeight：
   * 那邊的快門是從影片畫格擷取的，串流解析度就是成品的畫質。
   */
  previewWidth: 1920,
  previewHeight: 1080,
  /**
   * 取景串流的**長邊**目標（只有拍照走 takePhoto 的裝置才會套用）。
   *
   * ⚠ 實際要求的寬高要**照感光元件的長寬比算出來**，不可以直接寫死 1920×1080。
   *   感光元件多半是 4:3，預覽若設成 16:9，DocumentScannerModal 那條
   *   「高解析照片偵測失敗時沿用預覽框到的四角」的救援路徑會永遠不成立
   *   （它要求兩者長寬比相差 2% 以內）—— 使用者預覽裡看得到綠框，
   *   按下快門卻被丟去手動拖四角。4:3 的機器套出來是 1440×1080。
   *
   * 1440 是取景與偵測夠用的下限：偵測本來就只吃 detectLongSide(512) 的縮圖，
   * 而畫面上給人看的取景框再大也沒有意義。
   */
  previewLongSide: 1440,
  /**
   * takePhoto() 的成品長邊至少要有 previewLongSide 的幾倍，才算「拍照管線可信」。
   * 有些 Android 的 ImageCapture 其實只是回傳預覽畫格 —— 那種裝置不能壓預覽，
   * 否則存檔畫質會從 12M 掉到 1.5M（見 ScannerCamera 的 capture）。
   */
  trustedPhotoRatio: 1.5,
  /** 事前探測：getPhotoCapabilities 回報的最大寬度要 ≥ 這個值才算可信 */
  trustedPhotoMinWidth: 2500,
  /** 支援 ImageCapture 時用 takePhoto() 取得感光元件全解析度 */
  useTakePhoto: true,
  takePhotoTimeoutMs: 6000,
  /** 原始照片長邊上限。再大會撞到 iOS 的 canvas 記憶體上限 */
  maxSourceLongSide: 4000,
  /** 整片白紙會讓自動曝光過亮、字跡變淡，相機支援時降 0.5 EV */
  exposureCompensation: -0.5,

  /* ---------- 即時偵測與自動拍照 ---------- */
  /**
   * 即時偵測用的縮圖長邊。
   *
   * 跟 minCaptureAreaRatio 是綁在一起的：紙張至少要佔畫面 30% 才會自動拍，
   * 512 的長邊下那也還有 280px 寬，四條邊夠清楚。**要調小之前先想清楚
   * 這件事** —— 只把這個數字改小，會變成框得快但框得爛。
   */
  detectLongSide: 512,
  detectIntervalMs: 110,
  /**
   * 連續這麼多幀找不到紙張，就跑一次完整偵測（含色彩遮罩那條路徑）。
   * 8 幀約 1 秒。平常用快的，木紋桌面之類的情況才付那個成本。
   */
  fullDetectAfterMisses: 8,
  stillDetectLongSide: 1280,
  stableDurationMs: 1000,
  /** 自動拍照門檻：紙張至少佔畫面 30%（太小提示「請靠近一點」） */
  minCaptureAreaRatio: 0.3,
  /** 自動拍照門檻：四個角與 90° 相差不超過 20°（太斜提示「請與紙面平行」） */
  maxSkewDeg: 20,
  /** 四條邊之中最差的一條，至少 55% 取樣點要貼在真實邊緣上 */
  minEdgeSupport: 0.55,
  /** 四個角離畫面邊緣至少 2%（整張紙要完整入鏡） */
  frameMarginRatio: 0.02,
  edgeSamples: 24,
  /** 四角位移容許值（畫面對角線比例） */
  stableTolerance: 0.02,
  /** Laplacian 變異數下限，低於此值視為畫面模糊 */
  minSharpness: 15,
  /** 開啟相機後等待對焦的時間 */
  warmupMs: 1200,

  /* ---------- 文件四邊形過濾 ---------- */
  minDocAreaRatio: 0.15,
  maxAspect: 2.2,
  /** 紙張內部至少要比外部亮這麼多（灰階 0~255） */
  minContrast: 8,

  /* ---------- 輸出 ---------- */
  /** 輸出長邊上限；實際大小另受「偵測到的紙張寬度 × 1.2」限制 */
  outputLongSide: 3500,
  /** A3、B4 長寬比皆約 1.414 */
  paperRatio: Math.SQRT2,
  /** 估計比例與 1.414 相差 12% 以內就直接採用 1.414 */
  snapTolerance: 0.12,
  /** adaptiveThreshold 區塊大小（大一點較能消除局部陰影） */
  blockSize: 51,
  thresholdC: 15,
  bgDownscale: 4,
  /** 色階拉伸：取最暗的 2% 當作「字跡黑點」 */
  inkPercentile: 0.02,
  /** 字跡黑點要拉到的亮度（0 = 純黑，留一點避免筆畫斷掉） */
  inkTarget: 25,
  /** 對比放大上限，避免雜訊被過度放大 */
  maxLevelGain: 2.2,
  /** 黑點高於此值代表整張幾乎空白，不做拉伸（否則空白頁會整片變黑） */
  skipStretchAbove: 200,

  /* ---------- 介面 ---------- */
  editorPreviewLongSide: 1600,
  /** 結果頁畫面上只顯示縮小版；送出與保存仍使用全解析度 */
  resultPreviewLongSide: 1600,
  loupeZoom: 3,

  /* ---------- 送進 OCR 前的壓縮 ---------- */
  /**
   * 送去辨識的影像長邊。全解析度（3500px）的 JPEG 有 2–4MB，
   * 轉成 base64 再塞進 API 會慢又貴；2000px 對手寫字辨識已經很夠。
   */
  ocrLongSide: 2000,
  ocrJpegQuality: 0.9,
} as const;
