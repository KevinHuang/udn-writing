# 批次代繳交的背景辨識（Cloud Run Job `ocr-job`）

老師用「批次代繳交」登錄紙本作文時，照片**先上傳、後辨識**：

```
登錄照片   POST /service/instructor/submissions/ocr_proxy        存 GCS ＋ 寫 batch_proxy_submission（不辨識）
開始辨識   POST /service/instructor/submissions/ocr_proxy/start  逐位觸發 ocr-job（重試也是這一支）
看進度     GET  /service/instructor/assignments/:id/proxy_status  輪詢用，不含作文全文
校對完成   POST /service/instructor/submissions/proxy  { confirm_ocr: true }  批次退役
```

真正做辨識的是 Cloud Run Job **`ocr-job`**，**它的原始碼不在這個 repo**。
這個 repo 只負責觸發它（`apps/api/src/dal/cloud_run_jobs_helper.ts`），
再從資料表上的痕跡推斷結果（`apps/web/lib/proxy/status.ts`）。

---

## ⚠️ 上線前要確認的事

目前的狀態推導是**依假設寫的**。請有 GCP 權限的人在測試環境對
**一位學生、一張照片**跑完整流程，然後看資料：

```sql
SELECT * FROM batch_proxy_submission ORDER BY id DESC LIMIT 1;
SELECT id, content, word_count, pic_files, is_submitted, submited_time, last_update
  FROM submission WHERE ref_user_id = <學生> AND ref_assignment_id = <作業>;
```

```bash
gcloud run jobs executions list --job ocr-job --region asia-east1 --limit 5
gcloud logging read 'resource.type="cloud_run_job" resource.labels.job_name="ocr-job"' --limit 50
```

| # | 問題 | 程式目前的假設 | 答案不同時要改哪裡 |
|---|---|---|---|
| 1 | job 靠什麼找到要辨識的那一批？`batchUUID`，還是「該生該作業、`is_valid`、`ocr_time IS NULL`」？ | 用 env 帶的 `batchUUID` | 重試是「同一批再觸發一次」；若 job 只撿 `ocr_time IS NULL` 的，`force` 重跑已完成的那種會無效 |
| 2 | `img_files` 當**裸檔名**還是相對路徑？自己補 `submit/assign_<id>/` 嗎？ | 裸檔名，job 自己補資料夾 | 後端**刻意沒有統一格式**，不要改 |
| 3 | 成功時寫哪些欄位？ | `ocr_time`（＋ `ocr_model`、tokens） | `lib/proxy/status.ts` |
| 4 | 寫 `submission` 的哪些欄位？會不會覆寫學生自己存的草稿？有沒有寫 `pic_files`？ | 寫 `content`；`pic_files` 可能沒寫（前端已退回用批次的照片顯示原稿） | 若會覆寫草稿，要在觸發前擋 |
| 5 | **失敗**時做什麼？照樣寫 `ocr_time` 嗎？ | 可能照寫 —— 所以「完成」要 `ocr_time` **且** submission 真的有文字 | `lib/proxy/status.ts` |
| 6 | 有沒有擋「已經批改過」？ | 不確定。`SubmissionHelper.submit` 有那道 409，job 若直接 UPDATE 就繞過了 —— 分數會指向一段不存在的文字 | 若沒擋，要在 `/ocr_proxy/start` 跳過已批改的 |
| 7 | 一次 execution 幾分鐘？重複觸發同一批會不會寫出兩份文字？並行配額多少？ | 逾時 10 分鐘（`OCR_TIMEOUT_MS`）；同時觸發 3 個（`OCR_START_CONCURRENCY`） | 兩個常數 |

---

## 狀態怎麼推

`apps/web/lib/proxy/status.ts`，時鐘用**伺服器時間**（`proxy_status` 回的 `now`）：

| 狀態 | 判定 |
|---|---|
| 待辨識 | 有有效批次、`ocr_time` 空、`last_update = created_at`（還沒按開始） |
| 辨識中 | 同上但 `last_update > created_at`，而且還沒超過逾時 |
| 已辨識（＝AI 辨識未校對） | `ocr_time` 有值 **且** submission 有文字 |
| 失敗 | `ocr_time` 有值但沒文字，或按了開始之後超過逾時還沒結果 |

- **逾時從 `last_update` 算，不是 `created_at`**：老師拍完一整班才按開始，
  第一位的 `created_at` 可能早二十分鐘。
- 「有沒有按過開始」不存在瀏覽器裡：`touchTriggered` 只推 `last_update`，
  兩台裝置看到同一個答案。

## 「未校對」怎麼消失

老師在批改頁按「校對文字」→ 存檔時帶 `confirm_ocr: true` → 該批 `is_valid = false`。
批改清單的「AI 辨識未校對」徽章消失，每小時的自動 OCR 也不會再撿走它。
批次批改遇到未校對的作品會先跳確認。

---

## 本機開發

本機沒有 GCP 憑證。兩個 fake 都要**明確開啟**，`NODE_ENV=production` 時一律無效：

```bash
# repo 根目錄的 .env
STORAGE_FAKE=1           # 照片不存 GCS（回一個形狀一樣的假檔名）
OCR_JOB_FAKE=simulate    # 不開 Cloud Run job；6 秒後寫回一段「示範模式」文字
```

`OCR_JOB_FAKE=1` 只記錄呼叫、不寫回（測試用，見 `apps/api/src/test/setup.ts`）。
`simulate` 寫回的方式是**猜的**，只為了讓畫面走得完，不代表真的 job 也這樣寫。
假檔名的照片在畫面上會是破圖，這是正常的。
