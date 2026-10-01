import crypto from 'crypto';
import config from '../config';

/**
 * 數位作品集的使用者是誰 —— 用他自己的 1Campus 登入憑證來證明。
 *
 * 數位作品集是另一個獨立平台（學生的同校佳作觀摩、家長功能），使用者在那邊用
 * 1Campus 登入，拿到 access token 後帶著呼叫這個系統的 /service/portfolio/*。
 * 這裡拿 token 去問 1Campus 的 userinfo（與 /auth/callback 同一支），
 * 得到 mail 之後再對到 "user".account。
 *
 * 使用者決定（2026-10-01）：用使用者自己的 1Campus 登入，不用平台共用金鑰 ——
 * 誰能看什麼由這個系統依「這個人是誰」決定，作品集平台本身拿不到別人的資料。
 *
 * ⚠️ 待 1Campus 確認：作品集是**另一個 OAuth client**，它拿到的 token
 *    這個系統拿去問 userinfo 能不能過。測試用假 IdP 模擬；正式環境要實際驗過。
 *
 * 快取：每個請求都去問 1Campus 太慢，token 驗過之後記 5 分鐘。
 * 鍵是 token 的 SHA-256，記憶體裡不留 token 原文。
 */

export interface CampusIdentity {
  mail: string;
  name: string;
  uuid?: string;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 5000;
const cache = new Map<string, { identity: CampusIdentity; expires: number }>();

const keyOf = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

/** 測試用：清掉快取，讓下一個案例重新問 1Campus */
export function clearPortfolioIdentityCache(): void {
  cache.clear();
}

/**
 * 從 Authorization: Bearer <token> 取出 token。格式不對回傳 null。
 * token 只放在標頭，不收網址參數 —— 網址會進存取紀錄與瀏覽器歷史。
 */
export function bearerTokenOf(header: string | undefined): string | null {
  const m = /^Bearer\s+([A-Za-z0-9._~+/=-]{8,4096})$/.exec(header ?? '');
  return m ? m[1] : null;
}

/**
 * 問 1Campus 這個 token 是誰。token 無效（1Campus 回非 2xx、或沒有 mail）回傳 null。
 * 連不上 1Campus 則丟出例外 —— 呼叫端要回 502，不能當成「token 無效」。
 */
export async function identityOf(token: string): Promise<CampusIdentity | null> {
  const key = keyOf(token);
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.identity;

  // 與 /auth/callback 同樣的呼叫方式（auth/index.ts 的 Step 2b）
  const res = await fetch(
    `${config.oauthConfig.userInfoUrl}?access_token=${encodeURIComponent(token)}`,
  );
  if (!res.ok) {
    cache.delete(key);
    return null;
  }
  const info = (await res.json().catch(() => null)) as
    | { mail?: string; uuid?: string; lastName?: string; firstName?: string }
    | null;
  if (!info?.mail) return null;

  const identity: CampusIdentity = {
    mail: info.mail,
    name: `${info.lastName ?? ''}${info.firstName ?? ''}`,
    uuid: info.uuid,
  };
  if (cache.size >= CACHE_MAX) {
    // 簡單的上限：滿了就把最舊的那一個丟掉（Map 依插入順序）
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { identity, expires: Date.now() + CACHE_TTL_MS });
  return identity;
}
