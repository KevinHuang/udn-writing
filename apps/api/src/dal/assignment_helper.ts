import { db } from './database';
import { CourseScope, courseScopeSubquery } from '../lib/course_scope';

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
                    -- ⚠️ 以下欄位是**新增**的，舊前端（apps/api/public）也吃這支端點，
                    --    所以既有欄位的名稱與語意一律不動，只往上疊。
                    c.id as course_id,
                    c.school_year,
                    c.semester,
                    -- opened → 學生看得到（@udn/shared 的 assignmentStatusOf）。
                    -- 收不收件看 deadline / allow_late_submission，不是狀態
                    a.opened,
                    a.opened_at,
                    a.deadline,
                    a.allow_late_submission,
                    sub.id as submission_id,
                    sub.word_count,
                    -- 真正的「已送出」旗標。底下那個 is_submitted 其實是
                    -- 「有沒有繳交紀錄」（sub.id IS NOT NULL），草稿也算 true ——
                    -- 語意不同但不能改，舊前端在用。新前端讀這一欄。
                    sub.is_submitted as submission_is_submitted,
                    fb.id as feedback_id,
                    fb.is_ai,
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
                    /*
                      **開過又改回未開放的作業也要回傳。**

                      以前只收 opened = true，所以老師一收回，那份作業就從
                      學生端整個消失 —— 連他已經拿到的成績一起不見（實測確認過）。
                      改回未開放的確認視窗對老師的承諾是「已發還的成績仍留在
                      學生的成績紀錄裡」。

                      opened_at IS NOT NULL 代表「曾經開放過」；從未開放的
                      草稿仍然看不到。前端把 opened = false 的一律當成未開放：
                      不列在作業清單與待辦，只在成績紀錄裡出現。
                      能不能繳交由 /student/submit 擋（opened 與截止日）。
                    */
                    a.opened = true OR a.opened_at IS NOT NULL
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
    public static async getAssignmentsByCourseId(scope: CourseScope, courseId: string) {
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
                AND ass.ref_course_id IN ${courseScopeSubquery(scope)}
            ORDER BY
                ass.sort_order ASC NULLS LAST, ass.assigned_at ASC
        `;
        return (await db.default.manyOrNone(sql, [courseId])) || [];
    }

    /**
     * 開關作業（Draft ⇄ Published）：學生看不看得到。收不收件看截止日。
     *
     * ⚠️ **`opened_at` 只在「開啟」時寫，而且只寫第一次。**
     *    它的意思是「曾經對學生開放過」—— 開過又改回未開放的作業，學生的
     *    成績紀錄裡仍要看得到已發還的成績（見 getAssignments 的 WHERE）。
     *    關閉時把 opened_at 蓋掉（或寫成 NULL）就分不出「從沒開過」與
     *    「開過又收回」。COALESCE 保留第一次開放的時間。
     *
     * ⚠️ 授權進 WHERE：先前只比對 id，任何教師都能開關別人班的作業。
     *    錯誤訊息寫著 unauthorized，但 SQL 裡沒有任何 authorization。
     */
    public static async updateStatus(assignmentId: string, body: { opened: boolean }, scope: CourseScope) {
        const sql = `
            UPDATE assignment
            SET opened = $1,
                opened_at = CASE WHEN $1 THEN COALESCE(opened_at, NOW()) ELSE opened_at END
            WHERE id = $2
              AND ref_course_id IN ${courseScopeSubquery(scope)}
            RETURNING *;
        `;
        return await db.default.oneOrNone(sql, [body.opened, assignmentId]) || null;
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
     *
     * `opened` 預設 false（先存著）；派發精靈選「立即開放」時帶 true，
     * 這時 opened_at 一併寫入，和 updateStatus 第一次開啟的規則一致。
     */
    public static async create(data: {
        ref_course_id: string;
        ref_task_id: string;
        week_no?: number | null;
        deadline?: string | null;
        allow_late_submission?: boolean;
        opened?: boolean;
    }, userId: string, scope: CourseScope) {
        const sql = `
            INSERT INTO assignment (
                ref_course_id, ref_task_id, ref_user_id, week_no, opened, opened_at, assigned_at,
                deadline, allow_late_submission, sort_order
            )
            SELECT
                $1, $2, $3, $4, $7, CASE WHEN $7 THEN NOW() END, NOW(), $5, $6,
                COALESCE((SELECT MAX(sort_order) + 1 FROM assignment WHERE ref_course_id = $1), 0)
            -- ref_user_id（$3）記錄「誰派的」；能不能派看的是範圍
            WHERE EXISTS (
                SELECT 1 FROM public.course WHERE id = $1 AND id IN ${courseScopeSubquery(scope)}
            )
            RETURNING *;
        `;
        return await db.default.oneOrNone(sql, [
            data.ref_course_id, data.ref_task_id, userId, data.week_no ?? null,
            data.deadline ?? null, data.allow_late_submission ?? false, data.opened === true,
        ]) || null;
    }

    /** 更新截止日與逾期設定（僅限自己教的班） */
    public static async updateConfig(assignmentId: string, data: {
        deadline?: string | null;
        allow_late_submission?: boolean;
    }, scope: CourseScope) {
        const sql = `
            UPDATE assignment
            SET deadline = $2,
                allow_late_submission = COALESCE($3, allow_late_submission)
            WHERE id = $1
              AND ref_course_id IN ${courseScopeSubquery(scope)}
            RETURNING *;
        `;
        return await db.default.oneOrNone(sql,
            [assignmentId, data.deadline ?? null, data.allow_late_submission ?? null]) || null;
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
    public static async reorder(courseId: string, orderedIds: string[], scope: CourseScope) {
        return await db.default.tx(async (t) => {
            const owns = await t.oneOrNone(
                `SELECT 1 FROM public.course WHERE id = $1 AND id IN ${courseScopeSubquery(scope)}`,
                [courseId]);
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
    public static async deleteById(assignmentId: string, scope: CourseScope) {
        return await db.default.tx(async (t) => {
            const owned = await t.oneOrNone(
                `SELECT id FROM assignment
                 WHERE id = $1
                   AND ref_course_id IN ${courseScopeSubquery(scope)}`,
                [assignmentId]);
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
    /**
     * 更換作業的題目。
     *
     * **底下的繳交、批改、作品標記會一併刪除。** 換了題目之後，學生寫的
     * 還是舊題目的作文、老師打的還是舊題目的分數 —— 留著就是把一篇
     * 「那次失敗之後」掛在「給未來自己的一封信」底下（實測看到的就是這個）。
     *
     * ⚠️ 這件事**前端的換題視窗早就寫在畫面上了**：「這份作業已有 N 筆繳交
     *    紀錄（含已批改的）。換題後會全部刪除，無法復原。」但後端只改了
     *    ref_task_id，什麼都沒刪 —— 對老師說了不會發生的事。
     *
     * 資料庫沒有外鍵，連鎖清理要自己寫全，而且要在同一個交易裡：
     * 刪到一半失敗會留下沒有繳交紀錄卻還有批改的孤兒。
     *
     * **只在確定沒有人正在寫的時候可以換**（與前端 lib/assignments.ts 的
     * canSwapQuestion 同一條規則）：未開放，或已截止且不收遲交。
     * 收件中換掉等於把學生寫到一半的東西抽走 —— 以前只有前端擋，
     * 直接打 API 照樣換得掉。不符合時回 'not_swappable'（路由回 409）。
     *
     * @returns null＝不是你的作業；'not_swappable'＝現在不能換；否則是更新後的作業
     */
    public static async updateTask(assignmentId: string, ref_task_id: string, scope: CourseScope) {
        return await db.default.tx(async (tx) => {
            const owned = await tx.oneOrNone(
                `SELECT id,
                        (opened = false
                         OR (deadline IS NOT NULL AND deadline < NOW()
                             AND allow_late_submission IS NOT TRUE)) AS swappable
                   FROM assignment
                  WHERE id = $1
                    AND ref_course_id IN ${courseScopeSubquery(scope)}
                  FOR UPDATE`,
                [assignmentId]);
            // ⚠️ 授權進 WHERE —— 先前只比對 id，任何教師都能換掉別人班作業的題目
            if (!owned) return null;
            if (!owned.swappable) return 'not_swappable' as const;

            const subIds = `SELECT id FROM submission WHERE ref_assignment_id = $1`;
            await tx.none(`DELETE FROM submission_mark WHERE ref_submission_id IN (${subIds})`, [assignmentId]);
            await tx.none(`DELETE FROM submission_feedback WHERE ref_submission_id IN (${subIds})`, [assignmentId]);
            await tx.none(`DELETE FROM submission WHERE ref_assignment_id = $1`, [assignmentId]);

            return await tx.oneOrNone(
                `UPDATE assignment
                    SET ref_task_id = $2,
                        assigned_at = NOW()
                  WHERE id = $1
                  RETURNING *`,
                [assignmentId, ref_task_id]);
        });
    }
}

export default AssignmentHelper;