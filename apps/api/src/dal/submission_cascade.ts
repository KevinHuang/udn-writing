import type pgPromise from 'pg-promise';

/**
 * 刪繳交、刪作業、換題時，**資料庫沒有外鍵幫忙的那幾張表**。
 *
 * 這個資料庫幾乎沒有外鍵（只有 migration 001、008～013 補的幾條），所以連鎖清理
 * 大半要自己寫。現況：
 *
 *   submission_feedback        → submission   ❌ 沒有外鍵，呼叫端自己刪
 *   submission_mark            → submission   ✅ CASCADE（migration 001）
 *   submission_mark_auto       → submission   ✅ CASCADE（009）
 *   submission_publish_consent → submission   ✅ CASCADE（010）
 *   assignment_leave           → assignment   ✅ CASCADE（001）
 *   featured_rule_assignment   → assignment   ✅ CASCADE（009）
 *   batch_proxy_submission     → assignment   ❌ **沒有外鍵** ← 這裡處理
 *   handwriting_grid_result    → batch        ✅ CASCADE（011）
 *   manuscript_mark_decision   → grid_result  ✅ CASCADE（013）
 *   simple_grading_result      → submission   ❌ **一條外鍵都沒有**（012）← 這裡處理
 *
 * 所以只要把 `batch_proxy_submission` 那一列刪掉，逐格辨識的結果與老師在原稿上的
 * 決定會順著兩條 CASCADE 一起走；真正要手寫的只有批次本身與簡易批改的細節。
 *
 * ── 為什麼非得清不可（不只是清乾淨比較漂亮）──────────────────
 *
 * `SimpleGradingHelper.gridForSubmission()` 是用 **(作業, 學生)** 去找逐格辨識結果的，
 * 不是用 submission id —— 因為辨識完成時 submission 可能還不存在。於是舊的辨識結果
 * 會黏在「那位學生在那份作業」上：換題之後學生重新交一篇**新題目**的作文，批改頁的
 * 原稿有機會撈到**舊題目**那次拍的稿紙照片與紅筆標記（`GET .../manuscript` 只看有沒有
 * 辨識結果，不比對文字）。老師看到的是另一篇作文的紙。
 *
 * ── GCS 上的照片 ────────────────────────────────────────────
 *
 * **不刪。** 這個系統目前沒有任何刪檔的路徑，而且照片是老師拿紙本拍的、只有這一份。
 * 刪作業之後 `submit/assign_<id>/` 整個資料夾會變成沒有人指得到的檔案 —— 這是已知的
 * 殘留，要清得另外寫一支對照 GCS 與資料庫的腳本（見 artifacts/handoff.md）。
 */

type Tx = pgPromise.ITask<unknown>;

/**
 * **整份作業的學生作品都要消失**（刪作業、換題）時，清掉底下所有人的代繳交痕跡
 * 與簡易批改細節。
 *
 * ⚠️ **一定要在刪 `submission` 之前呼叫** —— 簡易批改的細節是靠 submission 找出來的
 *    （`simple_grading_result.ref_submission_id` 沒有外鍵，submission 一旦刪掉就再也
 *    對不回來，那些列會變成永遠的孤兒）。
 *
 * 批次整列刪掉而不是退役：作業本身都沒了（或換了題目），那幾列誰都讀不到
 * （`statusOf`、`latestValidFor` 都 JOIN assignment），留著只是孤兒。
 */
export async function dropAssignmentWork(t: Tx, assignmentId: string): Promise<void> {
    await t.none(
        `DELETE FROM simple_grading_result
          WHERE ref_submission_id IN (SELECT id FROM submission WHERE ref_assignment_id = $1)`,
        [assignmentId]);
    // CASCADE：handwriting_grid_result → manuscript_mark_decision
    await t.none(`DELETE FROM batch_proxy_submission WHERE ref_assignment_id = $1`, [assignmentId]);
}

/**
 * **一位學生的一份繳交被清掉**（清除繳交）時的收尾。作業還在、別人的作品還在，
 * 所以這裡不刪批次，只讓它「不再是現行的」：
 *
 *   1. 批次退役（is_valid = false）—— 語意與老師按「校對完成」相同。
 *      不退役的話：批改清單那一列會同時是「未繳交」與「AI 辨識未校對」／「辨識失敗」
 *      （徽章讀批次、繳交狀態讀 submission），而且老師按「重試」會把剛剛清掉的作文
 *      整篇寫回來（`GridOcrHelper.saveDone` 的 INSERT ... WHERE NOT EXISTS）。
 *   2. 辨識結果標成不再適用 —— 否則那位學生之後自己打字交一篇新的，
 *      `gridForSubmission()` 用 (作業, 學生) 一撈，還是會撈到這次的照片。
 *      借用既有的 failed＋error_code 表示法（和「照片被新上傳的取代」同一個做法）；
 *      批次已經退役，所以這個狀態不會出現在任何畫面上。
 *   3. 簡易批改的細節刪掉（評分依據、請老師留意、卡片位置都跟著那一份走）。
 *
 * 照片本身留在 GCS，批次那一列也留著 —— 它是唯一指得到那些檔案的紀錄。
 */
export async function clearSubmissionWork(
    t: Tx,
    target: { submissionId: string; assignmentId: string; userId: string },
): Promise<void> {
    const { submissionId, assignmentId, userId } = target;
    await t.none(`DELETE FROM simple_grading_result WHERE ref_submission_id = $1`, [submissionId]);
    await t.none(
        `UPDATE batch_proxy_submission
            SET is_valid = false, last_update = now()
          WHERE ref_assignment_id = $1 AND ref_user_id = $2 AND is_valid = true`,
        [assignmentId, userId]);
    await t.none(
        `UPDATE handwriting_grid_result
            SET status = 'failed', error_code = 'CLEARED',
                error_message = '這一份繳交已經被清除', updated_at = now(), finished_at = now()
          WHERE ref_assignment_id = $1 AND ref_user_id = $2 AND status <> 'failed'`,
        [assignmentId, userId]);
}
