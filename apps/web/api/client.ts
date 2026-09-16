/**
 * 後端呼叫的共同底層。
 *
 * **所有對後端的請求都走這裡**，不要在元件或 api/*.ts 裡自己 fetch ——
 * credentials、錯誤處理、JSON 解析這三件事各寫一次，就會有一處忘記帶
 * cookie 或忘記檢查狀態碼，而那不會有編譯錯誤。
 *
 * 路徑前綴是 `/service` 與 `/auth`（**不是 `/api`**，見 docs/auth.md）。
 * 開發時由 Vite proxy 轉到 :3001，正式環境是後端直接 serve 前端，都是同源。
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  /** 沒登入，或 session 過期了 */
  get isUnauthenticated() { return this.status === 401; }
  /** 登入了但沒有權限 */
  get isForbidden() { return this.status === 403; }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    // session 在 HttpOnly cookie 裡，不帶 credentials 就等於沒登入
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });

  if (!res.ok) {
    // 後端的錯誤回應是 { error: '...' }，但打錯路徑時會是別的東西 ——
    // 解析失敗不該蓋掉真正有用的狀態碼
    let message = res.statusText;
    try {
      const body = await res.json();
      if (typeof body?.error === 'string') message = body.error;
    } catch { /* 不是 JSON 就用 statusText */ }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
