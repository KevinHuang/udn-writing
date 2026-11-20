import { systemConfirmedTypos, type FormatIssue, type TypoMark } from './essay';

/**
 * 給老師看的辨識摘要（批改頁的簡易批改區塊）：辨識完成度、確定／待確認的錯字數、格式問題。
 * 純函式。
 */

/**
 * 辨識完成度低於這個比例就提醒老師：有些字可能讀錯，批改前對照一下原稿。
 * 暫定 85%（1Campus Write 同一個數字，等有真實樣本再調）。
 */
export const LOW_COMPLETION = 0.85;

export interface GridSummary {
    template: string | null;
    /** 可信的格子 ÷ 有寫字的格子（0～1）；沒有資料時 null */
    completion: number | null;
    lowCompletion: boolean;
    chars: number | null;
    paragraphs: number | null;
    /** 確定的錯別字（系統有把握、重複只算一個）—— 送 AI 的就是這一份 */
    confirmedTypos: number;
    /** 待確認的錯字：只給老師看，不算分、不送 AI（第三階段在原稿上讓老師確認） */
    pendingTypos: number;
    /** 段首沒空兩格的處數 */
    indentIssues: number;
    /** 標點寫在行首的處數 */
    punctuationIssues: number;
}

export function summarizeGrid(grid: {
    sheetTemplate: string | null;
    completion: number | null;
    chars: number | null;
    paragraphs: number | null;
    typoMarks: TypoMark[] | null;
    formatIssues: FormatIssue[] | null;
}): GridSummary {
    const marks = Array.isArray(grid.typoMarks) ? grid.typoMarks : [];
    const issues = Array.isArray(grid.formatIssues) ? grid.formatIssues : [];
    const completion = typeof grid.completion === 'number' && Number.isFinite(grid.completion) ? grid.completion : null;
    return {
        template: grid.sheetTemplate,
        completion,
        lowCompletion: completion !== null && completion < LOW_COMPLETION,
        chars: grid.chars,
        paragraphs: grid.paragraphs,
        confirmedTypos: systemConfirmedTypos(marks).length,
        pendingTypos: marks.filter((m) => m?.kind === 'check').length,
        indentIssues: issues.filter((i) => i?.type === '段首空兩格').length,
        punctuationIssues: issues.filter((i) => i?.type === '標點在行首').length,
    };
}
