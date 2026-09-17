# 聯合報雲寫作教室（轉換版）

AI 作文批改輔助系統的**展示原型**。教師端可管理課程、題庫、作業與批改，
學生端可作答、繳交與查看批改結果；另有聯合報管理人員與校務管理兩種身分。

技術：Vite 7 + React 19 + TypeScript + Tailwind CSS 4 + Gemini API。

> **這是原型，不是產品。** 沒有後端、沒有帳號驗證，所有資料存在瀏覽器的
> localStorage 裡。它的用途是把完整的操作流程展示出來、讓需求對得起來，
> 不是拿來直接上線的程式碼。下面「正式開發前必須處理的事」有清單。

---

## 執行

**這個專案已經是 npm workspaces monorepo**，指令請在 **repo 根目錄**下：

```bash
npm install              # 一次裝好所有 workspace
npm run dev              # 同時起前端(3000)與後端(3001)
npm run dev:web          # 只起前端
npm run dev:api          # 只起後端
npm test -w @udn/api     # 後端的 57 個整合測試
```

後端測試跑在 `TEST_DB_NAME` 指定的**空資料庫**上（每個案例前清空），
不是 `DB_NAME`。設錯會在啟動時被擋下。

目錄對照：

| 路徑 | 是什麼 |
|---|---|
| `apps/web` | 這份前端（原 `client-new/`） |
| `apps/api` | Koa 後端（原 `legacy-server/`） |
| `packages/shared` | 前後端共用型別（`types.ts` 的實際定義在這裡） |

環境變數只有**根目錄一份 `.env`**，樣板見 `.env.example`。

⛔ `writing_classroom` 是 production 資料庫，開發請用 `writing_classroom_test`。
`apps/api/src/dal/database.ts` 有啟動防護會擋下誤連。

Node 建議 20 以上。`package-lock.json` 有進版控，請用 `npm install`
（或 `npm ci`）安裝，不要換成別的套件管理器，會裝到不同版本的相依樹。

### AI 功能：前端**不需要**任何金鑰

AI 呼叫全部在後端（`apps/api`，走 Vertex AI）。前端只打自己的 API，
對應在 `api/ai.ts`：

| 函式 | 端點 |
|---|---|
| `extractTextFromImage` | `POST /service/gemini/ocr_text` |
| `analyzeImageContent` | `POST /service/gemini/analyze_image` |
| `generateGradingRubric` | `POST /service/gemini/rubric` |
| `gradeEssayWithAI`（題庫試批改） | `POST /service/gemini/grade` |

批改頁與批次批改走的是另一支 `POST /service/instructor/grading/:submissionId`
—— 那支會把結果存成版本並記錄 token 用量。

**沒有設定 Vertex AI 憑證也能跑完整個流程。** 沒設定時**後端**會走
`apps/api/src/dal/simulated_grading.ts` 的模擬批改 —— 分數由作文內容的雜湊決定
（同一篇永遠得到同一個結果，不是亂數），評語開頭會標明「示範模式」。
憑證設定在 repo 根目錄的 `.env`（`GOOGLE_GENAI_USE_VERTEXAI`、`GOOGLE_CLOUD_PROJECT`）。

> 這裡曾經有一把 `GEMINI_API_KEY`，透過 Vite 的 `define` 直接替換進前端 bundle，
> 任何人打開 devtools 都看得到。Phase 5 已經把整件事移到後端，
> `apps/web` 不再有 `@google/genai` 相依，也不再讀任何環境變數。
> **不要把它加回來。**

---

## 資料存在哪裡

**存在瀏覽器的 localStorage**，前綴 `udn-writing:`。重新整理頁面資料還在，
換一台電腦或清除網站資料就沒了。實作在 `lib/usePersistentState.ts`。

### `SCHEMA_VERSION`

`lib/usePersistentState.ts` 裡有一個版本號。**改動 `mockData.ts` 的結構或
既有代碼時，把它加一。** 否則舊的快取會留在使用者的瀏覽器裡，對不上新的
資料結構，畫面看起來像壞掉（實際上只是資料過期）。版本不合時整包清掉重來。

畫面上也有「重置示範資料」的入口（`useResetDemo()`），示範前想回到乾淨
狀態時用。

---

## 專案結構

```
App.tsx              教師端的頁面切換與共用狀態（最大的一個檔）
index.tsx            進入點
types.ts             只是再匯出 packages/shared —— 型別的實際定義在那裡
mockData.ts          原型用的示範資料（課程、題庫、作業、繳交紀錄）
index.css            Tailwind v4 的 @theme 設定與全站色彩 token
metadata.json        原型平台用的描述檔（含 camera 權限宣告，代繳交要拍照）
```

### `lib/` —— 純邏輯

**這個專案最重要的慣例：會被兩個以上畫面用到的規則，一律收在 `lib/`。**
這些函式沒有副作用、不依賴 React，可以直接在 console 驗證。

| 檔案 | 管什麼 |
|---|---|
| `usePersistentState.ts` | localStorage 的 useState、`SCHEMA_VERSION`、重置 |
| `access.ts` | 身分與可見範圍（哪個角色看得到哪些課） |
| `assignments.ts` | 作業狀態、截止日、繳交統計、換題條件 |
| `assignmentOrder.ts` | 老師排定的作業順序（存排序鍵，序號用算的） |
| `submissionMarks.ts` | 作品標記（佳作／預選）與「能不能蓋章」的判斷 |
| `scoring.ts` | 會考六級分（`MAX_LEVEL` = 6，整體評定不是加總） |
| `statusStyles.ts` | 繳交狀態的顏色與文字，全站唯一來源 |
| `folders.ts` | 題庫資料夾的題目數等計算 |
| `questionMeta.ts` | 建題表單的驗證規則與上限 |
| `leave.ts` | 請假註記（逾期未繳分成真的沒寫與請假兩種） |
| `concern.ts` | 需要關心的學生名單 |
| `gradingQueue.ts` | 批改的「上一位／下一位」順序 |
| `courseSearch.ts` / `courseGroups.ts` | 課程搜尋與依縣市／學校分組 |
| `schoolName.ts` | 課程名稱拆解成學校與班級 |
| `features.ts` | 功能開關（暫時隱藏但保留機制的項目） |
| `hash.ts` | FNV-1a。**產生要存起來的資料時不要用 `Math.random()`** |
| `navigation.ts` / `constants.ts` / `fileToBase64.ts` | 導覽狀態、共用常數、檔案轉 base64 |

### 其餘

```
components/          畫面元件
api/                 後端呼叫。**所有 fetch 都走這裡**，元件不自己打
  client.ts          共同底層（credentials、錯誤處理、JSON 解析）
  ai.ts              AI 功能。金鑰在後端，這裡只有端點路徑
scripts/
  check-tokens.mjs     色彩 token 稽核（wired 進 npm run lint）
  check-mockdata.mjs   示範資料一致性稽核（同上）
  contrast-audit.js    對比度稽核，貼進瀏覽器主控台用
```

---

## 指令

在根目錄下（`-w @udn/web` 指定只跑前端）：

```bash
npm run dev:web                  # 開發伺服器，port 3000
npm run build     -w @udn/web    # 產生 apps/web/dist/
npm run lint      -w @udn/web    # ESLint + 兩支自製稽核（見下）
npm run typecheck -w @udn/web    # 型別檢查
```

省略 `-w` 則對所有 workspace 執行。

`npm run lint` 除了 ESLint，還會跑兩支專案自己的稽核，**改壞會直接擋下來**：

- `check-tokens.mjs` —— 有沒有用到 `index.css` 裡沒宣告的顏色
- `check-mockdata.mjs` —— 名冊人數與 `studentCount` 是否相符、
  被移除過的欄位有沒有偷偷長回來

---

## 給接手的人

**先讀 `CLAUDE.md`。** 那份記的是這個專案已經踩過的坑，每一條都是實際
debug 出來的，包括：

- 深色模式（碑拓）的色階是**反轉**的，寫死 `text-white` 會變成亮底白字
- Tailwind 會在編譯期把 `@theme` 的陰影展開成字面顏色，
  在 `html.dark` 底下覆蓋陰影**沒有作用**（要走 `--shadow-tint-*`）
- 對比度要用 canvas 量，不能用肉眼或正則 —— Tailwind v4 會輸出 `oklab()`
- 同一個資訊不要存兩份（`questionCount` / `submittedCount` / `studentCount`
  那一家人，全部是因此壞掉的）

### 正式開發前必須處理的事

1. **把 Gemini 呼叫移到後端。** 金鑰現在在前端 bundle 裡。
2. **接真正的資料庫。** localStorage 只在這一台瀏覽器，沒有多人共用可言。
3. **帳號與權限。** 現在的身分切換是原型用的假切換（`lib/access.ts` 有
   可見範圍的邏輯可以參考，但沒有任何驗證）。
4. **`tsconfig.json` 沒有開 `strict`**，所以 `strictNullChecks` 是關的 ——
   TypeScript 抓不到選填欄位的呼叫端。要開的話會有一批要修。
5. `mockData.ts` 整份是示範資料，接了後端就該退場。
