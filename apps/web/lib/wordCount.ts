import type { Question } from '@udn/shared';

/**
 * 作文字數。**只有這一支**，畫面與送出後端的值都走它。
 *
 * 中文不計空白（換行、縮排都不算），英文才數單字 —— 兩種語言的「字數」
 * 本來就是兩回事。
 *
 * ⚠️ 以前這個規則寫在 StudentEssayEditor 的 useMemo 裡，而 `submitEssay()`
 *    另外用 `content.length` 送出 —— 同一篇作文，畫面顯示 246，
 *    資料庫存 252（空白與換行被算進去了）。教師端的成績表讀的是資料庫那個。
 *    這正是 CLAUDE.md 那條「同一份資訊不要在多處各自解析」。
 */
export function countWords(content: string, subject?: Question['subject']): number {
  if (subject !== 'English') {
    return content.replace(/\s/g, '').length;
  }
  return content.trim().split(/\s+/).filter((w) => w.length > 0).length;
}
