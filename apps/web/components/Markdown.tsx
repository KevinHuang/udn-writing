import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { FEEDBACK_SANITIZE_SCHEMA } from '../lib/feedbackMarks';

/**
 * 渲染 AI 批改產出的 markdown 報告。
 *
 * **為什麼需要這個元件**：後端存的 `submission_feedback.content` 裡那段
 * `response` 是一整份 markdown（`### 📝 寫作評量`、`**【綜合評分】**`、
 * 條列…）。先前前端是用 `<p className="whitespace-pre-wrap">` 直接印，
 * 學生會看到滿螢幕的 `###` 與 `**`。
 *
 * **為什麼用 react-markdown 而不是 marked**：marked 產出 HTML 字串，
 * 要接 `dangerouslySetInnerHTML`，那條路得自己接 sanitizer。
 * react-markdown 產 React 元素，而且過濾這一層是明確的 plugin。
 *
 * **關於 HTML**：這個元件原本完全不渲染 markdown 裡的 HTML。
 * 現在老師可以在評語裡用螢光筆與文字顏色（存成 `<mark class="hl-yellow">`），
 * 學生要看得到，所以改成：
 *
 *     rehypeRaw（把 markdown 裡的 HTML 還原成節點）
 *       → rehypeSanitize（白名單過濾）
 *
 * **順序不能反**，先過濾再還原等於沒有過濾。白名單只放行 `<mark>`／`<span>`
 * 與那幾個固定 class（見 lib/feedbackMarks.ts）—— 評語是 AI 產生、老師可編輯、
 * 中間夾帶學生作文，等於使用者輸入，其餘標籤與屬性一律丟掉。
 *
 * `remarkGfm`：老師的編輯器可以插入表格、刪除線與 `- [ ]` 待辦清單，
 * 沒有這個 plugin 學生端會看到原始語法。
 *
 * 樣式走 `.prose-ink`（見 index.css）—— 它把 typography 的變數接到專案的
 * 色彩 token 上，所以碑拓模式自動跟著翻轉，不需要 dark:prose-invert。
 */
export const Markdown: React.FC<{ children: string; className?: string }> = ({
  children,
  className = '',
}) => (
  <div className={`prose prose-ink max-w-none ${className}`}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw, [rehypeSanitize, FEEDBACK_SANITIZE_SCHEMA]]}
    >
      {children}
    </ReactMarkdown>
  </div>
);
