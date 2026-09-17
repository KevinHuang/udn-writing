/**
 * 測試的預載檔（`tsx --import ./src/test/setup.ts`）。
 *
 * **必須在任何東西 import config.ts 之前執行**，因為 config 在模組載入當下
 * 就把環境變數讀進去了。用 --import 預載才保證順序，不要改成在測試檔裡 import。
 */

/** 正式資料庫。有線上使用者，測試絕對不能碰。 */
const PRODUCTION_DB_NAME = 'writing_classroom';

const devDb = process.env.DB_NAME;
const testDb = process.env.TEST_DB_NAME;

function abort(message: string): never {
  console.error('\n❌ 測試中止\n' + message + '\n');
  process.exit(1);
}

if (!testDb) {
  abort('沒有設定 TEST_DB_NAME。\n' +
        '測試需要一個**專屬且可被清空**的資料庫，請在 repo 根目錄的 .env 設定。');
}

if (testDb === PRODUCTION_DB_NAME) {
  abort(`TEST_DB_NAME 指向 production 資料庫「${PRODUCTION_DB_NAME}」。\n` +
        '測試每個案例前會清空所有資料表 —— 跑下去就沒了。');
}

if (testDb === devDb) {
  abort(`TEST_DB_NAME 與 DB_NAME 相同（都是「${testDb}」）。\n` +
        '測試每個案例前會清空所有資料表，這會把開發資料洗掉。\n' +
        '請另外建立一個空的資料庫給測試用。');
}

/**
 * DAL 讀的是 DB_NAME（config.ts → database.ts），所以直接把它換成測試庫。
 * 換過之後 src/dal/database.ts 那道 production 防護仍然有效 ——
 * 兩道檢查互相補位。
 */
process.env.DB_NAME = testDb;

/**
 * 把 OAuth endpoint 指到本機的假 IdP（helpers.ts 會在這個 port 起一個）。
 * 固定 port 而不是隨機 port，是因為 config.ts 在模組載入時就讀完環境變數了，
 * 那時候還拿不到隨機分配的結果。
 */
export const FAKE_IDP_PORT = 39001;
const idp = `http://127.0.0.1:${FAKE_IDP_PORT}`;
process.env.OAUTH_AUTHORIZE_URL = `${idp}/authorize`;
process.env.OAUTH_TOKEN_URL = `${idp}/token`;
process.env.OAUTH_USERINFO_URL = `${idp}/me`;
process.env.OAUTH_CLIENT_ID = 'test-client-id';
process.env.OAUTH_CLIENT_SECRET = 'test-client-secret';
process.env.OAUTH_REDIRECT_URI = 'http://127.0.0.1/auth/callback';
process.env.CLIENT_HOME_PAGE = 'http://127.0.0.1/';

/** app.ts 沒有這個會拒絕啟動。測試用固定值即可。 */
process.env.SESSION_KEY = process.env.SESSION_KEY || 'test-session-key-not-a-real-secret';

/**
 * **關掉 Vertex AI。**
 *
 * repo 根目錄的 .env 為了開發方便有設 GOOGLE_GENAI_USE_VERTEXAI=true，
 * 但測試不該打真的 AI：慢、要錢、而且每次回傳都不一樣，斷言無從寫起。
 * 關掉之後批改會走 dal/simulated_grading.ts 的決定性模擬批改 ——
 * 那正好也是「沒有憑證時仍要能跑完流程」這條規格要驗的行為。
 */
/*
  ⚠️ 這裡**不能用 delete**。config.ts 在自己被載入時才呼叫 dotenv.config()，
  那已經是這個檔跑完之後了 —— 而 dotenv 只會跳過「已存在」的 key。
  delete 掉等於把 key 讓出來，dotenv 立刻從 .env 把 true 灌回去，
  測試就會去打真的 Vertex AI（實際發生過，燒掉了一些 token）。
  設成空字串／false 則 key 仍然存在，dotenv 不會覆寫。
*/
process.env.GOOGLE_GENAI_USE_VERTEXAI = 'false';
process.env.GOOGLE_CLOUD_PROJECT = '';

process.env.NODE_ENV = 'test';
