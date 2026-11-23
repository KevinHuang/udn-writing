# 交接：目前做到哪

最後更新：2026-10-20。這一份**會變舊**，每次交接都要更新；不會變的規則在根目錄的 `CLAUDE.md`。

---

## 最近完成

| commit | 內容 |
|---|---|
| 分支 `feat/manuscript-redpen`（未 commit，接在 `feat/simple-grading` 後面，2026-11-20） | **原稿紅筆，第三階段（老師端）**。稿紙代繳交的作文，批改頁左邊換成拉正的原稿加紅筆（錯字紅圈＋楷書正確字寫在行間、待確認紫色虛線、亮點波浪線、密圈、格式提醒，編號和右邊便條互相跳），可以切回「辨識文字」、放大拖曳。老師在原稿上確認／否決／改字／點字加錯字、否決格式提醒，每按一下就存（新表 `manuscript_mark_decision`，migration 013），發還後鎖住。**確定的錯別字只有一份**：簡易批改送 AI 的清單改用老師決定後的。老師加的錯字落在卡片引用上自動拿掉引用。改了錯字跨過「3 個以上或段首沒空兩格」時提醒「重新評分」（新端點，存成新的一版）。楷書用全字庫正楷體（OFL，字型檔從 1Campus 複製到 `public/fonts/tw-kai`）。測試：後端 `manuscript.test.ts` 13 條＋`simple_grading` 21 條；前端 261 條。瀏覽器用模擬 AI 實測過整個流程。**學生端還沒做**，見 [`docs/manuscript.md`](../docs/manuscript.md) |
| 分支 `feat/simple-grading`（未 commit，接在 `feat/grid-ocr` 後面，2026-11-20） | **簡易批改，第二階段**。稿紙代繳交、經逐格辨識、老師沒改過文字的作文，按「AI 批改」（單份或批次）自動改用簡易批改：不逐句批改、辨識不確定的字不引用不批評、錯字只看系統清單。**評分規準沿用這一題的批改規範**（聯合報作文批改；使用者決定），後面接簡易批改的規則換掉輸出格式。學生看得到：級分＋評語（總評、亮點、精彩詞語、再上層樓、成語運用，老師可以改）；只給老師看：評分依據、請老師留意、系統拿掉的引用 → 新表 `simple_grading_result`（migration 012）。引用逐格檢查（不可信、有錯字標記的拿掉）、不合格重批一次、不足 100 字不送 AI。批改頁多一塊「簡易批改」。測試：後端 `simple_grading.test.ts` 21 條，`grading`／`grid_ocr`／`grading_result` 51 條照舊通過；前端 252 條。瀏覽器用模擬 AI 實測過。**真的 Gemini 沒跑過**，見 [`docs/simple-grading.md`](../docs/simple-grading.md) |
| 分支 `feat/grid-ocr`（未 commit，2026-11-20） | **稿紙逐格辨識，第一階段：批次代繳交**。《我的稿紙》印的稿紙（四角有定位標記）改走逐格辨識，其他照片照舊走 ocr-job。① 上傳時先問辨識服務：稿紙缺角、太糊 → 422、照片不存，代繳交視窗跳「重拍」（和「網路斷了沒傳上去」分開）。② 開始辨識 → Cloud Run Job `grid-ocr-job`（同 API 映像檔，`node dist/jobs/grid_ocr_job.js`）→ 服務拉正切行 → Gemini 逐行認字 → 排回稿紙、找錯別字 → 寫 `submission`。③ 狀態明確存在新表 `handwriting_grid_result`（migration 011），失敗原因顯示在名冊上；卡住 15 分鐘可重試；重拍過的舊結果、已批改的作文不覆寫。④ 錯別字位置、格式問題、拉正的稿紙圖都存好了，給之後的簡易批改與原稿紅筆用。測試：後端 `grid_ocr.test.ts` 11 條（會自己起 Python 服務）、`proxy_submit` 33 條照舊通過；前端 `gridStatus.test.tsx`。瀏覽器用模擬 AI 實測過：缺角 → 重拍提示；重拍 → 開始辨識 → 6.5 秒「已辨識」→ 批改清單「AI 辨識未校對」。**真的 Gemini 沒跑過、服務與 job 都還沒部署**，見 [`docs/grid-ocr.md`](../docs/grid-ocr.md) |
| 分支 `feat/portfolio-teacher-tools`（未 commit） | **AI 批改時一併產生四向度**（使用者決定，2026-10-20）。以前四向度只有管理員手動打 `/admin/grading_subscores` 才補，而且老師每存一次評語新版本就是空的。現在：① `GenAIHelper.grading()` 的回傳格式加上 `sub_scores`（四個 0-6 分數＋四段 50 字內評語），提示詞後面附加批次那份「嚴格校準版」的**四向度規準**（只有核心評量規準；「心態校準」「審查極限」會改變整體級分，沒有附加）。規準、格式、整理規則都在 `apps/api/src/lib/grading_result.ts`，批次補分改成共用同一段規準（原文逐字比對過）。② 零級分一律四向度全 0、評語空白（沿用批次）；AI 沒給齊就只存整體級分、四向度留空給批次補。③ **老師存檔沿用上一版的四向度**，改整體級分也不動（`saveFeedback` 的 `sub_scores` 參數：undefined＝沿用）。④ AI 回傳解析失敗（或沒有合法級分）改成回 502、**不存檔** —— 以前會被存成一份有效的零級分。⑤ AI 批改與題庫試批改改用 `GRADING_MODEL`（以前沒帶模型，吃到預設的 `OCR_MODEL`）。⑥ **成績管理的四向度雷達圖接上真資料**：摘要與詳細兩支查詢多帶四個分數（不帶評語），前端 `lib/categoryScores.ts` 讀取與平均，沒有四向度的作品不算、標示「M／N 份有四向度」。以前前端一律填 0，雷達圖永遠是 0。測試：`grading_result.test.ts` 14 條、`grading.test.ts` 新增 4 條、前端 `categoryScores.test.tsx`。**真的 Gemini 還沒有實跑過**（本機沒有憑證），上線前要對一兩篇實批，確認四向度有回來、`response` 的排版沒有被附加的說明影響 |
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

### 4-1. 《我的稿紙》靜態版（分支 `feat/my-sheets`，2026-11-20）

- 教師端新頁 `/sheets`（桌機頂端導覽「我的稿紙」；手機收在右上角個人選單，底部導覽維持五項）：
  聯合報國中寫作稿紙（A3／B4）、聯合盃作文大賽稿紙（B4／A3）、會考稿紙（B4／A3）、學測稿紙（A3／B4，兩題都印），
  可預覽、列印、下載。
- **靜態**（使用者決定）：PDF 與預覽圖放在 `apps/web/public/sheets/`，由 `services/handwriting-ocr/tools/build_static_sheets.py`
  產生；清單在 `apps/web/lib/answerSheets.ts`，`test/answerSheets.test.tsx` 檢查兩邊對得上。不用部署服務、不改資料庫。
- `services/handwriting-ocr/` 是從 1Campus Write 整份複製來的稿紙產生與逐格辨識服務（Python），**還沒部署**；
  聯合報這邊改了什麼見它的 `SOURCE.md`。之後做逐格辨識、或要讓老師自訂學校名稱與大標題，就是部署這一份。
- 聯合報國中寫作稿紙、聯合盃作文大賽稿紙**照原稿紙**（使用者決定）：整頁用聯合報提供的 PDF（`headers/*_original.pdf`）當底圖，
  只加定位標記（第 4 版、聯合報專用的 ID）。**在聯合報的稿紙上加定位標記，對外發出前可能要先跟聯合報確認。**
- 聯合盃第一頁的紙用得太滿，四角放不下標記，**版面重排過**（使用者看過示意圖、選定，2026-11-20）：
  整片作答格往右 4mm（格子不縮）、初評分與複評分縮成 16mm 並排移到 Logo 上方、入場證號碼往上 8mm。
  四角標記都在離紙邊 8mm 的正角落，離任何印刷至少 3mm（`sheet.py` 的 `UCUP_PAGE1`）。**這改動了聯合盃的官方版面。**
- 目標是之後能像 1Campus 一樣逐格辨識、在原稿上畫紅筆，所以 `test_udn.py` 量印出來的圖：格線要在樣式說的位置（±0.2mm），
  標記離其他印刷至少 3mm（逐格辨識裁切格子時多留 2mm 邊）。
- 聯合盃是比賽用的匿名稿紙（印著「請勿填寫姓名」），網頁說明有寫出來，讓老師自己決定怎麼用。
- 字型只用全字庫正楷體（開放授權），產生腳本會檢查；`fonts/` 不進 git，要自己下載（見 `SOURCE.md`）。
- **還沒實際印出來試過**：雙面對齊、實際大小、印表機會不會切到定位標記，以及印出來拍照能不能認得（自動測試只用 PDF 轉的圖）。

### 4-2. 稿紙逐格辨識（分支 `feat/grid-ocr`，2026-11-20）

- 設計、部署步驟、本機怎麼跑：[`docs/grid-ocr.md`](../docs/grid-ocr.md)。
- **還沒驗證**：真的 Gemini（本機沒有憑證）——錯字率、時間、成本；`gemini-3.8-flash` 在 Vertex 上支援不支援
  `responseJsonSchema` 與 `mediaResolution`；實際印出來、用手機拍的稿紙（第 4-1 項同一件事）。
- **還沒做**：第二階段簡易批改、第三階段原稿紅筆（資料已存，沒有畫面）；學生自己拍照繳交仍是整張辨識。
- 照片檔名日期的 bug（第 7 項）在這次實測又看到一次（`sub_77_1116_1105-…`，11/20 星期五），沒有動。

### 4-3. 簡易批改（分支 `feat/simple-grading`，2026-11-20）

- 設計、規則、程式位置：[`docs/simple-grading.md`](../docs/simple-grading.md)。
- **還沒驗證**：真的 Gemini —— 分數和一般批改差多少、引用通過的比例、會不會洩漏〔?〕的字、花費；
  題目的批改規範（有自己的輸出模板）和簡易批改的規則接在一起，AI 會不會照規範的模板寫。
  學生作文送外部模型前要先問使用者。
- 單篇的四向度照舊不顯示（`SHOW_CATEGORY_SCORES`）；示意圖裡的「四向度評語」因此沒有出現在批改頁。
- 本機的 `dev-grid` 啟動設定要 `GOOGLE_GENAI_USE_VERTEXAI=false` 才會走模擬 AI（`.env` 開著 Vertex，這台沒有憑證；一般批改也一樣）。

### 4-4. 原稿紅筆（分支 `feat/manuscript-redpen`，2026-11-20）

- 設計、API、字型授權：[`docs/manuscript.md`](../docs/manuscript.md)。只做老師端（使用者決定）。
- **還沒做**：學生端「我的原稿」（發還後看原稿加紅筆）；批次批改前的待確認提醒；名冊上的「錯字待確認 N」。
- **重新評分會換掉整份評語**（1Campus 只換分數、卡片不動）：這邊卡片併在評語裡，沒辦法只換一半。按之前有確認視窗。
- 開發庫 `writing_classroom_test2` 裡王宥人（作業 77）那一份有示範用的錯字標記與卡片（標「示範」），是實測時加的。

### 4-5. 稿紙上的批改區（分支 `feat/manuscript-redpen`，2026-11-23）

- 聯合報國中稿紙第二頁左側的錯字訂正、寫作能力分析、老師評語，原稿畫面直接用紅筆、楷書填進去（評語直寫）。
  規則與做法：[`docs/manuscript.md`](../docs/manuscript.md)「稿紙上的批改區」。
- 等第對應（使用者決定）：6 極佳、5 佳、4 尚可、3 以下待加強；簡易批改的提示詞升到第 2 版，補第四向度 5、6 級分怎麼分。
  **這一句只能加在簡易批改的提示詞（只用在原稿批改）；一般批改的提示詞與回饋維持原樣**（使用者指定，有測試釘住）。
- 只寫一頁（沒有拍第二頁）的作文：原稿最下面補一頁空白稿紙的第二頁放批改區（底圖 `public/sheets/udn_A3_p2_grading.png`）。
- 測試：後端 `manuscript.test.ts` 18 條、`simple_grading` 22 條；前端 276 條（新增 `gradingZone.test.tsx`）。**後端整套沒有重跑。**
- 瀏覽器實測：開發庫作業 77 王宥人那一份（只有第一頁）在批改頁看得到補上的空白稿紙與批改區，位置對齊。
- **還沒驗證**：有拍第二頁的真照片；第 2 版提示詞沒有用真的 Gemini 跑過。
- **還沒做**：老師改四向度；列印與學生端。

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

- **《我的稿紙》**（2026-11-20）：先做靜態版；聯合報國中寫作稿紙照原稿紙（Logo、QR Code 照原樣）；
  會考、學測稿紙也從 1Campus 搬過來；聯合盃作文大賽稿紙也加（同樣照原稿紙）。

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
