// import { Pool } from 'pg';
import pgPromise from 'pg-promise';
import conf from '../config';

import dotenv from 'dotenv';
dotenv.config();

/**
 * Production 資料庫的名稱。**有線上使用者正在使用，不可在開發或測試時連上。**
 *
 * 這道防護存在的原因：legacy 的 .env 與 .env.development 兩份都曾經指向這裡，
 * 也就是 `npm run dev` 與本機 `npm start` 都直接連著 production。
 * 靠人記得改檔案是不夠的 —— 下一個人 clone 下來就又踩一次。
 *
 * Cloud Run 上 NODE_ENV=production（cookie 的 SameSite=none 依賴它），
 * 所以正式部署不受這道檢查影響。
 */
const PRODUCTION_DB_NAME = 'writing_classroom';

if (conf.db.database === PRODUCTION_DB_NAME && process.env.NODE_ENV !== 'production') {
  throw new Error(
    `拒絕連線：DB_NAME 指向 production 資料庫「${PRODUCTION_DB_NAME}」，` +
    `但 NODE_ENV 是「${process.env.NODE_ENV ?? '(未設定)'}」。\n` +
    `開發與測試請改用 writing_classroom_test。\n` +
    `若真的要在本機連 production（唯讀查問題之類），請明確設定 NODE_ENV=production，` +
    `並且清楚知道任何寫入都會影響線上使用者。`
  );
}

export const db = {
  default: pgPromise()<pgPromise.IDatabase<any>>(conf.db)
};

// const pool = new Pool({
//   host: process.env.DB_HOST || 'localhost',
//   user: process.env.DB_USER || 'postgres',
//   password: process.env.DB_PASSWORD || 'password',
//   database: process.env.DB_NAME || 'writing_db',
//   port: parseInt(process.env.DB_PORT || '5432', 10),
// });

// export const query = (text: string, params?: any[]) => {
//   return pool.query(text, params);
// };
