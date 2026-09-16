import { db } from './database';

class SystemHelper {

    /** 透過 identity code 取得登入者資訊 */
    public static async server_time() {
        const sql = `
            SELECT now() as current_time
        `;

        const result = await db.default.oneOrNone(sql);

        return result;
    }

    public static async period_list(dsns: string) {
        const sql = `
            SELECT semester,
                   period 
              FROM school_period
              WHERE ref_school_id IN (
                SELECT 
                  id 
                 FROM school
                    WHERE dsns=($dsns)
                    )
        `;

        const result = await db.default.manyOrNone(sql, [dsns]);

        return result.map((p: any) => p.period);
    }

    public static async get_schools() {
        const sql = `
              SELECT 
                    id, dsns, school_name
              FROM 
                    school
              ORDER BY
                    school_name ASC
        `;

        const result = await db.default.manyOrNone(sql, []);

        return result;
    }
}

export default SystemHelper;