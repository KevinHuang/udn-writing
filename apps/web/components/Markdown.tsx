import React from 'react';
import ReactMarkdown from 'react-markdown';

/**
 * 渲染 AI 批改產出的 markdown 報告。
 *
 * **為什麼需要這個元件**：後端存的 `submission_feedback.content` 裡那段
 * `response` 是一整份 markdown（`### 📝 寫作評量`、`**【綜合評分】**`、
 * 條列…）。先前前端是用 `<p className="whitespace-pre-wrap">` 直接印，
 * 學生會看到滿螢幕的 `###` 與 `**`。
 *
 * **為什麼用 react-markdown 而不是 marked**：marked 產出 HTML 字串，
 * 要接 `dangerouslySetInnerHTML`，而這段內容是 **AI 產生的** ——
 * 中間夾帶學生作文，等於使用者輸入。那條路要自己接 sanitizer 才安全。
 * react-markdown 直接產 React 元素，預設不渲染原始 HTML，沒有這個問題。
 *
 * 樣式走 `.prose-ink`（見 index.css）—— 它把 typography 的變數接到專案的
 * 色彩 token 上，所以碑拓模式自動跟著翻轉，不需要 dark:prose-invert。
 */
export const Markdown: React.FC<{ children: string; className?: string }> = ({
  children,
  className = '',
}) => (
  <div className={`prose prose-ink max-w-none ${className}`}>
    <ReactMarkdown>{children}</ReactMarkdown>
  </div>
);
