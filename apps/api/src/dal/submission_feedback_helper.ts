import { db } from './database';
import AssignmentHelper from './assignment_helper';

class SubmissionFeedbackHelper {

    /** 把批改結果發還給學生 */
    public static async returnFeedback(submissionIds: string[]) {
        const result = await db.default.manyOrNone(`
            UPDATE submission_feedback SET is_returned = true, returned_time = now()  WHERE ref_submission_id = ANY($1::bigint[]) and is_valid = true RETURNING id
        `, [submissionIds]);
        return result;
    }

    public static async getBySubmissionId(user_id: string, submission_id: string) {
        // console.log({ user_id, submission_id })
        const sql = `
            SELECT fb.* 
            FROM 
                submission_feedback as fb 
                JOIN submission as s ON fb.ref_submission_id = s.id 
            WHERE fb.ref_submission_id = $1 AND s.ref_user_id = $2 AND fb.is_valid = true
        `;
        const result = await db.default.oneOrNone(sql, [submission_id, user_id]);
        return result;
    }

    public static async resetBySubmissionId(submission_id: string) {
        const sql = `
            UPDATE submission_feedback SET is_valid = false WHERE ref_submission_id = $1 AND is_valid = true RETURNING id
        `;
        const result = await db.default.manyOrNone(sql, [submission_id]);
        return result || [];
    }

    public static async saveSubscores(feedback_id: string, inputTokens: number = 0, outputTokens: number = 0, sub_scores: any = undefined) {

        const sql = `
            UPDATE public.submission_feedback 
            SET 
                sub_scores = $4::jsonb,
                sub_scores_input_tokens = $1,
                sub_scores_output_tokens = $2,
                sub_scores_time = now()
            WHERE
                id = $1
            RETURNING id;
        `;
        return await db.default.oneOrNone(sql, [feedback_id, inputTokens, outputTokens, JSON.stringify(sub_scores)]);
    }

    public static async getScoresByCourseIdTaskId(course_id: string, taskIds: string[]) {

        const sql = `
            with ass AS (
                select *
                from 
                    assignment
                where
                    ref_course_id = $1
                    and
                    ref_task_id IN (${taskIds.join(", ")})
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
        return await db.default.manyOrNone(sql, [course_id]);
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