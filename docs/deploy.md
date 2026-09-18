# 部署到 Cloud Run

**服務**：`udn-writing-test`（專案 `writing-classroom-672f8`、區域 `asia-east1`）
**網址**：https://udn-writing-test-994138062914.asia-east1.run.app

前端與後端**打包成同一個服務** —— 後端用 `koa-static` 送出 `apps/web` 的建置產物，
API 走同源的 `/service` 與 `/auth`。所以沒有跨網域問題，session cookie 也不需要
`SameSite=none`（雖然程式在 production 下仍設成 none，見底下的「可以再收斂的地方」）。

---

## 建置與部署

```bash
npm run deploy          # 建置映像檔 + 部署（等於下面兩步）

npm run deploy:build    # 只建置：gcloud builds submit
npm run deploy:run      # 只部署：把 :latest 推上 Cloud Run
npm run deploy:smoke    # 部署後檢查（自動取得服務網址）
```

專案 id、region、服務名、映像檔路徑都寫在根目錄 `package.json` 的 script 裡，
不要在別處再抄一份。`npm run deploy` 是 `deploy:build && deploy:run` ——
建置失敗就不會部署。

冒煙測試也可以指向別的環境（本機、其他 revision）：

```bash
bash scripts/smoke.sh http://localhost:3000
```

環境變數只在**第一次**部署時設定，之後更新映像檔不必重設（Cloud Run 會保留）。

### ⚠️ build context 必須是根目錄

這是 monorepo：前端在 `apps/web`、共用型別在 `packages/shared`。
`apps/api/Dockerfile` 會用到 repo 根目錄的 `package-lock.json` 與三個 workspace。
在 `apps/api/` 底下跑 `gcloud builds submit` 一定失敗。

踩過的坑：Dockerfile 原本有 `COPY tsconfig*.json ./` —— **根目錄沒有這個檔**
（每個 workspace 各自有一份），建置會在那一步掛掉。

---

## 環境變數

第一次部署用 `--env-vars-file`（YAML）比 `--set-env-vars` 安全：後者的值會出現在
shell 歷史裡。設定完就把那個檔刪掉。

| 變數 | 值 | 說明 |
|---|---|---|
| `NODE_ENV` | `production` | 影響 cookie 的 secure/sameSite |
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` | 見 `.env` | |
| `DB_NAME` | **`writing_classroom_test`** | ⚠️ 見下方警告 |
| `OAUTH_CLIENT_ID` / `OAUTH_CLIENT_SECRET` / `OAUTH_SCOPE` | 見 `.env` | |
| `OAUTH_REDIRECT_URI` | `<服務網址>/auth/callback` | **要向 1Campus 登記** |
| `CLIENT_HOME_PAGE` | `<服務網址>` | 登入完成後導回這裡 |
| `DEVAPI_HOST` | `https://devapi.1campus.net` | 校務同步 |
| `GOOGLE_GENAI_USE_VERTEXAI` | `true` | |
| `GOOGLE_CLOUD_PROJECT` | `ischool-ai` | ⚠️ **跨專案**，見下 |
| `GOOGLE_CLOUD_LOCATION` | `global` | |
| `OCR_MODEL` / `GRADING_MODEL` | 見 `.env` | |
| `STORAGE_BUCKET_NAME` / `STORAGE_API_URL` | 見 `.env` | ⚠️ 與程式寫死的 bucket 不一致，見下 |
| `SESSION_KEY` | **另外產生一把**，不要沿用本機的 | `openssl rand -base64 48` |

### ⛔ DB_NAME 那道防護在 Cloud Run 上不會擋

`apps/api/src/dal/database.ts` 有一道保險：`DB_NAME` 是 `writing_classroom`
而 `NODE_ENV` 不是 `production` 就拒絕啟動。但 Cloud Run 上 `NODE_ENV=production`，
**那道防護不會生效**。連錯資料庫不會有任何人提醒你 —— 設定時自己看清楚。

---

## 已知的三個跨專案／不一致問題

**1. Vertex AI 在別的專案。** `GOOGLE_CLOUD_PROJECT=ischool-ai`，而服務跑在
`writing-classroom-672f8`。Cloud Run 的服務帳號必須在 **ischool-ai** 上有
`roles/aiplatform.user`，否則 AI 批改、OCR、期末總結全部會失敗（而且是呼叫時
才失敗，啟動時看不出來）。

**2. GCS bucket 名稱對不上。** 環境變數寫 `1campus-storage`，但
`apps/api/src/dal/storage_helper.ts` **寫死** `writing-classroom`。實際使用的是
寫死的那個。服務帳號需要它的寫入權限（手寫稿 OCR 會上傳），而學生端顯示原稿
是直接讀 `https://storage.googleapis.com/writing-classroom/...`，所以那個 bucket
還要允許公開讀取。

**3. 服務帳號。** 沒有指定 `--service-account`，用的是專案的預設 compute 服務帳號。
正式上線前應該建一個最小權限的專用帳號。

---

## 冒煙測試

```bash
npm run deploy:smoke
```

檢查四項（`scripts/smoke.sh`）：

| 路徑 | 預期 | 為什麼查這個 |
|---|---|---|
| `/` | 200 text/html | 首頁送得出前端 |
| `/auth/me` | 401 json | 未登入應為 401，不是 500 |
| `/service/nonsense` | **404 application/json** | 見下 |
| `/courses` | 200 text/html | SPA fallback：前端路由拿得到 index.html |

最後一項特別重要：**打錯的 API 路徑要回 404 JSON，不是 index.html**。
先前那個坑是 SPA fallback 檢查 `/api` 而真正的前綴是 `/service`，
結果打錯的 API 路徑回 200 HTML，前端拿到 HTML 當 JSON 解析。

⚠️ **上面四項都通過也不代表資料庫連得上** —— 它們都沒有碰到資料庫。
資料庫要到登入（寫 session）才會用到。真正的驗證是實際登入一次。

---

## 可以再收斂的地方

- **機密改用 Secret Manager。** 現在 `DB_PASSWORD`、`OAUTH_CLIENT_SECRET`、
  `SESSION_KEY` 是明文環境變數，任何有 Cloud Run 檢視權限的人
  `gcloud run services describe` 就看得到。
- **session cookie 可以收成 `SameSite=lax`。** `app.ts` 在 production 下設 `none`，
  那是為了前後端不同網域的舊架構。現在同源，`lax` 更安全。
- **舊前端退場**：`apps/api/public/` 已經被 `apps/web` 的建置產物取代，
  那三個相容措施可以拿掉了（見 `artifacts/spec.md` 的開放問題）。
