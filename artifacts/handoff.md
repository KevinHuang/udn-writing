# 交接：目前做到哪

最後更新：2026-10-01。這一份**會變舊**，每次交接都要更新；不會變的規則在根目錄的 `CLAUDE.md`。

---

## 最近完成

| commit | 內容 |
|---|---|
| 分支 `feat/portfolio-teacher-tools`（未合併） | **數位作品集的教師功能搬進來**（分工見數位作品集資料夾的 `UDN_整合分析.md`）。① 批改清單「依級分蓋佳作」：選門檻、列出候選、確認才蓋，**只蓋不取消**（`lib/submissionMarks.ts` 的 `featuredCandidates`）。② 班級頁「數位作品集：佳作觀摩顯示級分」開關，存在新表 `course_showcase`（migration 008，預設不顯示），`PUT /service/instructor/courses/:id/showcase`，讀取跟著課程清單的 `showcase_show_score`。③ 成績管理「製作成果集」→ `/anthology`：跨班跨校勾選、全部／佳作／預選／依題目，A4 稿紙排版、目錄頁碼是**排出來的**不是估的（`lib/anthology.ts`）。瀏覽器實測過三項；**實際列印與另存 PDF 還沒有人試過**。④ **自動蓋佳作**：批改作業入口頁設定自己的標準（例如 5 級分以上），作品**第一次**批改完成（AI 或手動存檔）就自動蓋；批改清單可另外調整該作業的標準（沿用／本作業 N 級分／不自動蓋）。用當下批改的人的標準、每篇只判斷一次、只對之後的批改生效（migration 009、`dal/featured_rule_helper.ts`、掛在 `InstructorHelper.saveFeedback`）。瀏覽器實測過（模擬批改）。⑤ **兩個資料外洩的修補**（同一個分支，commit 時分開，需要時可以單獨挑出來先上線）：`GET /instructor/courses/:course_id/tasks/:task_ids/scores` 補上範圍檢查、task_ids 改成參數（以前是 SQL 注入點，任何教師可以讀整個資料庫）；學生端 `my_assignments` 與 `submission_feedback` 在發還前不再送出分數與評語（以前只靠畫面不顯示）。測試 `scores_and_unreturned.test.ts`，已確認舊程式會失敗 5 條。⑥ **學生的「我的作品集」**（`/student/portfolio`）：挑自己已發還的作品排成 A4 作品集（與老師的成果集同一套引擎，目錄依學期分組），佳作發還後會標示；被選為佳作的作品可以設定「同校觀摩：願意公開／不公開」（migration 010 `submission_publish_consent`，`PUT /service/student/submissions/:id/publish-consent`，只限自己的、已發還的佳作；沒設＝還沒決定＝不公開；不限學期、隨時可改）。家長同意在數位作品集平台。**後端新測試因為 10/1 早上資料庫伺服器反覆當機恢復，還沒有乾淨跑完**。⑦ 公開意願也能在**學習概況的「近期發還」**與**我的作業**設定（共用元件 `components/FeaturedConsent.tsx`、共用狀態 `handleSetPublishConsent`）；學習概況多一條「N 篇佳作還沒決定」提醒（`lib/featuredConsent.ts`），帶到我的作業的已發還分頁。學生端的學期選單在**學習概況、我的作業、成績紀錄**互相延用：網址 `?semester` 優先，否則 AppState 的 `currentSemester`；頂端導覽換頁時帶著走。頂端的學期小標籤改成固定顯示今天的學期 |
| 分支 `feat/portfolio-teacher-tools`（未合併） | **數位作品集專用資料介面** `/service/portfolio/v1/*`（`routes/portfolio.ts`，說明 `docs/portfolio-api.md`）。唯讀；**用使用者自己的 1Campus access token 驗證**（使用者決定，不用平台金鑰）：學生拿自己已發還的作品、同校觀摩（佳作＋學生願意公開＋已發還＋同校，級分依班級設定、不給評語）；原稿照片由本系統轉送，給 15 分鐘的簽章網址；**家長端點預留、回 501**，等 1Campus 家長身分的文件（`lib/parent_links.ts`）。測試 `portfolio_api.test.ts` 13 條。`scores_and_unreturned.test.ts` 也終於乾淨跑完（16 條） |
| `beef3c1` | **批次代繳交改成「先收照片、後台辨識」**。老師拍完一位就上傳、自動跳下一位，全部收完按「開始辨識」由 Cloud Run `ocr-job` 在背景跑，可以關掉視窗。批改清單有進度 pill 與「AI 辨識未校對」徽章，批改頁有「校對文字」，批次批改遇到未校對的會先確認。設計與狀態推導見 `docs/ocr-job.md` |
| `09f1499` | 代繳交兩支端點補上範圍檢查（以前任一教師可對任意學生代繳交）、`batch_proxy_submission_helper` 的 SQL 改成參數化（以前是字串內插）、修批改清單同一位學生出現兩列的 bug。**零行為改變，可以單獨上線** |
| `47408d7` | 稿紙掃描的拍攝提示不再要求「橫持手機」（直式稿紙橫握只佔畫面 29.7%） |
| `cbf3156` | Kevin 的「從 DSA 同步課程」：新增 `/service/instructor/sync/get_courses`、`/sync/from_dsa_course`，改寫了 `SyncSchoolModal`。**動課程匯入相關的東西前先看這一支** |

更早的：課程名單同步（`a595f6a`）、管理人員可管理所有班級（`556d211`）、
稿紙多張連拍托盤（`2a5efc5`）、清除按鈕／回饋編輯器／成績總覽（`1416a3f`）。

**學生操作教學影片**（稿紙掃描 → 校對 → 提交，4 分 07 秒，只有字幕）：
專案在 repo **外面** `..\udn-writing-video\`（Revideo），沒有版本控制。
成品在 `out\udn-scan-tutorial.mp4`，怎麼重新渲染、怎麼驗證寫在它自己的 `README.md`。
影片裡的畫面是 9/26 拍的，之後改了 UI 就要重拍素材。

---

## 待驗證／還沒做

### 1. 批次代繳交還沒在瀏覽器實際點過

- **現況**：自動測試全過（後端 `proxy_submit.test.ts` 33 條、前端 `proxyStatus`／`proxyQueue`），
  但畫面沒有人點過，手機版面也沒看過。
- **卡在**：要用模擬模式重啟開發 API，上一個對話沒有權限重啟正在跑的服務。
- **下一步**：停掉現在的 `npm run dev`，改用：
  ```powershell
  $env:STORAGE_FAKE='1'; $env:OCR_JOB_FAKE='simulate'; npm run dev
  ```
  用教師身分進某份作業的批改清單 →「批次代繳交」→ 拍／選 2–3 位的照片 →「開始辨識」→
  等約 6 秒變「已辨識」→ 關視窗看清單的 pill 與徽章 → 點進批改頁「校對文字」→ 存檔後徽章消失。
  模擬模式下照片不會真的存，縮圖是破圖，這是正常的。

### 2. 背景辨識 `ocr-job` 是黑箱 —— **上線前必做**

- **現況**：`ocr-job` 的原始碼不在這個 repo。「辨識中／成功／失敗」是依假設推的。
- **下一步**：請有 GCP 權限的人照 `docs/ocr-job.md` 對一位學生實跑一次，回答那七個問題。
  最要緊的是「失敗時會不會照樣寫 `ocr_time`」與「會不會蓋掉學生的草稿、繞過已批改的保護」。
  答案不同時要改的地方，表格裡都寫了。

### 3. 開發用登入進了 git，上線前要拿掉

- **現況**：`2a5efc5` 把它一起 commit 進去了。沒有 token 或 `NODE_ENV=production` 時不會掛上路由，但不該留在正式版。
- **下一步**：移除這三個地方
  - `apps/api/src/auth/dev_login.ts`（整個檔）
  - `apps/api/src/auth/index.ts` 的 `import { mountDevLogin }` 與 `mountDevLogin(router)` 兩處
  - `.env` 的 `DEV_LOGIN_TOKEN`
- ⚠️ 拿掉之後手機就登入不了（1Campus 的 OAuth 回呼綁在 `localhost:3001`），要先想好手機測試怎麼辦。

### 4. 使用者決定先不修的

- **直式稿紙掃完一律變橫的**：`apps/web/lib/scan/enhance.ts` 的 `warpDocument` 強制把長邊擺水平。
  目前靠結果頁的旋轉鍵補救（教學影片也這樣教）。要改的話會動到橫式稿紙的裁切與 OCR 輸入，要一起測。

### 5. 管理人員在「可匯入的課程」是空的

- **現況**：`GET /service/instructor/school-courses` 仍用 `ctx.session.userInfo.id` 查教師有掛課的學校，
  管理人員在 `uc_instructor` 裡沒有資料列 → 空清單。其他教師端 API 都已經改走 `courseScopeOf(ctx)`。
- **注意**：Kevin 的 `cbf3156` 另外做了一條從 DSA 同步的路，改這支之前先確認兩條路的分工。

### 6. 管理人員自行管理批改 prompt

使用者在跟工程師討論要不要做，**還沒開工**。

### 7. 代繳交照片檔名的日期是錯的

`apps/api/src/routes/instructor.ts` 的 `/submissions/ocr_proxy` 用 `dt.getDay()`（星期幾），
`geminiService.ts` 用的是 `getDate()`。只是檔名，不影響功能。
**等第 2 項答完**（確認 `ocr-job` 不靠檔名解析日期）再改。

### 8. 「我的作業」是空的 —— 不是 bug

開發資料庫的課程都在 114-2（2026-03-01～08-31），今天是 115-1，而「我的作業」只列本學期。
要看到資料就在開發資料庫開一門 115-1 的課。

---

## 使用者做過的決策

這一段從 Claude 的記憶與過去的對話整理。**記憶是依專案路徑存的**，從不同路徑開啟可能讀不到，所以寫在這裡。

- **新版 UI 移植**（`聯合報雲寫作教室新版/` 原型）：衝突時以新版為主。保留目前版獨有的期末總結、身分切換、登出、後端 AI 批改。評語維持單一欄位（不拆三欄，那要改資料庫模型）。
- **聯合學苑配色**：套全系統（教師端＋學生端）；名稱維持「聯合報 雲寫作教室」；介面用思源黑體、作文與題目用霞鶩文楷；有白字的按鈕與藍色連結加深一階以達 WCAG AA。改色一律走 `apps/web/index.css` 的 `@theme`。
- **管理人員**：聯合報管理人員與校務管理的能力都**等同授課教師**，差別只在範圍（全部／自己的學校）。
- **課程卡片**：拿掉「設定批改模型」；「同步學生名單」直接增刪，沒匯入過的班停用並說明原因。
- **批次代繳交**：沿用 Cloud Run `ocr-job`；每拍完一位就指定學生；失敗跳過並標記、可單獨重試；**不動 schema**；順手修安全問題。
- **教學影片**：只有字幕、沒有旁白；OCR 用模擬的結果；作文稿紙必須是直寫；方向不對就教學生按旋轉鍵。

---

## 本機開發備忘

- `.env`（repo 根目錄，不進 git）：`DB_NAME=writing_classroom_test`、`TEST_DB_NAME=writing_classroom_autotest`
- **手機測試**：另外起 `npm run dev:https -w @udn/web`（自簽憑證的 3443 埠，與 3000 可同時跑），
  手機連 `https://<電腦 IP>:3443`，用開發用登入 `/auth/dev-login?token=…`（token 在 `.env` 的 `DEV_LOGIN_TOKEN`）
- **模擬模式**：`STORAGE_FAKE=1`（照片不存 GCS）、`OCR_JOB_FAKE=simulate`（不開 Cloud Run job，6 秒後寫回示範文字）。
  兩個都要明確開啟，`NODE_ENV=production` 時程式會忽略。
- **稿紙掃描除錯**：網址加 `?scandebug=1`（或長按相機畫面右上角的解析度標籤）開診斷 HUD，
  看得到串流解析度與偵測命中率（`lib/scan/debug.ts`、`components/scan/ScanDebugHud.tsx`）。
- 這台電腦沒有 gcloud／ADC，真的 OCR、GCS、Cloud Run 在本機都跑不了。
