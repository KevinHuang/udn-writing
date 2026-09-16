import { db } from './database';
import AssignmentHelper from './assignment_helper';

class SubmissionHelper {

    /** 提交作業 */
    public static async submit(user_id: string, assignment_id: string, content: string, pic_files: any, word_count: number) {

        const sql = `

            with raw_data AS (
                SELECT 
                    $1::bigint as ref_user_id,
                    $2::bigint as ref_assignment_id,
                    $3::text as content,
                    $4::jsonb as pic_files,
                    $5::integer AS word_count
            )
            ,
            insert_data AS (
                INSERT INTO public.submission (
                    ref_user_id, ref_assignment_id, content, pic_files, word_count ) 
                SELECT
                    r.ref_user_id, r.ref_assignment_id, r.content, r.pic_files, r.word_count
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
                    word_count = r.word_count
                FROM
                    raw_data AS r
                WHERE
                    s.ref_user_id = r.ref_user_id AND
                    s.ref_assignment_id = r.ref_assignment_id
                RETURNING id
            )
            SELECT 'insert' as action_type, count(id) as count FROM insert_data
            UNION ALL
            SELECT 'update' as action_type, count(id) as count FROM update_data

        `
        const result = await db.default.manyOrNone(sql, [user_id, assignment_id, content, JSON.stringify(pic_files), word_count]);

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
    public static async resetSubmissions(submissionId: string) {
        const result = await db.default.manyOrNone(`
            UPDATE submission SET ref_user_id = (0 - ref_user_id)::bigint, last_update = now() WHERE id = $1 RETURNING id
        `, [submissionId]);
        return result;
    }


}

export default SubmissionHelper;