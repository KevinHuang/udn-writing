import { db } from './database';
import type { DecisionPlan, DecisionRow, Target } from '../lib/manuscript/marks';

/**
 * 原稿紅筆的資料：老師在原稿上的決定（manuscript_mark_decision，migration 013）。
 * 呼叫端都已經用 courseScopeOf 確認過老師看得到這篇作文；這裡不再檢查範圍。
 */
class ManuscriptHelper {

    public static async listDecisions(gridId: string): Promise<DecisionRow[]> {
        const rows = await db.default.manyOrNone(
            `SELECT target, cell_key, decision, correct, note
               FROM manuscript_mark_decision WHERE ref_grid_result_id = $1::bigint`,
            [gridId]);
        return rows.map((r) => ({ target: r.target, cellKey: r.cell_key, decision: r.decision, correct: r.correct, note: r.note }));
    }

    public static async apply(params: {
        gridId: string; submissionId: string; target: Target; cellKey: string; plan: DecisionPlan; userId: string;
    }): Promise<void> {
        const { gridId, submissionId, target, cellKey, plan, userId } = params;
        if (plan.op === 'delete') {
            await db.default.none(
                `DELETE FROM manuscript_mark_decision
                  WHERE ref_grid_result_id = $1::bigint AND target = $2 AND cell_key = $3`,
                [gridId, target, cellKey]);
            return;
        }
        await db.default.none(
            `INSERT INTO manuscript_mark_decision
                 (ref_grid_result_id, ref_submission_id, target, cell_key, decision, correct, note, decided_by)
             VALUES ($1::bigint, $2::bigint, $3, $4, $5, $6, $7, $8::bigint)
             ON CONFLICT (ref_grid_result_id, target, cell_key) DO UPDATE SET
                 decision = EXCLUDED.decision, correct = EXCLUDED.correct, note = EXCLUDED.note,
                 decided_by = EXCLUDED.decided_by, updated_at = now()`,
            [gridId, submissionId, target, cellKey, plan.decision, plan.correct, plan.note, userId]);
    }

    /**
     * 已發還就鎖住：學生看得到的紅筆不能在他看過之後偷偷改。要改先收回發還。
     * 看的是目前有效的那一版批改。
     */
    public static async isReturned(submissionId: string): Promise<boolean> {
        const row = await db.default.oneOrNone(
            `SELECT 1 FROM submission_feedback
              WHERE ref_submission_id = $1::bigint AND is_valid = true AND is_returned = true LIMIT 1`,
            [submissionId]);
        return Boolean(row);
    }
}

export default ManuscriptHelper;
