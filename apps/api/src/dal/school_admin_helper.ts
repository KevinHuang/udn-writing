
import dayjs from 'dayjs';
import { db } from './database';

/** 學校管理者的資訊  */
export class SchoolAdminHelper {

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