import { db } from './database';

class LoginHistoryHelper {

    /** 透過 identity code 取得登入者資訊 */
    public static async addLog(userInfo: any, ip: string) {
        if (!userInfo) { return; }

        const sql = `INSERT INTO login_history (user_name, dsns, role_type, login_time, name, user_info, client_ip) VALUES ($1, $2, $3, now(), null, $4, $5);`

        await db.default.none(sql, [userInfo.mail, userInfo.schoolDsns, userInfo.roleType, userInfo, ip]);
    }

}

export default LoginHistoryHelper;