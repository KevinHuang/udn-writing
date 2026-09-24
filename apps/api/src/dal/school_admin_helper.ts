
import dayjs from 'dayjs';
import { db } from './database';

/** 學校管理者的資訊  */
export class SchoolAdminHelper {

    /**
     * 這個帳號管哪幾所學校。
     *
     * 校務管理身分的資料範圍就靠這個 —— session 裡沒有學校 id 可用：
     * `UserHelper.getIdentity()` 只回 `school_name`（字串），而
     * `userInfo.ref_school_id` 實際上永遠是 undefined（見 docs/auth.md）。
     * 所以每次要範圍就回頭查這張表，用 account 比對（getIdentity 也是用 account，
     * 不是 ref_user_id —— 兩邊要一致，否則會出現「選單上有校務管理身分、
     * 但一所學校都查不到」的錯位）。
     *
     * 一個人管多校就是多列，所以回陣列。
     */
    public static async schoolIdsOfAccount(account: string): Promise<number[]> {
        const rows = await db.default.manyOrNone<{ ref_school_id: string | number }>(
            `select distinct ref_school_id
               from school_admin
              where account = $(account) and ref_school_id is not null`,
            { account },
        );
        return rows.map((r) => Number(r.ref_school_id)).filter((n) => Number.isSafeInteger(n));
    }

    /** 取得學校定義的管理者 */
    public static async get_by_account(dsns: string, account: string) {
        const sql = `
            select
                *
            from
                school_admin
            where
                ref_school_id in (select id from school where dsns=$(dsns))
                and account = $(account)                 
        `;

        const result = await db.default.oneOrNone(sql, { dsns, account });

        // console.log({ dsns, account, result });

        return (result);
    }

    public static async getSchoolAdmin(dsns: string) {
        const sql = `
        select
            *
        from
            school_admin
        where
            ref_school_id in (select id from school where dsns=$(dsns))              
    `;

        const result = await db.default.manyOrNone(sql, { dsns });
        return (result);
    }

    /** 新增指定學校所定義的簽核流程 */
    public static async addSchoolAdmin(dsns: string, account: string, name: string, role_type: string) {
        const sql = `
            insert into school_admin
                (ref_school_id, account, name, role_type)
            values
                ((select id from school where dsns=$(dsns)), $(account), $(name), $(role_type))
        `;

        const result = await db.default.manyOrNone(sql, { dsns, account, name, role_type });

        // console.log( { result });

        return result;
    }

    /** 刪除學校所定義的簽核流程 */
    public static async deleteSchoolAdmin(id: number) {
        const sql = `
            delete from school_admin
            where id=$(id)
        `;

        const result = await db.default.manyOrNone(sql, { id });

        // console.log( { result });

        return result;
    }

}

export default SchoolAdminHelper;