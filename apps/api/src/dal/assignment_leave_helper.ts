import { db } from './database';
import { CourseScope, courseScopeSubquery } from '../lib/course_scope';

/**
 * 請假註記。
 *
 * 逾期沒交有兩種：真的沒寫，和請假。標成請假的學生不計入逾期未繳，
 * 關心名單（前端的 lib/concern.ts）也讀這份資料。
 *
 * 鍵是「作業 × 學生」的複合鍵，不是掛在 submission 上 ——
 * **請假的那一份根本沒有繳交紀錄**，沒有東西可以掛。
 */
class AssignmentLeaveHelper {

    public static async getByScope(scope: CourseScope) {
        const sql = `
            SELECT l.ref_assignment_id, l.ref_user_id
            FROM assignment_leave l
                INNER JOIN assignment a ON a.id = l.ref_assignment_id
            WHERE a.ref_course_id IN ${courseScopeSubquery(scope)}
        `;
        return (await db.default.manyOrNone(sql)) || [];
    }

    public static async set(assignmentId: string, studentId: string, markerId: string, scope: CourseScope) {
        const sql = `
            INSERT INTO assignment_leave (ref_assignment_id, ref_user_id, ref_marker_id)
            SELECT $1, $2, $3
            WHERE EXISTS (
                SELECT 1 FROM assignment a
                WHERE a.id = $1
                  AND a.ref_course_id IN ${courseScopeSubquery(scope)}
            )
            ON CONFLICT (ref_assignment_id, ref_user_id) DO NOTHING
            RETURNING *;
        `;
        return await db.default.oneOrNone(sql, [assignmentId, studentId, markerId]);
    }

    public static async unset(assignmentId: string, studentId: string, markerId: string, scope: CourseScope) {
        const sql = `
            DELETE FROM assignment_leave l
            USING assignment a
            WHERE l.ref_assignment_id = $1
              AND l.ref_user_id = $2
              AND a.id = l.ref_assignment_id
              AND a.ref_course_id IN ${courseScopeSubquery(scope)}
            RETURNING l.*;
        `;
        return await db.default.oneOrNone(sql, [assignmentId, studentId, markerId]);
    }
}

export default AssignmentLeaveHelper;
