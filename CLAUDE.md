# 聯合報雲寫作教室 —— 給接手的開發者與 AI

這一份只放**不常變**的東西。目前做到哪、還有什麼沒驗證，看 [`artifacts/handoff.md`](artifacts/handoff.md)。
Claude Code 做不到、要人去操作的事，看 [`artifacts/action-items.md`](artifacts/action-items.md)。

## 專案地圖

| 位置 | 內容 |
|---|---|
| `apps/api` | 後端。Koa ＋ pg-promise ＋ TypeScript，部署在 Cloud Run |
| `apps/web` | 前端。React ＋ Vite ＋ Tailwind v4。**改前端先讀 [`apps/web/CLAUDE.md`](apps/web/CLAUDE.md)**（顏色 token、深色模式、對比度等規則） |
| `packages/shared` | 前後端共用的型別（`types.ts`） |
| `artifacts/` | 規格（`spec.md`）、發現（`findings.md`）、API 缺口（`api-gap.md`）、交接與待辦 |
| `docs/` | 部署（`deploy.md`）、批次代繳交的背景辨識（`ocr-job.md`）、schema、migrations |

⚠️ `docs/schema.sql` 是舊的 dump（例如沒有 `submission.is_submitted`），欄位以實際資料庫為準。

## 怎麼跑、怎麼測

```bash
npm run dev                    # 前端 :3000、後端 :3001（同時起）
npm test -w @udn/api           # 真 Postgres、--test-concurrency=1，整套約 19 分鐘
npm test -w @udn/web           # tsx --test，幾秒
npm run lint -w @udn/web       # eslint ＋ 色彩 token 稽核 ＋ 示範資料檢查
npx tsc --noEmit -p apps/api/tsconfig.json
npx tsc --noEmit -p apps/web/tsconfig.json
```

- 只跑單一後端測試檔：在 `apps/api` 底下
  `npx tsx --env-file=../../.env --import ./src/test/setup.ts --test --test-concurrency=1 src/test/<檔名>.test.ts`
- 後端整套測試跑的時候**不要改 `apps/api/src`**：測試檔是一支一支依序起程序的，
  後面的檔案會讀到改到一半的程式。
- 後端測試不打真的 AI、GCS、Cloud Run（`src/test/setup.ts` 關掉了）。

## 不能碰的

- **正式資料庫 `writing_classroom`**。開發用 `writing_classroom_test`，測試用 `writing_classroom_autotest`
  （`src/test/setup.ts` 與 `dal/database.ts` 各有一道防護）。
- **正式環境的 migration 由人決定、由人執行**。
- **不要在對話裡要資料庫密碼**；`.env` 不進 git。
- `apps/api/src/auth/dev_login.ts` 是**開發專用**的登入（讓手機能登入測試），上線前要移除，見交接文件。

## 慣例

- 註解與 commit 訊息用**繁體中文**，重點寫「為什麼」與「踩過什麼」，不是複述程式在做什麼。
- 前端純邏輯抽成 `apps/web/lib/` 的模組再寫測試（元件本身沒有 DOM 測試環境）。
- 狀態的顏色與文字只有一個來源：`apps/web/lib/statusStyles.ts`。
- 教師端的查詢範圍一律走 `apps/api/src/lib/course_scope.ts`（`courseScopeOf(ctx)`）——
  授課教師、聯合報管理人員、校務管理看得到的範圍不同，**寫在 SQL 裡**，不要先查再檢查。

## 這台 Windows 機器上的坑

- Git Bash 的 heredoc 內容裡有**奇數個單引號**時整段會壞（`unexpected EOF while looking for matching`）。
  長一點的檔案改動，先把 Python／Node 腳本寫成檔案再執行。
- `LF will be replaced by CRLF` 的警告可以忽略。
- 這台沒有 gcloud／ADC：真的 OCR、GCS、Cloud Run job 在本機跑不了，要用模擬模式（見 `docs/ocr-job.md`）。
