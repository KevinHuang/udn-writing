import { db } from './database';

class AssignmentHelper {

    /** 根據學生的使用者編號，取得本學期被指派的作業清單 */
    public static async getAssignments(user_id: string) {
        const sql = `
            with current_semester AS (
                -- 找出目前學年期
                select *
                from 
                    semesters
                where
                    start_date <= now()::date
                    and
                    end_date >= now()::date
            ),

            target_user AS (
                -- 找出使用者資訊
                select * from "user" where id = $1
            ),

            target_course AS (
                -- 找出這位使用者在本學期修習的課程
                select crs.*
                from course crs
                    -- inner join current_semester cs 
                    --     ON cs.school_year = crs.school_year
                    --     AND cs.semester = crs.semester
                where
                    crs.id IN (
                        select ref_course_id 
                        from uc_learner INNER JOIN target_user u 
                            ON uc_learner.ref_user_id = u.id
                    )
            ),

            raw_data AS (
                SELECT 
                    a.id as assignment_id,
                    t.id as task_id,
                    s.school_name ,
                    c.course_name,
                    t.title ,
                    t.description ,
                    t.pic1,
                    t.pic_position,
                    t.note,
                    a.assigned_at,
                    -- 繳交狀態判斷
                    CASE 
                        WHEN sub.id IS NOT NULL THEN true
                        ELSE false
                    END AS is_submitted,
                    sub.submited_time ,
                    sub.content as submission_content,
                    sub.last_update,
                    -- 批改狀態判斷 (重點新增)
                    CASE 
                        WHEN fb.id IS NOT NULL THEN true
                        ELSE false
                    END AS has_feedback,
                    fb.score ,
                    fb.content as feedback_content ,
                    fb.is_returned
                FROM 
                    target_user u
                    JOIN public.uc_learner ul ON u.id = ul.ref_user_id
                    JOIN target_course c ON ul.ref_course_id = c.id
                    JOIN public.school s ON c.ref_school_id = s.id
                    JOIN public.assignment a ON c.id = a.ref_course_id
                    JOIN public.task t ON a.ref_task_id = t.id
                    -- 連接提交紀錄
                    LEFT JOIN public.submission sub ON (a.id = sub.ref_assignment_id AND u.id = sub.ref_user_id)
                    -- 連接批改紀錄，並篩選有效的批改 (is_valid = true)
                    LEFT JOIN (
                        SELECT * 
                        FROM public.submission_feedback 
                        WHERE is_valid = true
                    ) fb ON (sub.id = fb.ref_submission_id)   
                WHERE
                    a.opened = true
                ORDER BY 
                    a.assigned_at DESC
            )
            select * from raw_data
        `;

        const result = await db.default.manyOrNone(sql, [user_id]);

        return result || [];
    }

    /** 根據課程編號，取得指派給這個成的任務清單與狀態 */
    /**
     * 某個班級的作業清單。
     *
     * ⚠️ **`user_id` 一定要進 WHERE。** 先前這支收了 user_id 卻完全沒用，
     *    WHERE 只比對 courseId —— 任何教師都讀得到任何班的作業。
     *
     * 排序改用 sort_order（migration 001）。先前是 `ORDER BY week_no`，
     * 但時間模型已決定以原型為準：截止日 + 教師拖拉排序，week_no 不使用。
     * NULLS LAST 讓沒排過的落在最後（與 lib/assignmentOrder.ts 一致）。
     */
    public static async getAssignmentsByCourseId(user_id: string, courseId: string) {
        const sql = `
            SELECT
                ass.id,
                ass.ref_course_id,
                ass.ref_task_id,
                ass.ref_user_id,
                ass.assigned_at,
                ass.opened,
                ass.opened_at,
                ass.deadline,
                ass.allow_late_submission,
                ass.sort_order,
                ass.week_no,
                task.title AS task_title,
                task.description as task_description,
                (SELECT COUNT(*) FROM uc_learner ul WHERE ul.ref_course_id = ass.ref_course_id) AS total_students
            FROM
                assignment AS ass
                INNER JOIN task ON task.id = ass.ref_task_id
            WHERE
                ass.ref_course_id = $1
                AND ass.ref_course_id IN (
                    SELECT ref_course_id FROM uc_instructor WHERE ref_user_id = $2
                )
            ORDER BY
                ass.sort_order ASC NULLS LAST, ass.assigned_at ASC
        `;
        return (await db.default.manyOrNone(sql, [courseId, user_id])) || [];
    }

    /**
     * 開關作業（Draft ⇄ Published）。
     *
     * ⚠️ **`opened_at` 只在「開啟」時寫，而且只寫第一次。**
     *    先前不論開或關都 `opened_at = NOW()` —— 那會毀掉前端三種狀態的區分：
     *
     *      opened = true                        → Published（進行中）
     *      opened = false, opened_at IS NULL    → Draft（從未開放，學生看不到）
     *      opened = false, opened_at IS NOT NULL→ Closed（開過又收回，學生看得到成績）
     *
     *    關閉時把 opened_at 蓋成現在，等於宣告「它剛剛才第一次開放」，
     *    Draft 與 Closed 從此分不出來。COALESCE 保留第一次開放的時間。
     *
     * ⚠️ 授權進 WHERE：先前只比對 id，任何教師都能開關別人班的作業。
     *    錯誤訊息寫著 unauthorized，但 SQL 裡沒有任何 authorization。
     */
    public static async updateStatus(assignmentId: string, body: { opened: boolean }, userId: string) {
        const sql = `
            UPDATE assignment
            SET opened = $1,
                opened_at = CASE WHEN $1 THEN COALESCE(opened_at, NOW()) ELSE opened_at END
            WHERE id = $2
              AND ref_course_id IN (
                    SELECT ref_course_id FROM uc_instructor WHERE ref_user_id = $3
              )
            RETURNING *;
        `;
        return await db.default.oneOrNone(sql, [body.opened, assignmentId, userId]) || null;
    }

    /**
     * 新增指派任務。
     *
     * ⚠️ **只能派給自己教的班。** 先前直接 INSERT 任何 ref_course_id ——
     *    教師可以把作業派進別人的班級。用 SELECT ... WHERE EXISTS 取代
     *    VALUES，不是自己的班就插不進去（回 null → 路由回 403）。
     *
     * sort_order 自動接在該班最後面。前端的 lib/assignmentOrder.ts 也是
     * 這個規則 —— 在唯一的建立入口補上，不管誰呼叫都不會漏。
     */
    public static async create(data: {
        ref_course_id: string;
        ref_task_id: string;
        week_no?: number | null;
        deadline?: string | null;
        allow_late_submission?: boolean;
    }, userId: string) {
        const sql = `
            INSERT INTO assignment (
                ref_course_id, ref_task_id, ref_user_id, week_no, opened, assigned_at,
                deadline, allow_late_submission, sort_order
            )
            SELECT
                $1, $2, $3, $4, false, NOW(), $5, $6,
                COALESCE((SELECT MAX(sort_order) + 1 FROM assignment WHERE ref_course_id = $1), 0)
            WHERE EXISTS (
                SELECT 1 FROM uc_instructor WHERE ref_course_id = $1 AND ref_user_id = $3
            )
            RETURNING *;
        `;
        return await db.default.oneOrNone(sql, [
            data.ref_course_id, data.ref_task_id, userId, data.week_no ?? null,
            data.deadline ?? null, data.allow_late_submission ?? false,
        ]) || null;
    }

    /** 更新截止日與逾期設定（僅限自己教的班） */
    public static async updateConfig(assignmentId: string, data: {
        deadline?: string | null;
        allow_late_submission?: boolean;
    }, userId: string) {
        const sql = `
            UPDATE assignment
            SET deadline = $2,
                allow_late_submission = COALESCE($3, allow_late_submission)
            WHERE id = $1
              AND ref_course_id IN (
                    SELECT ref_course_id FROM uc_instructor WHERE ref_user_id = $4
              )
            RETURNING *;
        `;
        return await db.default.oneOrNone(sql,
            [assignmentId, data.deadline ?? null, data.allow_late_submission ?? null, userId]) || null;
    }

    /**
     * 重新排序（教師在課程作業清單裡拖拉的結果）。
     *
     * 收的是「這個班的作業 id，照老師要的順序」。一次寫完整個班而不是
     * 逐筆搬移，因為拖拉的結果本來就是一份完整的順序 —— 逐筆更新的話
     * 中途失敗會留下半套順序。整包在一個交易裡。
     *
     * 不在清單裡的作業不動（可能是別人剛新增的），也不會把別班的作業
     * 一起改到 —— WHERE 有 ref_course_id 與授權兩道。
     */
    public static async reorder(courseId: string, orderedIds: string[], userId: string) {
        return await db.default.tx(async (t) => {
            const owns = await t.oneOrNone(
                `SELECT 1 FROM uc_instructor WHERE ref_course_id = $1 AND ref_user_id = $2`,
                [courseId, userId]);
            if (!owns) return null;

            for (let i = 0; i < orderedIds.length; i++) {
                await t.none(
                    `UPDATE assignment SET sort_order = $3 WHERE id = $1 AND ref_course_id = $2`,
                    [orderedIds[i], courseId, i]);
            }
            return { updated: orderedIds.length };
        });
    }

    /**
     * 刪除作業（僅限自己教的班），連同底下的東西一起清乾淨。
     *
     * 這個資料庫**幾乎沒有外鍵**，所以連鎖清理大半要自己寫。現況是：
     *
     *   submission_feedback → submission   ❌ 沒有外鍵，**必須手動刪**
     *   submission_mark     → submission   ✅ ON DELETE CASCADE（migration 001）
     *   assignment_leave    → assignment   ✅ ON DELETE CASCADE（migration 001）
     *   submission          → assignment   ❌ 沒有外鍵，**必須手動刪**
     *
     * 所以順序是由下往上：先清 feedback，再刪 submission（順帶帶走 mark），
     * 最後刪 assignment（順帶帶走 leave）。少刪一層就留下指向不存在作業的
     * 孤兒資料，而統計與關心名單都會把它們算進去 —— CLAUDE.md 整整一節
     * 在講這個坑。全部在一個交易裡，中途失敗不會留下半套。
     */
    public static async deleteById(assignmentId: string, userId: string) {
        return await db.default.tx(async (t) => {
            const owned = await t.oneOrNone(
                `SELECT id FROM assignment
                 WHERE id = $1
                   AND ref_course_id IN (
                         SELECT ref_course_id FROM uc_instructor WHERE ref_user_id = $2
                   )`,
                [assignmentId, userId]);
            if (!owned) return null;

            await t.none(
                `DELETE FROM submission_feedback
                 WHERE ref_submission_id IN (SELECT id FROM submission WHERE ref_assignment_id = $1)`,
                [assignmentId]);
            await t.none(`DELETE FROM submission WHERE ref_assignment_id = $1`, [assignmentId]);
            return await t.oneOrNone(`DELETE FROM assignment WHERE id = $1 RETURNING *`, [assignmentId]);
        });
    }

    /** 更換現有 assignment 的題目（更換模式） */
    public static async updateTask(assignmentId: string, ref_task_id: string, userId: string) {
        const sql = `
            UPDATE assignment
            SET ref_task_id = $2,
                assigned_at = NOW()
            WHERE id = $1
              AND ref_course_id IN (
                    SELECT ref_course_id FROM uc_instructor WHERE ref_user_id = $3
              )
            RETURNING *;
        `;
        // ⚠️ 授權進 WHERE —— 先前只比對 id，任何教師都能換掉別人班作業的題目
        const result = await db.default.oneOrNone(sql, [assignmentId, ref_task_id, userId]);
        return result || null;
    }
}

export default AssignmentHelper;