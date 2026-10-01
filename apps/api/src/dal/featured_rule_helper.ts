import { db } from './database';
import { CourseScope, courseScopeSubquery } from '../lib/course_scope';

/** 級分的範圍。0 級分「以上」等於全部，沒有意義 */
export const MIN_RULE_SCORE = 1;
export const MAX_RULE_SCORE = 6;
export const DEFAULT_RULE_SCORE = 5;

export const isRuleScore = (n: unknown): n is number =>
    Number.isInteger(n) && (n as number) >= MIN_RULE_SCORE && (n as number) <= MAX_RULE_SCORE;

/**
 * 自動蓋佳作的標準（docs/migrations/009）。
 *
 * 規則（使用者決定，見 migration 的說明）：
 *   - 用當下批改的人的標準；作業另外調整過就用作業的
 *   - 每篇只判斷一次，之後不論改分、取消章都不再動
 *   - 只對之後的批改生效
 */
class FeaturedRuleHelper {

    /** 使用者自己的標準。沒設定過回傳預設值（關閉、5 級分） */
    public static async getUserRule(userId: string) {
        const row = await db.default.oneOrNone<{ enabled: boolean; min_score: number }>(
            `SELECT enabled, min_score FROM featured_rule_user WHERE ref_user_id = $1`,
            [userId],
        );
        return row ?? { enabled: false, min_score: DEFAULT_RULE_SCORE };
    }

    public static async setUserRule(userId: string, enabled: boolean, minScore: number) {
        return await db.default.one<{ enabled: boolean; min_score: number }>(
            `INSERT INTO featured_rule_user (ref_user_id, enabled, min_score, updated_at)
             VALUES ($1, $2, $3, now())
             ON CONFLICT (ref_user_id) DO UPDATE
                SET enabled = EXCLUDED.enabled, min_score = EXCLUDED.min_score, updated_at = now()
             RETURNING enabled, min_score`,
            [userId, enabled, minScore],
        );
    }

    /** 範圍內作業另外調整過的標準。min_score 為 null ＝ 這份作業不自動蓋 */
    public static async getAssignmentRules(scope: CourseScope) {
        return await db.default.manyOrNone<{ assignment_id: string; min_score: number | null }>(
            `SELECT r.ref_assignment_id::text AS assignment_id, r.min_score
               FROM featured_rule_assignment r
               JOIN assignment a ON a.id = r.ref_assignment_id
              WHERE a.ref_course_id IN ${courseScopeSubquery(scope)}`,
        );
    }

    /**
     * 調整某一份作業的標準。
     *
     *   inherit ＝ 刪掉資料列，沿用批改者自己的標準
     *   off     ＝ 這份作業不自動蓋
     *   custom  ＝ 這份作業用 minScore
     *
     * 範圍外的作業回傳 null（呼叫端回 404）。範圍條件寫在 SQL 裡。
     */
    public static async setAssignmentRule(
        assignmentId: string,
        mode: 'inherit' | 'off' | 'custom',
        minScore: number | null,
        userId: string,
        scope: CourseScope,
    ): Promise<{ assignment_id: string; mode: string; min_score: number | null } | null> {
        const owned = await db.default.oneOrNone(
            `SELECT id FROM assignment WHERE id = $1 AND ref_course_id IN ${courseScopeSubquery(scope)}`,
            [assignmentId],
        );
        if (!owned) return null;

        if (mode === 'inherit') {
            await db.default.none(`DELETE FROM featured_rule_assignment WHERE ref_assignment_id = $1`, [assignmentId]);
            return { assignment_id: String(assignmentId), mode, min_score: null };
        }
        const value = mode === 'off' ? null : minScore;
        await db.default.none(
            `INSERT INTO featured_rule_assignment (ref_assignment_id, min_score, ref_user_id, updated_at)
             VALUES ($1, $2, $3, now())
             ON CONFLICT (ref_assignment_id) DO UPDATE
                SET min_score = EXCLUDED.min_score, ref_user_id = EXCLUDED.ref_user_id, updated_at = now()`,
            [assignmentId, value, userId],
        );
        return { assignment_id: String(assignmentId), mode, min_score: value };
    }

    /**
     * 作品**第一次**批改完成時呼叫（InstructorHelper.saveFeedback）。
     *
     * 1. 找出這篇適用的標準：作業調整過用作業的，否則用批改者的（沒開就沒有）
     * 2. 沒有標準 → 什麼都不做，也**不記錄** —— 老師之後開啟，重批時還會判斷
     * 3. 有標準 → 記下「判斷過了」；已經記過就停（每篇只判斷一次）
     * 4. 達標才蓋佳作章。老師自己先蓋過就不動（ON CONFLICT DO NOTHING）
     *
     * 回傳這次有沒有蓋章。
     */
    public static async applyAfterFirstGrading(submissionId: string, score: number, graderId: string): Promise<boolean> {
        const rule = await db.default.oneOrNone<{ min_score: number | null }>(
            `SELECT CASE
                        WHEN fa.ref_assignment_id IS NOT NULL THEN fa.min_score
                        WHEN fu.enabled THEN fu.min_score
                    END AS min_score
               FROM submission s
               LEFT JOIN featured_rule_assignment fa ON fa.ref_assignment_id = s.ref_assignment_id
               LEFT JOIN featured_rule_user fu ON fu.ref_user_id = $2
              WHERE s.id = $1`,
            [submissionId, graderId],
        );
        const minScore = rule?.min_score;
        if (minScore == null) return false;

        const reached = Number(score) >= minScore;
        const judged = await db.default.oneOrNone(
            `INSERT INTO submission_mark_auto (ref_submission_id, min_score, score, marked, ref_user_id)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (ref_submission_id) DO NOTHING
             RETURNING ref_submission_id`,
            [submissionId, minScore, score, reached, graderId],
        );
        if (!judged || !reached) return false;

        await db.default.none(
            `INSERT INTO submission_mark (ref_submission_id, kind, ref_user_id, marked_at)
             VALUES ($1, 'featured', $2, now())
             ON CONFLICT (ref_submission_id, kind) DO NOTHING`,
            [submissionId, graderId],
        );
        return true;
    }
}

export default FeaturedRuleHelper;
