import dotenv from 'dotenv';
import path from 'path';

/**
 * 環境變數收斂在 repo 根目錄的 .env（monorepo 只留一份）。
 *
 * 開發時 `npm run dev` 已經透過 tsx 的 --env-file 注入，這行是給
 * 本機 `npm start`（跑編譯後的 dist）用的備援。
 * 從 src/ 與從 dist/ 往上三層都是 repo 根目錄。
 *
 * 正式環境（Cloud Run）沒有這個檔，環境變數由 gcloud 設定；
 * 找不到檔案時 dotenv 會安靜地略過，不影響啟動。
 */
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const config = {

    oauthConfig: {
        // 替換為您的實際值
        clientId: process.env.OAUTH_CLIENT_ID || 'your_client_id',
        clientSecret: process.env.OAUTH_CLIENT_SECRET || 'your_client_secret',
        redirectUri: process.env.OAUTH_REDIRECT_URI || 'http://localhost:3000/auth/callback',

        // devapi
        devapiHost: process.env.DEVAPI_HOST || 'https://devapi.1campus.net',

        // 1Campus OAuth 端點。
        // 預設值就是正式的 1Campus 位址，平常不必設定；
        // 可覆寫是為了整合測試能指向本機的假 IdP。
        authorizeUrl: process.env.OAUTH_AUTHORIZE_URL || 'https://auth.ischool.com.tw/oauth/authorize.php',
        tokenUrl: process.env.OAUTH_TOKEN_URL || 'https://auth.ischool.com.tw/oauth/token.php',
        userInfoUrl: process.env.OAUTH_USERINFO_URL || 'https://auth.ischool.com.tw/services/me.php',

        // OAuth 參數
        scope: process.env.OAUTH_SCOPE || 'User.Mail,User.BasicInfo,User.Application',
        responseType: 'code',
        grantType: 'authorization_code',

        // 導向 client 路徑
        clientHomePage: process.env.CLIENT_HOME_PAGE || 'http://localhost:3000',
    },

    storage: {
        api_url: process.env.STORAGE_API_URL || 'https://storage.googleapis.com/upload/storage/v1/b/1campus-storage/o',
        bucket_name: process.env.STORAGE_BUCKET_NAME || '1campus-storage',
    },

    db: {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'password',
        database: process.env.DB_NAME || 'writing_db',
    },
    ocrModel: process.env.OCR_MODEL || 'gemini-3.1-pro-preview',
    gradingModel: process.env.GRADING_MODEL || 'gemini-3.7-flash',
};

export default config;