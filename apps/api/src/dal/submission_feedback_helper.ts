import { db } from './database';
import { CourseScope, courseScopeSubquery } from '../lib/course_scope';
import AssignmentHelper from './assignment_helper';

class SubmissionFeedbackHelper {

    /** 把批改結果發還給學生 */
    /**
     * 批次發還（把批改結果送到學生端）。
     *
     * ⚠️ **先前完全沒有授權檢查** —— 這一支收一個 id 陣列就直接 UPDATE，
     *    任何教師都能把**別班的成績發還給學生**。這是整組批改 API 裡
     *    最嚴重的一個，因為它的副作用是不可逆的（學生已經看到了）。
     *    現在只會動到呼叫者教的班。
     */
    public static async returnFeedback(submissionIds: string[], scope: CourseScope) {
        const result = await db.default.manyOrNone(`
            UPDATE submission_feedback SET is_returned = true, returned_time = now()
            WHERE ref_submission_id = ANY($1::bigint[])
              AND is_valid = true
              AND ref_submission_id IN (
                    SELECT s.id FROM submission s
                        INNER JOIN assignment a ON a.id = s.ref_assignment_id
                    WHERE a.ref_course_id IN ${courseScopeSubquery(scope)}
              )
            RETURNING id
        `, [submissionIds]);
        return result;
    }

    /**
     * 收回發還：把有效那一版改回「已批改、還沒發還」。分數與評語都留著，不是重置。
     *
     * 為什麼要有：原稿上的紅筆發還之後會鎖住（學生看過的東西不能偷偷改），畫面與錯誤訊息一直叫老師
     * 「要改請先收回發還」，但以前沒有這個動作 —— 唯一能解鎖的是重置批改，會把分數與評語一起清掉。
     *
     * 收回期間學生端回到還沒發還的樣子（分數、評語、佳作章、作品集都看不到 —— 那些查詢本來就看
     * is_returned）；再發還一次就回來。學生填過的公開意願（submission_publish_consent）不動。
     *
     * 範圍和發還同一套：只動呼叫者教的班，別班的 id 會被安靜略過。只動目前已發還的那幾筆，
     * 回傳真的收回了哪些。
     */
    public static async unreturnFeedback(submissionIds: string[], scope: CourseScope) {
        return await db.default.manyOrNone<{ id: string; ref_submission_id: string }>(`
            UPDATE submission_feedback SET is_returned = false, returned_time = NULL
            WHERE ref_submission_id = ANY($1::bigint[])
              AND is_valid = true
              AND is_returned = true
              AND ref_submission_id IN (
                    SELECT s.id FROM submission s
                        INNER JOIN assignment a ON a.id = s.ref_assignment_id
                    WHERE a.ref_course_id IN ${courseScopeSubquery(scope)}
              )
            RETURNING id, ref_submission_id::text
        `, [submissionIds]);
    }

    /**
     * 學生看自己某一篇的批改結果。**只有發還之後才回傳**，還沒發還就是 null。
     *
     * ⚠️ 以前少了 is_returned 的條件：老師批改完、還沒按發還，學生就能從這支
     *    讀到分數與評語（畫面不顯示，但開發者工具看得到）。
     */
    public static async getBySubmissionId(user_id: string, submission_id: string) {
        const sql = `
            SELECT fb.* 
            FROM 
                submission_feedback as fb 
                JOIN submission as s ON fb.ref_submission_id = s.id 
            WHERE fb.ref_submission_id = $1 AND s.ref_user_id = $2
              AND fb.is_valid = true AND fb.is_returned = true
        `;
        const result = await db.default.oneOrNone(sql, [submission_id, user_id]);
        return result;
    }

    /**
     * 重置批改：把有效的那一筆設為失效。
     *
     * 狀態因此退回 Pending（見 @udn/shared 的 submissionStatusOf），
     * 但歷史紀錄留著 —— 作文還在，老師會重批。
     *
     * ⚠️ 同樣補上授權：先前任何教師都能重置任何一份作品的批改。
     */
    public static async resetBySubmissionId(submission_id: string, scope: CourseScope) {
        const sql = `
            UPDATE submission_feedback SET is_valid = false
            WHERE ref_submission_id = $1
              AND is_valid = true
              AND ref_submission_id IN (
                    SELECT s.id FROM submission s
                        INNER JOIN assignment a ON a.id = s.ref_assignment_id
                    WHERE a.ref_course_id IN ${courseScopeSubquery(scope)}
              )
            RETURNING id
        `;
        return (await db.default.manyOrNone(sql, [submission_id])) || [];
    }

    /**
     * 管理員的四向度批次補分（routes/admin.ts 的 /admin/grading_subscores）：
     * 把算好的四向度與這一次花掉的 token 寫回那一版批改。
     *
     * ⚠️ 用**具名參數**，不要回去用 $1、$2。原本是這樣寫的：
     *
     *     SET sub_scores = $4, sub_scores_input_tokens = $1, sub_scores_output_tokens = $2
     *     WHERE id = $1
     *     -- 參數是 [feedback_id, inputTokens, outputTokens, sub_scores]
     *
     * 整排往左錯一格：`sub_scores_input_tokens` 存進去的是 **feedback id**、
     * `sub_scores_output_tokens` 存的是 inputTokens，outputTokens 根本沒有被寫入。
     * `WHERE id = $1` 剛好是對的，所以補分功能看起來完全正常 —— 只有花費統計
     * 一直是錯的，而且數字很大（id 是 bigint），看起來像真的 token 數。
     * 沒有任何畫面或查詢讀這兩欄，所以除了對帳沒有別的影響。**既有資料仍是錯的**：
     * 清理在 `docs/migrations/014-subscores-token-columns.sql`（人工決定與執行，不急）——
     * input 可以從 output 挪回來，真正的 outputTokens 當初沒寫進去，救不回來。
     */
    public static async saveSubscores(feedback_id: string, inputTokens: number = 0, outputTokens: number = 0, sub_scores: any = undefined) {

        const sql = `
            UPDATE public.submission_feedback
            SET
                sub_scores = $(subScores)::jsonb,
                sub_scores_input_tokens = $(inputTokens),
                sub_scores_output_tokens = $(outputTokens),
                sub_scores_time = now()
            WHERE
                id = $(feedbackId)
            RETURNING id;
        `;
        return await db.default.oneOrNone(sql, {
            feedbackId: feedback_id,
            inputTokens,
            outputTokens,
            // 與 saveFeedback 同一個寫法：沒有四向度就寫 null，不要寫 "undefined"
            subScores: sub_scores == null ? null : JSON.stringify(sub_scores),
        });
    }

    /**
     * 某個班、某幾題的分數（舊前端的成績表用）。
     *
     * ⚠️ 以前有兩個洞：
     *   1. 沒有範圍檢查 —— 任何教師改網址上的班級編號，就拿得到別班的分數
     *   2. taskIds 直接拼進 SQL —— 網址上可以塞任意 SQL（SQL injection）
     * 現在範圍條件寫在 SQL 裡（範圍外的班查不到任何一列），taskIds 走參數。
     * 呼叫端另外先檢查 taskIds 都是數字，格式不對直接 400。
     */
    public static async getScoresByCourseIdTaskId(course_id: string, taskIds: string[], scope: CourseScope) {

        const sql = `
            with ass AS (
                select *
                from 
                    assignment
                where
                    ref_course_id = $1
                    and
                    ref_course_id IN ${courseScopeSubquery(scope)}
                    and
                    ref_task_id IN ($2:csv)
            )

            select
                ass.ref_course_id,
                ass.ref_task_id,
            -- 		subm.*,
                subm.id as ref_submission_id,
                subm.ref_user_id,
                case when subf.content is not null then cast((subf.content::jsonb)->>'raw_score' as integer) else null::int end as raw_score,
                subf.score,
                subf.sub_scores
            -- 		subf.*
            from
                ass inner join (
					select * from submission where ref_user_id IN (select ref_user_id from uc_learner where ref_course_id IN ( select ref_course_id from ass))
				) as subm ON ass.id = subm.ref_assignment_id
                left outer join (
                    select * from submission_feedback where is_valid = true) as subf ON subf.ref_submission_id = subm.id
            -- where
            --     subm.ref_assignment_id IN ( select id from ass)

        `;
        return await db.default.manyOrNone(sql, [course_id, taskIds]);
    }

    public static async getByCourseIdUserId(course_id: string, user_id: string) {

        const sql = `
            with ass AS (
                select *
                from 
                    assignment
                where
                    ref_course_id = $1
            )

            select
                ass.ref_course_id,
                ass.ref_task_id,
                subm.id as ref_submission_id,
                subm.ref_user_id,
                subf.content,
                subf.score,
                subf.sub_scores,
                task.title
            from
                ass inner join ( select * from submission where ref_user_id = $2) as subm ON ass.id = subm.ref_assignment_id
                inner join task ON task.id = ass.ref_task_id
                left outer join (
                    select * from submission_feedback where is_valid = true) as subf ON subf.ref_submission_id = subm.id
            where
                subm.ref_assignment_id IN ( select id from ass)

        `;
        return await db.default.manyOrNone(sql, [course_id, user_id]);
    }

}

export default SubmissionFeedbackHelper;