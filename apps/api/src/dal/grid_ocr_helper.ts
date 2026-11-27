import { db } from './database';
import type { GridOcrOutput } from '../lib/grid_ocr/pipeline';

/**
 * 稿紙逐格辨識的資料（handwriting_grid_result，docs/migrations/011-grid-ocr.sql）。
 * 一批代繳交照片（batch_proxy_submission）一列；狀態 pending → queued → running → done／failed。
 */

export type GridOcrStatus = 'pending' | 'queued' | 'running' | 'done' | 'failed';

/**
 * 卡住超過這麼久就當作失敗了：老師可以重新辨識，前端也顯示成失敗。
 * 一份作文正常 30～90 秒；前端 lib/proxy/status.ts 的 GRID_STALE_MS 要和這裡一致。
 *
 * 兩種卡住，時間基準不同（前端兩格都看，見 proxyOcrStatusOf）：
 *   running 卡住  背景工作領到了卻沒跑完 → 算 started_at
 *   queued  卡住  **背景工作根本沒領到**（job 啟動了但在 claim 之前就掛掉、
 *                 映像檔壞了、配額滿了）→ started_at 還是空的，只能算 updated_at
 *
 * 下面的 SQL 只需要處理 running：queued 本來就在可以重新排隊的狀態裡，
 * 所以老師按「重試」一定動得了 —— 以前的問題是**前端永遠顯示「辨識中」、
 * 不給重試的按鈕**，那一列就永遠卡著。
 */
export const STALE_RUNNING_MINUTES = 15;

/** 背景工作領取到的那一批 */
export interface ClaimedBatch {
    batchId: string;
    assignmentId: string;
    userId: string;
    imgFiles: string[];
}

function filesOf(raw: unknown): string[] {
    if (!raw) return [];
    let arr: unknown = raw;
    if (typeof raw === 'string') {
        try { arr = JSON.parse(raw); } catch { return []; }
    }
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
}

class GridOcrHelper {

    /** 上傳時認出是我們的稿紙：先建一列 pending。同一批重複呼叫不重複建 */
    public static async createPending(batchId: string, assignmentId: string, userId: string, template: string | null): Promise<void> {
        await db.default.none(
            `INSERT INTO handwriting_grid_result (ref_batch_id, ref_assignment_id, ref_user_id, sheet_template)
             VALUES ($1::bigint, $2::bigint, $3::bigint, $4)
             ON CONFLICT (ref_batch_id) DO NOTHING`,
            [batchId, assignmentId, userId, template]);
    }

    /** 這幾批裡哪些要走逐格辨識（有 handwriting_grid_result 那一列的） */
    public static async gridBatchIds(batchIds: string[]): Promise<Set<string>> {
        if (!batchIds.length) return new Set();
        const rows = await db.default.manyOrNone<{ id: string }>(
            `SELECT ref_batch_id::text AS id FROM handwriting_grid_result WHERE ref_batch_id = ANY($1::bigint[])`,
            [batchIds]);
        return new Set(rows.map((r) => r.id));
    }

    /**
     * 按下「開始辨識」或「重新辨識」：排進佇列、清掉上一次的失敗原因。
     * 正在辨識中的不動（避免同一批跑兩次），除非已經卡住超過 STALE_RUNNING_MINUTES
     * （背景工作中途被關掉，那一列會永遠停在 running）；force＝已經完成的也重跑。
     * 回傳真的排進去的批次。
     */
    public static async markQueued(batchIds: string[], force = false): Promise<string[]> {
        if (!batchIds.length) return [];
        const rows = await db.default.manyOrNone<{ id: string }>(
            `UPDATE handwriting_grid_result
                SET status = 'queued', error_code = NULL, error_message = NULL, updated_at = now()
              WHERE ref_batch_id = ANY($1::bigint[])
                AND (status IN ('pending', 'queued', 'failed')
                     OR ($2::boolean AND status = 'done')
                     OR (status = 'running' AND started_at < now() - make_interval(mins => $3)))
              RETURNING ref_batch_id::text AS id`,
            [batchIds, force, STALE_RUNNING_MINUTES]);
        return rows.map((r) => r.id);
    }

    /**
     * 背景工作領取一批（queued → running）。照片那一批已經被換掉（老師重拍、is_valid=false）就不領，
     * 直接標失敗 —— 新的那一批有自己的一列。
     */
    public static async claim(batchId: string): Promise<ClaimedBatch | null> {
        return db.default.tx(async (t) => {
            const row = await t.oneOrNone<{ assignment_id: string; user_id: string; img_files: unknown; is_valid: boolean }>(
                `SELECT g.ref_assignment_id::text AS assignment_id, g.ref_user_id::text AS user_id,
                        b.img_files, b.is_valid
                   FROM handwriting_grid_result g
                   JOIN batch_proxy_submission b ON b.id = g.ref_batch_id
                  WHERE g.ref_batch_id = $1::bigint AND g.status = 'queued'
                  FOR UPDATE OF g`,
                [batchId]);
            if (!row) return null;
            if (!row.is_valid) {
                await t.none(
                    `UPDATE handwriting_grid_result
                        SET status = 'failed', error_code = 'SUPERSEDED',
                            error_message = '這一批照片已經被新上傳的取代', updated_at = now(), finished_at = now()
                      WHERE ref_batch_id = $1::bigint`, [batchId]);
                return null;
            }
            await t.none(
                `UPDATE handwriting_grid_result
                    SET status = 'running', started_at = now(), attempts = attempts + 1, updated_at = now()
                  WHERE ref_batch_id = $1::bigint`, [batchId]);
            return { batchId, assignmentId: row.assignment_id, userId: row.user_id, imgFiles: filesOf(row.img_files) };
        });
    }

    /**
     * 辨識完成：結果存進這張表，全文寫進學生的作文（跟老師手動代繳交同一個規則：已批改的不覆寫），
     * 批次記下 ocr_time（舊的狀態判斷照樣看得懂：有 ocr_time 又有文字＝已辨識、等老師校對）。
     *
     * 寫入前再確認一次這一批還是現行的：辨識要幾十秒，期間老師可能重拍了 —— 那就不寫，免得舊照片的
     * 結果蓋掉新的。回傳 'saved'／'superseded'。
     */
    public static async saveDone(
        claimed: ClaimedBatch,
        out: GridOcrOutput,
        pageImageFiles: string[],
        model: string,
    ): Promise<'saved' | 'superseded'> {
        const picFiles = claimed.imgFiles.map((f) => (f.includes('/') ? f : `submit/assign_${claimed.assignmentId}/${f}`));
        return db.default.tx(async (t) => {
            const batch = await t.oneOrNone<{ is_valid: boolean }>(
                `SELECT is_valid FROM batch_proxy_submission WHERE id = $1::bigint FOR UPDATE`, [claimed.batchId]);
            if (!batch?.is_valid) {
                await t.none(
                    `UPDATE handwriting_grid_result
                        SET status = 'failed', error_code = 'SUPERSEDED',
                            error_message = '這一批照片已經被新上傳的取代', updated_at = now(), finished_at = now()
                      WHERE ref_batch_id = $1::bigint`, [claimed.batchId]);
                return 'superseded';
            }
            const words = out.chars ?? Array.from(out.text.replace(/\s/g, '')).length;
            await t.none(
                `INSERT INTO submission (ref_user_id, ref_assignment_id, content, pic_files, word_count, is_submitted, submited_time)
                 SELECT $1::bigint, $2::bigint, $3::text, $4::jsonb, $5::integer, true, now()
                  WHERE NOT EXISTS (SELECT 1 FROM submission WHERE ref_user_id = $1::bigint AND ref_assignment_id = $2::bigint)`,
                [claimed.userId, claimed.assignmentId, out.text, JSON.stringify(picFiles), words]);
            await t.none(
                `UPDATE submission s
                    SET content = $3::text, pic_files = $4::jsonb, word_count = $5::integer, is_submitted = true,
                        submited_time = COALESCE(s.submited_time, now()), last_update = now()
                  WHERE s.ref_user_id = $1::bigint AND s.ref_assignment_id = $2::bigint
                    AND NOT EXISTS (SELECT 1 FROM submission_feedback f WHERE f.ref_submission_id = s.id AND f.is_valid = true)`,
                [claimed.userId, claimed.assignmentId, out.text, JSON.stringify(picFiles), words]);
            await t.none(
                `UPDATE batch_proxy_submission
                    SET ocr_time = now(), ocr_model = $2, input_tokens = $3, output_tokens = $4
                  WHERE id = $1::bigint`,
                [claimed.batchId, `grid:${model}`, out.usage.inputTokens, out.usage.outputTokens]);
            await t.none(
                `UPDATE handwriting_grid_result
                    SET status = 'done', error_code = NULL, error_message = NULL,
                        marked_text = $2, chars = $3, paragraphs = $4, completion = $5,
                        pages = $6::jsonb, format_issues = $7::jsonb, typo_marks = $8::jsonb, warnings = $9::jsonb,
                        page_image_files = $10::jsonb, prompt_version = $11, model = $12, ai_calls = $13,
                        input_tokens = $14, output_tokens = $15, timing = $16::jsonb,
                        finished_at = now(), updated_at = now()
                  WHERE ref_batch_id = $1::bigint`,
                [claimed.batchId, out.markedText, out.chars, out.paragraphs, out.completion,
                    JSON.stringify(out.pages), JSON.stringify(out.formatIssues), JSON.stringify(out.typoMarks),
                    JSON.stringify(out.warnings), JSON.stringify(pageImageFiles), out.promptVersion, model, out.aiCalls,
                    out.usage.inputTokens, out.usage.outputTokens, JSON.stringify(out.timing)]);
            return 'saved';
        });
    }

    /** 辨識失敗：原因給老師看。學生的作文不動 */
    public static async saveFailed(batchId: string, code: string, message: string): Promise<void> {
        await db.default.none(
            `UPDATE handwriting_grid_result
                SET status = 'failed', error_code = $2, error_message = $3, finished_at = now(), updated_at = now()
              WHERE ref_batch_id = $1::bigint`,
            [batchId, code, message]);
    }
}

export default GridOcrHelper;
