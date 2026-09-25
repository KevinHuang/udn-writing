import { db } from './database';

/** 校務系統送回來的一位學生 */
export interface RosterStudent {
    account: string;
    name: string;
    seatNo: number | null;
}

/** 名單同步的結果，要拿去告訴老師「動了什麼」 */
export interface RosterSyncResult {
    added: Array<{ userId: string; name: string; account: string }>;
    removed: Array<{ userId: string; name: string; account: string }>;
    /** 同步後這一班有幾位學生 */
    total: number;
}

/**
 * 單一班級的學生名單同步（課程管理卡片上的「同步學生名單」）。
 *
 * 為什麼不直接用 DsaSyncHelper.syncLearners：那一支是**用字串接出 SQL** 的
 * （`'${user.name}'`），名字裡有一個單引號就會壞掉，而這些值來自外部的校務系統
 * —— 那是注入點，不是風格問題。這裡整條走參數化（unnest 陣列），
 * 而且回報「加了誰、移了誰」，老師才知道剛剛發生了什麼事。
 *
 * ⚠️ 移除學生只動 `uc_learner`。他已經繳交的作文**仍然留在資料庫**
 *    （submission 沒有 ref_course_id，也沒有外鍵），只是不再出現在這一班的
 *    名單與統計裡。這是刻意的：資料不該因為一次同步就消失。
 */
class RosterSyncHelper {

    public static async syncCourseRoster(
        courseId: string,
        roster: RosterStudent[],
    ): Promise<RosterSyncResult> {
        const accounts = roster.map((s) => s.account);
        const names = roster.map((s) => s.name || s.account);
        const seats = roster.map((s) => (Number.isFinite(s.seatNo as number) ? s.seatNo : null));

        return db.default.tx(async (t) => {
            /*
              1. 沒見過的帳號先建成使用者。
                 只補 account 與 name，不碰 last_signin —— 那是登入才會有的東西。
            */
            await t.none(
                `INSERT INTO "user" (account, name)
                 SELECT i.account, i.name
                   FROM unnest($1::varchar[], $2::varchar[]) AS i(account, name)
                   LEFT JOIN "user" u ON u.account = i.account
                  WHERE u.id IS NULL`,
                [accounts, names],
            );

            /*
              2. 不在新名單上的人 —— 先查出來（要回報姓名），再刪。
                 順序不能顛倒：刪完就查不到他們是誰了。
            */
            const removed = await t.manyOrNone<{ userId: string; name: string; account: string }>(
                `SELECT u.id::text AS "userId", u.name, u.account
                   FROM uc_learner l
                   JOIN "user" u ON u.id = l.ref_user_id
                  WHERE l.ref_course_id = $1
                    AND u.account <> ALL($2::varchar[])`,
                [courseId, accounts],
            );
            if (removed.length) {
                await t.none(
                    `DELETE FROM uc_learner
                      WHERE ref_course_id = $1
                        AND ref_user_id = ANY($2::bigint[])`,
                    [courseId, removed.map((r) => r.userId)],
                );
            }

            // 3. 新名單上、但還不在這一班的人
            const added = await t.manyOrNone<{ userId: string; name: string; account: string }>(
                `WITH incoming AS (
                     SELECT i.account, i.seat_no
                       FROM unnest($2::varchar[], $3::int[]) AS i(account, seat_no)
                 ),
                 ins AS (
                     INSERT INTO uc_learner (ref_course_id, ref_user_id, seat_no)
                     SELECT $1, u.id, i.seat_no
                       FROM incoming i
                       JOIN "user" u ON u.account = i.account
                       LEFT JOIN uc_learner l
                              ON l.ref_course_id = $1 AND l.ref_user_id = u.id
                      WHERE l.id IS NULL
                     RETURNING ref_user_id
                 )
                 SELECT u.id::text AS "userId", u.name, u.account
                   FROM ins
                   JOIN "user" u ON u.id = ins.ref_user_id`,
                [courseId, accounts, seats],
            );

            /*
              4. 已經在班上的人也要更新座號。
                 舊的批次同步只做「加」與「刪」，座號變動（換座位、重新編號）
                 永遠寫不進來，名冊排序就會跟校務系統對不起來。
            */
            await t.none(
                `UPDATE uc_learner l
                    SET seat_no = i.seat_no
                   FROM unnest($2::varchar[], $3::int[]) AS i(account, seat_no)
                   JOIN "user" u ON u.account = i.account
                  WHERE l.ref_course_id = $1
                    AND l.ref_user_id = u.id
                    AND l.seat_no IS DISTINCT FROM i.seat_no`,
                [courseId, accounts, seats],
            );

            const { total } = await t.one<{ total: number }>(
                `SELECT count(*)::int AS total FROM uc_learner WHERE ref_course_id = $1`,
                [courseId],
            );

            return { added, removed, total };
        });
    }
}

export default RosterSyncHelper;
