# 稿紙逐格辨識（第一階段：批次代繳交）

老師用「批次代繳交」登錄紙本作文時，照片如果是**《我的稿紙》印出來的稿紙**（四角有定位標記），
就改走逐格辨識；其他照片照舊走 `ocr-job`（[ocr-job.md](ocr-job.md)），**一行都沒改**。

為什麼要逐格：整張丟給 AI 辨識，AI 會自己「順」句子、補字、漏行，老師看不出哪裡被改過。
逐格辨識先用定位標記把稿紙拉正、切成一行一行（每行一張圖、標「第 N 行」），AI 只負責「這一格是什麼字」，
所以每個字都知道在第幾頁第幾行第幾格 —— 之後的簡易批改、在原稿上畫紅筆都靠這個。

流程是從 1Campus Write 搬來的（`gridOcrPipeline.js`），稿紙的定位與切格在 `services/handwriting-ocr`（Python）。

---

## 流程

```
登錄照片   POST /submissions/ocr_proxy
             └─ 先問辨識服務 /check：是我們的稿紙嗎？四角都看得到嗎？      ← 在存 GCS 之前
                  ├─ 稿紙有問題（缺角、太斜、太糊）→ 422，照片不收，老師當場重拍
                  ├─ 是我們的稿紙 → 照常存照片，另寫一列 handwriting_grid_result（pending）
                  └─ 不是／服務沒設定／服務沒回應 → 照舊（之後走 ocr-job）
開始辨識   POST /submissions/ocr_proxy/start
             ├─ 有 grid 那一列的 → markQueued → 觸發 Cloud Run Job grid-ocr-job（env BATCH_ID）
             └─ 其他 → 照舊觸發 ocr-job
背景工作   node dist/jobs/grid_ocr_job.js
             領取（queued→running）→ 讀照片 → /prepare（拉正、切行）
             → Gemini 逐行認字（一次 4 行並行）→ /assemble（排回稿紙、算格式）
             → 找錯別字（Gemini）→ /typos（對回格子）
             → 存拉正的稿紙圖（grid_<batchId>_p<頁>_*.jpg，同一個資料夾）
             → 寫 submission ＋ handwriting_grid_result（done）
看進度     GET /assignments/:id/proxy_status   多帶 grid_status、grid_error（失敗原因給老師看）
```

程式位置：

| 位置 | 內容 |
|---|---|
| `apps/api/src/lib/grid_ocr/pipeline.ts` | 上傳前檢查 `precheckSheets`、整條辨識 `runGridOcr` |
| `apps/api/src/lib/grid_ocr/service_client.ts` | 呼叫 Python 服務（Cloud Run 上自動帶 ID token） |
| `apps/api/src/lib/grid_ocr/ai.ts` | Gemini（提示詞、回應格式由服務的 `/prompts` 提供，兩邊不會不同步） |
| `apps/api/src/lib/grid_ocr/runner.ts` | 跑一批：領取 → 辨識 → 存檔；失敗一律記下來、不往外丟 |
| `apps/api/src/lib/grid_ocr/dispatch.ts` | 背景工作怎麼跑（job／inline／record） |
| `apps/api/src/dal/grid_ocr_helper.ts` | `handwriting_grid_result` 的讀寫 |
| `apps/api/src/jobs/grid_ocr_job.ts` | Cloud Run Job 的進入點 |
| `docs/migrations/011-grid-ocr.sql` | 資料表 |

### 狀態

`handwriting_grid_result.status` 是**明確記下來的**，不像 ocr-job 要從 `ocr_time` 推：

| status | 畫面 | 意思 |
|---|---|---|
| `pending` | 待辨識 | 照片收了，還沒按「開始辨識」 |
| `queued` | 辨識中 | 已送出，背景工作還沒領 |
| `running` | 辨識中 | 跑到一半。**超過 15 分鐘當作失敗**，可以重新辨識（工作中途被關掉會永遠停在這裡） |
| `done` | 已辨識 | 寫進 `submission`，標「AI 辨識未校對」 |
| `failed` | 失敗 | `error_message` 是給老師看的一句話 |

### 幾條規則（都有測試，`src/test/grid_ocr.test.ts`）

- **認出是我們的稿紙之後，就不再退回整張辨識**。逐格失敗就是失敗、告訴老師原因 ——
  退回整張辨識會得到一份「看起來成功」但格子對不上的結果，之後的紅筆會畫錯地方。
- 存結果前**再檢查一次這批還是不是有效的**：辨識途中老師重拍了，舊的結果丟掉（`SUPERSEDED`）。
- **已經批改過的作文不覆寫**（有有效的 `submission_feedback`）。
- AI 回應格式壞掉（`BAD_REPLY`）、整份沒有字（`EMPTY`）記為失敗，不存一份半殘的作文。
- 背景工作的自動重試**不要開**：缺角、AI 回應壞掉，重跑結果一樣，由老師按「重新辨識」。

---

## 部署（要有 GCP 權限的人做）

本機沒有 gcloud／ADC，以下都還沒在雲端跑過。專案 `writing-classroom-672f8`、區域 `asia-east1`。

### 1. 正式庫套 migration 011

由人決定、由人執行（根目錄 `CLAUDE.md`）。測試庫 `writing_classroom_test2`、`writing_classroom_autotest` 已套。

```bash
psql ... -d <資料庫> -f docs/migrations/011-grid-ocr.sql
```

**先套 migration 再部署程式**：`proxy_status` 會 LEFT JOIN 這張表，沒有表會整支壞掉。

### 2. 部署辨識服務 `handwriting-ocr`

```bash
cd services/handwriting-ocr
gcloud run deploy handwriting-ocr --source . --region asia-east1 \
  --no-allow-unauthenticated --memory 2Gi --cpu 2 --timeout 300 --concurrency 4
```

- **不要開放匿名**：服務本身沒有驗證，會收任何人的照片。
- 2Gi：A3 照片拉正、切格時記憶體會衝高。
- 這個服務**不呼叫 AI、不碰資料庫**，不需要任何憑證或環境變數。
- 部署完打 `/healthz`（要帶 ID token）確認 `sheet_ready`。

### 3. 建 Cloud Run Job `grid-ocr-job`

映像檔就是 API 的那一個（`npm run deploy:build` 建出來的），只是指令不同：

```bash
gcloud run jobs create grid-ocr-job --region asia-east1 \
  --image <和 API 同一個映像檔> \
  --command node --args dist/jobs/grid_ocr_job.js \
  --max-retries 0 --task-timeout 900 --memory 1Gi \
  --service-account <和 API 同一個服務帳號> \
  --env-vars-file grid-job-env.yaml        # 用完刪掉
```

環境變數和 API 服務**相同的那幾個**：`NODE_ENV`、`DB_*`、`STORAGE_*`、`GOOGLE_GENAI_USE_VERTEXAI`、
`GOOGLE_CLOUD_PROJECT`、`GOOGLE_CLOUD_LOCATION`，加上 `GRID_OCR_SERVICE_URL`（見下表）。
⚠️ `DB_NAME` 一樣要自己看清楚（[deploy.md](deploy.md) 的 ⛔ 那段）。

每次 API 換新映像檔，job 也要跟著換：`gcloud run jobs update grid-ocr-job --image ...`。

### 4. 權限

| 誰 | 要什麼 | 為什麼 |
|---|---|---|
| API 與 job 的服務帳號 | `handwriting-ocr` 的 `roles/run.invoker` | 呼叫辨識服務（程式從 metadata server 拿 ID token） |
| API 的服務帳號 | `grid-ocr-job` 的 `run.jobs.run`（含 overrides，例如 `roles/run.developer` 或自訂角色） | 觸發背景工作、帶 `BATCH_ID` |
| job 的服務帳號 | Vertex AI 使用者（`ischool-ai` 專案，**跨專案**，和 API 一樣） | Gemini |

### 5. API 服務加環境變數

| 變數 | 值 | 說明 |
|---|---|---|
| `GRID_OCR_SERVICE_URL` | `handwriting-ocr` 的網址 | **沒設就整個不啟用**，所有照片照舊走 ocr-job |
| `GRID_OCR_JOB_NAME` | 可省略 | 預設 `projects/writing-classroom-672f8/locations/asia-east1/jobs/grid-ocr-job` |
| `GRID_OCR_MODEL` | 可省略 | 預設 `gemini-3.8-flash` |
| `GRID_OCR_DISPATCH` | **不要設** | production 自動用 `job` |
| `GRID_OCR_AI_FAKE` | **不要設** | 本機用的模擬 AI；production 下程式會忽略 |

### 6. 上線前實測

1. 用《我的稿紙》印一張聯合報國中稿紙，手寫一段，用手機「掃描稿紙」代繳交 → 開始辨識 → 1～2 分鐘內「已辨識」。
2. 對照原稿看錯字率；`handwriting_grid_result` 的 `ai_calls`、`input_tokens`、`timing` 看成本與時間。
3. 故意遮住一個角拍 → 上傳當下就要跳「重拍」，照片不會存進 GCS。
4. 一般白紙作文照片 → 照舊走 ocr-job。
5. **Gemini 模型要確認**：`gemini-3.8-flash` 在 Vertex 上支援 `responseJsonSchema` 與 `mediaResolution: HIGH`
   （1Campus Write 用的是 AI Studio）。不支援的話，job 的日誌會是 `REJECTED`／`BAD_REPLY`。

---

## 本機開發

```bash
# 辨識服務（第一次：python -m venv .venv && .venv\Scripts\pip install -r requirements.txt）
cd services/handwriting-ocr && set PORT=8090 && .venv\Scripts\python.exe -m gaozhi.service.server
```

API 加上：`STORAGE_FAKE=1`、`GRID_OCR_SERVICE_URL=http://127.0.0.1:8090`、`GRID_OCR_AI_FAKE=simulate`、`GRID_OCR_DISPATCH=inline`
（`.claude/launch.json` 的 `grid-ocr-service` 與 `dev-grid`）。

- 模擬 AI 不辨識，只照服務判斷「有墨跡」的格子填「示範模式模擬辨識」—— 用來測流程，不是測準確度。
- `STORAGE_FAKE=1` 時照片存在 `%TEMP%\udn-writing-fake-storage`，背景工作讀得到；但畫面上的原稿圖仍是 GCS 網址，載不出來是正常的。
- 後端測試 `grid_ocr.test.ts` 會自己起服務（port 18090）；沒有 `.venv` 就整檔跳過。

---

## 之後

- **第二階段：簡易批改** —— 已做，見 [simple-grading.md](simple-grading.md)。用到 `typo_marks`、`format_issues`、
  `completion` 與每格的字。
- **第三階段：原稿紅筆**。`page_image_files` 是拉正後的稿紙圖，格子座標和服務的樣式一致，紅筆直接畫在它上面。
- 學生自己拍照繳交還是走舊的整張辨識。
