import crypto from 'crypto';

/**
 * 數位作品集的原稿照片：短效簽章網址。
 *
 * 為什麼不直接要求 Authorization 標頭：網頁的 <img src> 送不出標頭，
 * 作品集只好自己先下載再轉成 blob，每一張圖都要多寫一段程式。
 * 改成本系統在**檢查完權限之後**簽一個 15 分鐘有效的網址，作品集直接放進 <img> 就好；
 * 網址就算外流，15 分鐘後也失效，而且看不出 GCS 上的真實路徑。
 *
 * 簽章金鑰由 SESSION_KEY 衍生（HMAC 加上用途標籤），不必多管一把金鑰；
 * 換 SESSION_KEY 時舊的圖片網址一起失效 —— 反正它們本來就只活 15 分鐘。
 */

export const IMAGE_URL_TTL_SECONDS = 15 * 60;

const signingKey = () =>
  crypto.createHmac('sha256', process.env.SESSION_KEY ?? '').update('portfolio-image-url/v1').digest();

const signatureOf = (submissionId: string, index: number, exp: number) =>
  crypto.createHmac('sha256', signingKey()).update(`${submissionId}:${index}:${exp}`).digest('base64url');

/** 簽一張圖的網址（相對路徑）。呼叫端必須已經確認觀看者看得到這一篇 */
export function signedImagePath(submissionId: string, index: number, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + IMAGE_URL_TTL_SECONDS;
  return `/service/portfolio/v1/images/${submissionId}/${index}?exp=${exp}&sig=${signatureOf(submissionId, index, exp)}`;
}

/** 驗證簽章與期限。時間比較用 timingSafeEqual，不讓人用回應時間猜簽章 */
export function verifyImageSignature(
  submissionId: string, index: number, exp: string | undefined, sig: string | undefined, now = Date.now(),
): boolean {
  if (!exp || !sig || !/^\d+$/.test(exp)) return false;
  const expNum = Number(exp);
  if (expNum * 1000 < now) return false;
  const expected = Buffer.from(signatureOf(submissionId, index, expNum));
  const given = Buffer.from(sig);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

/** jsonb／json 欄位 → 字串陣列。pg 多半給陣列，舊資料也可能是 JSON 字串 */
function stringsOf(raw: unknown): string[] {
  let v: unknown = raw;
  if (typeof raw === 'string') {
    try { v = JSON.parse(raw); } catch { return []; }
  }
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];
}

/**
 * 一篇作品的原稿照片（GCS 相對路徑），依頁序。
 *
 * submission 自己有就用它的；沒有才退回批次代繳交的照片 —— 那邊存的是裸檔名，
 * 要補上 `submit/assign_<id>/`。規則與前端 apps/web/lib/proxy/paths.ts 的 originalsFor 相同。
 */
export function imagePathsOf(assignmentId: string, picFiles: unknown, batchFiles: unknown): string[] {
  const own = stringsOf(picFiles);
  if (own.length) return own;
  return stringsOf(batchFiles).map((f) => (f.includes('/') ? f : `submit/assign_${assignmentId}/${f}`));
}
