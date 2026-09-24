import Router from '@koa/router';
import { Context } from 'koa';
import config from '../config';
import { TokenResponse, UserInfo } from '../types';
import { OAuthMiddleware } from '../middleware/oauth';
import { randomBytes } from 'crypto';
import LoginHistoryHelper from '../dal/login_history_helper';
import UserHelper from '../dal/user_helper';
import { SchoolAdminHelper } from '../dal/school_admin_helper';
import SystemAdminHelper from '../dal/system_admin_helper';
import sessionStore from '../dal/session_store';
import { availableIdentities, defaultIdentity, identityOptions, isIdentityType } from '../lib/identity';
// ⚠️ 開發專用登入，測完就整段移除（見 auth/dev_login.ts）
import { mountDevLogin } from './dev_login';

const router = new Router({ prefix: '/auth' });

/**
 * Step 1：登入按鈕
 * 導向使用者到 1Campus 授權頁面
 */
router.get('/login', async (ctx: Context) => {
  // 產生隨機 state 參數（防止 CSRF）
  const state = randomBytes(16).toString('hex');

  if (ctx.session.userInfo) {
    ctx.redirect(config.oauthConfig.clientHomePage);
    return;
  }

  // 儲存 state 到 cookie
  ctx.cookies.set('oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });

  // 組建授權 URL
  const authUrl = new URL(config.oauthConfig.authorizeUrl);
  authUrl.searchParams.append('client_id', config.oauthConfig.clientId);
  authUrl.searchParams.append('response_type', config.oauthConfig.responseType);
  authUrl.searchParams.append('redirect_uri', config.oauthConfig.redirectUri);
  authUrl.searchParams.append('scope', config.oauthConfig.scope);
  authUrl.searchParams.append('state', state);

  // 導向到 1Campus 登入頁面
  ctx.redirect(authUrl.toString());
});

/**
 * Step 2：Callback 路由
 * 1Campus 返回授權碼後的處理
 */
router.get('/callback', async (ctx: Context) => {
  const { code, state } = ctx.query;

  // 驗證 state 參數（防 CSRF）
  const savedState = ctx.cookies.get('oauth_state');

  // state 是一次性的：驗證過就清掉，留著可以被重放。
  // 放在比對之前清，是為了讓所有離開路徑（含下面的 400 與後面的 catch）
  // 都不會留下這個 cookie。
  ctx.cookies.set('oauth_state', '', { maxAge: 0 });

  // 注意這裡必須檢查 savedState 存在。
  // 原本只寫 `state !== savedState`，兩邊都是 undefined 時
  // （沒帶 state 參數、也沒有 cookie）比較結果是 false —— 驗證直接放行，
  // 等於完全沒有 CSRF 防護。
  if (!savedState || typeof state !== 'string' || state !== savedState) {
    ctx.status = 400;
    ctx.body = { error: 'Invalid state parameter' };
    return;
  }

  if (!code) {
    ctx.status = 400;
    ctx.body = { error: 'Missing authorization code' };
    return;
  }

  try {
    // Step 2a：用授權碼換取 access_token
    const tokenResponse = await fetch(config.oauthConfig.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: config.oauthConfig.clientId,
        client_secret: config.oauthConfig.clientSecret,
        redirect_uri: config.oauthConfig.redirectUri,
        code: code as string,
        grant_type: config.oauthConfig.grantType,
      }).toString(),
    });

    if (!tokenResponse.ok) {
      throw new Error(`Token endpoint error: ${tokenResponse.statusText}`);
    }

    const tokenData: TokenResponse = await tokenResponse.json();

    // Step 2b：用 access_token 取得使用者資訊
    const userResponse = await fetch(
      `${config.oauthConfig.userInfoUrl}?access_token=${tokenData.access_token}`
    );

    if (!userResponse.ok) {
      throw new Error(`UserInfo endpoint error: ${userResponse.statusText}`);
    }

    const userInfo: UserInfo = await userResponse.json();
    userInfo.account = userInfo.mail;
    // const userInfo: UserInfo = (
    //   {
    //     "mail": "113207@ynhs.ylc.edu.tw",
    //     "uuid": "701f0d1c-792e-4022-9625-cdfce6b496d1",
    //     "language": "zh-Hant-TW",
    //     "lastName": "丁",`
    //     "firstName": "貝佳",
    //     isSchoolAdmin: false,
    //     isInstructor: false,
    //     isLearner: true,
    //     isSystemAdmin: false,
    //     id: 987,
    //     ref_school_id: '22',
    //     account: '113207@ynhs.ylc.edu.tw',
    //     clientIP: '163.27.232.254',
    //     targetDSNS: '',
    //     roles: [

    //     ],
    //     // "application": []
    //   }
    // );

    // console.log({ userInfo });

    // Step 3：建立 session
    const recUser = await UserHelper.add(userInfo);

    // console.log({ recUser })

    // 判斷是否是校管理者
    // const adminRec = await SchoolAdminHelper.get_by_account(dsns.toString(), userInfo.account);
    // userInfo.isAdmin = !!adminRec;

    // 如果是澔學帳號，才判斷是否是系統管理者。
    // if (userInfo.mail.indexOf('ischool.com.tw') > -1) {
    // 判斷是否是系統管理者
    const systemAdminRec = await SystemAdminHelper.get_by_account(userInfo.mail);
    userInfo.isSystemAdmin = !!systemAdminRec;
    // }

    console.log({ userid: recUser.id })

    /**
     * 使用者的 IP。
     *
     * app.ts 設了 `app.proxy = true`，Koa 的 `ctx.request.ip` 在那之下**已經**
     * 會回傳 X-Forwarded-For 的第一個值，沒有代理時才退回 socket 位址。
     * 所以這裡不需要、也不該自己解析標頭。
     *
     * 原本的寫法是：
     *
     *   let clientIP = ctx.request.ip;
     *   if (ctx.request.ip !== "::1") {
     *     clientIP = ctx.headers!['x-forwarded-for']!.toString().split(',')[0];
     *   }
     *
     * 只要來源不是 `::1` 又沒有 X-Forwarded-For，那個 `!` 就是在對 undefined
     * 呼叫 .toString() —— **整個登入 callback 直接 500**。
     * Cloud Run 前面有負載平衡器一定帶 XFF 所以沒被踩到，但本機用
     * 127.0.0.1（IPv4）而不是 localhost（IPv6）登入就會壞。
     */
    const clientIP = ctx.request.ip;


    // 2. 紀錄使用者登入歷程，
    await LoginHistoryHelper.addLog(userInfo, clientIP);

    // console.log('開始儲存使用者資料到 session 中');
    userInfo.id = recUser.id;
    userInfo.ref_school_id = recUser.ref_school_id;
    userInfo.clientIP = clientIP;
    userInfo.account = userInfo.mail;

    const identities = await UserHelper.getIdentity(userInfo.account);
    userInfo.roles = identities;
    userInfo.isSchoolAdmin = identities.some(identity => identity.identity_type === 'school_admin');
    userInfo.isInstructor = identities.some(identity => identity.identity_type === 'instructor');
    userInfo.isLearner = identities.some(identity => identity.identity_type === 'learner');

    // 3. 儲存在 session 中
    ctx.session.userInfo = userInfo;

    /**
     * 目前身分的預設值。
     *
     * explicit = false 代表「這是系統挑的，不是使用者選的」。
     * 守衛會因此放寬（見 middleware/oauth.ts）—— 目前線上的舊前端沒有
     * 身分切換 UI，不會呼叫 /auth/identity，嚴格檢查會直接把它擋死。
     * 舊前端退場後（spec.md 開放問題 4），這個欄位連同放寬一起移除。
     */
    ctx.session.activeIdentity = { type: defaultIdentity(userInfo), explicit: false };
    // const sessionId = randomBytes(32).toString('hex');
    // OAuthMiddleware.setSession(sessionId, {
    //   uuid: userInfo.uuid,
    //   name: `${userInfo.lastName}${userInfo.firstName}`,
    //   mail: userInfo.mail,
    //   language: userInfo.language,
    //   accessToken: tokenData.access_token,
    //   loginTime: Date.now(),
    // });

    // // 設定 session cookie
    // ctx.cookies.set('sessionId', sessionId, {
    //   httpOnly: true,
    //   secure: process.env.NODE_ENV === 'production',
    //   sameSite: 'lax',
    //   maxAge: tokenData.expires_in * 1000,
    // });

    // 重導到首頁或儀表板
    const origin = ctx.get('Origin');
    // console.log({ origin });
    const next_url = process.env.CLIENT_HOME_PAGE || origin;
    // console.log({ next_url });
    ctx.redirect(next_url);
    // console.log('重導完成');

  } catch (error) {
    // 細節只進 server log。token endpoint 的錯誤訊息可能含有設定細節
    // （endpoint 位址、client_id、甚至回應內容），不要原樣吐給瀏覽器。
    console.error('OAuth callback error:', error);
    ctx.status = 500;
    ctx.body = { error: 'Authentication failed' };
  }
});

/**
 * 取得目前登入者資訊
 */
router.get('/me', OAuthMiddleware.requireLogin, (ctx: Context) => {
  const user = ctx.session.userInfo;
  ctx.body = {
    ...user,
    /** 這個人有哪些身分可以選，以及每種身分橫跨哪些學校 */
    identities: identityOptions(user),
    /** 現在選的是哪一種。前端的大頭貼下拉依這個顯示 */
    activeIdentity: ctx.session.activeIdentity?.type ?? null,
  };
});

/**
 * 切換目前身分。
 *
 * **只能切到自己真的擁有的身分** —— 前端送什麼過來都要驗，
 * 否則這支 endpoint 就變成提權的入口。
 */
router.post('/identity', OAuthMiddleware.requireLogin, (ctx: Context) => {
  const { type } = (ctx.request.body ?? {}) as { type?: unknown };

  if (!isIdentityType(type)) {
    ctx.status = 400;
    ctx.body = { error: 'Invalid identity type' };
    return;
  }
  if (!availableIdentities(ctx.session.userInfo).includes(type)) {
    ctx.status = 403;
    ctx.body = { error: 'You do not have this identity' };
    return;
  }

  ctx.session.activeIdentity = { type, explicit: true };
  ctx.body = { activeIdentity: type };
});

/**
 * 登出
 */
/**
 * 登出。
 *
 * **正式的方法是 POST。** GET 暫時保留是因為目前部署中的舊前端
 * （apps/api/public/ 那份）呼叫的是 GET —— 現在拿掉會讓線上使用者無法登出。
 *
 * GET 登出可以被任何一張 <img src="/auth/logout"> 觸發，屬於 CSRF。
 * 危害只是被強制登出，不會外洩資料，所以可以接受短期並存。
 *
 * ⚠️ apps/web 接上之後（spec.md Phase 4），**把 GET 這條拿掉**。
 */
const handleLogout = (ctx: Context) => {
  const sess = ctx.session;
  // console.log({ sess });
  if (sess) {
    // ctx.session.userInfo = null;
    console.log({ action: 'destroy session', id: sess.id })
    // sessionStore.destroy(sess.id);
    ctx.session = null;
  }
  ctx.body = { message: 'Logged out successfully' };
};

router.post('/logout', handleLogout);
/** @deprecated 舊前端相容用，apps/web 接上後移除 */
router.get('/logout', handleLogout);

// ⚠️ 開發專用登入，測完就整段移除（見 auth/dev_login.ts）
mountDevLogin(router);

export default router;