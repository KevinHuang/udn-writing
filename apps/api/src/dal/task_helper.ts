import { db } from './database';

/*
  ── 共同題庫的組織 ─────────────────────────────────────────
  共用題要掛在組織底下，授課教師才看得到（getByInstructorUserId 以 ref_org_id 比對）。
  ⚠️ 以前 create 完全沒寫 ref_org_id —— 新系統建的共用題一律是 NULL，老師永遠看不到
     （2026-09-19 盤點開發庫：7 題共用題有 3 題是 NULL，見 migration 006）。
  組織取建立者任教班級的組織；不帶班的管理人員退回第一個組織（正式資料只有聯合報一個）。
  FolderHelper 用同一條規則。
*/
export const orgOfUser = (userParam: string) => `COALESCE(
    (SELECT crs.ref_org_id FROM uc_instructor AS inst
        INNER JOIN course AS crs ON crs.id = inst.ref_course_id
      WHERE inst.ref_user_id = ${userParam} AND crs.ref_org_id IS NOT NULL LIMIT 1),
    (SELECT id FROM org ORDER BY id LIMIT 1)
)`;

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

    /**
     * 聯合報管理人員看到的題庫：**全部**共用題（不分組織），加上自己的個人題。
     * 授課教師走 getByInstructorUserId —— 只看得到自己組織的共用題。
     */
    public static async getForSystemAdmin(userId: string) {
        if (!userId) return [];
        return (await db.default.manyOrNone(
            `SELECT * FROM task WHERE ref_user_id = $1 OR shared = true`, [userId])) || [];
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
                writing_type, max_score, preferred_ai_model, pic1_description, ref_folder_id,
                ref_org_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW(), $11, $12, $13, $14, $15,
                    CASE WHEN $8 THEN ${orgOfUser('$7')} END)
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

    /**
     * 更新任務。擁有者可以改；以管理人員身分（asAdmin）還可以改**任何共用題**。
     *
     * 管理人員改別人的共用題時 shared 維持 true —— 不讓它被改成「掛在別人名下的個人題」，
     * 那會讓它從共同題庫消失、又不在管理人員自己的個人題庫裡。
     */
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
    }, userId: number, asAdmin = false) {
        const sql = `
            UPDATE task
            SET title=$2, description=$3, level=$4, source=$5, note=$6, pic1=$7,
                shared = CASE WHEN ref_user_id = $9 THEN $8 ELSE shared END,
                pic_position=$10, ref_instruction_id=$11,
                writing_type=$12, max_score=$13, preferred_ai_model=$14, pic1_description=$15,
                ref_folder_id=$16, updated_time=NOW(),
                -- 變成（或本來就是）共用題卻沒有組織的，補上 —— 否則老師看不到
                ref_org_id = CASE
                    WHEN (CASE WHEN ref_user_id = $9 THEN $8 ELSE shared END) AND ref_org_id IS NULL
                    THEN ${orgOfUser('task.ref_user_id')}
                    ELSE ref_org_id END
            WHERE id=$1 AND (ref_user_id=$9 OR ($17 AND shared = true))
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
            data.refFolderId ?? null,
            asAdmin,
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
    public static async setArchived(taskId: string, archived: boolean, userId: number, asAdmin = false) {
        const sql = `
            UPDATE task SET is_archived=$3, updated_time=NOW()
            WHERE id=$1 AND (ref_user_id=$2 OR ($4 AND shared = true))
            RETURNING *;
        `;
        return await db.default.oneOrNone(sql, [taskId, userId, archived, asAdmin]);
    }

    /** 刪除任務：擁有者，或以管理人員身分刪任何共用題 */
    public static async deleteById(taskId: string, userId: number, asAdmin = false) {
        const sql = `
            DELETE FROM task WHERE id=$1 AND (ref_user_id=$2 OR ($3 AND shared = true)) RETURNING *;
        `;
        const result = await db.default.oneOrNone(sql, [taskId, userId, asAdmin]);
        return result;
    }
}

export default TaskHelper;