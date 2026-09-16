import { db } from './database';
import AssignmentHelper from './assignment_helper';

class BatchProxySubmissionHelper {

    /** 提交作業 */
    public static async submit(user_id: string, assignment_id: string, submitter_id: string, img_files: string[], batchUUID: string) {

        const result = await db.default.manyOrNone(`

            with raw_data AS (
                SELECT 
                    '${user_id}'::bigint as ref_user_id,
                    '${assignment_id}'::bigint as ref_assignment_id,
                    '${submitter_id}'::bigint as submitter_id,
                    '${JSON.stringify(img_files)}'::jsonb as img_files,
                    '${batchUUID}'::text as batch_uuid
            )
            ,
            update_data AS (
                -- 把指定學生目前已代繳交的作業設為無效，以免又進行 ocr ，
                UPDATE batch_proxy_submission 
                SET 
                    is_valid = false,
                    last_update = now()
                FROM
                    raw_data AS r
                WHERE
                    batch_proxy_submission.ref_user_id = r.ref_user_id AND
                    batch_proxy_submission.ref_assignment_id = r.ref_assignment_id
                RETURNING batch_proxy_submission.id
            )
            ,
            insert_data AS (
                INSERT INTO public.batch_proxy_submission (
                    ref_user_id, ref_assignment_id, submitter_id, img_files, batch_uuid ) 
                SELECT
                    r.ref_user_id, r.ref_assignment_id, r.submitter_id, r.img_files, r.batch_uuid
                FROM
                    raw_data AS r

                RETURNING id
            )
            
            SELECT 'insert' as action_type, count(id) as count FROM insert_data
            UNION ALL
            SELECT 'update' as action_type, count(id) as count FROM update_data

        `);

        return result;
    }
}

export default BatchProxySubmissionHelper;