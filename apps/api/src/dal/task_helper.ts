import { db } from './database';

class TaskHelper {

    /** 透過 identity code 取得登入者資訊 */
    public static async getById(taskId: string) {
        if (!taskId) { return; }

        // let schoolSystemId = (userInfo.roleType === 'teacher' ? userInfo.teacher.teacherID :
        //     (userInfo.roleType === 'student' ? userInfo.student.studentID :
        //         (userInfo.roleType === 'parent' ? userInfo.parent.studentID : '')
        //     )
        // );
        let schoolSystemId = null;

        const sql = `
            SELECT * from task WHERE id=$1;
        `

        const result = await db.default.oneOrNone(sql, [taskId]);
        return result;
    }

    /** 取得指定教師所能取得的任務，包含他自己建立的任務，或是他教授課程所屬組織的公開任務 */
    public static async getByInstructorUserId(userId: string) {
        if (!userId) { return; }

        const sql = `
            WITH target_user AS (
                SELECT * FROM "user" WHERE id = $1
            )
            ,
            -- 使用者所屬組織
            target_orgs AS (
                SELECT DISTINCT
                    org.id,
                    org.name
                FROM uc_instructor AS inst 
                    INNER JOIN target_user AS u ON u.id = inst.ref_user_id
                    INNER JOIN course as crs ON crs.id = inst.ref_course_id
                    INNER JOIN org ON crs.ref_org_id = org.id
            )

            -- select * from target_orgs

            SELECT *
            FROM
                task
            WHERE
                -- 自己編輯的任務
                ref_user_id IN (
                    SELECT id FROM target_user
                )
                -- 組織共享的任務
                OR (
                    ref_org_id IN (
                        SELECT id FROM target_orgs
                    )
                    AND shared = true
                )
        `

        const result = await db.default.manyOrNone(sql, [userId]);
        return result || [];
    }

    /** 建立新任務 */
    public static async create(data: {
        title: string;
        description: string;
        level: string[];
        source: string[];
        note: string;
        pic1: string;
        shared: boolean;
        picPosition: string;
        refInstructionId?: string;
        // ── migration 002 補的五個欄位。全部選填，舊的呼叫端不受影響 ──
        /** 寫作類型（看圖寫作／記敘抒情／論說…）。注意這不是學段，學段在 level */
        writingType?: string | null;
        /** 滿分。null 代表用系統預設（會考六級分） */
        maxScore?: number | null;
        preferredAiModel?: string | null;
        /** 配圖的文字描述：無障礙替代文字，同時也是 AI 對圖片的理解 */
        pic1Description?: string | null;
        /** 所屬資料夾。null 代表根層級 */
        refFolderId?: string | null;
    }, userId: number) {
        const sql = `
            INSERT INTO task (
                title, description, level, source, note, pic1, ref_user_id, shared,
                ref_instruction_id, pic_position, created_time, updated_time,
                writing_type, max_score, preferred_ai_model, pic1_description, ref_folder_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW(), $11, $12, $13, $14, $15)
            RETURNING *;
        `;
        const result = await db.default.oneOrNone(sql, [
            data.title,
            data.description,
            JSON.stringify(data.level),
            JSON.stringify(data.source),
            data.note,
            data.pic1 || '',
            userId,
            data.shared,
            data.refInstructionId || '1',
            data.picPosition || 'after',
            data.writingType ?? null,
            data.maxScore ?? null,
            data.preferredAiModel ?? null,
            data.pic1Description ?? null,
            data.refFolderId ?? null
        ]);
        return result;
    }

    /** 更新任務（僅限任務擁有者） */
    public static async update(taskId: string, data: {
        title: string;
        description: string;
        level: string[];
        source: string[];
        note: string;
        pic1: string;
        shared: boolean;
        picPosition: string;
        refInstructionId?: string;
        // ── migration 002 補的五個欄位。全部選填，舊的呼叫端不受影響 ──
        /** 寫作類型（看圖寫作／記敘抒情／論說…）。注意這不是學段，學段在 level */
        writingType?: string | null;
        /** 滿分。null 代表用系統預設（會考六級分） */
        maxScore?: number | null;
        preferredAiModel?: string | null;
        /** 配圖的文字描述：無障礙替代文字，同時也是 AI 對圖片的理解 */
        pic1Description?: string | null;
        /** 所屬資料夾。null 代表根層級 */
        refFolderId?: string | null;
    }, userId: number) {
        const sql = `
            UPDATE task
            SET title=$2, description=$3, level=$4, source=$5, note=$6, pic1=$7,
                shared=$8, pic_position=$10, ref_instruction_id=$11,
                writing_type=$12, max_score=$13, preferred_ai_model=$14, pic1_description=$15,
                ref_folder_id=$16, updated_time=NOW()
            WHERE id=$1 AND ref_user_id=$9
            RETURNING *;
        `;
        const result = await db.default.oneOrNone(sql, [
            taskId,
            data.title,
            data.description,
            JSON.stringify(data.level),
            JSON.stringify(data.source),
            data.note,
            data.pic1 || '',
            data.shared,
            userId,
            data.picPosition || 'after',
            data.refInstructionId || '1',
            data.writingType ?? null,
            data.maxScore ?? null,
            data.preferredAiModel ?? null,
            data.pic1Description ?? null,
            data.refFolderId ?? null
        ]);
        return result;
    }

    /**
     * 封存／取消封存。
     *
     * 獨立一支而不是併進 update()：封存是清單上的一個開關，不會開啟編輯表單，
     * 所以呼叫端手上沒有題目的其他欄位。用 update() 的話得先讀一次再整包寫回，
     * 中間有人改了別的欄位就會被蓋掉。
     */
    public static async setArchived(taskId: string, archived: boolean, userId: number) {
        const sql = `
            UPDATE task SET is_archived=$3, updated_time=NOW()
            WHERE id=$1 AND ref_user_id=$2
            RETURNING *;
        `;
        return await db.default.oneOrNone(sql, [taskId, userId, archived]);
    }

    /** 刪除任務（僅限任務擁有者） */
    public static async deleteById(taskId: string, userId: number) {
        const sql = `
            DELETE FROM task WHERE id=$1 AND ref_user_id=$2 RETURNING *;
        `;
        const result = await db.default.oneOrNone(sql, [taskId, userId]);
        return result;
    }
}

export default TaskHelper;