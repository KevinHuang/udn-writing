<!-- 步驟 0：辨識服務。2026-10-25 第一版。依 1Campus dev/規格書/簡易批改/工程師回覆與決策.md 的「方案一」：Python 只處理圖片，AI 一律由 Node 經 gpt.1campus.net 呼叫。 -->

# 辨識服務說明（給 1Campus 工程師）

**一句話**：這個服務把稿紙照片變成「要送 AI 的小圖」，再把 AI 的回應組回「每一格的字、全文、格式問題、錯字清單」；另外依老師的稿紙設定產生 1Campus 稿紙 PDF（步驟 1「我的稿紙」）。服務本身不呼叫 AI、不連資料庫、不存任何資料、不需要金鑰。

- 程式：`gaozhi/service/core.py`（三個步驟）、`gaozhi/service/server.py`（HTTP 介面）、`gaozhi/sheet.py`（產生稿紙）
- 測試：`tests/test_service.py`（不連網，用假的 AI 回應走完整流程）
- 部署檔：`Dockerfile`、`requirements.txt`、`.gcloudignore`

---

## 1. 一次代繳交的完整流程（Node 端怎麼串）

```
api（老師上傳完、排入佇列前）
 0. POST /check     ← 這位學生的照片（base64），約 0.5 秒一張、不呼叫 AI
       ok=false    → 不排入辨識：工作直接標成失敗，原因（problems[].message）馬上顯示在名冊，老師可以重拍
       ours=false 且 original_gsat=true → 不排入：原版學測答案卷，工作標成失敗，請老師改用 1Campus 學測稿紙
       其餘（ok=true、一般稿紙的 ours=false、連不上或超過 20 秒）→ 照常排入
proxyOcrTask（Node，沿用 ai_grading_job＋Cloud Tasks）
 1. POST /prepare   ← 這位學生的照片（base64）
       ours=false  → 一般稿紙：整張送原本的手寫辨識 preset（整張辨識）；original_gsat=true 時不辨識，工作標成失敗
       ok=false    → 擋下：把 problems[].message 顯示給老師（重拍／撤回重傳），工作標成失敗
       ok=true     → 每頁的 meta、warped_jpeg（拉正的稿紙圖）、strips（每組要送 AI 的小圖與文字）
 2. 每一頁的每一個 strip：gptService 呼叫「稿紙逐格辨識」preset（見第 2 節）
       多張圖＝strip.images 的 png，使用者文字＝strip.prompt；收回的 JSON 字串照原樣保留
       設定了思考低的新 preset（GRID_OCR_CELLS_PRESET）時改用它，並改成每張圖前面一段「第 N 行：」、strip.prompt 放在所有圖後面
 3. POST /assemble  ← 每頁的 meta、warped_jpeg、replies[{index, text}]
       → 每頁每格的字（ocr）、全文、送批改用的全文（不確定的字標〔?〕）、字數、段落數、
         辨識完成度、格式問題、程式找到的錯字（rule_marks）、typo_request（要送「找錯別字」的文字）
 4. gptService 呼叫「找錯別字」preset（preset_f8f4n9tl），使用者文字＝typo_request.prompt
 5. POST /typos     ← /assemble 的 pages、rule_marks，加上第 4 步的回應（ai_reply）
       done=false → 回傳 zhuyin_request：呼叫「注音補字」preset（preset_gc3gf4vi），再呼叫一次 /typos 帶上 zhuyin_reply
       done=true  → marks：每個錯字標記（kind=typo 確定、kind=check 待確認）
 6. warped_jpeg 上傳 storage.1campus.net；ocr、全文、格式問題、marks 寫進新資料表（只新增、不改舊欄位）
```

AI 用量照現在的方式記在 `ai_grading_job`（第 2、4 步各自記）。

**認得出 1Campus 稿紙之後就不改用整張辨識**：`/prepare` 回 `ok=true` 之後，第 2～5 步任何一步失敗（AI 回應空白、截斷、格式不對，或服務出錯），都不改用整張辨識，直接把工作標成失敗，老師用已上傳的照片重新辨識。整張辨識讀格子稿紙錯字很多，也不能用簡易批改。限流這類暫時性錯誤，照樣交給 Cloud Tasks 重試。還不知道是不是 1Campus 稿紙時（下載、`/prepare` 本身失敗），才照舊在最後一次改用整張辨識。

**原版學測答案卷不收**（docs/adr/0012）：考場原版或學校影印的學測答案卷，格子和 1Campus 學測稿紙一樣，但沒有定位標記，整張辨識讀它錯字約兩成。`/check`、`/prepare` 在所有照片都讀不到定位標記時，用格線比對學測答案卷的格子（`gaozhi/gridreg.py`，先縮到長邊 2000，一張約 1 秒），對得上就回 `original_gsat: true`。Node 端遇到這個回應不辨識，請老師改用 1Campus 學測稿紙。這是看紙判斷，不看作業選了哪個批改模型。會考格式不擋。

**學生自己拍照也走同一段**（搶先測試 `studentGridOcr`，`dev/api/student-ocr-api.md`）：學生的國文照片一樣先 `/check`、再 `/prepare` → 逐格辨識 → `/assemble`，但**不呼叫第 4、5 步**（學生自己校對，不找錯別字），也不做第 6 步（不存原稿）。任務函式是另一個（`studentOcrTask`），所以這個服務要允許它的服務帳號呼叫（和 `proxyocrtask` 同一個預設帳號時不用另外設定）。

---

## 2. 三個 preset 的系統指令

`GET /prompts` 會回傳三個 preset 的 `system`（系統指令）、`schema`（固定 JSON 回傳格式）與建議設定，直接貼進 gpt.1campus.net 後台即可。這些文字和本機原型用的**一字不差**；之後調整 prompt 時，請一併更新後台。

**gpt.1campus.net 不能強制 schema**：回應一律是模型寫的字串，原型靠 Gemini SDK 的 `response_json_schema` 才拿到純 JSON。系統指令裡沒寫回傳格式，所以只靠後台設定時模型會回 Markdown 條列或表格（2026-10-29 正式站實際發生）。
Node 端（`functions/lib/gridOcrPipeline.js` 的 `REPLY_FORMATS`）會在每次送出的文字後面附上「只回 JSON」與欄位格式，並拆掉 ```json 程式碼框再交給 `/assemble`、`/typos`。**改 schema 欄位時要一併改 `REPLY_FORMATS`。**

| preset | 識別碼 | 建議設定 |
|---|---|---|
| 稿紙逐格辨識 | `preset_kt3o1bon` | gemini-3.8-flash、media_resolution 高、thinking 低、max output 16384、固定 JSON 回傳（正式站目前想得比「低」多，不動它，見下） |
| 稿紙逐格辨識（思考低，搶先測試） | 新建；名稱填進 `functions/.env.<project>` 的 `GRID_OCR_CELLS_PRESET` | 系統指令、模型、解析度、輸出上限都和 `preset_kt3o1bon` 一樣，只有 thinking 設「低」 |
| 找錯別字 | `preset_f8f4n9tl` | gemini-3.8-flash、thinking 高（2026-10-27 Enzo 定案）、固定 JSON 回傳 |
| 注音補字 | `preset_gc3gf4vi` | gemini-3.8-flash、thinking 低、固定 JSON 回傳 |

**思考低要配新的送法，兩件一起切換**（`functions/lib/gptService.js` `getGridCellsSetup`）。沒填 `GRID_OCR_CELLS_PRESET` 時，照舊用 `preset_kt3o1bon`，送法是說明文字在前、小圖接在後面。填了才同時改用新 preset，並改成原型的送法：每張小圖前面一段「第 N 行：」，`strip.prompt`＋回傳格式放在所有圖後面，文字內容一字不改。2026-11-04 用學生手機照片測試（有人工定稿 4 份 × 各 3 次，直接連 Gemini）：

| 設定 | 錯字 | 每頁 AI（中位／最慢） |
|---|---|---|
| 正式設定（`preset_kt3o1bon`，說明在前） | 1.54% | 約 40／110 秒 |
| 只調低思考（說明在前） | 2.28%（會漏字） | 約 11／15 秒 |
| 思考低＋每張圖前標「第 N 行」 | 1.48% | 約 10／19 秒 |
| 同上，照片長邊 2400 | 1.38% | 約 11／15 秒 |

gpt.1campus.net 會照 `content` 的順序，把文字和圖片交錯轉給模型（2026-11-04 用 `preset_kt3o1bon` 實測：最前面多放兩張沒標行號的圖，「第 1 行：」後面那張圖仍然讀成第 1 行）。新 preset 的底層模型以 gemini-3.8-flash 估算 AI 用量（`aiModelPricing.js`）。

---

## 3. API

所有請求和回應都是 JSON（`Content-Type: application/json`），影像用 base64。一個請求最多 30 MB。錯誤回 `{"error": "給老師看的中文訊息"}`，狀態碼 400／413／415／422；伺服器錯誤 500 只回錯誤種類，不含內容。

### GET /healthz

`{"ok": true, "service_version": 1, "sheet_ready": true}`（`sheet_ready`＝有稿紙字型，可以產生稿紙）

### POST /check

請求同 `/prepare`。只找四角定位標記、判斷要不要老師處理（不做格線微調、不切小圖），問題的判斷和 `/prepare` 相同；只有「格子對不準」（`grid_misaligned`）要微調過才知道，`/check` 發現不了。

```json
{"ours": false, "reason": "找不到 1Campus 稿紙的四角定位標記", "failed": [...]}
{"ours": false, "original_gsat": true, "original_gsat_names": ["第1張"], "reason": "這是原版學測答案卷（沒有 1Campus 稿紙的定位標記）", "failed": [...]}
{"ours": true, "ok": false, "problems": [{"code": "markers_incomplete", "names": ["第1張"], "message": "第1張的左下角定位標記看不清楚，請重拍（四個角都要清楚拍進去）"}], "pages": [...]}
{"ours": true, "ok": true, "pages": [{"page": 1, "template": "gsat", "format": "學測國寫答案卷", "paper": "B4", "source": "第1張"}]}
```

### POST /prepare

請求：`{"files": [{"name": "王小明_1.jpg", "data": "<base64>"}, …]}`（一位學生的所有頁；JPEG、PNG、PDF）

回應（三種；`ours=false` 時照片是原版學測答案卷會另帶 `original_gsat: true`，同 `/check`）：

```json
{"ours": false, "reason": "找不到 1Campus 稿紙的四角定位標記", "failed": [{"name": "…", "error": "…"}]}
{"ours": true, "ok": false, "problems": [{"code": "two_questions", "message": "學測第一、二大題混在一起，…"}], "pages": [...]}
{"ours": true, "ok": true, "prompt_version": 2, "pages": [
  {"page": 1, "template": "cap", "format": "教育會考寫作測驗答案卷", "paper": "B4", "source": "王小明_1.jpg",
   "meta": {…}, "warped_jpeg": "<base64>", "ink_cells": 412,
   "strips": [{"index": 0, "cols": [1,2,3,4,5,6], "prompt": "以上是第 1、2…", "images": [{"col": 1, "png": "<base64>"}, …]}, …]}]}
```

`problems[].code`：

| code | 什麼情況 | 老師要做什麼 |
|---|---|---|
| `markers_missing` | 有的照片認得出稿紙、有的認不出 | 重拍那幾張（四個角都要拍進去） |
| `markers_incomplete` | 認得出稿紙，但有一個角的定位標記讀不出來（只靠三個角拉正會歪 1～2mm，空白格會被當成有字，2026-11-03 正式站） | 重拍那幾張（四個角都要清楚拍進去） |
| `grid_misaligned` | 四個角都認到，但格線微調沒成功、只靠定位標記拉正又偏 0.8mm 以上（照片太小、紙沒攤平、拍得太斜）。照樣切格子的話，格線殘段會被當成字（2026-11-04 本機量測：照片縮成 1600 時偏 1.15mm，多出約 290 個假格子）。只有 `/prepare` 會發現 | 重拍那幾張（紙要攤平、從正上方拍） |
| `duplicate_page` | 同一頁傳了兩次 | 刪掉其中一張 |
| `mixed_formats` | 混了會考和學測稿紙 | 確認放對 |
| `two_questions` | 學測第一、二大題在同一份作業 | 撤回後重傳正確的那一面 |

`meta` 和 `warped_jpeg` 要原封不動保存，第 3 步送回來（服務沒有狀態，靠這兩樣重算格子）。

### POST /assemble

請求：`{"pages": [{"meta": {…}, "warped_jpeg": "<base64>", "replies": [{"index": 0, "text": "<preset 回傳的 JSON 字串>"}, …]}]}`

回應重點：

| 欄位 | 內容 |
|---|---|
| `pages[]` | `{prefix: "第1頁", page, ocr}`：ocr 是每一格的字與狀態（agree 可信／single 建議看一下／review 需確認／blank），原稿批改頁畫標記要用 |
| `text` | 全文（依稿紙分段） |
| `marked_text` | 送簡易批改模型用的全文：不確定的字後面加〔?〕 |
| `chars`、`paragraphs` | 字數（一格一字，標點也算）、段落數 |
| `completion` | 辨識完成度＝可信格數 ÷ 有字格數（門檻暫定 0.85） |
| `format[]` | 格式問題：`標點在行首`、`段首空兩格`，各帶 `keys`（格子位置）與 `why` |
| `rule_marks[]` | 程式找到的錯字（常見錯詞、簡體字、注音代替、成語） |
| `typo_request` | `{preset: "找錯別字", prompt}`：第 4 步要送的文字 |
| `warnings[]` | 某幾組沒有回應或格式不對（那幾格會變成「需確認」） |

格子位置一律寫成 `第N頁:行:格`（例：`第1頁:3:12`）。

### POST /typos

請求：`{"pages": <assemble 的 pages>, "rule_marks": <assemble 的 rule_marks>, "ai_reply": "<找錯別字回應>", "zhuyin_reply": "<注音補字回應，第二次才帶>"}`

回應：`{"done": false, "zhuyin_request": {preset, prompt}}` 或

```json
{"done": true, "lost": 0, "marks": [
  {"keys": ["第1頁:1:7"], "wrong": "在", "correct": "再", "type": "別字", "reason": "…", "confidence": "high",
   "source": "ai-text", "status": "pending", "trusted": true, "kind": "typo", "context": ["放心", "在", "家"]}]}
```

- `kind=typo`（trusted）：那幾格辨識可信，可以直接畫紅圈，發還時學生看得到。
- `kind=check`：辨識不確定，畫紫色「待確認」，老師確認後學生才看得到。
- 送給簡易批改模型的錯字清單＝`kind=typo` 加上老師確認過的（定稿規則 3）。

### GET /sheet-options

「印稿紙」視窗用的選項，字數上限請讀這裡，不要寫死：

```json
{"formats": [{"id": "cap", "label": "會考稿紙", "default_paper": "B4"}, {"id": "gsat", "label": "學測稿紙", "default_paper": "A3"}],
 "papers": ["B4", "A3"], "title_max": 20, "school_max": 20, "default_title": "寫作測驗答案卷",
 "gsat_questions": [{"id": "analytical", "label": "知性題", "detail": "第一大題・1 頁", "pages": 1},
                    {"id": "affective", "label": "情意題", "detail": "第二大題・1 頁", "pages": 1},
                    {"id": "both", "label": "兩題都印", "detail": "考場版・2 頁（正反面）", "pages": 2}]}
```

### POST /sheet

產生 1Campus 稿紙。會考稿紙兩頁；學測稿紙依 `gsat_question` 印一題（1 頁）或兩題（2 頁，和考場答案卷一樣）。
表頭位置固定，不會壓到作答格與四角定位標記；沒有身分碼（QR）。

請求：

```json
{"format": "gsat", "paper": "A3", "school": "臺北市立○○高中", "title": "高三國寫練習：情意題",
 "fields": {"class_seat_name": true, "date": false, "score": false}, "seat_marks": false,
 "gsat_question": "affective", "output": "pdf"}
```

| 欄位 | 說明 |
|---|---|
| `format` | `cap` 會考稿紙／`gsat` 學測稿紙，必填（老師每次自己選） |
| `paper` | `B4`／`A3`；省略＝跟著格式預設（會考 B4、學測 A3） |
| `school` | 學校名稱，可空白（不印），最多 `school_max` 字 |
| `title` | 大標題，必填，最多 `title_max` 字；換行與多餘空白會收成一個空格 |
| `fields` | 要印的填寫欄：班級座號姓名、日期、得分 |
| `seat_marks` | 加印座號劃記（測試開關 `sheetSeatMarks`，Node 端要先檢查權限） |
| `gsat_question` | 學測稿紙印哪一題：`analytical` 知性題（第一大題，1 頁）／`affective` 情意題（第二大題，1 頁）／`both` 兩題都印（2 頁）；省略＝`both`。會考稿紙不看這個欄位 |
| `output` | `pdf`（預設）或 `png`（印前預覽：每一頁一張圖） |

回應：`{"pdf": "<base64>", "pages": 2, "paper": "B4"}`，或 `output: "png"` 時
`{"images": [{"png": "<base64>", "label": "情意題（第二大題）"}], "png": "<第 1 頁 base64>", "paper": "A3"}`
（每頁一張 90 dpi 的 PNG，和 PDF 同一份文件畫出來；`label` 是學測那一頁是哪一題，會考是空字串）。
錯誤回 400 `{"error": "…"}`，例如沒選格式、字數超過、有字印不出來（「這幾個字印不出來：…，請換個寫法」）。

**單面怎麼排**（2026-11-09）：只印知性題＝兩題都印的第 1 頁，一模一樣。只印情意題＝第二大題的格子與定位標記，
上方加和第 1 頁同位置的表頭（學校、填寫欄、座號劃記）；第二大題右側的作答區標籤外面沒有位置直排大標題，改成橫排置中在格子上方。
定位標記記著是第 1 還是第 2 頁，所以**單面情意題上傳後一樣認成第 2 頁，辨識不必改**；1Campus 依頁別預設簡易批改的版本
（第一大題＝知性題、第二大題＝情意題）。產生稿紙與 `/prepare` 讀 PDF 共用同一把鎖（PyMuPDF 不能同時在兩個執行緒用）。

**定位標記離紙邊多遠**（2026-11-19）：油印、影印時紙邊常被裁掉幾 mm，會考稿紙改用第 3 版定位標記——
格子大小、位置都不動，只把四角標記往內移：B4 離紙邊 11.5mm（左邊到作答格只夠這樣）、A3 12mm（原本第 2 版 8mm）。
第 3 版是另一組 ID（`layout.MARKER_V3_OFFSET`），由樣式的 `marker_margins` 決定位置；掃描時看 ID 就知道是哪一版，
已經印出去的第 1、2 版稿紙照樣能讀。學測稿紙還是第 2 版。

印出來的稿紙用 `/prepare` 一定認得出格式、頁碼與紙張（測試有驗證兩種格式 × 兩種紙張，以及學測單面兩題 × 兩種紙張）。

---

## 4. 部署（Cloud Run，asia-east1）

在這個資料夾（`services/handwriting-ocr/`）。gcloud 的預設專案不一定是 campus-essay，每個指令都帶 `--project`：

```
gcloud run deploy gaozhi-ocr --source . --region asia-east1 --project campus-essay \
  --no-allow-unauthenticated --memory 2Gi --cpu 2 --timeout 300 --concurrency 4
# 會呼叫這個服務的兩支 Functions 用的服務帳戶（沒指定時都是 Compute Engine 預設服務帳戶）：
# proxyocrtask（代繳交逐格辨識）、api（我的稿紙／印稿紙）
gcloud run services describe proxyocrtask --region asia-east1 --project campus-essay \
  --format 'value(spec.template.spec.serviceAccountName)'
gcloud run services describe api --region asia-east1 --project campus-essay \
  --format 'value(spec.template.spec.serviceAccountName)'
# 每個查到的服務帳戶各綁一次（兩個一樣就只要一次）
gcloud run services add-iam-policy-binding gaozhi-ocr --region asia-east1 --project campus-essay \
  --member serviceAccount:<上一步查到的服務帳戶> --role roles/run.invoker
```

部署完把服務網址（`gcloud run services describe gaozhi-ocr ... --format 'value(status.url)'`）寫進
`functions/.env.campus-essay` 的 `GRID_OCR_SERVICE_URL=`（逐格辨識與稿紙共用這一個變數），再部署 Functions（`api`、`proxyOcrTask`）。
沒設定時代繳交照舊整張辨識，印稿紙會回「稿紙服務暫時無法使用」。

- 不需要任何 secret；不連 Cloud SQL。
- Node 端用 `google-auth-library` 取 ID token（audience＝服務網址）帶在 `Authorization: Bearer` 上。
- 映像檔建置時會下載教育部辭典（約 15 MB，只用來比對成語），下載失敗不影響部署。
- 映像檔建置時也會下載**全字庫正楷體**（TW-Kai，約 58 MB 壓縮檔，國家發展委員會全字庫，政府資料開放授權條款第 1 版，可商用、需標示來源）。雲端沒有 Windows 的標楷體，稿紙改用這套字型；下載失敗不擋部署，但 `/sheet` 不能用（本機的 `/healthz` 會看到 `sheet_ready` 是 false）。授權 2026-10-27 Enzo 確認可用。
- **Cloud Run 上打不到 `/healthz`**：Cloud Run 保留結尾是 `z` 的網址路徑，請求不會進到服務，會回 Google 的 HTML 404 頁
  （服務自己的 404 是 JSON）。Node 端不會呼叫 `/healthz`，所以不影響功能。部署後改用下面兩個請求驗證：

  ```
  # 服務有起來、ID token 驗證通過：回三個 preset 的 JSON
  curl -H "Authorization: Bearer $(gcloud auth print-identity-token)" <服務網址>/prompts
  # 稿紙字型有下載成功：回 pages、paper 和很長的 pdf（base64）
  curl -X POST -H "Authorization: Bearer $(gcloud auth print-identity-token)" -H "Content-Type: application/json" \
    -d '{"format":"cap","paper":"B4","title":"寫作測驗答案卷","output":"pdf"}' <服務網址>/sheet
  ```
- 本機（Windows）照樣用標楷體；要指定字型資料夾可設環境變數 `GAOZHI_FONT_DIR`。
- 日誌只記網址、狀態碼與耗時，不記作文內容。

本機試跑：`python -m gaozhi.service.server`（預設連接埠 8080，環境變數 `PORT` 可改）。

---

## 5. 還沒做、要注意的

- 2026-10-27 已在本機 `docker build` 建置成功、`/healthz` 與 `/prompts` 正常、辭典有下載。
- Node 端已串接（`functions/lib/gridOcrPipeline.js`、`gridOcrService.js`，由 `proxyOcrJobRunner.js` 呼叫），
  放在搶先測試 `gridOcrProxy` 後面；結果寫進 `handwriting_grid_result`（`dev/sql/schema/handwriting_grid_result.md`）。
- 原版學測答案卷的判斷（2026-11-04）只用 1Campus 學測稿紙的照片驗證過（格子相同；9 張認出 8 張），
  電腦產生的會考稿紙、自己畫的一般稿紙和橫線紙都沒被認成學測。**還沒用真的原版學測答案卷照片驗證**。
- 第 2 步 preset 後台的參數（解析度、思考程度）要和上表一致，結果才會和本機原型相同。
- 國文代繳交的照片（App 拍照、相簿、PDF）前端縮到長邊 3200（搶先測試 `gridOcrProxy`；其他照舊 1600）。
  1600 時有的稿紙格子對不準，2400 錯字略少；3200 還沒用 AI 測過。也還沒測：1Campus 會考稿紙、A3 學測稿紙的實際照片。
- 原版會考／學測答案卷（沒有定位標記）這次不支援：`/prepare` 會回 `ours=false`。

---

## 6. 測試

```
pip install -r requirements-dev.txt
python -m pytest tests -q
```

不連網、不花錢：用假的 AI 回應走完 /prepare → /assemble → /typos，並產生兩種稿紙、確認印出來的稿紙認得出來（這台電腦沒有標楷體或全字庫正楷體時，稿紙的測試會略過）。`tests/fixtures/` 的稿紙圖是電腦合成的範例，不是學生作文。
