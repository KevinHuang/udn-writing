import { db } from './database';

/**
 * 作品標記（教師蓋在作文上的佳作／預選章）。
 *
 * 可視範圍跟著課程走：只回這位教師教的班的標記。
 * 取消蓋章一律 DELETE 整列 —— 不要留 `is_valid = false` 之類的旗標，
 * 那會讓 COUNT 數錯（見 migration 001 的說明與 CLAUDE.md）。
 */
class SubmissionMarkHelper {

    /** 這位教師所有班級的作品標記 */
    public static async getByInstructorUserId(userId: string) {
        const sql = `
            SELECT
                m.ref_submission_id,
                m.kind,
                m.marked_at
            FROM submission_mark m
                INNER JOIN submission s ON s.id = m.ref_submission_id
                INNER JOIN assignment a ON a.id = s.ref_assignment_id
            WHERE a.ref_course_id IN (
                SELECT ref_course_id FROM uc_instructor WHERE ref_user_id = $1
            )
        `;
        return (await db.default.manyOrNone(sql, [userId])) || [];
    }

    /**
     * 蓋章。同一份作品同一種章只能有一個 —— 靠
     * `UNIQUE (ref_submission_id, kind)` 保證，重複蓋就更新時間。
     */
    public static async set(submissionId: string, kind: string, userId: string) {
        const sql = `
            INSERT INTO submission_mark (ref_submission_id, kind, ref_user_id)
            SELECT $1, $2, $3
            WHERE EXISTS (
                SELECT 1 FROM submission s
                    INNER JOIN assignment a ON a.id = s.ref_assignment_id
                WHERE s.id = $1
                  AND a.ref_course_id IN (
                        SELECT ref_course_id FROM uc_instructor WHERE ref_user_id = $3
                  )
            )
            ON CONFLICT (ref_submission_id, kind)
            DO UPDATE SET marked_at = now(), ref_user_id = EXCLUDED.ref_user_id
            RETURNING *;
        `;
        return await db.default.oneOrNone(sql, [submissionId, kind, userId]);
    }

    /** 取消蓋章。整列刪掉，不留旗標。 */
    public static async unset(submissionId: string, kind: string, userId: string) {
        const sql = `
            DELETE FROM submission_mark m
            USING submission s, assignment a
            WHERE m.ref_submission_id = $1
              AND m.kind = $2
              AND s.id = m.ref_submission_id
              AND a.id = s.ref_assignment_id
              AND a.ref_course_id IN (
                    SELECT ref_course_id FROM uc_instructor WHERE ref_user_id = $3
              )
            RETURNING m.*;
        `;
        return await db.default.oneOrNone(sql, [submissionId, kind, userId]);
    }
}

export default SubmissionMarkHelper;
