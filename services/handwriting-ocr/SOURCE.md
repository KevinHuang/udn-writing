# 來源

## 聯合報雲寫作教室這一份（2026-11-20）

這個資料夾是從 **1Campus Write**（`1Campus_essay_v2` 的 `services/handwriting-ocr`，main 分支 `e20cd34`）
整份複製過來的稿紙產生與逐格辨識服務。目前在聯合報這邊**只拿來產生《我的稿紙》的靜態 PDF**
（`tools/build_static_sheets.py`），還沒有部署；之後做逐格辨識時，部署的就是這一份。

1Campus 那份之後有改（例如英文稿紙，複製時還沒合併進它的 main），要不要跟進由這邊決定；
**聯合報這邊改過的地方**列在下面，跟進時不要被蓋掉：

- `gaozhi/layout.py`、`gaozhi/markerscan.py`、`locate.py`：**第 4 版定位標記**（ID 192～239、樣式代號 4～6），
  給聯合報自己的版型用。1Campus 的樣式代號 0～3 已經用完；分開一組 ID，兩邊的稿紙不會互相認錯。
- `gaozhi/render.py`：
  - 字型**一律先找全字庫正楷體**（`fonts/`），找不到才用 Windows 的標楷體等。PDF 會嵌入字型、發給學校，
    微軟的字型不能這樣散布。（1Campus 那份是 Windows 字型優先，它的雲端本來就只有全字庫正楷體。）
  - 頁面設定可以有 `background`（用另一份 PDF 當底圖；可以整頁照原樣，也可以用 `pieces` 切塊重排），
    樣式可以設 `draw_grid: false`（格子在底圖裡，不另外畫）。
- `gaozhi/sheet.py`：新增格式 `udn`（聯合報國中寫作稿紙）、`ucup`（聯合盃作文大賽稿紙）：照聯合報提供的原稿紙
  （`headers/*_original.pdf`）印，加定位標記（`FIXED_SHEETS`）。聯合盃第一頁的紙用得太滿，切塊重排讓出四角（`UCUP_PAGE1`）。
- `templates/udn.json`、`templates/ucup.json`、`headers/udn_original.pdf`、`headers/ucup_original.pdf`：
  兩種稿紙的格子座標（從原稿紙的向量量的）與底圖。
- `tests/test_udn.py`：上面這些的測試，量的是**印出來的圖**（格線在樣式說的位置 ±0.2mm、標記離任何印刷至少 3mm）；
  `tests/test_service.py` 的格式清單多了 `udn`、`ucup`。
- `tools/build_static_sheets.py`：產生網站上的靜態稿紙（`apps/web/public/sheets/`）。

- 2026-11-27 **整疊掃描的讀座號**，從 1Campus 的 `feat/batch-scan`（`22d5671`，那邊還沒合併進 main）搬來：
  `gaozhi/seatread.py`（新）、`gaozhi/service/core.py`（`seat_scan`）、`gaozhi/service/server.py`（`POST /seat-scan`）、
  `gaozhi/layout.py`（`SEATMARK_MAX_TENS` 5→9）、`gaozhi/render.py`（`el_seatmark` 全黑、線寬 0.7）、`tests/test_seatread.py`（新）。
  **和 1Campus 不一樣的地方**（跟進時不要被蓋掉）：
  - `sheet.SEATMARKS` 多了 `udn`（國中稿紙第 1 頁格子上方靠右；`_fixed` 可以加印劃記）；聯合盃沒有劃記。
  - 會考的劃記 x 是 334.9（1Campus 是 338.4），填寫欄縮成 11pt、往格子靠（`_cap`）。
  - `seatread.CROPS` 改成分頁（格式 → 第幾頁 → 範圍），多了 `udn`、`ucup`；`header_crops` 多一個 `page_index`。
  - `seat_scan` 沒有英文稿紙那一段（這邊沒有英文稿紙）；沒有座號劃記的稿紙照樣回表頭截圖。
  流程見 `docs/batch-scan.md`。

本機跑測試：

```bash
cd services/handwriting-ocr
python -m venv .venv && .venv/Scripts/python.exe -m pip install -r requirements-dev.txt
# 全字庫正楷體放進 fonts/（下載方式同 Dockerfile；fonts/ 不進 git）
.venv/Scripts/python.exe -m pytest -q
```

---

## 1Campus 那份原本的來源說明

這個資料夾是從「作文手寫稿辨識系統」專案（原型，Python）匯出的辨識服務，**不要直接在這裡改程式**：
在原專案修改、測試後，用 `python tools/export_service.py <這個資料夾>` 重新匯出，再開 PR。

- 匯出日期：2026-10-25
- 原專案版本：ef0a9a4（分支 proxy-trial）
- 匯出的程式檔：30 個（清單在原專案 `tools/export_service.py` 的 FILES）

### 匯出後在這裡直接改過、原專案要同步的地方

下次匯出前請先把這些改動補回原專案，否則會被蓋掉：

- 2026-10-27 `gaozhi/grading/typos.py`：`TEXT_THINKING` 由 `"medium"` 改 `"high"`（Enzo 定案「找錯別字」preset 用 thinking 高）。
- 2026-10-27 `README.md`：第 2 節找錯別字的 thinking、第 4 節部署指令（加 `--project`、查 `proxyocrtask`／`api` 兩個服務帳戶、
  `GRID_OCR_SERVICE_URL` 為逐格辨識與稿紙共用、字型授權已確認）、第 5 節現況（本機建置已驗證、Node 端已串接）。
- 2026-10-27 `README.md` 第 4 節：Cloud Run 保留結尾是 `z` 的路徑，`/healthz` 打不到（回 Google 的 HTML 404），
  部署後改用 `/prompts`、`/sheet` 驗證。原專案若要在雲端做健康檢查，建議另開一個不以 `z` 結尾的路徑（例如 `/health`）。
- 2026-10-27 `Dockerfile`：下載全字庫正楷體時關掉 Python 3.13+ 的 `VERIFY_X509_STRICT`（全字庫網站憑證缺
  Subject Key Identifier，原本建置時下載失敗、只印「TW-Kai skipped」，雲端 `/sheet` 回 `RuntimeError`）。
- 2026-10-29 `README.md` 第 2 節：註明 gpt.1campus.net 不能強制 schema，回傳格式改由 Node 端附在請求文字後面。
  原專案建議把回傳格式寫進三個 `SYSTEM`（或 `/prompts` 另給一段格式說明），Node 端就能改用服務提供的文字、不必自己維護一份。
- 2026-11-09 `gaozhi/sheet.py`、`gaozhi/service/server.py`、`tests/test_service.py`、`README.md`：學測稿紙可以只印一題
  （`gsat_question`：知性題＝第 1 頁、情意題＝第 2 頁的格子加表頭與橫排大標題、兩題都印），`output: "png"` 改成每頁一張預覽圖
  （`images`，附是哪一題），`/sheet-options` 多 `gsat_questions`；`/sheet` 改在 `core.PDF_LOCK` 裡產生（PyMuPDF 不能多執行緒同時用）。
- 2026-11-19 `gaozhi/layout.py`、`gaozhi/markerscan.py`、`templates/cap.json`、`tests/test_service.py`、`README.md`：定位標記第 3 版
  （樣式寫 `marker_margins` 時四角離紙邊改成指定的 mm、ID 加 `MARKER_V3_OFFSET`＝64）；會考稿紙 B4 11.5mm、A3 12mm，舊的第 1、2 版照樣能讀。
- 2026-11-20 `locate.py`、`tests/test_service.py`：`identify` 依票數由多到少看，樣式沒有那一版定位標記的票（例如學測稿紙的第 3 版 ID，多半是誤讀）跳過，不再丟例外。
