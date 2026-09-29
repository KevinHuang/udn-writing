import { db } from './database';

/**
 * 不打 Cloud Run 的 OCR job（測試與本機開發用）。
 *
 * 真正的 `ocr-job` 原始碼不在這個 repo，本機也沒有 GCP 憑證 ——
 * 不包這一層，「開始辨識／重試」那條路在測試裡完全跑不到。
 *
 * 兩種模式（**要明確開啟**，正式環境一律無效）：
 *
 *   OCR_JOB_FAKE=1          只記錄「被叫了幾次、叫了誰」。測試用 ——
 *                           斷言「重試沒有重傳照片」「範圍外的沒被觸發」。
 *
 *   OCR_JOB_FAKE=simulate   記錄之外，幾秒後把**示範文字**寫回去（ocr_time ＋ submission），
 *                           讓本機可以走完「上傳 → 辨識中 → 完成 → 校對」整條畫面。
 *                           文字開頭標明示範模式，不會被誤認為真的辨識結果。
 *
 * ⚠️ simulate 寫回去的方式是**猜的**（真正的 job 怎麼寫是黑箱，見計畫的階段 0）。
 *    它只是讓畫面動得起來，不代表真的 job 也是這樣寫。
 */
export type OcrJobFakeMode = 'off' | 'record' | 'simulate';

export function ocrJobFakeMode(): OcrJobFakeMode {
    if (process.env.NODE_ENV === 'production') return 'off';
    const v = (process.env.OCR_JOB_FAKE || '').toLowerCase();
    if (v === 'simulate') return 'simulate';
    if (v === '1' || v === 'true') return 'record';
    return 'off';
}

export const ocrJobCalls: Array<{ studentId: string; assignmentId: string; batchUUID?: string }> = [];

export function resetOcrJobCalls(): void {
    ocrJobCalls.length = 0;
}

/** 示範文字的標記。任何人看到就知道這不是真的辨識結果 */
export const SIMULATED_OCR_NOTICE = '【示範模式：以下為模擬的辨識結果，不是真的 OCR】';

/** simulate 模式等多久才「辨識完成」—— 讓畫面看得到「辨識中」那一段 */
const SIMULATE_DELAY_MS = 6000;

export function fakeStartOcrJob(studentId: string, assignmentId: string, batchUUID?: string): string {
    ocrJobCalls.push({ studentId, assignmentId, batchUUID });
    if (ocrJobFakeMode() === 'simulate') {
        setTimeout(() => {
            void simulateCompletion(studentId, assignmentId, batchUUID).catch((e) =>
                console.error('[ocr-job:simulate] 寫回失敗', e));
        }, SIMULATE_DELAY_MS);
    }
    return `fake-execution-${ocrJobCalls.length}`;
}

async function simulateCompletion(studentId: string, assignmentId: string, batchUUID?: string) {
    await db.default.tx(async (t) => {
        const batch = await t.oneOrNone<{ id: string; img_files: unknown }>(
            `SELECT id, img_files FROM batch_proxy_submission
              WHERE ref_user_id = $1::bigint AND ref_assignment_id = $2::bigint
                AND is_valid = true
                AND ($3::text IS NULL OR batch_uuid = $3::text)
              ORDER BY created_at DESC, id DESC LIMIT 1`,
            [studentId, assignmentId, batchUUID ?? null]);
        if (!batch) return;

        const content = `${SIMULATED_OCR_NOTICE}\n\n那次失敗之後，我學會了面對自己的不足。`;
        /*
          與 SubmissionHelper.submit 同一道擋：已經批改過的不覆寫。
          （真正的 job 有沒有這道擋是未知數 —— 計畫階段 0 的第 6 題。）
        */
        await t.none(
            `INSERT INTO submission (ref_user_id, ref_assignment_id, content, word_count, is_submitted, submited_time)
             SELECT $1::bigint, $2::bigint, $3::text, char_length($3::text), true, now()
              WHERE NOT EXISTS (SELECT 1 FROM submission
                                 WHERE ref_user_id = $1::bigint AND ref_assignment_id = $2::bigint)`,
            [studentId, assignmentId, content]);
        await t.none(
            `UPDATE submission s
                SET content = $3::text, word_count = char_length($3::text), last_update = now()
              WHERE s.ref_user_id = $1::bigint AND s.ref_assignment_id = $2::bigint
                AND NOT EXISTS (SELECT 1 FROM submission_feedback f
                                 WHERE f.ref_submission_id = s.id AND f.is_valid = true)`,
            [studentId, assignmentId, content]);
        await t.none(
            `UPDATE batch_proxy_submission SET ocr_time = now(), ocr_model = 'simulated' WHERE id = $1`,
            [batch.id]);
    });
}
