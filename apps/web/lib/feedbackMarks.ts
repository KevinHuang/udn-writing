import { defaultSchema } from 'rehype-sanitize';

/**
 * 評語裡的標色：螢光筆底色與文字顏色。
 *
 * **存的還是 markdown**（AI 產出、資料庫、學生端渲染都沒變），標色是
 * markdown 允許的行內 HTML，而且只用固定的 class：
 *
 *     <mark class="hl-yellow">首尾呼應</mark>
 *     <span class="tx-red">錯字較多</span>
 *
 * 為什麼是 class 而不是 style="color:…"：
 *   1. 白名單好寫 —— 只要比對字串，不必解析 CSS
 *   2. 深色模式（碑拓）能換一組顏色，寫死的色碼在深底上會看不見
 *
 * 為什麼不用 `==螢光==`：那不是 GFM 語法，react-markdown 不認得；
 * turndown 還會把行首的 `==` 跳脫成 `\==`（見 FeedbackEditor 的註解）。
 */

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink';
export type TextColor = 'red' | 'orange' | 'green';

export const HIGHLIGHT_COLORS: { value: HighlightColor; label: string }[] = [
  { value: 'yellow', label: '黃' },
  { value: 'green', label: '綠' },
  { value: 'blue', label: '藍' },
  { value: 'pink', label: '粉' },
];

export const TEXT_COLORS: { value: TextColor; label: string }[] = [
  { value: 'red', label: '紅' },
  { value: 'orange', label: '橘' },
  { value: 'green', label: '綠' },
];

export const highlightClass = (color: HighlightColor) => `hl-${color}`;
export const textColorClass = (color: TextColor) => `tx-${color}`;

/** 白名單允許的 class，就這幾個字串，其他一律濾掉 */
export const ALLOWED_MARK_CLASSES: string[] = [
  ...HIGHLIGHT_COLORS.map((c) => highlightClass(c.value)),
  ...TEXT_COLORS.map((c) => textColorClass(c.value)),
];

/**
 * 學生端渲染評語時用的過濾規則。
 *
 * ⚠️ 評語是 **AI 產生、老師可編輯**的內容，中間還夾著學生作文 ——
 *    等於使用者輸入。開了 rehype-raw 之後 markdown 裡的 HTML 會真的被解析，
 *    安全就只剩這一層白名單：
 *      · 標籤只多開 <mark> 與 <span>
 *      · 這兩個標籤只允許 className，而且值必須是上面那幾個固定字串
 *      · 不開 style、不開任何 on* 事件屬性
 */
export const FEEDBACK_SANITIZE_SCHEMA = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'mark', 'span'],
  attributes: {
    ...defaultSchema.attributes,
    mark: [['className', ...ALLOWED_MARK_CLASSES]],
    span: [['className', ...ALLOWED_MARK_CLASSES]],
  },
};

/** 標色的標籤。抓 <mark …> 與 <span class="tx-…">，含結束標籤 */
const MARK_TAG = /<\/?(?:mark|span)\b[^>]*>/gi;

/**
 * 把標色的標籤拿掉、只留文字。
 *
 * 給「不能有標籤」的場合用 —— 目前是學生端下載的 Word 報告：
 * 那支匯出是逐行塞純文字，標籤會原字面印進文件裡。
 */
export function stripFeedbackMarks(text: string): string {
  return text ? text.replace(MARK_TAG, '') : text;
}
