import { randomUUID } from 'node:crypto';
import { db } from './database';
import { CourseScope, courseScopeSubquery, isEmptyScope } from '../lib/course_scope';

/** 一批「已上傳、等著辨識」的代繳交 */
export interface BatchProxyRow {
    id: string;
    user_id: string;
    batch_uuid: string;
    img_files: string[];
    created_at: string;
    last_update: string;
    ocr_time: string | null;
}

/** 代繳交的辨識狀態（給前端推導用的原始資料，不做判斷） */
export interface ProxyStatusRow extends BatchProxyRow {
    submission_id: string | null;
    /** 這位學生的 submission 有沒有真的拿到文字 —— `ocr_time` 有值不等於成功 */
    has_content: boolean;
}

/**
 * 教師批次代繳交：把學生的紙本作文照片收進來，等背景 OCR 把文字填回 submission。
 *
 * ⚠️ **這一支以前整段 SQL 是字串接出來的**（`'${batchUUID}'::text`、
 *    `'${JSON.stringify(img_files)}'::jsonb`），而 batchUUID 直接來自
 *    client 的 request body —— 那是注入點。全部改成 `$n` 參數。
 *
 * ⚠️ `img_files` 欄位型別是 **json 不是 jsonb**，而且要用
 *    `JSON.stringify()` 當**字串**參數傳：直接給陣列的話 pg-promise 會
 *    格式化成 Postgres 的 array literal（`{a,b}`），不是 JSON。
 *
 * ⚠️ `img_files` 裡存的是 `StorageHelper` 回的**裸檔名**，不含
 *    `submit/assign_<id>/` 前綴。背景的 ocr-job（原始碼不在這個 repo）
 *    很可能自己用 assignmentId 組回資料夾，所以**不要「順手統一格式」**。
 */
class BatchProxySubmissionHelper {

    /**
     * 收下一位學生的一批照片。
     *
     * batch_uuid **由這裡產生**，不收 client 的值 —— 兩個分頁同時開就可能撞號。
     *
     * 舊的那一批會被設成 `is_valid = false`（退役），語意是「這一批不是現行的了，
     * 不要再被辨識」。
     */
    public static async submit(
        user_id: string,
        assignment_id: string,
        submitter_id: string,
        img_files: string[],
    ): Promise<{ id: string; batch_uuid: string }> {
        const batch_uuid = randomUUID();

        return db.default.tx(async (t) => {
            /*
              ⚠️ WHERE 要帶 `is_valid = true`。
                 沒有這個條件，同一位學生**歷史上每一批**的 last_update 都會被推成現在 ——
                 而 last_update 正是下游拿來當「什麼時候觸發辨識」的時間基準
                 （用 created_at 不行：老師拍完一整班才按開始，第一位可能早二十分鐘）。
            */
            await t.none(
                `UPDATE batch_proxy_submission
                    SET is_valid = false,
                        last_update = now()
                  WHERE ref_user_id = $1::bigint
                    AND ref_assignment_id = $2::bigint
                    AND is_valid = true`,
                [user_id, assignment_id],
            );

            return t.one<{ id: string; batch_uuid: string }>(
                `INSERT INTO public.batch_proxy_submission
                     (ref_user_id, ref_assignment_id, submitter_id, img_files, batch_uuid)
                 VALUES ($1::bigint, $2::bigint, $3::bigint, $4::json, $5::text)
                 RETURNING id::text, batch_uuid`,
                [user_id, assignment_id, submitter_id, JSON.stringify(img_files), batch_uuid],
            );
        });
    }

    /**
     * 這份作業目前「有效」的那幾批，依學生。
     *
     * 範圍檢查寫在**同一句 SQL** 裡（`ref_course_id IN (scope)`）——
     * 範圍外的 studentId 自然查不到，不會有「先查再檢查」的空隙。
     *
     * `userIds` 省略＝這份作業全部；給了就只取那幾位（觸發與重試用）。
     */
    public static async latestValidFor(
        assignment_id: string,
        scope: CourseScope,
        userIds?: string[],
    ): Promise<BatchProxyRow[]> {
        if (isEmptyScope(scope)) return [];
        const rows = await db.default.manyOrNone<BatchProxyRow>(
            `SELECT b.id::text,
                    b.ref_user_id::text AS user_id,
                    b.batch_uuid,
                    b.img_files,
                    b.created_at,
                    b.last_update,
                    b.ocr_time
               FROM batch_proxy_submission b
               JOIN assignment a ON a.id = b.ref_assignment_id
              WHERE b.ref_assignment_id = $1::bigint
                AND b.is_valid = true
                AND ($2::bigint[] IS NULL OR b.ref_user_id = ANY($2::bigint[]))
                AND a.ref_course_id IN ${courseScopeSubquery(scope)}
              ORDER BY b.ref_user_id`,
            [assignment_id, userIds && userIds.length ? userIds : null],
        );
        return rows.map((r) => ({ ...r, img_files: filesOf(r.img_files) }));
    }

    /**
     * 這份作業每一位學生的辨識狀態。輪詢用，**刻意不含作文全文** ——
     * 全文正是辨識成功之後才會變大的那一塊，拿它做高頻輪詢等於越順利越貴。
     *
     * 只回原始欄位，「算不算失敗」交給前端的純函式判斷（那裡好測，
     * 而且逾時門檻改一個常數就好，不必動後端）。
     */
    public static async statusOf(
        assignment_id: string,
        scope: CourseScope,
    ): Promise<ProxyStatusRow[]> {
        if (isEmptyScope(scope)) return [];
        const rows = await db.default.manyOrNone<ProxyStatusRow>(
            `SELECT b.id::text,
                    b.ref_user_id::text AS user_id,
                    b.batch_uuid,
                    b.img_files,
                    b.created_at,
                    b.last_update,
                    b.ocr_time,
                    s.id::text AS submission_id,
                    COALESCE(length(btrim(s.content)) > 0, false) AS has_content
               FROM batch_proxy_submission b
               JOIN assignment a ON a.id = b.ref_assignment_id
               LEFT JOIN submission s
                      ON s.ref_assignment_id = b.ref_assignment_id
                     AND s.ref_user_id = b.ref_user_id
              WHERE b.ref_assignment_id = $1::bigint
                AND b.is_valid = true
                AND a.ref_course_id IN ${courseScopeSubquery(scope)}
              ORDER BY b.ref_user_id`,
            [assignment_id],
        );
        return rows.map((r) => ({ ...r, img_files: filesOf(r.img_files) }));
    }

    /**
     * 記下「剛剛送去辨識」的時間。
     *
     * 逾時是拿 `last_update` 算的，所以每次觸發（含重試）都要推一次，
     * 否則重試的那一位會立刻又被判成逾時。
     */
    public static async touchTriggered(ids: string[]): Promise<void> {
        if (!ids.length) return;
        await db.default.none(
            `UPDATE batch_proxy_submission
                SET last_update = now()
              WHERE id = ANY($1::bigint[])
                AND is_valid = true`,
            [ids],
        );
    }

    /**
     * 退役：老師已經校對過這一批辨識結果了。
     *
     * `is_valid = false` 之後，「AI 辨識未校對」的徽章就消失，
     * 每小時的自動批次 OCR 也不會再把它撿走。作文與原稿都留在 submission，
     * 不受影響。
     */
    public static async retire(
        assignment_id: string,
        user_id: string,
        scope: CourseScope,
    ): Promise<number> {
        if (isEmptyScope(scope)) return 0;
        const rows = await db.default.manyOrNone<{ id: string }>(
            `UPDATE batch_proxy_submission b
                SET is_valid = false,
                    last_update = now()
               FROM assignment a
              WHERE a.id = b.ref_assignment_id
                AND b.ref_assignment_id = $1::bigint
                AND b.ref_user_id = $2::bigint
                AND b.is_valid = true
                AND a.ref_course_id IN ${courseScopeSubquery(scope)}
              RETURNING b.id::text`,
            [assignment_id, user_id],
        );
        return rows.length;
    }
}

/**
 * `img_files` 讀回來可能是陣列（json 欄位），舊資料也可能是 JSON 字串。
 * 兩種都吃，認不得就當作沒有照片 —— 不要讓一列壞資料把整份清單打掉。
 */
function filesOf(raw: unknown): string[] {
    if (!raw) return [];
    let arr: unknown = raw;
    if (typeof raw === 'string') {
        try { arr = JSON.parse(raw); } catch { return []; }
    }
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
}

export default BatchProxySubmissionHelper;
