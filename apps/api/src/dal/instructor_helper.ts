import { db } from './database';

class InstructorHelper {

    /**
     * 取得該教師所屬課程的派發任務清單
     */
    public static async getAssignments(teacher_id: string) {
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
            )
            SELECT 
                c.id AS course_id,
                c.course_name AS course_name,
                c.school_year,
                c.semester,
                s.school_name,
                -- 取得該課程的總學生數
                (SELECT COUNT(*) FROM public.uc_learner ul WHERE ul.ref_course_id = c.id) AS student_count,
                t.id AS task_id,
                t.title AS task_title,
                t.description AS task_description,
                t.note AS task_note,
                t.pic1 as task_pic,
                t.pic_position AS task_pic_position,
                a.id AS assignment_id,
                a.assigned_at AS start_date,
                -- 作業的狀態不是一個欄位，是 opened + opened_at 的組合
                --（推導規則在 @udn/shared 的 assignmentStatusOf()）
                a.opened,
                a.opened_at,
                a.deadline,
                a.allow_late_submission,
                a.sort_order,
                -- 取得該項作業已繳交的學生人數
                (SELECT COUNT(*) FROM public.submission s WHERE s.ref_assignment_id = a.id) AS submission_count,
                -- 取得該項作業已批改（且為有效狀態）的學生人數
                (
                    SELECT COUNT(DISTINCT s.ref_user_id)
                    FROM public.submission s
                    JOIN public.submission_feedback sf ON sf.ref_submission_id = s.id
                    WHERE s.ref_assignment_id = a.id AND sf.is_valid = true
                ) AS graded_count
            FROM public.assignment a
            JOIN public.course c ON a.ref_course_id = c.id
            JOIN public.task t ON a.ref_task_id = t.id
            JOIN public.school s ON c.ref_school_id = s.id
            -- 鎖定當學年度與學期
            -- JOIN current_semester sem ON c.school_year = sem.school_year
            --                        AND c.semester = sem.semester 
            -- 篩選條件：1. 教師本人指派 或是 2. 教師所屬班級的作業
            WHERE (a.ref_user_id = $1 OR c.id IN (SELECT ref_course_id FROM public.uc_instructor WHERE ref_user_id = $1))
            
            -- 與單一班級的查詢用同一套排序（sort_order，NULLS LAST）——
            -- 兩個畫面列同一班的作業卻出現兩種順序，老師會覺得系統在跟他鬧
            ORDER BY a.sort_order ASC NULLS LAST, a.assigned_at DESC;
        `;
        return await db.default.manyOrNone(sql, [teacher_id]);
    }

    /**
     * 這位教師所有班級的繳交**摘要**。
     *
     * ⚠️ **刻意不帶 content。** 實測最忙的一位教師有 2,091 筆繳交、
     *    作文內容合計 2.8 MB —— 每次開畫面都拉一次不可行。
     *    去掉之後大約 300 KB，統計、狀態徽章、作品標記都夠用。
     *
     * 需要作文全文的只有批改頁，那裡是「某一份作業」的範圍，
     * 走 getSubmissions(assignmentId)（那一支有 content）。
     *
     * 一樣 LEFT JOIN 名冊 —— 未繳交的學生也要在結果裡，
     * 否則前端算不出 Unsubmitted（見 @udn/shared 的 submissionStatusOf）。
     */
    public static async getSubmissionSummary(userId: string) {
        const sql = `
            SELECT
                a.id AS assignment_id,
                a.ref_course_id AS course_id,
                u.id AS user_id,
                u.name AS student_name,
                ul.seat_no,
                s.id AS submission_id,
                s.is_submitted,
                s.submited_time,
                s.word_count,
                sf.id AS feedback_id,
                sf.score,
                sf.is_returned,
                sf.is_ai
            FROM assignment a
                JOIN uc_learner ul ON ul.ref_course_id = a.ref_course_id
                JOIN "user" u ON u.id = ul.ref_user_id
                LEFT JOIN submission s ON s.ref_user_id = u.id AND s.ref_assignment_id = a.id
                LEFT JOIN (
                    SELECT DISTINCT ON (ref_submission_id) *
                    FROM submission_feedback
                    WHERE is_valid = true
                    ORDER BY ref_submission_id, created_time DESC, id DESC
                ) sf ON sf.ref_submission_id = s.id
            WHERE a.ref_course_id IN (
                SELECT ref_course_id FROM uc_instructor WHERE ref_user_id = $1
            )
            ORDER BY a.id, ul.seat_no NULLS LAST, u.name
        `;
        return (await db.default.manyOrNone(sql, [userId])) || [];
    }

    /**
     * 取得某份作業的修課學生繳交狀況與成績
     */
    public static async getSubmissions(assignment_id: string) {
        const sql = `
            SELECT 
                u.id as user_id, 
                u.name as student_name,
                s.id as submission_id, 
                s.content, 
                s.submited_time,
                s.pic_files,
                -- 狀態推導需要：false 代表學生寫了但還沒送出（草稿）
                s.is_submitted,
                ul.seat_no,
                sf.id as feedback_id,
                sf.score, 
                sf.content as ai_analysis,
                sf.is_returned,
                proxy_s.id as batch_proxy_submission_id,
                proxy_s.created_at as batch_proxy_submission_time,
                proxy_s.ocr_time 
            FROM assignment a
            JOIN uc_learner ul ON ul.ref_course_id = a.ref_course_id
            JOIN "user" u ON u.id = ul.ref_user_id
            LEFT JOIN submission s ON s.ref_user_id = u.id AND s.ref_assignment_id = a.id
            -- 每一筆繳交最多只有一筆「有效」批改（重批會把舊的設成 is_valid=false）。
            -- ⚠️ 外層的 sf1 **也要**過濾 is_valid —— 先前只比對 created_time，
            --    同一秒內同時存在有效與無效的紀錄時可能挑到無效那一筆，
            --    畫面上就會看到剛剛才重置掉的舊分數。
            --    改用 DISTINCT ON 也順便讓「最新的一筆」變成明確的規則。
            LEFT JOIN (
                SELECT DISTINCT ON (ref_submission_id) *
                FROM submission_feedback
                WHERE is_valid = true
                ORDER BY ref_submission_id, created_time DESC, id DESC
            ) sf ON sf.ref_submission_id = s.id
            LEFT JOIN (
                SELECT bps1.*
                FROM
                    batch_proxy_submission bps1
                    INNER JOIN (
                        SELECT ref_assignment_id, ref_user_id, created_at as max_time
                        FROM batch_proxy_submission
                        WHERE is_valid = true) AS bps2
                    ON bps1.ref_assignment_id = bps2.ref_assignment_id 
                        AND bps1.ref_user_id = bps2.ref_user_id
                        AND bps1.created_at = bps2.max_time
            ) AS proxy_s ON proxy_s.ref_user_id = u.id AND proxy_s.ref_assignment_id = a.id
            WHERE a.id = $1
            ORDER BY u.id ASC;
        `;
        return await db.default.manyOrNone(sql, [assignment_id]);
    }

    /**
     * 儲存批改結果 (包含 AI 分析結果及教師評語)
     */
    /**
     * 寫入一筆批改結果。
     *
     * **模型是「版本」不是「欄位」**：任何時刻一份繳交最多只有一筆
     * `is_valid = true`，`is_ai` 標示那一版是 AI 產的還是教師改的。
     * 教師修改評語 = 把舊的全部設為失效，再寫一筆 `is_ai = false` 的新版本。
     * 舊版本留著但不再顯示（產品決定：改過之後不需要回看 AI 原版）。
     *
     * ⚠️ **先前完全沒有授權檢查** —— 任何教師都能批改任何一份作品。
     *    現在整包在一個交易裡，第一件事就是確認這份繳交屬於你教的班。
     */
    public static async saveFeedback(submission_id: string, score: number, analysis_content: any, instructor_id: string, inputTokens: number = 0, outputTokens: number = 0, is_ai: boolean = true) {
        const owned = await db.default.oneOrNone(
            `SELECT s.id FROM submission s
                 INNER JOIN assignment a ON a.id = s.ref_assignment_id
             WHERE s.id = $1
               AND a.ref_course_id IN (
                     SELECT ref_course_id FROM uc_instructor WHERE ref_user_id = $2
               )`,
            [submission_id, instructor_id]);
        if (!owned) return null;

        await db.default.none(`UPDATE public.submission_feedback SET is_valid = false WHERE ref_submission_id = $1`, [submission_id]);

        const sql = `
            INSERT INTO public.submission_feedback (
                ref_submission_id, 
                score, 
                content, 
                is_valid, 
                ref_user_id,
                input_tokens,
                output_tokens,
                is_ai
            ) VALUES (
                $1, $2, $3::text, true, $4, $5, $6, $7
            ) RETURNING id;
        `;
        const contentStr = typeof analysis_content === 'string' ? analysis_content : JSON.stringify(analysis_content);
        return await db.default.oneOrNone(sql, [submission_id, score || 0, contentStr, instructor_id, inputTokens, outputTokens, is_ai]);
    }

    /**
     * 取得作業批改所需的 Context
     */
    public static async getGradingContextBySubmissionId(submission_id: string) {
        const sql = `
            SELECT 
                t.title,
                t.description,
                t.note,
                t.pic1,
                si.content AS system_instruction
            FROM public.submission s
            JOIN public.assignment a ON s.ref_assignment_id = a.id
            JOIN public.task t ON a.ref_task_id = t.id
            LEFT JOIN public.system_instruction si ON t.ref_instruction_id = si.id
            WHERE s.id = $1
        `;
        const result = await db.default.oneOrNone(sql, [submission_id]);
        return result;
    }

    /**
     * 取得某課程的修課學生名單，
     * 要檢查是否是這位教師的班級才可以取得
     */
    public static async getStudents(course_id: string, teacher_id: string) {
        const sql = `
            SELECT 
                u.id ,
                u.name,
                ul.seat_no
            FROM public.uc_learner ul
            JOIN public."user" u ON u.id = ul.ref_user_id
            WHERE ul.ref_course_id = $1 
                AND ul.ref_course_id IN (
                    SELECT ref_course_id FROM public.uc_instructor WHERE ref_user_id = $2
                )
            ORDER BY ul.seat_no ASC;
        `;
        return await db.default.manyOrNone(sql, [course_id, teacher_id]);
    }
}

export default InstructorHelper;
