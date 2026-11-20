import ManuscriptHelper from '../../dal/manuscript_helper';
import type { GridForSubmission } from '../../dal/simple_grading_helper';
import {
    activeFormatIssues, confirmedTypos, flaggedTypos, markBaseline, mergeManuscriptMarks,
    type MergedMarks,
} from './marks';

/**
 * 原稿紅筆 API 的回傳內容（docs/manuscript.md）。
 */

const isRect = (rect: unknown): rect is number[] =>
    Array.isArray(rect) && rect.length === 4 && rect.every((v) => Number.isFinite(Number(v)));

export interface ManuscriptPagePayload {
    page: number;
    prefix: string;
    /** 拉正的稿紙圖：經 API 轉送（老師的範圍檢查、本機假儲存都照樣能用） */
    imageUrl: string | null;
    /** 有寫字的格子；rect 是拉正的稿紙圖上的 [左, 上, 右, 下] 像素 */
    cells: Array<{ key: string; rect: number[]; text: string; status: string }>;
}

/**
 * 每頁拉正的稿紙圖與有字的格子位置。純函式。
 * 只給有字的格子：空格子不畫標記，也不能加錯字（沒有字可以錯）。
 */
export function toManuscriptPages(grid: Pick<GridForSubmission, 'pages' | 'pageImageFiles'>, submissionId: string): ManuscriptPagePayload[] {
    return (Array.isArray(grid.pages) ? grid.pages : []).map((page, order) => {
        const number = page?.page ?? order + 1;
        const prefix = page?.prefix || `第${number}頁`;
        const cells = (Array.isArray(page?.ocr?.cells) ? page.ocr!.cells! : [])
            .filter((c) => c?.status !== 'blank' && typeof c?.text === 'string' && c.text && isRect((c as { rect?: unknown }).rect))
            .map((c) => ({
                key: `${prefix}:${c.col}:${c.row}`,
                rect: ((c as { rect: unknown[] }).rect).map(Number),
                text: c.text as string,
                status: String(c.status ?? ''),
            }));
        return {
            page: number,
            prefix,
            imageUrl: grid.pageImageFiles?.[order]
                ? `/service/instructor/grading/${submissionId}/manuscript/pages/${order}`
                : null,
            cells,
        };
    });
}

/** 合併後的標記與目前的錯字狀態（每次寫入決定後也回傳這一份） */
export const toMarksPayload = (merged: MergedMarks) => ({
    typos: merged.typos,
    formats: merged.formats,
    current: markBaseline(merged),
});

/** 一篇作文目前的標記：系統標記＋老師的決定 */
export async function loadMergedMarks(grid: GridForSubmission): Promise<MergedMarks> {
    return mergeManuscriptMarks(grid, await ManuscriptHelper.listDecisions(grid.gridId));
}

/** 給簡易批改（lib/simple_grading/grade.ts 的 decided）：確定的錯別字、格式問題、要避開的錯字、批改當下的基準 */
export function decidedForGrading(merged: MergedMarks) {
    return {
        confirmedTypos: confirmedTypos(merged),
        formatIssues: activeFormatIssues(merged),
        flaggedTypos: flaggedTypos(merged),
        baseline: markBaseline(merged),
    };
}
