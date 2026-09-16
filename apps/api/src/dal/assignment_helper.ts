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
                ass.week_no,
                task.title AS task_title,
                task.description as task_description
            FROM
                assignment AS ass
                INNER JOIN task ON task.id = ass.ref_task_id
            WHERE
                ass.ref_course_id = $1
            ORDER BY
                ass.week_no ASC
        `;

        const result = await db.default.manyOrNone(sql, [courseId]);

        return result || [];
    }

    /** 更新任務的開啟狀態 */
    public static async updateStatus(assignmentId: string, body: { opened: boolean }, userId: string) {
        const sql = `
            UPDATE assignment
            SET opened = $1,
                opened_at = NOW()
            WHERE id = $2
            RETURNING *;
        `;

        const result = await db.default.oneOrNone(sql, [body.opened, assignmentId]);
        return result || null;
    }

    /** 新增指派任務（指定課程、周次、任務） */
    public static async create(data: {
        ref_course_id: string;
        ref_task_id: string;
        week_no: number;
    }, userId: string) {
        const sql = `
            INSERT INTO assignment (ref_course_id, ref_task_id, ref_user_id, week_no, opened, assigned_at)
            VALUES ($1, $2, $3, $4, false, NOW())
            RETURNING *;
        `;
        const result = await db.default.oneOrNone(sql, [
            data.ref_course_id,
            data.ref_task_id,
            userId,
            data.week_no,
        ]);
        return result || null;
    }

    /** 更換現有 assignment 的題目（更換模式） */
    public static async updateTask(assignmentId: string, ref_task_id: string, userId: string) {
        const sql = `
            UPDATE assignment
            SET ref_task_id = $2,
                assigned_at = NOW()
            WHERE id = $1
            RETURNING *;
        `;
        const result = await db.default.oneOrNone(sql, [assignmentId, ref_task_id]);
        return result || null;
    }
}

export default AssignmentHelper;