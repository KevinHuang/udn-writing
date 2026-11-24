# 全系統掃描：操作與邏輯矛盾（2026-11-23）

掃描範圍：`apps/api/src`（路由、DAL、簡易批改、逐格辨識、原稿紅筆）、`apps/web`
（批改清單、批改頁、代繳交、學生端、純邏輯 lib）、`packages/shared`、`docs/migrations`、
以及 `apps/api/public`（線上的舊前端）。兩個專案的 `tsc --noEmit` 都是乾淨的。

這一份只列**互相矛盾**的地方：同一件事在兩處講法不同、畫面承諾的事系統做不到、
或是一條操作會把另一條的保護繞過去。**不含**「還沒做完」的項目（那些在
[`handoff.md`](handoff.md)）。

嚴重度：🔴 會讓老師或學生看到錯的東西／弄丟資料　🟡 會卡住或白做一次　⚪ 不一致但後果輕

---

## 狀態（2026-11-24 更新）

掃描是在 `07ecc59` 上做的。另一個對話（「稿紙與批改功能文件與影片規劃」）在同一天
晚上把其中兩項修掉了，分支上多了三個 commit：

| commit | 對應 |
|---|---|
| `98b67ba` 收回發還 | **第 1 項，已修**（連原稿鎖狀態抓太早的問題一起修了） |
| `32a423a` 清單原稿燈號改用真照片 | **第 3 項，已修**（`originalsState()`，含「讀取中」第三種狀態） |
| `b512234` 晚到的摘要不再蓋掉作文與評語 | **這次沒掃到的一個真 bug**，是 `32a423a` 的前置 |

之後在這個對話裡修的：

| commit | 對應 |
|---|---|
| `4fd8b6b` 重置批改加確認視窗、份數與動作對齊 | **第 2 項，已修**（新 `lib/resetGrading.ts`） |
| `2184c01` 清除繳交一併退役代繳交那一批、文案依作業狀態講實話 | **第 4 項，已修**（`SubmissionHelper.deleteById`、新 `lib/clearSubmission.ts`） |
| 本次（`saveSubscores` 改用具名參數） | **第 10 項，已修**；既有資料的清理是 `docs/migrations/014`（人工決定與執行，不急） |

其餘各項（第 5～9、11～13 項）在 `98b67ba` 上重新確認過，都還沒修。

`b512234` 那個洞值得記一下為什麼漏掉：它不是靜態讀程式看得出來的矛盾，而是
兩層載入（摘要／完整）**回來的先後順序**造成的，要跑起來才會現形。這一份掃描
只讀程式，這一類「時序」問題掃不到。

---

## ✅ 1.（已修於 `98b67ba`）文案叫老師「先收回發還」，但系統沒有「收回發還」這個動作

| | |
|---|---|
| 證據 | `components/ManuscriptViewer.tsx:535`「已發還，只能看；要改請先收回發還。」<br>`routes/instructor.ts:574`、`:618` 回 409「已發還的作文不能再改，要改請先收回發還」<br>`dal/manuscript_helper.ts:40`、`docs/migrations/013-manuscript-mark-decision.sql:25` 同一句話 |
| 事實 | 全 repo 沒有任何地方把 `is_returned` 改回 false（只有測試檔自己改資料庫）。 |

`ManuscriptHelper.isReturned()` 看的是「目前有效那一版批改有沒有發還」，所以唯一能
解開鎖的路徑是**重置批改**——那會連級分、評語、簡易批改的評分依據一起清掉
（見第 2 項）。老師照著畫面上的指示做，找不到那顆按鈕；真的照字面去找的話，
會按到一個比他預期破壞力大很多的鍵。

**建議**：二選一。
(a) 做一支「收回發還」（把有效那一版的 `is_returned` 設回 false，狀態退回已批改，
    `submission_feedback` 不動），文案才對得上；
(b) 把三處文案改成系統真的做得到的話，例如「已發還的原稿不能再改」，並在旁邊
    放「重置批改」的入口與它的代價。

---

## ✅ 2.（已修於 `4fd8b6b`）「重置批改」沒有任何確認，而且對已發還的作品照樣生效

| | |
|---|---|
| 證據 | `components/GradingEditor.tsx:652` 單筆重置：`onClick={() => onResetGrading?.(submission.id)}`，沒有確認視窗<br>`pages/GradingListPage.tsx:456` 批次重置：直接呼叫 `handleBatchReset`<br>`state/AppState.tsx:905`、`:952` 兩支 handler 都沒有確認<br>後端 `dal/submission_feedback_helper.ts:61` `resetBySubmissionId` 不看 `is_returned` |

同一個專案裡，破壞性比它小或相當的動作全部都有確認視窗：清除繳交（`AppState.tsx:975`）、
刪除作業、換題、重新評分（`GradingEditor.tsx` 的 `handleRegrade`）、批次批改遇到未校對。
只有重置批改沒有，而它做的事是：

1. 清掉級分與評語（歷史留著，但畫面與學生端都讀不到）；
2. 連 `simple_grading_result` 一起刪掉（`routes/instructor.ts` 的 `/grading/reset/:id` →
   `SimpleGradingHelper.remove`）——評分依據、請老師留意、卡片的格子位置都沒了，
   而且**沒有任何地方可以復原**；
3. 對**已發還**的作品一樣生效：學生昨天看到的 5 級分與評語，今天靜悄悄變回「批閱中」，
   沒有任何通知。

GradingEditor 的註解寫「已批改或已發還都能重置 —— 發還出去才發現評語寫錯是常有的事」，
意圖沒問題；問題是它同時是「解開原稿紅筆鎖」的唯一路徑（第 1 項），所以老師會在
不知道代價的情況下按它。

**建議**：加確認視窗，而且已發還的要另外寫一句「學生已經看到的成績會被收回」。
文案裡把「評分依據與請老師留意會一起刪掉」講出來。

---

## ✅ 3.（已修於 `32a423a`）批改清單的「有原稿／無手寫原稿」是用 id 的奇偶數假裝的

| | |
|---|---|
| 證據 | `pages/GradingListPage.tsx:229` `const hasDraft = (id) => id.charCodeAt(id.length - 1) % 2 === 0;`<br>用在 `:565`→`:639`（手機卡片的「有原稿」）與 `:729`→`:781`（桌機表格那顆綠／紅燈） |
| 對照 | `components/GradingEditor.tsx:220` 已經改成真資料：`const hasDraft = draftImages.length > 0`，註解還寫著「這裡以前是 `charCodeAt(...) % 2`——**用 id 末字元的奇偶數在假裝**」 |

同一個假邏輯在批改頁被修掉了，清單這一份沒有跟著改。結果是：清單上亮綠燈寫
「有手寫原稿」，點進去按鈕卻是灰的、提示「學生未上傳手寫原稿」，反之亦然——
而且剛好有一半的學生會對。

資料本來就在手上：選定作業時 `ensureSubmissions()` 會補完整的繳交（含 `pic_files`），
`rosterOf()` 回來的每一列都有 `picFiles`。

**建議**：`const hasDraft = (s) => (s.picFiles?.length ?? 0) > 0`，和批改頁同一條規則。

---

## ✅ 4.（已修）「清除繳交」不會退役代繳交的那一批，被清掉的作文會自己回來

| | |
|---|---|
| 證據 | `dal/submission_helper.ts` `deleteById()` 只刪 `submission_feedback` 與 `submission`（`submission_mark` 靠外鍵）<br>`batch_proxy_submission` 沒有被退役，`handwriting_grid_result` 也還在（它的外鍵只接到 batch）<br>`dal/batch_proxy_submission_helper.ts:135` `statusOf()` 只篩 `is_valid = true`，submission 是 LEFT JOIN |

清除之後會發生三件事：

1. 批改清單那一列的繳交狀態變成「未繳交」，旁邊卻還掛著代繳交的徽章——逐格辨識的
   那批顯示「AI 辨識未校對」（`grid_status='done'`），舊 ocr-job 那批顯示「辨識失敗」
   （`ocr_time` 有值但 submission 已經沒了 → `lib/proxy/status.ts` 判成 failed）。
   兩個維度互相打臉。
2. 老師在代繳交視窗按那位學生的「重試」（單人重試固定帶 `force`）→
   `GridOcrHelper.saveDone()` 的 `INSERT ... WHERE NOT EXISTS` 會把**剛剛清掉的作文
   整篇寫回來**（`dal/grid_ocr_helper.ts` saveDone）。老師會以為自己清除失敗。
3. 「清除繳交」的文案說「學生可以重新繳交」，但學生那邊只要作業已截止又不收遲交，
   `routes/student.ts` 的 409 就會擋住他（`AppState.tsx:975` 的訊息 vs `student.ts` 的
   `opened/deadline` 檢查）。這句承諾只在收件中的作業成立。

**建議**：`deleteById()` 的交易裡一併 `UPDATE batch_proxy_submission SET is_valid = false`
（語意就是「這批不是現行的了」，和校對完成同一個做法），並把文案改成
「這份作業還在收件的話，學生可以重新繳交」。

---

## 🟡 5. 換題與刪作業的連鎖清理沒跟上 011／012／013 三張新表

| | |
|---|---|
| 證據 | `dal/assignment_helper.ts` `updateTask()`（換題）與 `deleteById()`（刪作業）只清 `submission_mark`、`submission_feedback`、`submission` |
| 沒清到 | `batch_proxy_submission`（沒有接到 assignment 的外鍵）、`handwriting_grid_result`（外鍵只接 batch）、`manuscript_mark_decision`（接 grid）、`simple_grading_result`（**一條外鍵都沒有**，見 `docs/migrations/012:32`） |

最有感的後果在換題：`SimpleGradingHelper.gridForSubmission()`（`dal/simple_grading_helper.ts:36`）
是用 **(作業, 學生)** 配對去找逐格辨識結果的，不是用 submission id。所以換題之後學生
重新交一篇新題目的作文，批改頁的「原稿」有機會撈到**舊題目**那次拍的稿紙照片與紅筆標記
（`GET .../manuscript` 只檢查有沒有 grid，不比對文字）。

`apps/web/CLAUDE.md` 有一整節在講「孤兒標記」踩過的坑，`assignment_helper.ts` 自己的註解
也列了一張「哪些要手動刪」的表——那張表停在 migration 001 的年代。

**建議**：兩支刪除路徑都補上這四張表（或替 `simple_grading_result.ref_submission_id`
與 `handwriting_grid_result` 補外鍵），並把註解裡那張表更新到 013。

---

## 🟡 6.「全部重試失敗的 N 位」對它最該處理的那種失敗完全無效

| | |
|---|---|
| 證據 | `components/ProxySubmitModal.tsx:765` 全部重試：`start(toRetry)`（`force` 預設 false）<br>同檔 `:805` 單人重試：`start([s.studentId], true)`<br>`routes/instructor.ts` `/ocr_proxy/start`：`if (b.ocr_time && !force) → skipped: 'already_done'` |

路由的註解明寫 `force` 的用途是「重試『辨識出來是空的』那種失敗」——而那正是
`lib/proxy/status.ts` 判成 failed 的主要情形（`ocr_time` 有值但沒有文字）。
按單人的「重試」會動，按「全部重試失敗的 N 位」則全部被 skip，畫面只回一句
「沒有需要辨識的學生。」老師會以為系統壞了。

**建議**：`start(toRetry, true)`。兩顆按鈕的語意是同一件事，不該一個帶 force 一個不帶。

---

## 🟡 7. 逐格辨識卡在 queued 沒有出口，畫面會永遠停在「辨識中」

| | |
|---|---|
| 證據 | `dal/grid_ocr_helper.ts` `markQueued()` 的逾時條件只有 `status = 'running' AND started_at < now() - 15min`<br>`lib/proxy/status.ts` 把 `gridStatus === 'queued'` 一律對應成 `running`（顯示「辨識中」），而逾時判斷只套在 `gridStatus === 'running'`（要有 `gridStartedAt`） |

`queued → running` 是 Cloud Run Job 自己領取時才改的（`GridOcrHelper.claim()`）。
job 啟動成功但在領取前就掛掉（映像檔、配額、容器崩潰），那一列就永遠是 queued：
前端顯示「辨識中」、不算逾時、沒有「重試」按鈕（重試只出現在 failed），
後端也沒有任何東西會把它收掉。15 分鐘的 stale 規則剛好漏掉這一格。

**建議**：stale 判斷改成「queued 或 running 超過 N 分鐘」，時間基準用 `updated_at`
（queued 時有更新），前端的 `GRID_STALE_MS` 跟著對上。

---

## 🟡 8. 批次批改前的「未校對」警告，和簡易批改的設計互相矛盾

| | |
|---|---|
| 證據 | `pages/GradingListPage.tsx:517`：「…還沒有人對照原稿校對過。辨識一定會有錯字 —— 直接批改的話，分數會建立在錯的文字上。建議先點進去對照原稿校對，再批改。」<br>`components/GradingEditor.tsx:407-420`：同一篇作文在批改頁顯示的是另一句——`simpleInfo.eligible` 時改成 `lib/simpleGrading.ts` 的 `PROOFREAD_NOTE`：「按『AI 批改』會用簡易批改：辨識不確定的字不會被引用或批評。若先校對改過文字，就改用一般批改。」 |

批改頁已經分辨「稿紙逐格辨識」與「舊的整張辨識」，批次那一關沒有分：
`unproofreadInBatch`（`:193`）只看 `proxy.isUnproofread()`，而它等於「辨識完成」。
於是老師在清單上被勸去做一件在批改頁被告知「不是必要、而且做了會改用一般批改」的事。

**建議**：`unproofreadInBatch` 排除逐格辨識（`gridStatus` 有值）的那幾位，或至少把
那段文案依 `gridStatus` 分成兩種講法。

---

## 🟡 9. 老師代繳交／校對存檔的字數，和學生自己繳交算法不同

| | |
|---|---|
| 證據 | `api/submissions.ts:190` `proxySubmit()`：`word_count: content.length`<br>同檔 `submitEssay()`：`word_count: opts.wordCount ?? countWords(content)`<br>`lib/wordCount.ts` 的註解正是在講這個坑：「以前 `submitEssay()` 另外用 `content.length` 送出 —— 同一篇作文，畫面顯示 246，資料庫存 252」<br>逐格辨識寫回時用的是去掉空白的字數（`dal/grid_ocr_helper.ts` 的 `words`） |

學生端修好了，老師端兩條路（代繳交、校對文字存檔）還是 `content.length`，把換行與
空格都算進去。老師校對完一存檔，那篇的字數就會跳高（校對的文字通常有分段換行），
而成績管理與「不足 100 字」的判斷讀的都是資料庫那一欄。

**建議**：`proxySubmit()` 改用 `countWords(content)`。這是 `CLAUDE.md`「同一份資訊不要在
多處各自解析」的第五次。

---

## ✅ 10.（已修）`saveSubscores()` 的參數接錯位，token 欄位存的是別的東西

```sql
-- apps/api/src/dal/submission_feedback_helper.ts:73-88
SET sub_scores = $4::jsonb,
    sub_scores_input_tokens  = $1,   -- ← $1 是 feedback_id
    sub_scores_output_tokens = $2,   -- ← $2 是 inputTokens
    sub_scores_time = now()
WHERE id = $1
```

呼叫時傳的是 `[feedback_id, inputTokens, outputTokens, sub_scores]`
（`routes/admin.ts:191`，管理員的四向度批次補分）。所以：
`sub_scores_input_tokens` 存進去的是 **feedback id**、`sub_scores_output_tokens` 存的是
input tokens、`outputTokens` 根本沒被寫入。`WHERE id = $1` 剛好是對的，所以功能看起來正常，
只有花費統計是錯的（而且數字很大，看起來像真的）。

**建議**：`$2`／`$3` 往後挪一格，`WHERE id = $1` 不動。

---

## ⚪ 11. 兩套「取消繳交」並存，而線上的舊前端用的是破壞性比較大的那一支

| | |
|---|---|
| 證據 | 新前端：`DELETE /service/instructor/submissions/:id` → `SubmissionHelper.deleteById()`（整筆刪掉）<br>舊前端：`apps/api/public/assets/*.js` 裡確實有 `instructor/submissions/${r}/reset` → `routes/instructor.ts:206` → `SubmissionHelper.resetSubmissions()`（把 `ref_user_id` 變成負數）<br>`app.ts:69` 仍然把 `public/` 當靜態站台送出去 |

`resetSubmissions()` 自己的註解寫得很清楚：「系統裡**沒有任何地方會讀負數的
`ref_user_id` 把它轉回來**…唯一的還原是再打一次」。也就是同一個資料庫上，
同一個操作在兩個畫面有兩種結果：一個是真的刪掉（學生可重交），一個是把作品
從所有查詢裡隱形（且 `handwriting_grid_result`、`batch_proxy_submission` 全部留著）。

**建議**：舊前端退場前，至少讓 `/submissions/:id/reset` 內部改走 `deleteById()`，
或在文件裡標明它是舊前端專用、新前端不要再接。

---

## ⚪ 12. 稿紙上印「寫作能力分析」的四向度勾選，但老師在批改頁看不到也改不了

| | |
|---|---|
| 證據 | `lib/features.ts` `SHOW_CATEGORY_SCORES = false`（單篇的四向度在批改頁與學生端都不顯示）<br>`lib/gradingZone.ts` `sheetLevels()` 用 `result.categoryScores` 在稿紙第二頁勾極佳／佳／尚可／待加強，`ManuscriptViewer` 畫出來 |

老師看不到那四個分數、也沒有地方能改（`handoff.md` 4-5「還沒做：老師改四向度」），
但那四個勾會印在學生拿到的稿紙上。老師改了整體級分，勾選不會跟著動
（`saveFeedback` 的 `sub_scores` 沿用上一版，這是刻意的），於是會出現
「級分 5、四向度全勾極佳」這種對不起來的紙。

**建議**：要印就讓老師看得到＋改得動；暫時不做的話，稿紙那一區先留白
（留白看得見，猜錯看不見）。

---

## ⚪ 13. 兩支範圍不一致的教師端查詢

- `GET /service/instructor/courses`（`routes/instructor.ts:1408`）還在用
  `CourseHelper.getByInstructorUserId(userId)`，管理人員一門課都看不到；
  新前端走的是 `/service/courses`（`routes/course.ts:39`，已經用 `courseScopeOf`）。
  同一份 `CourseHelper.getByScope()` 就在隔壁，註解也說「回傳完全相同的欄位」。
  目前只有舊前端會打到那一支，但它是下一個「管理人員看到空白」的候選人。
- `GET /service/instructor/school-courses`（`:88`）同樣的老問題，`handoff.md` 第 5 項已記。
- `POST /service/student/submit` 只檢查作業開不開放，**沒有檢查這位學生在不在這個班的
  名冊上**（`routes/student.ts`）。寫進去的那一列不會出現在任何教師畫面
  （名冊是 JOIN `uc_learner`），所以看不出症狀，但它是教師端兩支代繳交補過的同一類洞。

---

## 掃過、確認沒有矛盾的地方

- 狀態推導只有一份（`packages/shared/derive.ts`），前後端都讀它；顏色與文字也只有
  `lib/statusStyles.ts` 一份。
- 繳交／代繳交／逐格辨識三條寫入路徑都有「已批改的不覆寫」那道擋，而且都擋在 SQL 的
  WHERE 裡（沒有先查再寫的空隙）。
- 教師端的範圍檢查：批改、發還、重置、代繳交、名冊、標記、請假、期末總結、分數表都走
  `courseScopeOf()`，且條件寫在 SQL 內。
- 自動蓋佳作「每篇只判斷一次」靠 `submission_mark_auto` 的 ON CONFLICT，重置批改之後
  重批也不會再蓋第二次。
- 學生端在發還前拿不到分數與評語（`assignment_helper.getAssignments` 的
  `CASE WHEN fb.is_returned`、`submission_feedback_helper.getBySubmissionId` 的
  `is_returned = true`）。
- 換題的擋件（收件中不能換）前後端同一條規則；截止判斷前後端同一條規則。
- 逐格辨識的 15 分鐘 stale 常數前後端一致（漏的只有 queued 那一格，見第 7 項）。
- 原稿紅筆的「確定的錯別字只有一份」成立：簡易批改、重新評分、稿紙訂正欄都走
  `lib/manuscript/marks.ts` 合併後的結果。
- `apps/api` 與 `apps/web` 的 `tsc --noEmit` 都沒有錯誤。
