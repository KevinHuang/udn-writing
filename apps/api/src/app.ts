import Koa from 'koa';
import Router from '@koa/router';
import bodyParser from 'koa-bodyparser';
import cors from '@koa/cors';
import serve from 'koa-static';
import path from 'path';
import fs from 'fs';
// import { generateTaskPrompt, gradeSubmission } from './services/geminiService.js';
import serviceRouter from './routes/index';
import auth from './auth';

import session from 'koa-session';
import sessionStore from './dal/session_store';



const app = new Koa();
app.proxy = true; // Trust proxy headers like X-Forwarded-Proto for HTTPS detection，這個標頭的功能就是告訴後端的伺服器：「雖然你收到的是 HTTP，但源頭的客戶端連線其實是 HTTPS 哦！」
const router = new Router();

// Configure CORS to allow frontend communication with credentials support
app.use(cors({
  origin: (ctx) => {
    // const allowed = (process.env.CLIENT_HOME_PAGE || 'http://localhost:3000,http://localhost:5002').split(',').map(o => o.trim());
    // const origin = ctx.get('Origin');
    // return allowed.includes(origin) ? origin : allowed[0];
    return process.env.CLIENT_HOME_PAGE || 'http://localhost:3000';
  },
  credentials: true,               // 允許攜帶 Cookie
}));
/**
 * Session cookie 的簽章金鑰。
 *
 * 先前寫死在這個檔案裡，等於任何有 repo 存取權的人都拿得到 ——
 * 拿到就能偽造任何人的 session。現在改讀環境變數。
 *
 * 刻意不給預設值：少設一個環境變數就靜默回退到一把大家都知道的金鑰，
 * 比直接啟動失敗糟得多。
 *
 * ⚠️ 換掉這個值會讓**所有人被登出**，挑離峰時間做。
 * 產生方式：openssl rand -base64 48
 */
if (!process.env.SESSION_KEY) {
  throw new Error(
    '缺少環境變數 SESSION_KEY —— 這是 session cookie 的簽章金鑰，沒有它就不能啟動。\n' +
    '本機：填進 repo 根目錄的 .env。\n' +
    'Cloud Run：用 gcloud run deploy --set-env-vars 或 Secret Manager 設定。\n' +
    '產生一把：openssl rand -base64 48'
  );
}
app.keys = [process.env.SESSION_KEY];

// 設定上傳文件大小限制
app.use(bodyParser({
  jsonLimit: '20mb',
  formLimit: '20mb',
  textLimit: '20mb'
}));

// Serve static files from the public directory
app.use(serve(path.join(__dirname, '../public')));

// 這個變數是用來相容開發環境（localhost）與 正式環境（cloud run）的 Cookie SameSite 設定差異。
// 在開發環境中 (localhost)， 我們使用 SameSite=lax，因為瀏覽器允許 同 Domain (不同 port)之間傳送 Cookie。
// 在正式環境中 (cloud run)，我們使用 SameSite=none，因為瀏覽器不允許 不同 Domain Name 之間傳送 Cookie。
const isProduction = process.env.NODE_ENV === 'production';

// 設定 session
const CONFIG = {
  key: '@1campus_writing_classroom',
  maxAge: 8 * 60 * 60 * 1000,
  store: sessionStore,
  sameSite: isProduction ? ('none' as const) : ('lax' as const),
  secure: isProduction,
};

app.use(session(CONFIG, app));

// auth 服務
app.use(auth.routes());
app.use(auth.allowedMethods());

// service 服務
app.use(serviceRouter.routes());
app.use(serviceRouter.allowedMethods());

/** 後端 API 的路徑前綴。這些底下沒對到就是 404，不要落到 SPA fallback。 */
const API_PREFIXES = ['/service', '/auth', '/api'];

// 如果都沒有符合的 route，則回傳 /public/index.html 檔案
app.use(async (ctx) => {
  // API 的路徑沒對到就回 404 JSON，不要回 index.html。
  //
  // 這裡原本檢查的是 '/api'，但**實際的 API 前綴是 '/service'**
  //（見 routes/index.ts；'/api' 底下從來沒掛過東西）。
  // 於是任何打錯或已移除的 /service/* 都會拿到 HTTP 200 的 HTML，
  // 呼叫端 JSON.parse 時才炸，而且錯誤訊息完全指不到真正的原因。
  if (API_PREFIXES.some((prefix) => ctx.path === prefix || ctx.path.startsWith(prefix + '/'))) {
    ctx.status = 404;
    ctx.body = { error: 'Not Found' };
    return;
  }
  const indexPath = path.join(__dirname, '../public/index.html');
  if (fs.existsSync(indexPath)) {
    ctx.type = 'html';
    ctx.body = fs.createReadStream(indexPath);
  } else {
    ctx.status = 404;
    ctx.body = { error: 'Index file not found' };
  }
});

/*
// RESTful endpoints for Gemini calls
router.post('/api/gemini/generateTaskPrompt', async (ctx) => {
  try {
    const { topic, level } = ctx.request.body as any;
    if (!topic || !level) {
      ctx.status = 400;
      ctx.body = { error: 'Topic and level are required parameters' };
      return;
    }
    const result = await generateTaskPrompt(topic, level);
    ctx.body = result;
  } catch (error: any) {
    console.error('generateTaskPrompt error:', error);
    ctx.status = 500;
    ctx.body = { error: error.message || 'Server error' };
  }
});

router.post('/api/gemini/gradeSubmission', async (ctx) => {
  try {
    const { prompt, submission } = ctx.request.body as any;
    if (!prompt || !submission) {
      ctx.status = 400;
      ctx.body = { error: 'Prompt and submission are required parameters' };
      return;
    }
    const result = await gradeSubmission(prompt, submission);
    ctx.body = result;
  } catch (error: any) {
    console.error('gradeSubmission error:', error);
    ctx.status = 500;
    ctx.body = { error: error.message || 'Server error' };
  }
});

*/
// app.use(router.routes()).use(router.allowedMethods());

export default app;
