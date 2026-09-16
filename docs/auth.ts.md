# 1Campus OAuth 2.0 Authorization Code Grant Flow Sample Code #

```typescript
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

  // 驗證 state 參數
  const savedState = ctx.cookies.get('oauth_state');
  if (state !== savedState) {
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

    // console.log('開始寫入登入歷程');
    //const clientIP = ctx.headers['x-forwarded-for'].toString().split(',')[0];
    let clientIP = ctx.request.ip;
    if (ctx.request.ip !== "::1") {
      clientIP = ctx.headers!['x-forwarded-for']!.toString().split(',')[0];
    }
    // console.log({ headers: ctx.headers, clientIP })


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

    // // 清除 state cookie
    // ctx.cookies.set('oauth_state', '', { maxAge: 0 });

    // 重導到首頁或儀表板
    const origin = ctx.get('Origin');
    // console.log({ origin });
    const next_url = process.env.CLIENT_HOME_PAGE || origin;
    // console.log({ next_url });
    ctx.redirect(next_url);
    // console.log('重導完成');

  } catch (error) {
    console.error('OAuth callback error:', error);
    ctx.status = 500;
    ctx.body = {
      error: 'Authentication failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
});

/**
 * 取得目前登入者資訊
 */
router.get('/me', OAuthMiddleware.requireLogin, (ctx: Context) => {
  // console.log({ action: 'get user info', sess: ctx.session })
  ctx.body = ctx.session.userInfo;
});

/**
 * 登出
 */
router.get('/logout', (ctx: Context) => {
  const sess = ctx.session;
  // console.log({ sess });
  if (sess) {
    // ctx.session.userInfo = null;
    console.log({ action: 'destroy session', id: sess.id })
    // sessionStore.destroy(sess.id);
    ctx.session = null;
  }
  ctx.body = { message: 'Logged out successfully' };
});

export default router;


```