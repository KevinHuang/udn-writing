# 規格：聯合報雲寫作教室 — 原型轉 full stack

原始想法在 `artifacts/thoughts.md`（保留不動）。這份給 Claude Code 逐階段執行。

---

## ⛔ 最高優先：不要碰 production 資料庫

`writing_classroom` 是 production，**有線上使用者正在使用**。

| 資料庫 | 用途 |
|---|---|
| `writing_classroom` | production —— **不要連、不要寫、不要跑 migration** |
| `writing_classroom_test` | 開發用（`DB_NAME`） |
| `writing_classroom_autotest` | 自動化測試用（`TEST_DB_NAME`，**會被清空**） |

`apps/api/src/dal/database.ts` 已加防護：`DB_NAME` 指向 production 而
`NODE_ENV` 不是 `production` 時，啟動即拋錯。**不要為了方便繞過它。**

`docs/migrations/001-prototype-gaps.sql` 先套用到 `writing_classroom_test` 驗證，
production 的套用是另一件事，要人決定與執行。

---

## 0. 執行方式

**一次只做一個階段。** 每階段有「做什麼／不做什麼／怎麼證明做完了」，
驗收全綠才進下一階段。

- **不要為了讓測試過而改測試。** 測試失敗代表程式有問題，先修程式。
- **不要順手重構。** 每階段的「不做什麼」是硬邊界；看到不順眼的程式碼記進
  `artifacts/findings.md`，不要當場改。
- **`apps/web/CLAUDE.md` 的每一條規則持續適用**（顏色 token、深色模式、陰影、對比度）。
- **`npm run lint` 的兩支自製稽核（`check-tokens` / `check-mockdata`）必須一直是綠的。**
- **測試跟著該階段一起寫**，不留到最後。

---

## 1. 現況

三份程式碼，不是一份：

| 目錄 | 是什麼 | 狀態 |
|---|---|---|
| `client-new/` | Vite + React 19 的 UI 原型 | 16,256 行。無後端，資料在 localStorage |
| `legacy-server/` | Koa + TypeScript 後端 | 5,218 行。**可運作且已部署 Cloud Run** |
| `legacy-server/public/` | 另一份已建置的舊前端 | 由後端 serve。`client-new` 是它的改版 |

**`legacy-server` 遠比「功能尚不完整」完整**：完整 DAL、OAuth、postgres session store、
DevAPI client credentials、727 行的 GenAI helper（已走 Vertex AI）、Dockerfile 與
gcloud 部署腳本。

所以這個專案**不是「從零建後端」，是「把既有後端補完，並換上新前端」。**

### 相關文件

| 文件 | 內容 |
|---|---|
|  | **只有人能做的事**（部署、輪替憑證、審核 migration） |
| `docs/schema.sql` | 既有生產庫的 pg_dump |
| `docs/auth.md` | 認證與授權的實際行為（從 legacy-server 查證） |
| `docs/migrations/001-prototype-gaps.sql` | 補齊原型功能的 migration，**待審核** |
| `docs/auth.ts.md`、`docs/devapi_helper.ts.md` | 1Campus 提供的範例 |

---

## 2. 已固定的技術決策（不要重新評估）

| 項目 | 決定 |
|---|---|
| 後端框架 | **Koa（沿用 legacy-server）**。thoughts.md 原本寫 Fastify，已推翻——見下 |
| 資料庫存取 | pg-promise + 手寫 SQL（沿用） |
| 前端 | Vite + React 19 + TypeScript + Tailwind v4，不升不換 |
| 前端路由 | `react-router-dom` |
| 登入 | 1Campus **OAuth 2.0 Authorization Code**（不是 OIDC，無 discovery/id_token） |
| 校務同步 | 同一組 client 憑證走 Client Credentials，讀 DevAPI |
| OAuth 函式庫 | **不用 `openid-client` 之類的 OIDC 套件**，直接 `fetch` |
| Session | postgres 的 `session` 表 + 既有的 `session_store.ts`，**不要重寫** |
| **部署形態** | **後端 serve 前端（同源）**。cookie 用 `SameSite=lax`，**CORS 整個拿掉** |
| AI | Vertex AI（`GOOGLE_GENAI_USE_VERTEXAI`），**不是 API 金鑰** |
| API 的 id 型別 | 字串（schema 全部是 `bigint`，超過 2^53 會失真） |
| 授權比對鍵 | `user.id`，不是姓名 |
| 多重身分 | **大頭貼下拉可切換身分**，畫面隨之切換。session 要存「目前身分」 |
| `isSchoolAdmin` | **UI 不使用，忽略**。`getIdentity()` 照樣回傳，前端過濾掉即可 |
| 學期與身分 | **身分不依學期篩選**：過去學期帶過班就永遠是教師（學生亦同） |
| 開發資料庫 | `writing_classroom_test`。**`writing_classroom` 是 production，不碰** |
| 測試資料庫 | 另開一個空的 `writing_classroom_autotest`（會被清空） |
| 參照完整性 | 應用層負責——全庫外鍵數量是 0 |

### 為什麼不改寫成 Fastify

重寫等於把 5,218 行**已經和一個沒有任何外鍵的 schema、以及一個非標準的
PHP OAuth provider 磨合過**的程式碼丟掉。Fastify 的好處（效能、schema 驗證）
換不到使用者看得到的差別，卻要重新驗證整個 1Campus 整合。

### 部署形態的改變

目前 production 是**分開的**：前端在 Firebase Hosting
（`https://writing-classroom-672f8.web.app`），後端在 Cloud Run，所以
cookie 必須用 `SameSite=none`。改成同源之後：

- `SameSite=lax`（比較安全，且不依賴第三方 cookie 政策）
- `src/index.ts` 的 CORS 整段移除
- `ALLOWED_ORIGINS` 這個死設定一併刪掉

---

## 3. 資料模型：schema 與原型的落差

**`docs/schema.sql` 是唯一真相**，原型的 `types.ts` 才是要被改的那一邊。

### 讀 schema 時必須知道的三件事

**① 完全沒有外鍵。** 全庫 `FOREIGN KEY` 數量是 0。刪除課程、清除繳交、換題的
連鎖清理要自己寫全。`CLAUDE.md` 有整整一節在講孤兒標記的坑，那個坑在資料庫
層級是敞開的。**每一條刪除路徑都要有測試。**

**② 所有 id 都是 `bigint`。** node-postgres／pg-promise 預設把 `int8` 以字串回傳
——**不要改掉這個行為**。API 的 JSON 一律用字串表示 id；前端 `types.ts` 的
`id: string` 剛好對得上。後端需要運算時轉 `BigInt`，不要轉 `Number`。

**③ `session` 表的欄位是固定的**（`session_id` / `expiry_date` bigint epoch 毫秒 /
`data` json）。`legacy-server/src/dal/session_store.ts` 已經解決過這個非標準形狀，
直接沿用。

### 表名對照

| 前端概念 | schema | 備註 |
|---|---|---|
| `Course` | `course` | 教師走 `uc_instructor`，名冊走 `uc_learner`（有 `seat_no`） |
| `Question` | `task` | `level` / `source` 是 jsonb 陣列 |
| 評分規準 | `system_instruction` | 經 `task.ref_instruction_id`，是獨立的表 |
| `Assignment` | `assignment` | |
| `Submission` | `submission` | 多了 `word_count`、`pic_files` |
| `GradingResult` | `submission_feedback` | `is_ai` / `is_valid` / `is_returned` |
| 代繳交 | `batch_proxy_submission` | 對應 `ProxySubmitModal` |
| 身分 | 見 `docs/auth.md` | **不讀 `user_role`**，從 `uc_*` 現算 |

### schema 有／原型沒有

| schema | 處置 |
|---|---|
| `final_report` 期末總結 | 後端已實作，前端沒有。本輪不做前端，記進 findings |
| `input_tokens` / `output_tokens` | 後端已在記帳。前端改接時不要弄丟 |
| `submission_feedback.is_ai` | AI 批改 `true`，教師修改另存 `false` |
| `submission_feedback.is_valid` | 重批讓舊紀錄失效，**不是覆蓋** |
| `semesters` 表 | 前端目前是寫死的 `SEMESTER_OPTIONS`，Phase 4 改讀這張表 |

### 原型有／schema 沒有 → 已有 migration 草案

`docs/migrations/001-prototype-gaps.sql`，**等待審核**。

| 原型功能 | migration 的處置 |
|---|---|
| 題庫資料夾樹 | 新表 `task_folder` + `task.ref_folder_id` |
| 作品標記（佳作／預選） | 新表 `submission_mark`，`UNIQUE(ref_submission_id, kind)` |
| 請假註記 | 新表 `assignment_leave`，`UNIQUE(ref_assignment_id, ref_user_id)` |
| 作業截止日 | `assignment.deadline`（可 NULL）+ `allow_late_submission` |
| 作業拖拉順序 | `assignment.sort_order` |

時間模型**以原型為準**（截止日 + 拖拉排序）。`assignment.week_no` 保留不動，
本系統不寫入也不讀取。

---

## 4. 階段

### Phase 1 — Monorepo 骨架 ✅ 已完成

**做什麼**

- 根目錄建立 npm workspaces（`apps/*`, `packages/*`）。
- `client-new/` → `apps/web/`（純搬移，含 `CLAUDE.md`、`.claude/launch.json`）。
- `legacy-server/` → `apps/api/`（純搬移）。
- `packages/shared/`：共用型別。**只搬型別，不搬 React 相關。**
- 環境變數收斂成根目錄一份 `.env`（樣板已在 `.env.example`），
  `apps/api/.env.development` 退場。
- 根 `package.json` 提供 `dev` / `build` / `lint` / `test`。
- 前端 dev server proxy `/service` 與 `/auth` → `http://localhost:3001`。
  （既有 API 的前綴就是這兩個，**不是 `/api`**。）

**不做什麼**

- 不改任何 component、`lib/`、DAL 或路由的**內容**，只改路徑與 import。
- 不碰資料來源，前端照樣跑 localStorage。
- 不依 schema 調整 `types.ts`（Phase 4 的事）。
- 不動 `tsconfig.json` 的 `strict`。

**怎麼證明做完了**

```bash
npm run build -w apps/web       # 通過
npm run lint  -w apps/web       # ESLint + check-tokens + check-mockdata 全綠
npx tsc --noEmit -w apps/web    # 通過
npx tsc --noEmit -w apps/api    # 通過
npm run dev   -w apps/web       # localhost:3000 畫面與搬移前完全相同
npm run dev   -w apps/api       # 起得來，OAuth 登入流程仍可完成
```

---

#### Phase 1 的實際結果

- `client-new/` → `apps/web/`（`@udn/web`）、`legacy-server/` → `apps/api/`（`@udn/api`）
- `packages/shared`（`@udn/shared`）收納 `types.ts`；`apps/web/types.ts` 改成再匯出，
  **所有元件的 import 一行都沒改**
- 環境變數收斂成根目錄一份 `.env`，`apps/api/.env` 與 `.env.development` 已刪除
- Vite proxy `/service` 與 `/auth` → `localhost:3001`（同源，不需要 CORS）
- 刪除兩份重複的 schema 副本

**搬移途中踩到、已解決的兩件事**（記在這裡，因為它們會再發生）：

1. **workspace 的單一 lock 檔會重新解析所有 `^` 範圍。** 第一次 `npm install`
   把 192 個套件升級了，包括 `recharts` 3.8→3.10、`tailwindcss` 4.2→4.3，
   web bundle 因此多了 45 kB。已把直接相依鎖回原本的版本
   （保留 `^` 語意，只是讓 lock 解析到舊版）。驗證方式是比對建置產物的雜湊：
   CSS 回到 `index-WhqqDHUr.css` 107.63 kB，與搬移前**逐位元組相同**。
   README 早就警告過「不要換套件管理器，會裝到不同版本的相依樹」——
   monorepo 化本身就會觸發同一件事。

2. **`@types/koa` 出現兩份，module augmentation 就失效。**
   `@types/koa-bodyparser` 在根目錄增補 `Request.body`，但 `koa` 解析到
   `apps/api/node_modules` 裡的另一份 `@types/koa`，於是 13 個
   `ctx.request.body` 全部報錯。把版本對齊成同一份即可。
   **以後在 monorepo 裡看到「型別增補突然不見了」，先數有幾份 @types。**

驗收結果：web / api / shared 三個 typecheck、web lint（含兩支自製稽核）、
兩邊的 build 全部通過；兩個 dev server 起得來，proxy 正常，
未登入打 `/auth/me` 與 `/service/admin/*` 都回 401。

---

### Phase 2 — 後端加固與測試基礎 ✅ 已完成

既有後端可以運作，但有一批安全問題與缺失。**這階段不加新功能。**

**做什麼**

依 `docs/auth.md`「安全問題」一節，按嚴重度處理：

| # | 項目 | 狀態 |
|---|---|---|
| 00 | `.env` 與 `.env.development` 兩份都指向 **production** 資料庫 | ✅ **已修**（改指 `writing_classroom_test`，並在 `database.ts` 加啟動防護） |
| 0 | `getIdentity()` 裡的學期篩選地雷 | ✅ **已拆**（刪掉未使用的 `current_semester` CTE 與註解掉的 JOIN，寫下理由） |
| 1 | `/service/admin/*` 完全沒有驗證 | ✅ **已修**（`requireLogin` + 六條加 `isSystemAdmin`） |
| 2 | GCP service account 私鑰在檔案系統 | ⬜ 已被 `.gitignore` 擋下，**金鑰仍需人工輪替** |
| 3 | session 簽章金鑰寫死在 `src/index.ts` | ✅ **已修**（改讀 `SESSION_KEY`，**沒設就拒絕啟動**，不給預設值） |
| 4 | admin 的寫入操作用 `GET` | ✅ **已修**（六條改 `POST`；舊前端不呼叫 `/admin/*`，不影響線上） |
| 5 | `state` cookie 用完沒清 | ✅ **已修**，且一併修掉一個繞過漏洞（見下） |
| 6 | 登出用 `GET` | ✅ 新增 `POST /auth/logout`；**`GET` 暫留**，因為部署中的舊前端在用 |
| 7 | 錯誤訊息原樣回前端 | ✅ **已修**（細節只進 server log） |
| 8 | `/admin/schools/:id/classes`、`/admin/instructors/:key/courses` 是 IDOR | ✅ **已修**（C 方案，見下） |
| 9 | SPA fallback 把 `/service/*` 的 404 變成 HTTP 200 的 HTML | ✅ **已修**（修補途中發現，見下） |
| 10 | OAuth `state` 驗證可被完全繞過 | ✅ **已修**（修補途中發現，見下） |
| 11 | 登入 callback 在沒有 `x-forwarded-for` 時 500 | ✅ **已修**（測試途中發現，見下） |
| 12 | `/service/user/my_identity` 永遠回傳 `{}` | ✅ **已修**（`routes/user.ts` 少了 `await`） |
| 13 | 第一次登入不會寫 `user.last_signin` | ✅ **已修**（測試途中發現，見下） |

#### 修補途中發現的兩個額外問題

**`state` 驗證可被繞過。** 原本的判斷是 `if (state !== savedState)`。
兩邊都是 `undefined` 時（請求不帶 `state` 參數、瀏覽器也沒有 cookie），
`undefined !== undefined` 是 `false` —— **驗證直接放行**，等於完全沒有 CSRF 防護。
現在改成必須 `savedState` 存在且 `state` 是字串才比較。

**SPA fallback 檢查錯了前綴。** 它對 `/api` 與 `/auth` 回 404 JSON，其餘一律回
`index.html`。但**實際的 API 前綴是 `/service`**，`/api` 底下從來沒掛過東西。
於是任何打錯或已移除的 `/service/*` 都會拿到 **HTTP 200 的 HTML** ——
呼叫端要到 `JSON.parse` 才炸，錯誤訊息完全指不到真正的原因。
Phase 4 前端接上時這會是個持續的陷阱，所以現在修掉。

#### 兩支唯讀查詢的授權：採 C 方案（拆成兩支）

問題不只是「誰可以查」，更是「回傳太多」：
`/admin/schools/:id/classes` 會把每門課的 `instructors` 與 `students` 一起掛上去，
**包含每個學生的 `account`（email）、`seat_no`、`source_class`** ——
一個請求等於一整間學校的名冊。而 `schoolId` 是連續的 bigint，可以直接從 1 數上去。
`/admin/instructors/:key/courses` 的比對是 `u.name = $1 or u.account = $1`，
**用姓名就查得到**，不需要任何 id。

做法：

| endpoint | 守衛 | 回傳 |
|---|---|---|
| `GET /service/admin/schools/:schoolId/classes` | `isSystemAdmin` | 完整名冊（含 email、座號） |
| `GET /service/admin/instructors/:key/courses` | `isSystemAdmin` | 依姓名／帳號查課程 |
| `GET /service/instructor/school-courses` | `isInstructor` | **沒有任何學生個資**，只有人數 |

教師端那支的兩個設計重點：

1. **不收 `:schoolId`。** 學校範圍由伺服器端從呼叫者的 `uc_instructor` 推導 ——
   沒有客戶端提供的 id，就沒有 IDOR 的空間。教師只看得到自己有掛課的學校。
2. **回傳欄位對齊畫面實際用到的。** `SyncSchoolModal` 只顯示
   `id / code / name / studentCount / teacherName` 五樣，所以就只給這些，
   外加伺服器端算好的 `is_mine`（前端 `canImportCourse()` 的等價判斷）。

⚠️ **`is_mine` 只是給畫面用的。** 真正的把關必須做在匯入那支 endpoint 上，
不能靠前端拿這個旗標決定。匯入流程本身屬於 Phase 4 —— 它需要學生**姓名**
（`App.tsx` 匯入時用 `sc.roster` 建名冊），那支要另外設計，並且只給
呼叫者有權匯入的那門課的名冊。

沒有選「依身分裁切同一支的回傳內容」，是因為那種 endpoint 之後很難維護：
每加一個欄位都要重新想一次誰看得到，漏一次就是外洩。拆開之後每支的
回傳形狀是固定的，授權寫在入口一次就好。

#### 測試途中發現的三個問題

寫測試的價值有一半在這裡 —— 這三個都是「平常看起來正常」的 bug：

**1. 登入 callback 會在沒有 `x-forwarded-for` 時 500。** 原本的寫法是：

```ts
let clientIP = ctx.request.ip;
if (ctx.request.ip !== "::1") {
  clientIP = ctx.headers!['x-forwarded-for']!.toString().split(',')[0];
}
```

只要來源不是 `::1` 又沒有那個標頭，就是在對 `undefined` 呼叫 `.toString()`，
**整個登入直接 500**。Cloud Run 前面的負載平衡器一定帶 XFF 所以沒被踩到，
但本機用 `127.0.0.1`（IPv4）而不是 `localhost`（IPv6）登入就會壞。
而且這段完全是多餘的 —— `app.proxy = true` 之下 `ctx.request.ip` 本來就會
取 XFF 的第一個值。現在直接用它。

**2. `/service/user/my_identity` 永遠回傳 `{}`。** `routes/user.ts` 少了一個
`await`，`ctx.body` 被指派成一個 Promise，Koa 序列化出來就是空物件。
TypeScript 抓不到，因為 `ctx.body` 是 `any`。

**3. 第一次登入不會寫 `last_signin`。** `UserHelper.add()` 的 `insert_user` CTE
只插入 `(account, name, auth_uuid)`，而同一句 SQL 裡的 `update_user` 是兄弟 CTE，
**看不到前者剛插入的資料列**（同一個快照）。所以新使用者的 `last_signin`
要到第二次登入才有值。

另外 `npm run build` 改成先 `rm -rf dist` —— tsc 不清理 outDir，
已經從原始碼刪掉的檔案會一直留在產物裡（實際遇到：舊的測試腳本刪了，
`dist/dal/instructor_helper.test.js` 還在）。

#### 測試基礎

```bash
npm test -w @udn/api      # 57 個測試
```

- **runner 是 Node 內建的 `node:test`**，加上 tsx。沒有新增任何測試相依。
- **打的是真的 app 與真的 postgres**，只有 1Campus 的 OAuth 換成本機假 IdP
  （`src/test/helpers.ts` 的 `startFakeIdp`）—— 那是唯一一個我們控制不了、
  也不該在測試裡連的外部系統。為此把 `config.ts` 的 OAuth endpoint 改成可用
  環境變數覆寫（預設值仍是正式的 1Campus 位址）。
- **`src/test/setup.ts` 是 `--import` 預載**，必須在任何東西 import `config.ts`
  之前執行（config 在模組載入當下就把環境變數讀進去了）。它做三件事：
  擋下 `TEST_DB_NAME` 沒設／等於 `DB_NAME`／指向 production，然後把 `DB_NAME`
  換成測試庫。
- **`--test-concurrency=1`**：各測試檔共用同一個資料庫與同一個假 IdP port，
  平行跑會互相清空對方的資料。
- `app.ts` 與 `index.ts` 拆開（前者建 app、後者 listen），測試才能把 app 掛在
  隨機 port，import 的當下不會佔用 3001。
- `resetDb()` 只 TRUNCATE **有權限**的表，且不加 `RESTART IDENTITY` ——
  `writing_mng` 對 `course_bk` 沒有權限，也不是序列的擁有者。

涵蓋的範圍：完整 OAuth 流程、session 存在 postgres 的證明（刪掉資料庫那一列
cookie 就失效）、state 的 CSRF 防護、四種身分的授權矩陣、三道啟動防護、
路由邊界，以及 `InstructorHelper` 的 DAL 行為（含「重批讓舊紀錄失效而不是
覆蓋」）。

其他：

- ⚠️ **同源部署的調整（`SameSite=lax`、移除 CORS）現在還不能做。**
  目前 production 前端在 Firebase Hosting（`writing-classroom-672f8.web.app`）、
  後端在 Cloud Run，是**跨網域**的，所以 `SameSite=none` 與 CORS 都還需要。
  這個改動必須與部署形態的改變**同時**進行，否則一上線登入就壞。
  本機開發已經透過 Vite proxy 走同源，不受影響。
- ✅ 已修正 `.env` 的 `KEY: value` 寫法（冒號）——那三個 Vertex AI 變數從未生效過。
- ✅ `UserHelper.add()` 已補上 `auth_uuid` 的寫入（用 `COALESCE` 只補空值，不覆蓋既有資料）。
  **改名同步刻意維持關閉**：放開它會讓 1Campus 的姓名覆蓋掉這邊手動修正過的名字，
  那是產品決定，不是 bug。
- 建立測試基礎：測試跑在 `TEST_DB_NAME`，每案例前重置。
  **第一件事是檢查 `TEST_DB_NAME !== DB_NAME`，相同就中止**，
  否則設錯會把開發資料清光。既有的 `instructor_helper.test.ts` 不是測試，
  是一支 console.log 腳本，要換成真的 runner。

**不做什麼**

- 不改任何 DAL 的 SQL。
- 不加新 endpoint。
- 不碰前端。

**怎麼證明做完了**

- 未登入打 `/service/admin/*` → 401；非 system admin → 403。
- 重啟 API process 後 session 仍有效（證明真的在 postgres）。
- 登入 → `/auth/me` 回正確身分 → 登出 → 401。
- `grep -rn "app.keys = \['@" apps/api/src/` 沒有結果。
- `TEST_DB_NAME` 設成與 `DB_NAME` 相同時，測試啟動即失敗。

---

### Phase 3 — 前端路由 ✅ 已完成

**做什麼**

- 導入 `react-router-dom`。
- **`ViewState` enum 與 `lib/navigation.ts` 的 `HistoryItem` 手刻上一頁堆疊整個退場**，
  改由 router 管。兩套導覽並存是最糟的結果。
- 未知路徑 → 404；角色不符的路徑擋下。

| 路徑 | 原 ViewState |
|---|---|
| `/` | `DASHBOARD` |
| `/courses` | `COURSES` |
| `/courses/:courseId` | `COURSE_DETAILS` |
| `/courses/:courseId/assignments/new` | `ASSIGNMENTS`（派發精靈，從課程頁進） |
| `/questions` | `QUESTION_BANK` |
| `/grading` | `GRADING_LIST` |
| `/grading/:assignmentId/:submissionId` | `GRADING_EDITOR` |
| `/grades` | `GRADES_STATS` |
| `/concern` | `CONCERN_LIST` |
| `/student` | `STUDENT_DASHBOARD` |
| `/student/assignments` | `STUDENT_ASSIGNMENTS` |
| `/student/assignments/:assignmentId` | `STUDENT_EDITOR` |
| `/student/grades` | `STUDENT_GRADES` |

篩選條件（學期、`hideOverdueAssignments`）放 query string，讓網址能完整還原畫面。

**不做什麼**

- 不接 API。資料仍走 localStorage——**路由改動與資料改動分開驗收**。

**怎麼證明做完了**

- 每條路由直接輸入網址都能開，重新整理停在原畫面。
- 上一頁／下一頁正確，尤其批改頁 → 清單。
- `grep -r "ViewState" apps/web/` 沒有殘留。

---

#### Phase 3 的實際結果

`App.tsx` 從 2268 行降到 88 行 —— 它現在只是路由樹。原本的內容拆成：

| 位置 | 內容 |
|---|---|
| `lib/routes.ts` | **全站網址的唯一來源**，取代 `ViewState` enum |
| `lib/useGoBack.ts` | 「上一頁」與「能不能上一頁」的唯一判斷 |
| `state/AppState.tsx` | 全站資料與操作（**Phase 4 要換成 API 的那道接縫**） |
| `state/appStateContext.ts` | context 與 hook（與 provider 分檔，Fast Refresh 才正常） |
| `layouts/TeacherLayout.tsx` | 教師端版面：導覽列、全域視窗、`<Outlet />` |
| `components/StudentPortal.tsx` | 學生端版面（原本它同時是版面**與**畫面切換器） |
| `pages/*.tsx`、`pages/student/*.tsx` | 13 個頁面 |

`ViewState` enum 與 `lib/navigation.ts` 的 `HistoryItem` 已刪除。

**三個「網址的複本」狀態一併退場**：`selectedCourse`、`selectedAssignmentId`、
`selectedSubmission` 現在都從網址現查。這順帶修掉一個既有的 bug ——
`selectedSubmission` 是一份快照，不會跟著 `submissions` 走，所以
`handleSaveGrading` 得額外寫一段把快照同步回去，否則存檔後畫面上的狀態
還停在「待批改」。現查之後那段同步連同問題一起消失。

同樣地，批改清單裡那段「手動 push 一筆 viewHistory，讓返回落在作業牆而不是
某一份作業」的 hack 也不需要了 —— 作業牆是 `/grading`，選定某份是
`/grading?assignment=…`，返回鍵自然會退回作業牆。

**踩到、已解決的三件事**（都記在這裡，因為都不是編譯期看得到的）：

1. **monorepo 裡出現兩份 React。** 裝 `react-router-dom` 時 npm 把 `react-dom`
   重新解析到 19.3.0 並提升到根，`react` 卻留在 `apps/web` 的 19.2.4 ——
   而 `react-dom@19.3.0` 的 peer 要求是 `react@^19.3.0`。症狀是
   「Invalid hook call」，而且**不是編譯期錯誤，是打開畫面才炸**。
   解法：`react` / `react-dom` 改成精確版本（不用 `^`）、`npm dedupe`、
   並在 `vite.config.ts` 加 `resolve.dedupe`。
2. **`npm dedupe` 把 TypeScript 7.0.2 提升到根。** 沒有任何 workspace 宣告過
   7.x（web 是 `~5.9.3`、api 是 `^6.0.2`），而 eslint 從根解析
   `ts-api-utils`，它讀不懂 TS 7 的內部結構就整個掛掉。
   解法：根目錄明確宣告 `typescript`，各 workspace 仍用自己巢狀的版本。
3. **`GradeManagement` 會呼叫 `getComputedStyle`**，所以路由測試的瀏覽器 shim
   要補它。不是 bug，是這個前端本來就只跑在瀏覽器裡。

#### 路由冒煙測試

```bash
npm test -w @udn/web      # 11 個
```

只問一件事：**每一條路由都渲染得出來、而且渲染出對的東西。**
typecheck 與 lint 抓不到「這一頁一打開就丟例外」——拆 `App.tsx` 的過程中，
少傳一個 prop、少一個 null 檢查，症狀都是這個。

用的是 `App.tsx` export 出來的 `AppRoutes`，**不是另外抄一份路由表**——
抄一份的話它就會跟真的那份漂移，而漂移了測試還是綠的。

⚠️ **這不是瀏覽器測試。** 它用 `renderToString` 在 Node 裡跑，證明的是
「渲染不會丟例外、內容對得上」，不涵蓋點擊、捲動、CSS 與實際的返回鍵行為。
那些仍然要人開瀏覽器看。

---

### Phase 4 — 前端接上 API ✅ 已完成

**前置**：`artifacts/api-gap.md` 的四個決定。

`docs/migrations/001-prototype-gaps.sql` **只擋住第 8～10 號資源**
（題庫資料夾、截止日與排序、作品標記與請假註記）。1～7 號不受影響。

**第一件事是產出 API 落差清單** ✅ 已完成 → `artifacts/api-gap.md`

那份文件的重點：落差有三層，**只有一層是「缺 endpoint」**，
另外兩層（回傳形狀、語意定義）更花工卻容易在估算時被漏掉。
另外它發現 **1～7 號資源完全不需要等 migration**，可以立刻開工 ——
做完那七項，主要流程就能整條跑在真資料上。

四個決定已定案（見該文件「決定結果」）：轉換寫在**前端的 api client**、
「清除繳交」要新增 endpoint、期末總結另列 Phase 6。

然後逐資源進行，一個做完（後端 + 測試 + 前端接上）才做下一個：

1. ✅ **身分與可視範圍** —— 已完成，見下
2. `course` + `uc_instructor` + `uc_learner`（含 DevAPI 同步）
3. `task` + `task_folder` + `system_instruction`
4. `assignment`（含新增的 deadline / sort_order）
5. `submission` + `batch_proxy_submission`
6. `submission_feedback` + `submission_mark` + `assignment_leave`

每個資源：

- **授權在伺服器端過濾。** `lib/access.ts` 自己註明「這是原型的展示用權限，
  不是真的存取控制」——後端要重新實作，用 `user.id` 比對。
- 前端改打 API，該資源的 `usePersistentState` 呼叫移除。

全部完成後，`usePersistentState.ts`、`SCHEMA_VERSION`、`mockData.ts` 一併退場。

#### 資源 3：課程與名冊（大致完成）

新增 **`GET /service/courses`** —— 可視範圍收在伺服器端一處：
管理者拿到全部、教師只拿到掛在自己名下的，而且**依「目前選的身分」**
而不是「擁有的身分」（否則身分切換等於沒有意義）。

前端的 `myCourses` 因此變成 `courses` 本身。先前那一層 `visibleCourses()`
不但多餘，而且危險 —— 它是用**姓名**比對的，姓名對不上就會把整份清單
濾成空的，而畫面上看起來只是「你沒有課」。

名冊改成依課程**延遲載入**（`ensureRoster()`）。一位教師可能有四十幾個班，
開一個畫面打四十幾個請求只為了其中一個班的名冊，不划算。

**接真實資料查出來的三件事：**

1. **原型對課程名稱的假設是錯的。** 原型以為是「新北市淡江中學國三孝班」
   這種黏成一串的字串，所以有 `parseCourseName()` 與「待確認」流程。
   真實資料裡校名（`school.school_name`）、班級（`course.course_name`）、
   學段（`school.school_type`）**本來就是三個欄位**，只有縣市要從校名前綴取。
   `lib/schoolName.ts` 因此只需要新增的那支 `cityOf()`，其餘那一整套
   等校務同步也接上真實資料就能整個刪掉。

2. **`ref_org_id` 為空的課程會從清單裡安靜消失** —— `getByInstructorUserId()`
   是 `INNER JOIN org`。正式資料目前 45 門課全部有組織，但這是個沒有任何
   徵兆的失效模式，測試的 fixture 因此一定要建組織。

3. ⛔ **校務同步兩邊的產品模型不一樣**，刻意維持原狀沒有半接。見開放問題。

#### 資源 6 + 7 + 10 + 11：繳交與批改（已完成）

**`usePersistentState` 的業務資料全部退場** —— 前端不再有任何領域資料
留在 localStorage。

**批改結果的模型改成「版本」**（產品確認）：一份繳交任何時刻只有一筆
`is_valid = true`，`is_ai` 標示那一版是 AI 產的還是教師改的。
教師修改 = 舊的全部失效 + 寫一筆 `is_ai = false` 的新版本。

型別跟著改：`GradingResult` 的 `aiFeedback` / `teacherFeedback` /
`suggestions` 三個欄位換成 `feedback` + `isAi`。漣漪到 7 個檔案、30 個
編譯錯誤。畫面上兩個評語輸入框合併成一個，學生端三個區塊合併成一個。

**繳交分兩層載入**（實測出來的決定）：

| | 內容 | 大小 |
|---|---|---|
| 全域摘要 `GET /service/instructor/submissions` | 所有班級，**不含作文全文** | 最忙的教師 2,091 筆，約 300 KB |
| 單份作業 `GET /assignments/:id/submissions` | 含作文與評語 | 批改頁進來時才補 |

不分層的話開一次畫面要拉 **2.8 MB** 的作文內容。`ensureSubmissions()`
在批改清單選定作業、以及批改頁直接開網址時補齊。

**又修掉一組授權漏洞**，這次是批改相關的三支：

| | 先前 |
|---|---|
| `saveFeedback` | 任何教師能批改任何一份作品 |
| `resetBySubmissionId` | 任何教師能重置任何一份批改 |
| **`returnFeedback`** | **任何教師能把別班的成績發還給學生**（收一個 id 陣列直接 UPDATE，副作用不可逆） |

其中一條測試特別重要：**批改失敗時不會把別人既有的批改設成失效**。
`saveFeedback` 的第一個動作是「把舊的全部設為失效」，授權檢查若放在
那之後，即使最後回 403，別人的批改也已經被作廢了。

**markdown 渲染**：後端存的是 markdown，前端原本用純文字印，會看到滿螢幕
的 `###`。加了 `react-markdown`（不走 `dangerouslySetInnerHTML` ——
那段內容是 AI 產的、又夾帶學生作文，等於使用者輸入）與
`@tailwindcss/typography`。樣式用 `.prose-ink` 把 typography 的變數接到
專案的色彩 token 上，碑拓模式自動跟著翻轉，不需要 `dark:prose-invert`。

⚠️ **Word 匯出目前照原樣輸出 markdown**，文件裡看得到 `###` 與 `-`。
要漂亮得把 markdown 轉成 docx 的段落與清單，另案處理。

#### 資源 5 + 9：作業、截止日與拖拉排序（已完成）

**先修了一個和 admin 同一類的授權漏洞。** `AssignmentHelper` 有四支查詢
**收了 `user_id` 卻沒有放進 WHERE**：

| 方法 | 先前的行為 |
|---|---|
| `getAssignmentsByCourseId` | 任何教師讀得到任何班的作業 |
| `updateStatus` | 任何教師能開關別人班的作業 |
| `updateTask` | 任何教師能換掉別人班作業的題目 |
| `create` | 可以把作業**派進別人的班** |

`updateStatus` 的錯誤訊息甚至寫著 `not found or unauthorized`，
但 SQL 裡沒有任何 authorization。四支都補上授權條件，並且有測試蓋著。

**第二個 bug：`opened_at` 在關閉時也被覆蓋成 `NOW()`。**
前端的三態靠 `opened` + `opened_at` 分辨：

| `opened` | `opened_at` | 狀態 |
|---|---|---|
| `true` | 任何 | `Published` |
| `false` | `null` | `Draft`（從未開放，學生看不到） |
| `false` | 有值 | `Closed`（開過又收回，學生看得到成績） |

關閉時把 `opened_at` 蓋成現在，等於宣告「它剛剛才第一次開放」——
**Draft 與 Closed 從此分不出來**。改用 `COALESCE(opened_at, NOW())`
只在開啟時寫、而且只寫第一次。

**推導規則放進 `packages/shared/derive.ts`**（`assignmentStatusOf()`）——
前端要它畫面、後端要它判斷可否繳交，兩邊各寫一次遲早漂移。
這也是規格要求 `SubmissionStatus` 推導要做的事，先從作業開始。

**新增的 endpoint**：截止日設定、重新排序、刪除。

刪除作業會**連鎖清掉底下的繳交、批改結果、作品標記、請假註記**。
資料庫幾乎沒有外鍵，只有 migration 001 為 `submission_mark → submission`
與 `assignment_leave → assignment` 加了兩條 —— 所以
`submission_feedback` 與 `submission` 必須手動刪，順序由下往上，
全部在一個交易裡。逐張表都有測試確認清乾淨。

前端的 `handleAssignmentOperation` 介面維持不變（建立／更新／刪除三份清單），
但內部改成**比對差異再發對應的 API**。後端沒有「整包覆蓋」的 endpoint，
而且也不該有 —— 開關、改截止日、換順序是三件不同的事，
各自有各自的授權與副作用。全部送一遍會把「老師只是拖了一下順序」
變成「順便重設了截止日」。

#### 資源 4 + 8：題目與題庫資料夾（已完成）

migration 002 套用後補完。後端新增 `PUT /tasks/:id/archived` 與資料夾的四條路由；
前端 `QuestionBank` 的 **9 個改動點**從「直接改陣列」換成明確的操作
（`questionOps` / `folderOps`），每一個都是「呼叫 API → 重新載入」。

**不做樂觀更新**是刻意的：樂觀更新要維護一份與伺服器平行的真相，
而這個專案已經在「同一份資訊存兩處」上吃過四次虧（見 `CLAUDE.md`）。
題庫的操作不頻繁，多一次往返換掉一整類不同步的 bug。

**兩件接的時候才發現的事：**

1. **題目與資料夾必須一起接。** 資料夾留在 mockData 而題目來自 API 的話，
   題目的 `folderId` 會指向不存在的資料夾 id，整個題庫畫面散掉。

2. ⚠️ **我自己造成過一次行為不一致。** migration 001 給
   `fk_task_folder_parent` 加了 `ON DELETE CASCADE`，但原型刪資料夾時
   **子資料夾是移到上一層、不跟著刪**（確認視窗明寫「不會被刪除」）。
   照 CASCADE 做會把整棵子樹帶走。
   後端因此在同一個交易裡**先改掛再刪** —— 順序錯了就會誤傷。
   這條規則外鍵表達不了（CASCADE 刪掉、SET NULL 退到根而不是上一層），
   所以寫在 `FolderHelper.deleteById`，並且有測試蓋著。

#### 資源 4：題目（原本卡住的記錄）

`api/questions.ts` 的**讀取路徑**寫好了（含 `level`／`source` 兩個 jsonb
陣列與前端代碼的對照），但**寫入路徑刻意沒有接到畫面上**。

`task` 表少了五個原型在用的欄位：`isArchived`（24 處）、`gradeLevel`
（寫作類型，11 處）、`maxScore`（6 處）、`preferredAiModel`（20 處，
但被 `SHOW_AI_MODEL_PICKER` 關著）、`aiImageDescription`（3 處）。

現在接上去的後果是：老師編輯題目按下儲存，這五樣**安靜地消失**，
畫面上沒有任何異狀，要等重新載入才發現封存跑掉、寫作類型變空白。
**那比還沒接更糟**，所以停在這裡等決定（migration 002 或砍功能）。

另外 `task.ref_instruction_id` 指向的是一張**共用的** `system_instruction` 表
（48 個題目共用 2 筆），與原型「每題自己一段評分規準」不是同一個東西，
所以沒有對應過去。

#### 資源 2：學期清單（已完成）

`GET /service/semesters` 回傳學年期清單與「今天落在哪一個」。
前端的 `currentSemester` 與三個學期下拉不再吃 `mockData` 的寫死清單。

`semesterLabel()` 從「查表」改成「用算的」—— 先前是去 `SEMESTER_OPTIONS`
找，查不到就原樣回傳，所以資料庫裡有、但選項清單裡沒有的學年期
（既有課程用到的 `110-2`、`113-1`）會直接印出代碼給使用者看。

**兩個從真實資料查出來的問題：**

1. ⚠️ **原型的四學期制在資料庫裡不存在。** 原型的學期有
   第1學期／寒假(`W`)／第2學期／暑假(`S`) 四種，但 `semesters` 表只有 1 與 2，
   而 `course.semester` 是 **integer**，根本裝不下 `W` 與 `S`。
   原型那兩個選項**永遠對不到任何課程**。若產品真的要開寒暑假班，
   那是 schema 的異動。→ 開放問題。

2. ⚠️ **`semesters` 表有一筆資料錯誤**：118 學年度有**兩列 `118-2`**、
   沒有 `118-1` —— 其中一列的日期區間（2029-09 ~ 2030-02）其實是第一學期。
   今天（115-1）解析正確，不影響現況，但 2029 年 9 月之後
   「目前學期」會算成 `118-2`。→ 資料要修，見 `artifacts/action-items.md`。

   `SemesterHelper.current()` 因此加了 `ORDER BY start_date DESC LIMIT 1` ——
   區間不重疊時本來就只會對到一列，但沒有 LIMIT 的查詢在資料再出錯時
   會安靜地回傳多列，呼叫端拿 `[0]` 就變成看執行計畫決定結果。

---

#### 資源 1 的實際結果：身分與可視範圍

**後端**（`apps/api`）

- `src/lib/identity.ts` —— 身分的種類、這個人有哪些、預設落在哪個、下拉要顯示什麼
- session 存 `activeIdentity`，登入時依優先序給預設值
- `POST /auth/identity` 切換身分，**會驗這個人是不是真的擁有它**
  （不驗的話這支就是提權的入口）
- `GET /auth/me` 多帶 `identities`（含每種身分橫跨哪些學校）與 `activeIdentity`
- 守衛改成同時檢查「**有**這個身分」與「**目前選的**是它」——
  只檢查前者，前端的切換就只是畫面效果；只檢查後者，等於讓前端決定自己的權限

⚠️ **`explicit === false` 時守衛放寬成只檢查「有沒有」。** 目前線上的舊前端
（`apps/api/public/`）沒有身分切換 UI，不會呼叫 `/auth/identity`，
嚴格檢查會直接把它擋死。**舊前端退場後把這個放寬拿掉**（開放問題 4），
屆時 `identity.test.ts` 最後那組測試要跟著改。

**前端**（`apps/web`）

- `api/client.ts` —— 所有後端呼叫的共同底層。credentials、錯誤處理、JSON 解析
  各寫一次就會有一處忘記帶 cookie，所以收在這裡
- `api/auth.ts` —— `fetchSession()` / `switchIdentity()`，以及**後端身分 → 前端角色**
  的對應（`school_admin` 刻意沒有對應，UI 不使用它）
- `state/AppState.tsx` 的 `userRole` 不再是 state，而是**從後端的 `activeIdentity` 推導**
- 大頭貼下拉只列這個人**真的擁有**的身分（先前是寫死的三個選項），
  只有一種時整段不顯示 —— 沒得選的選單只是雜訊
- 新增登入閘門：確認登入狀態前不 render 畫面（否則學生會看到一閃而過的教師介面）；
  未登入時給 `LoginPage`，**刻意不自動導向** 1Campus ——
  自動跳轉會讓「後端沒起來」與「session 過期」看起來一模一樣

⚠️ **開發流程改變了**：前端現在需要真的登入才看得到東西。
`npm run dev` 之後先點登入按鈕走完 1Campus 流程。

**不做什麼**

- 不改 `lib/` 裡的純邏輯（`scoring.ts`、`assignments.ts`、`assignmentOrder.ts`、
  `submissionMarks.ts`）。前後端都要用時搬到 `packages/shared/`，**搬移不改寫**。
- 不改畫面。這階段結束時 UI 行為應與 Phase 3 結束時一致。

**怎麼證明做完了**

- 教師 A 打教師 B 的課程 → **403**（不是 404 也不是空陣列）。
- 學生打別人的繳交紀錄 → 403。
- 重新批改 → 舊 `submission_feedback` 變 `is_valid=false`，不是被覆蓋。
- **刪除連鎖測試**（因為沒有外鍵）：刪課程 → assignment / submission / feedback /
  uc_learner / uc_instructor / submission_mark / assignment_leave 全部清乾淨。
- 前端沒有 localStorage 的業務資料（主題偏好可以留）。
- 完整流程跑通：派作業 → 學生繳交 → 老師批改 → 發還 → 學生看到成績。

---

### Phase 5 — 移除前端的 Gemini 呼叫 ✅ 已完成

**後端已經有完整的 GenAI 實作**（`genai_helper.ts`，走 Vertex AI，金鑰不在前端）。
所以這階段不是「把呼叫搬到後端」，是**把前端那份刪掉**。

**實際做了什麼**

| 項目 | 結果 |
|---|---|
| `apps/web/services/geminiService.ts`（265 行） | **刪除**。四支函式改成 `apps/web/api/ai.ts`，打後端端點，簽名不變 |
| `apps/web/services/simulatedGrading.ts`（136 行） | **搬到** `apps/api/src/dal/simulated_grading.ts` |
| `apps/web/lib/feedbackMarkdown.ts` | **刪除**。合併建議這件事改在後端做（見下） |
| `vite.config.ts` 的 `define` | **拿掉**，連同不再需要的 `loadEnv` |
| `apps/web` 的 `@google/genai` 相依 | **移除** |
| `apps/web/.env.example` | **刪除** —— 前端不再需要任何環境變數 |

**後端新增的四支端點**（全部 `requireLogin`，都在 `/service/gemini`）

| 端點 | 取代前端的 | 用在 |
|---|---|---|
| `POST /ocr_text` | `extractTextFromImage` | 學生作答頁、代繳交視窗 |
| `POST /analyze_image` | `analyzeImageContent` | 題庫的看圖出題 |
| `POST /rubric` | `generateGradingRubric` | 題庫產生評分規準 |
| `POST /grade` | `gradeEssayWithAI` | 題庫的**試批改**（不寫資料庫） |

提示詞原樣搬進 `GenAIHelper` 的 `describeImage` / `createRubric` / `gradeAdhoc`，
行為不變。三個參數檢查：mimeType 必須是圖片、base64 上限 11 MB、缺參數回 400。

**批改頁的「AI 批改」改走既有端點**

GradingEditor 原本呼叫前端的 `gradeEssayWithAI`，拿回結果放進本地 state 等老師按儲存。
現在改成 `onAutoGrade` → `POST /service/instructor/grading/:submissionId`
—— 與批次批改同一支，**批完直接存成一筆 `is_ai = true` 的版本**，
token 用量也記得到（批次批改本來就是這樣，單篇以前是例外）。

**順手修掉一個授權漏洞**

`POST /service/instructor/grading/:submissionId` 原本用不限定班級的
`getSubmissionById` 取作文 → 送去 AI → 才在 `saveFeedback` 裡擋權限，
**而且擋下來的回傳值（null）被忽略，照樣回 200**。結果是任何教師都能拿任意
submission id 換到別班學生的作文批改結果，順便燒掉 Vertex AI 的 token。
寫入是安全的，讀取不是。改成新增的 `getSubmissionByIdForInstructor`，
**先把關，再花錢**。

**測試環境不打真的 AI**

根目錄 `.env` 為了開發方便設了 `GOOGLE_GENAI_USE_VERTEXAI=true`，
`test/setup.ts` 現在會把它刪掉 —— 測試改走決定性的模擬批改。
這同時也就驗到了「沒有憑證時仍要能跑完流程」這條規格。

**一個容易漏掉的細節**

真實 AI 回傳的 `response` 本來就是一整份 markdown 報告，建議寫在裡面；
模擬批改的建議卻是獨立陣列。前端的 `toFeedbackMarkdown()` 以前負責合併，
它一刪，那三則建議就會安靜地不見。合併改在後端做，並有測試釘住
（`### 修改建議` 標題與三行項目）。

**怎麼證明做完了**

```bash
npm run build -w apps/web
grep -ril "GEMINI_API_KEY|AIza|@google/genai" apps/web/dist/ apps/web/package.json
# 沒有任何結果 ✅
```

- 未設 Vertex AI 憑證時，批改仍可完成且評語標明「示範模式」✅（測試涵蓋）
- 未登入打 AI endpoint → 401 ✅（測試涵蓋）
- 同一篇重批兩次拿到同一個分數 ✅（決定性，測試涵蓋）

---

### Phase 6 — 期末總結的前端畫面 ✅ 已完成

`final_report` 的後端本來就完整（`FinalReportHelper`，含 AI 產生的四項分數與總評，
測試庫裡有 888 筆真實資料），但前端**完全沒有這個畫面** —— 是一組沒有入口的功能。

**兩個產品決定**（2026-09-17 確認）

1. **教師可以為自己的班級產生總結。** 原本只有 `POST /admin/gen_final_report`
   （`isSystemAdmin`），教師只能讀 —— 打開一個還沒產生的班就沒轍。
   新增一支只跑自己任教班級的端點。
2. **這次只做教師端。** 總結的文字雖然是寫給學生看的，但後端沒有任何學生端
   的 final_report 端點，要不要開放、開放到什麼程度留給之後決定。

**新增與修改**

| 檔案 | 內容 |
|---|---|
| `GET /service/instructor/courses/:id/finalReports` | **補上把關**（見下），並 join 出姓名與座號、照座號排序 |
| `POST /service/instructor/courses/:id/finalReports` | 新增。為自己的班產生總結，回 `{generated, skipped}` |
| `FinalReportHelper.calculate()` | 改成回傳筆數；沒有 AI 憑證時走模擬摘要 |
| `simulated_grading.ts` | 新增 `simulateFinalSummary()` |
| `packages/shared/types.ts` | 新增 `FinalReport` |
| `apps/web/api/finalReports.ts` | 新增。八個平鋪的資料庫欄位 → `dimensions` 陣列 |
| `components/FinalReportList.tsx`、`pages/FinalReportPage.tsx` | 新增畫面 |
| `lib/routes.ts` | 新增 `/courses/:courseId/final-report` |
| `components/GradeManagement.tsx` | 加入口（描邊按鈕，不跟「匯出 EXCEL」搶主色） |

**又一個同型的授權漏洞**

`GET /courses/:course_id/finalReports` 取了 `userId` **卻沒有往下傳** ——
`getFinalReport` 只用 course_id 查。任何教師拿任意 course_id 就讀得到別班
整份總結：姓名、各科分數、AI 評語。這與資源 7 那三支、以及 Phase 5 的
AI 批改是同一個模式（**取了 userId 但 WHERE 沒有用到它**）。
把關改在 SQL 裡，不是自己的班回空陣列。

修 helper 的簽名之後，`tsc` 直接把呼叫端的漏洞指出來了 —— 這正是把授權
做進 DAL 參數而不是路由裡 if 的好處。

**刻意沒做的事**

`updateHightestScoreTilte()` 是**全域**回填（掃所有課程的 final_report），
不該由單一教師的動作觸發，所以新端點不呼叫它。
`calculate()` 本來就會一併寫入最高分作品的標題。

**怎麼證明做完了**

- 沒有 Vertex AI 憑證也能產生，總評標明「示範模式」、token 記 0 ✅
- 沒有已批改作品的學生被略過而不是報錯 ✅
- 重複按不會重算、不會產生第二筆 ✅
- 別人的班：產生 → 404 且沒寫入；讀取 → 空陣列 ✅
- 未登入 → 401 ✅
- 姓名與座號帶得出來且照座號排序 ✅

（`apps/api/src/test/final_report.test.ts`，8 個測試）

---

## 5. 開放問題

1. ⛔ **校務同步的產品模型。** 原型是「教師挑班級匯入」，後端是「管理者跑
   `sync/school`，課程／授課關聯／學生名冊一次全建好」。後端沒有「把這個班
   加進我的名下」這種動作 —— 要做的話等於讓教師自己建立 `uc_instructor`
   關聯，那是權限問題。**這是資源 3 唯一沒接的一塊**，見 `artifacts/api-gap.md`。

2. **原型的四學期制在資料庫裡不存在。** 原型有寒假(`W`)與暑假(`S`)，
   但 `semesters` 只有 1 與 2，而 `course.semester` 是 integer 裝不下。
   原型那兩個選項永遠對不到課程。要開寒暑假班是 schema 異動。

3. **`user_role` 表由誰維護？** 登入流程不寫它，但 schema 有，
   且 `updateSchoolSystemID()` 會更新它。是別的流程在寫嗎？

4. **`apps/api/public/` 的舊前端何時退場？** 換成 `apps/web` 的建置產物之後，
   舊的那份就該刪掉，否則兩份前端會漂移。屆時這三樣一起拿掉：
   - `GET /auth/logout` 的相容路徑（正式的是 POST）
   - 守衛在 `explicit === false` 時放寬身分檢查的那一段
   - CORS 設定（改成後端 serve 前端的同源部署）

5. **Word 匯出目前照原樣輸出 markdown**，文件裡看得到 `###` 與 `-`。
   要漂亮得把 markdown 轉成 docx 的段落與清單。

<details><summary>已解決（保留紀錄）</summary>

- ~~新表要不要加外鍵~~ → 加了 `ON DELETE CASCADE`，migration 001 已套用
- ~~學生草稿要做嗎~~ → 做了，`submission.is_submitted`
- ~~`App.tsx` 要不要按路由拆~~ → 拆了，2268 行降到 87 行（Phase 3）
- ~~`teacherFeedback` 要不要獨立欄位~~ → 不要，用 `is_ai` 標示版本作者
- ~~`suggestions` 怎麼辦~~ → 留在 markdown 裡，前端改用 markdown 渲染
</details>
