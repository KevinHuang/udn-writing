import { db } from './database';
import { CourseScope, courseScopeSubquery } from '../lib/course_scope';
import AssignmentHelper from './assignment_helper';

class SubmissionHelper {

    /** 提交作業 */
    /**
     * 學生繳交（或存草稿）。同一份作業只會有一列，所以是 upsert。
     *
     * `is_submitted = false` 代表**草稿**：作文存起來了，但還沒送出。
     * 這一欄是 migration 001 加的，`submissionStatusOf()` 靠它分辨 Draft
     * 與 Pending —— 而這支先前完全沒收它，欄位一路吃預設值 true。
     * 結果是「儲存草稿」在後端根本不存在，前端那顆按鈕也只是個空殼。
     *
     * **草稿不覆寫 submited_time。** 那一欄是「什麼時候送出的」，
     * 存草稿時還沒送出。送出時才更新（COALESCE 保留第一次送出的時間）。
     *
     * **已經批改過的不接受覆寫。** 沒有這道擋，學生可以在老師批完之後
     * 把作文整篇換掉 —— 分數與評語就會指向一段已經不存在的文字。
     * 擋在 UPDATE 的 WHERE 裡（不是先查再寫），所以不會有「查完到寫入之間
     * 剛好被批改」的空隙。擋下來時兩個 CTE 都是 0 筆，呼叫端據此回 409。
     */
    public static async submit(user_id: string, assignment_id: string, content: string, pic_files: any, word_count: number, is_submitted: boolean = true) {

        const sql = `

            with raw_data AS (
                SELECT 
                    $1::bigint as ref_user_id,
                    $2::bigint as ref_assignment_id,
                    $3::text as content,
                    $4::jsonb as pic_files,
                    $5::integer AS word_count,
                    $6::boolean AS is_submitted
            )
            ,
            insert_data AS (
                INSERT INTO public.submission (
                    ref_user_id, ref_assignment_id, content, pic_files, word_count, is_submitted,
                    submited_time )
                SELECT
                    r.ref_user_id, r.ref_assignment_id, r.content, r.pic_files, r.word_count,
                    r.is_submitted,
                    -- 草稿還沒送出，送出時間留空
                    CASE WHEN r.is_submitted THEN now() ELSE NULL END
                FROM
                    raw_data AS r
                    LEFT OUTER JOIN submission AS s ON
                        s.ref_user_id = r.ref_user_id AND
                        s.ref_assignment_id = r.ref_assignment_id
                WHERE
                    s.id IS NULL

                RETURNING id
            )
            ,
            update_data AS (
                UPDATE submission AS s
                SET 
                    content = r.content,
                    pic_files = r.pic_files,
                    last_update = now(),
                    word_count = r.word_count,
                    is_submitted = r.is_submitted,
                    -- 只在送出時補時間，而且保留第一次送出的那個
                    submited_time = CASE
                        WHEN r.is_submitted THEN COALESCE(s.submited_time, now())
                        ELSE s.submited_time
                    END
                FROM
                    raw_data AS r
                WHERE
                    s.ref_user_id = r.ref_user_id AND
                    s.ref_assignment_id = r.ref_assignment_id AND
                    -- 已經有有效批改就不給改了
                    NOT EXISTS (
                        SELECT 1 FROM submission_feedback f
                        WHERE f.ref_submission_id = s.id AND f.is_valid = true
                    )
                RETURNING id
            )
            SELECT 'insert' as action_type, count(id) as count FROM insert_data
            UNION ALL
            SELECT 'update' as action_type, count(id) as count FROM update_data

        `
        const result = await db.default.manyOrNone(sql, [user_id, assignment_id, content, JSON.stringify(pic_files), word_count, is_submitted]);

        return result;
    }

    public static async getSubmission(user_id: string, assignment_id: string) {
        const result = await db.default.oneOrNone(`
            SELECT id, ref_user_id, ref_assignment_id, content, pic_files, submited_time, last_update FROM public.submission WHERE ref_user_id = $1 AND ref_assignment_id = $2 
        `, [user_id, assignment_id]);
        return result;
    }

    /**
     * 取得特定作業的繳交紀錄
     */
    public static async getSubmissionById(submission_id: string) {
        const result = await db.default.oneOrNone(`
            SELECT id, ref_user_id, ref_assignment_id, content, pic_files, submited_time, last_update, word_count FROM public.submission WHERE  id = $1
        `, [submission_id]);
        return result;
    }

    /**
     * 同上，但**限定呼叫者任教的班級**。
     *
     * 無限定版的 getSubmissionById 仍留著給不需把關的內部路徑用；
     * 只要請求是外面打進來的，一律走這一支。AI 批改就是踩過這個坑的地方：
     * 它先用無限定版取出作文、送去 AI、才在寫入時才擋 —— 寫入是擋住了，
     * 但別班學生的作文與 AI 評語已經回給呼叫者，token 也燒掉了。
     */
    public static async getSubmissionByIdForInstructor(submission_id: string, scope: CourseScope) {
        const result = await db.default.oneOrNone(`
            SELECT s.id, s.ref_user_id, s.ref_assignment_id, s.content, s.pic_files,
                   s.submited_time, s.last_update, s.word_count
            FROM public.submission s
                INNER JOIN assignment a ON a.id = s.ref_assignment_id
            WHERE s.id = $1
              AND a.ref_course_id IN ${courseScopeSubquery(scope)}
        `, [submission_id]);
        return result;
    }


    /** 發還作業 */
    public static async returnSubmissions(submissionIds: string[]) {
        const result = await db.default.manyOrNone(`
            UPDATE submission SET status = 'returned', last_update = now() WHERE id = ANY($1::bigint[]) RETURNING id
        `, [submissionIds]);
        return result;
    }


    /** 取得尚未評分子項目的作業與題目、提示詞等 */
    public static async getNoSubscoresRecord() {
        const sql = `
        with target_feedback AS (
            SELECT * 
            FROM public.submission_feedback
            where
                is_valid = true
                -- and id < 327
                and
                sub_scores is null
                
            ORDER BY id desc
        )

        select 
            sub.*,
            tf.score,
            tf.id as feedback_id,
            ass.ref_task_id,
            task.title, task.description, task.note,
            task.pic1
        from
            submission as sub 
            inner join target_feedback as tf on tf.ref_submission_id = sub.id
            inner join assignment as ass ON ass.id = sub.ref_assignment_id
            inner join task on task.id = ass.ref_task_id
        order by 
            tf.id desc
        Limit
            500
        `

        const result = await db.default.manyOrNone(sql);
        return result;
    }

    /** 把這筆紀錄標示為未繳交。
     * 做法是把 user_id 變成相反數，這樣可以確保可以重新選擇這一筆作業。
     */
    /**
     * 重置繳交：把 `ref_user_id` 變成負數，也就是把這篇作品從學生身上摘掉。
     *
     * **只有這份作業所屬班級的授課教師可以執行。** 條件直接寫進 UPDATE 的
     * WHERE，而不是先查一次再寫 —— 兩段式在「查完」與「寫入」之間有空隙，
     * 而這一行是破壞性的。沒有改到任何一列就回空陣列，呼叫端據此回 404。
     *
     * 原本這支**連 instructorId 參數都沒有**，WHERE 只有 `id`。任何一位合法
     * 教師拿任意 submissionId 就能把別班學生的作文摘掉。更糟的是呼叫端在它
     * 後面還有一支**有**把關的 resetBySubmissionId —— 打別班時第一支成功、
     * 第二支被擋，留下「作文沒有主人、批改卻還有效」的半毀狀態，而且回 200。
     *
     * ⚠️ 系統裡**沒有任何地方會讀負數的 ref_user_id 把它轉回來**（搜過
     * apps/api 與 legacy-server，只有這一行會寫）。所有查詢都是
     * `ref_user_id = <正數>`，所以摘掉之後那篇在名冊、批改清單、成績、
     * 期末總結裡都會直接消失。唯一的還原是再打一次（負負得正）。
     */
    public static async resetSubmissions(submissionId: string, scope: CourseScope) {
        const result = await db.default.manyOrNone(`
            UPDATE submission SET ref_user_id = (0 - ref_user_id)::bigint, last_update = now()
            WHERE id = $1
              AND ref_assignment_id IN (
                    SELECT a.id FROM assignment a
                    WHERE a.ref_course_id IN ${courseScopeSubquery(scope)}
              )
            RETURNING id
        `, [submissionId]);
        return result;
    }



    /**
     * 清除繳交：把這一筆繳交紀錄**整筆刪掉**。
     *
     * 不是清空內容、也不是改狀態 —— 批改清單與學生端都是
     * 「找不到紀錄就當作未繳交」（見 @udn/shared 的 submissionStatusOf：
     * 沒有 submission 資料列就是 Unsubmitted），所以刪掉才會真的回到未繳交，
     * 學生也才能重新繳交。
     *
     * 連鎖清理：
     *   submission_feedback → submission  ❌ 沒有外鍵，**必須手動刪**
     *   submission_mark     → submission  ✅ ON DELETE CASCADE（migration 001）
     *
     * 所以只要手動清 feedback，標記會自己跟著走。
     */
    public static async deleteById(submissionId: string, scope: CourseScope) {
        return await db.default.tx(async (t) => {
            const owned = await t.oneOrNone(
                `SELECT s.id
                 FROM submission s
                     INNER JOIN assignment a ON a.id = s.ref_assignment_id
                 WHERE s.id = $1
                   AND a.ref_course_id IN ${courseScopeSubquery(scope)}`,
                [submissionId]);
            if (!owned) return null;

            await t.none(`DELETE FROM submission_feedback WHERE ref_submission_id = $1`, [submissionId]);
            return await t.oneOrNone(`DELETE FROM submission WHERE id = $1 RETURNING *`, [submissionId]);
        });
    }
}

export default SubmissionHelper;