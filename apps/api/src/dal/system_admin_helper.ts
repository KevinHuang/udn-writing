
import dayjs from 'dayjs';
import { db } from './database';

/** 學校管理者的資訊  */
export class SystemAdminHelper {

    /** 取得系統定義的管理者 */
    public static async get_by_account(account: string) {
        const sql = `
            select
                *
            from
                system_admin
            where
                account = $(account)                 
        `;

        const result = await db.default.oneOrNone(sql, { account });

        // console.log({ account, result });

        return (result);
    }


}

export default SystemAdminHelper;