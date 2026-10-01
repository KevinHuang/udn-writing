import { db } from './database';

/**
 * 學生對自己佳作的公開意願（docs/migrations/010）。
 *
 * 數位作品集的同校觀摩要學生與家長**都**同意才公開；學生的這一半存在這裡，
 * 家長的那一半在數位作品集。
 */
class PublishConsentHelper {

    /**
     * 設定公開意願。只有**自己的、已發還的、蓋了佳作章的**作品可以設 ——
     * 條件全部寫在 SQL 裡，任何一條不成立就寫不進去、回傳 null。
     *
     * 沒發還的不行：那時學生根本還不該知道自己被選為佳作。
     */
    public static async set(submissionId: string, userId: string, willing: boolean) {
        return await db.default.oneOrNone<{ ref_submission_id: string; willing: boolean }>(
            `INSERT INTO submission_publish_consent (ref_submission_id, willing, ref_user_id, updated_at)
             SELECT s.id, $3, $2, now()
               FROM submission s
              WHERE s.id = $1
                AND s.ref_user_id = $2
                AND EXISTS (SELECT 1 FROM submission_feedback fb
                             WHERE fb.ref_submission_id = s.id AND fb.is_valid = true AND fb.is_returned = true)
                AND EXISTS (SELECT 1 FROM submission_mark m
                             WHERE m.ref_submission_id = s.id AND m.kind = 'featured')
             ON CONFLICT (ref_submission_id) DO UPDATE
                SET willing = EXCLUDED.willing, ref_user_id = EXCLUDED.ref_user_id, updated_at = now()
             RETURNING ref_submission_id::text, willing`,
            [submissionId, userId, willing],
        );
    }
}

export default PublishConsentHelper;
