import { db } from './database';

/**
 * 題庫資料夾（migration 001 的 task_folder）。
 *
 * 可視範圍與 task 完全一致：自己建的，加上所屬組織的共享資料夾。
 * 兩邊用同一套規則，題目與資料夾才不會出現「看得到題目卻看不到它的資料夾」。
 */
class FolderHelper {

    /** 這位教師看得到的資料夾 */
    public static async getByInstructorUserId(userId: string) {
        if (!userId) return [];
        const sql = `
            WITH target_orgs AS (
                SELECT DISTINCT org.id
                FROM uc_instructor AS inst
                    INNER JOIN course AS crs ON crs.id = inst.ref_course_id
                    INNER JOIN org ON crs.ref_org_id = org.id
                WHERE inst.ref_user_id = $1
            )
            SELECT *
            FROM task_folder
            WHERE
                ref_user_id = $1
                OR (shared = true AND ref_org_id IN (SELECT id FROM target_orgs))
            ORDER BY name
        `;
        return (await db.default.manyOrNone(sql, [userId])) || [];
    }

    public static async create(
        data: { name: string; parentId: string | null; shared: boolean },
        userId: number,
    ) {
        /**
         * 共享資料夾要掛在組織底下。取這位教師的第一個組織 ——
         * 正式資料只有一個組織（聯合報），所以這裡不會有歧義；
         * 真的出現多組織時要改成由呼叫端指定。
         */
        const sql = `
            WITH my_org AS (
                SELECT crs.ref_org_id AS id
                FROM uc_instructor AS inst
                    INNER JOIN course AS crs ON crs.id = inst.ref_course_id
                WHERE inst.ref_user_id = $4
                LIMIT 1
            )
            INSERT INTO task_folder (name, ref_parent_id, shared, ref_user_id, ref_org_id)
            SELECT $1, $2, $3, $4, CASE WHEN $3 THEN (SELECT id FROM my_org) ELSE NULL END
            RETURNING *;
        `;
        return await db.default.oneOrNone(sql, [data.name, data.parentId, data.shared, userId]);
    }

    /** 改名或搬移（僅限擁有者） */
    public static async update(
        folderId: string,
        data: { name?: string; parentId?: string | null },
        userId: number,
    ) {
        const sql = `
            UPDATE task_folder
            SET name = COALESCE($3, name),
                ref_parent_id = $4,
                updated_time = NOW()
            WHERE id = $1 AND ref_user_id = $2
            RETURNING *;
        `;
        return await db.default.oneOrNone(sql, [folderId, userId, data.name ?? null, data.parentId ?? null]);
    }

    /**
     * 刪除資料夾（僅限擁有者）。
     *
     * **底下的東西一律退到上一層，不跟著刪** —— 子資料夾與題目都是。
     * 老師刪的是分類，不是內容；內容跟著消失是資料遺失，不是整理。
     * 前端的確認視窗也是這樣寫的：「裡面的 N 個子資料夾會移到上一層，
     * 不會被刪除」。
     *
     * ⚠️ 資料庫上 fk_task_folder_parent 是 ON DELETE CASCADE，
     *    所以**順序很重要**：必須先把子資料夾改掛到上一層，再刪這一個。
     *    先刪的話 CASCADE 會把整棵子樹一起帶走。
     *    三個動作在同一個交易裡，中途失敗不會留下半個狀態。
     *
     * 外鍵表達不了這個行為（CASCADE 會刪掉、SET NULL 會退到根而不是上一層），
     * 所以規則在這裡。
     */
    public static async deleteById(folderId: string, userId: number) {
        return await db.default.tx(async (t) => {
            const folder = await t.oneOrNone(
                `SELECT id, ref_parent_id FROM task_folder WHERE id = $1 AND ref_user_id = $2`,
                [folderId, userId],
            );
            if (!folder) return null;

            // 1. 直屬的子資料夾接到母層。孫層自然跟著走，不必遞迴
            await t.none(
                `UPDATE task_folder SET ref_parent_id = $2, updated_time = NOW() WHERE ref_parent_id = $1`,
                [folderId, folder.ref_parent_id],
            );
            // 2. 底下的題目也退到上一層
            await t.none(
                `UPDATE task SET ref_folder_id = $2, updated_time = NOW() WHERE ref_folder_id = $1`,
                [folderId, folder.ref_parent_id],
            );
            // 3. 這時已經沒有東西指向它，CASCADE 不會誤傷
            return await t.oneOrNone(`DELETE FROM task_folder WHERE id = $1 RETURNING *`, [folderId]);
        });
    }
}

export default FolderHelper;
