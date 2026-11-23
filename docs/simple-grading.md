# 簡易批改（第二階段：稿紙代繳交的作文）

稿紙代繳交、經過[逐格辨識](grid-ocr.md)的作文，學生**沒有校稿**：文字是系統一格一格認出來的，難免有讀錯的字。
這種作文按「AI 批改」（單份或批次批改都一樣）會改用**簡易批改**：

- 打級分、寫重點回饋，**不逐句批改、不示範改寫**；
- 辨識不確定的字（〔?〕、□）**不引用、不批評**，也不能只憑它降級；
- 錯別字與格式**只看系統的清單**，AI 不自己找、不自己數；
- 學生看不出文字是辨識出來的。

流程與規則搬自 1Campus Write 的簡易批改定稿（會考版）。**評分規準不搬**：沿用這一題自己的批改規範
（`system_instruction`，例如「聯合報作文批改」；使用者決定，2026-11-20）。

---

## 什麼時候用

後端在 `POST /service/instructor/grading/:submissionId` 自己判斷，老師不用選：

| 條件 | 結果 |
|---|---|
| 這篇有完成的逐格辨識結果，而且作文文字還是辨識出來的那一份 | 簡易批改 |
| 老師按「校對文字」改過內容 | 一般批改（文字已經是人看過的了，格子也對不上了） |
| 學生自己交的、整張辨識的、打字的 | 一般批改（照舊） |

「文字有沒有改過」是比對去掉空白與〔?〕之後的全文（`normalizeForCompare`）。

不足 100 字**不送 AI**，直接建議 0 級分（固定的一段說明），不花錢。

---

## 送給 AI 的內容

系統提示 ＝ 這一題的批改規範 ＋【題目】【題說】【教師提示】＋ 簡易批改的規則（`lib/simple_grading/prompt.ts`）。

簡易批改的規則告訴 AI：規範裡的**級分判斷、偏題檢測、四級分守門條件、語氣**照用；
規範裡的**輸出模板、改寫示範、字詞診療室、逐段解析**不用，改照 JSON 輸出。
寫法不點名規範裡的段落名稱 —— 規範會被改。

學生作文那一段是資料模板（`lib/simple_grading/essay.ts`）：

```
【辨識全文】（每段一行，行首的數字是段落編號；字後面的〔?〕表示這個字辨識不確定；□ 表示看不出來的字）
1　那年暑假，我到花蓮的外婆家……她總是笑著和每個攤〔?〕販打招呼。
2　……
【系統統計】字數：612；段落數：7
【確定的錯別字】共 1 個
1. 第 1 段「外婆都會待我到市場」：待 → 帶
【格式檢查】段首沒有空兩格：無／標點寫在一行的第一格：1 處（第 1 段）
```

「確定的錯別字」是系統有把握的（`kind = typo`，重複的只算一個）加上老師在原稿上確認、自己加的，
扣掉老師否決的（[manuscript.md](manuscript.md)）。**待確認的不送、不算分。**

---

## AI 回來的東西放哪

| 內容 | 存在哪 | 誰看得到 |
|---|---|---|
| 級分 | `submission_feedback.score` | 都看得到 |
| 總評＋亮點、精彩詞語（密圈）、再上層樓（建議）、成語運用 | `submission_feedback.content.response`（markdown） | 都看得到；老師可以在評語欄改 |
| 四向度級分與評語 | `submission_feedback.sub_scores` | 照現在的規則（單篇目前不顯示，`SHOW_CATEGORY_SCORES`）；聯合報國中稿紙的「寫作能力分析」用它打勾，見 [manuscript.md](manuscript.md)「稿紙上的批改區」。提示詞第 2 版起補了第四向度 5、6 級分怎麼分 |
| 評分依據、判 0 級分的原因、**請老師留意**、系統拿掉了哪些引用、卡片每個字在哪一格 | `simple_grading_result`（migration 012） | **只有老師**（批改頁的「簡易批改」區塊） |

卡片要併進評語，因為這個系統的評語只有一個欄位：老師改評語＝存新的一版，學生端也只讀這一欄。
結構化的卡片照樣存在 `simple_grading_result.detail.cards`（含 `quoteKeys`），第三階段在原稿上畫線用。

**學生端的 API 完全不讀 `simple_grading_result`。** `submission_feedback.content` 只放 `score` 與 `response`（有測試）。

---

## 系統把關（`lib/simple_grading/result.ts`）

- 級分 0～6 整數、有總評、四向度齊全（0 級分除外）；不合格**重批一次**，第二次還不合格回 502、不存。
- 卡片引用必須和辨識全文**逐字相同、每一格都辨識可信、身上沒有錯字標記（包括待確認的）**，
  否則拿掉引用只留評語；密圈一定要有引用，不行就整張不出。拿掉了什麼記在 `checks`，批改頁看得到。
- 成語鼓勵同一條規則，最多 5 個。
- 「重置批改」刪掉這一篇的 `simple_grading_result`；老師手動改級分、改評語不動它。

逐格檢查靠 `pages[].ocr.cells` 重建「每個字在哪一格」。重建結果和存下的 `marked_text` 對不上
（例如辨識服務改版）時，退回只看〔?〕記號 —— 引用照樣檢查，只是不知道格子位置。

---

## 程式位置

| 位置 | 內容 |
|---|---|
| `apps/api/src/lib/simple_grading/essay.ts` | 全文索引、資料模板、確定的錯別字 |
| `apps/api/src/lib/simple_grading/prompt.ts` | 簡易批改的規則、JSON 格式 |
| `apps/api/src/lib/simple_grading/result.ts` | 檢查、逐格驗證引用、組學生看得到的評語 |
| `apps/api/src/lib/simple_grading/grade.ts` | 整條流程、重批、模擬 AI |
| `apps/api/src/dal/simple_grading_helper.ts` | 能不能用、存取 `simple_grading_result` |
| `GET /service/instructor/grading/:id/simple` | 給批改頁：能不能用、辨識摘要、只給老師看的細節 |
| `apps/web/components/SimpleGradingPanel.tsx`、`lib/simpleGrading.ts` | 批改頁的「簡易批改」區塊 |

測試：後端 `src/test/simple_grading.test.ts`，前端 `test/simpleGrading.test.tsx`。

---

## 部署

1. 正式庫先套 `docs/migrations/011-grid-ocr.sql`，再套 `012-simple-grading.sql`（**都要在程式上線之前**）。
2. 不用新的環境變數；用的是一般批改的 `GRADING_MODEL`。
3. 逐格辨識還沒上線（沒設 `GRID_OCR_SERVICE_URL`）時，沒有作文符合條件，簡易批改不會被用到。

## 還沒驗證

- **真的 Gemini 沒跑過**（本機沒有憑證）：分數和一般批改差多少、引用通過的比例、會不會洩漏〔?〕的字、每篇花費。
  1Campus 的建議是拿 10 篇樣本比三件事：和一般批改的級分差、同一篇批兩次的飄移、換模型的差異。
  **學生作文送外部模型前先問過使用者，樣本由使用者決定。**
- 這一題的批改規範和簡易批改的規則接在一起之後，AI 會不會還是照規範的模板輸出（JSON schema 應該擋得住，要實測）。

## 之後

- 第三階段原稿紅筆（老師端）—— 已做，見 [manuscript.md](manuscript.md)：老師確認的錯字才送 AI、重新評分提醒。學生看到原稿加紅筆還沒做。
- 辨識完成度低於 85% 時，批次批改預設跳過（現在只在批改頁提醒）。
