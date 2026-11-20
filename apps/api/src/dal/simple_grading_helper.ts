import { db } from './database';
import { normalizeForCompare, type StoredGridResult } from '../lib/simple_grading/essay';
import type { SimpleGradingDetail } from '../lib/simple_grading/result';
import type { SimpleGradingRun } from '../lib/simple_grading/grade';

/**
 * 簡易批改的資料：判斷一篇作文能不能用簡易批改、存取只給老師看的細節（simple_grading_result，migration 012）。
 * 呼叫端都已經用 courseScopeOf 確認過老師看得到這篇作文；這裡不再檢查範圍。
 */

export interface GridForSubmission extends StoredGridResult {
    gridId: string;
    assignmentId: string;
    sheetTemplate: string | null;
    completion: number | null;
    /** 拉正的稿紙圖：GCS 裸檔名，依頁序，和照片同一個資料夾（submit/assign_<id>/） */
    pageImageFiles: string[];
}

export interface SimpleGradingEligibility {
    /** 這篇作文能不能用簡易批改 */
    eligible: boolean;
    /** 不能用時的原因（給老師看）；能用時 null */
    reason: 'no_grid' | 'edited' | null;
    grid: GridForSubmission | null;
}

class SimpleGradingHelper {

    /**
     * 這篇作文最近一次完成的逐格辨識結果。
     * ⚠️ 不看 batch_proxy_submission.is_valid：老師校對完會把那一批退役，但辨識結果（格子、錯字）還要用。
     *    文字有沒有被改過，由 eligibilityOf 比對內容決定。
     */
    public static async gridForSubmission(submissionId: string): Promise<GridForSubmission | null> {
        const row = await db.default.oneOrNone(
            `SELECT g.id::text AS grid_id, g.ref_assignment_id::text AS assignment_id, g.sheet_template, g.completion,
                    g.marked_text, g.chars, g.paragraphs, g.pages, g.typo_marks, g.format_issues, g.page_image_files
               FROM submission s
               JOIN handwriting_grid_result g
                 ON g.ref_assignment_id = s.ref_assignment_id AND g.ref_user_id = s.ref_user_id
              WHERE s.id = $1::bigint AND g.status = 'done'
              ORDER BY g.finished_at DESC NULLS LAST, g.id DESC
              LIMIT 1`,
            [submissionId]);
        if (!row) return null;
        return {
            gridId: row.grid_id,
            assignmentId: row.assignment_id,
            sheetTemplate: row.sheet_template,
            pageImageFiles: Array.isArray(row.page_image_files) ? row.page_image_files : [],
            completion: row.completion === null ? null : Number(row.completion),
            markedText: row.marked_text,
            chars: row.chars,
            paragraphs: row.paragraphs,
            pages: row.pages,
            typoMarks: row.typo_marks,
            formatIssues: row.format_issues,
        };
    }

    /**
     * 能不能用簡易批改：有完成的逐格辨識，而且作文的文字還是辨識出來的那一份。
     * 老師「校對文字」改過 → 文字已經是人看過的了，照一般批改（格子也對不上了，引用沒辦法逐格檢查）。
     */
    public static async eligibilityOf(submissionId: string, content: string | null): Promise<SimpleGradingEligibility> {
        const grid = await this.gridForSubmission(submissionId);
        if (!grid || !grid.markedText) return { eligible: false, reason: 'no_grid', grid: null };
        if (normalizeForCompare(content) !== normalizeForCompare(grid.markedText)) {
            return { eligible: false, reason: 'edited', grid };
        }
        return { eligible: true, reason: null, grid };
    }

    /** 存只給老師看的細節：一篇一列，重新批改整列換掉 */
    public static async save(submissionId: string, gridId: string, feedbackId: string | null, run: SimpleGradingRun): Promise<void> {
        await db.default.none(
            `INSERT INTO simple_grading_result
                 (ref_submission_id, ref_grid_result_id, ref_feedback_id, detail, model, prompt_version,
                  ai_calls, input_tokens, output_tokens)
             VALUES ($1::bigint, $2::bigint, $3::bigint, $4::jsonb, $5, $6, $7, $8, $9)
             ON CONFLICT (ref_submission_id) DO UPDATE SET
                 ref_grid_result_id = EXCLUDED.ref_grid_result_id,
                 ref_feedback_id    = EXCLUDED.ref_feedback_id,
                 detail             = EXCLUDED.detail,
                 model              = EXCLUDED.model,
                 prompt_version     = EXCLUDED.prompt_version,
                 ai_calls           = EXCLUDED.ai_calls,
                 input_tokens       = EXCLUDED.input_tokens,
                 output_tokens      = EXCLUDED.output_tokens,
                 updated_at         = now()`,
            [submissionId, gridId, feedbackId, JSON.stringify(run.outcome.detail), run.model,
                run.outcome.detail.promptVersion, run.aiCalls, run.inputTokens, run.outputTokens]);
    }

    public static async get(submissionId: string): Promise<{ detail: SimpleGradingDetail; model: string | null; updatedAt: string } | null> {
        const row = await db.default.oneOrNone(
            `SELECT detail, model, updated_at FROM simple_grading_result WHERE ref_submission_id = $1::bigint`,
            [submissionId]);
        return row ? { detail: row.detail, model: row.model, updatedAt: row.updated_at } : null;
    }

    /** 重置批改：作文回到待批改，舊的評分依據、請老師留意不再對得上 */
    public static async remove(submissionId: string): Promise<void> {
        await db.default.none(`DELETE FROM simple_grading_result WHERE ref_submission_id = $1::bigint`, [submissionId]);
    }
}

export default SimpleGradingHelper;
