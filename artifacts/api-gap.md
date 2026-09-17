# API 落差清單

Phase 4 的第一步。比對 `apps/api` 既有的 endpoint 與 `apps/web` 每個畫面的需求，
**先給人看過再動工**（見 `artifacts/spec.md` Phase 4）。

最後更新：2026-09-16

---

## 結論先講

落差有三層，**只有第二層是「缺 endpoint」**，另外兩層更花工，卻容易在估算時被漏掉：

| 層次 | 是什麼 | 影響範圍 |
|---|---|---|
| ① 形狀 | 後端回傳的是 **snake_case 的資料庫列**，前端型別是 camelCase 的領域物件 | **每一個資源** |
| ② 功能 | 前端有、後端完全沒有的東西 | 5 項，全部卡 migration |
| ③ 語意 | 同一個概念兩邊定義不同 | 4 處，改起來要碰既有 SQL |

**現有 endpoint 的覆蓋率其實不差** —— 課程、題目、作業、繳交、批改的主要動作都有。
真正的工作量在把兩邊的資料模型對起來。

---

## ① 形狀落差

後端目前直接把查詢結果吐出去。以作業為例：

| `AssignmentHelper.getAssignmentsByCourseId` 回傳 | `Assignment`（前端） |
|---|---|
| `id`（bigint → 字串） | `id: string` |
| `ref_course_id` | `courseId` |
| `ref_task_id` | `questionId` |
| `assigned_at` | `createdAt` |
| `opened` / `opened_at` | `status: 'Published' \| 'Draft' \| 'Closed'` ＋ `publishedAt` |
| `week_no` | （不使用，見 ③） |
| `task_title` | `title` |
| — | `config: { deadline?, allowLateSubmission? }` ← 欄位還不存在 |
| — | `totalStudents` ← 要另外算 |
| — | `order` ← 欄位還不存在 |

課程、繳交、批改結果都是同樣的情形。

### ✅ 已決定：**方案 B —— 前端 api client**

| 方案 | 做法 | 代價 |
|---|---|---|
| **A. 後端轉** | endpoint 直接回傳前端型別的形狀 | 前端元件一行都不用改，但**會改掉現有回應的形狀** |
| **B. 前端轉** | `apps/web` 加一層 api client 負責對應 | 不動後端，風險最低 |
| **C. 版本化** | 保留舊形狀，另開一組新 endpoint | 兩套要同時維護 |

⛔ **方案 A 有一個現在還不能忽略的問題**：`apps/api/public/` 那份舊前端
**目前是上線中的**，而它就是吃現在這個形狀。改掉回應形狀會讓線上壞掉，
直到新前端一起上線為止。

在 `apps/web/api/` 放一層薄薄的 client，每個資源一支
`fetchCourses()` / `fetchAssignments()`，負責呼叫與對應。理由：

1. **對舊前端零風險** —— 後端完全不動。
2. **對應集中在一處**。`CLAUDE.md` 那條「同一份資訊不要在多處各自解析、
   在入口解析一次」講的就是這件事；api client 就是那個入口。
3. **它正好是 `state/AppState.tsx` 要換掉的那一層**。Phase 3 已經把全站資料
   收斂到那個檔案，現在只要把 `usePersistentState` 換成這些 fetch 就好，
   元件完全不知道有事發生。
4. 等舊前端退場（開放問題 4），要把對應搬到後端隨時可以，**那時候才是
   零風險的時機**。

---

## ② 功能落差：前端有、後端完全沒有

**這五項全部卡在 `docs/migrations/001-prototype-gaps.sql` 的審核**（含外鍵那個決定）。
migration 沒過就沒有表可以寫。

| 前端功能 | 實作位置 | 後端現況 | migration 後要新增的 endpoint |
|---|---|---|---|
| 題庫**資料夾**樹 | `lib/folders.ts`、`QuestionBank.tsx` | ❌ 完全沒有 | folders 的 CRUD、`task.ref_folder_id` |
| 作品標記（佳作／預選） | `lib/submissionMarks.ts` | ❌ 完全沒有 | 蓋章／取消、依作業查標記 |
| 請假註記 | `lib/leave.ts` | ❌ 完全沒有 | 設定／取消請假 |
| 作業**截止日** | `lib/assignments.ts` 整套 | ❌ 欄位不存在 | 併進作業的建立／更新 |
| 作業**拖拉順序** | `lib/assignmentOrder.ts` | ❌ 欄位不存在 | 重新排序 |

---

## ③ 語意落差：同一個概念，兩邊定義不同

這一類最危險 —— 兩邊都「有」，但意思不一樣，**不會有任何錯誤訊息**。

### 3.1 作業順序：`week_no` vs `sort_order`

`AssignmentHelper.getAssignmentsByCourseId` 現在是 `ORDER BY ass.week_no ASC`。
但時間模型已決定**以原型為準**（截止日 + 教師拖拉排序），`week_no` 不使用。
→ 這支 SQL 的排序要改成 `sort_order`（migration 後）。

### 3.2 繳交狀態要用推導的

`SubmissionStatus` 的五個值在資料庫裡不存在，要從三張表推出來
（規則見 `artifacts/spec.md` 第 3 節）。

**這支推導函式要放在 `packages/shared`，前後端共用一份。**
兩邊各寫一次，狀態判斷遲早會漂移 —— 而漂移的症狀是「老師看到已批改、
學生看到待批改」這種沒人會聯想到根因的 bug。

### 3.3 學期

前端的 `currentSemester` 是寫死的字串（`mockData.ts` 的 `SEMESTER_OPTIONS`），
schema 的 `course` 是 `school_year`（整數）+ `semester`（整數），
另外還有一張帶起訖日的 `semesters` 表。
→ 需要一支 endpoint 回傳學期清單，以及一個雙向的格式對應。

### 3.4 名冊與座號

前端的 `rosters` 是 `Record<courseId, { seatNo, name }[]>`，
後端的 `/instructor/courses/:courseId/students` 回傳的是資料庫列。
座號在 `uc_learner.seat_no`。→ 形狀對應，另外要注意前端目前是**整包**拿，
接上 API 之後會變成逐課程查詢。

---

## 資源逐一對照

✅ 可用　⚠️ 要改　❌ 要新增

| 前端需要 | 既有 endpoint | 狀態 | 說明 |
|---|---|---|---|
| 目前身分 | `GET /auth/me` | ✅ | |
| 身分清單（切換用） | `GET /service/user/my_identity` | ✅ | Phase 2 修好了少 `await` 的 bug |
| 課程清單 | `GET /service/courses` | ✅ | Phase 4 新增。**依目前身分決定範圍**，管理者全部、教師只有自己的 |
| 課程 CRUD | `POST/PUT/DELETE /service/instructor/courses` | ⚠️ | 形狀；刪除的連鎖清理要驗（**沒有外鍵**） |
| 可匯入的課程 | `GET /service/instructor/school-courses` | ✅ | Phase 2 新增（C 方案） |
| 校務同步 | `POST /service/admin/sync/school` | ⚠️ | 目前寫死 `dsns` 與學年期 |
| 班級名冊 | `GET /service/instructor/courses/:courseId/students` | ✅ | 依課程延遲載入，不預先全抓 |
| 題目清單／CRUD | `GET/POST/PUT/DELETE /service/instructor/tasks` | ✅ | migration 002 補齊五個欄位 |
| 題目封存 | `PUT /service/instructor/tasks/:id/archived` | ✅ | Phase 4 新增 |
| 單一題目 | `GET /service/task/:id` | ✅ | |
| 題庫資料夾 | `GET/POST/PUT/DELETE /service/instructor/folders` | ✅ | Phase 4 新增 |
| 作業清單（依課程） | `GET /service/instructor/courses/:id/assignments` | ✅ | 排序改 `sort_order`，**並補上先前缺的授權** |
| 作業清單（依教師） | `GET /service/instructor/assignments` | ✅ | 補上 `opened` / `deadline` / `sort_order` |
| 建立作業 | `POST /service/instructor/courses/:id/assignments` | ✅ | 含截止日；**派進別人的班回 403** |
| 開關作業 | `PUT /service/instructor/assignments/:id/status` | ✅ | |
| 換題 | `PUT /service/instructor/assignments/:id/task` | ✅ | |
| 作業重新排序 | `PUT /service/instructor/courses/:id/assignments/order` | ✅ | Phase 4 新增 |
| 作業截止日設定 | `PUT /service/instructor/assignments/:id/config` | ✅ | Phase 4 新增 |
| 刪除作業 | `DELETE /service/instructor/assignments/:id` | ✅ | Phase 4 新增，**含連鎖清理** |
| 學生的作業清單 | `GET /service/student/my_assignments` | ⚠️ | 形狀 |
| 學生繳交 | `POST /service/student/submit` | ✅ | |
| 學生看批改結果 | `GET /service/student/submission_feedback` | ⚠️ | 形狀 |
| 某作業的繳交狀況 | `GET /service/instructor/assignments/:id/submissions` | ✅ | 補上 `is_submitted` / `seat_no`，並收緊挑「有效批改」的 SQL |
| 單筆批改（AI） | `POST /service/instructor/grading/:submissionId` | ✅ | |
| 存批改結果 | `POST /service/instructor/submissions/:id/feedback` | ⚠️ | 形狀 |
| 重置批改 | `POST /service/instructor/grading/reset/:id` | ✅ | |
| 發還 | `POST /service/instructor/submission_feedback/return` | ✅ | |
| 代繳交 | `POST /service/instructor/submissions/proxy` | ✅ | |
| 代繳交 OCR | `POST /service/instructor/submissions/ocr_proxy` | ✅ | |
| 清除繳交 | `DELETE /service/instructor/submissions/:id` | ✅ | Phase 4 新增，含連鎖清理 |
| 作品標記 | `GET /service/instructor/marks`、`PUT /submissions/:id/marks/:kind` | ✅ | Phase 4 新增 |
| 請假註記 | `GET /service/instructor/leaves`、`PUT /assignments/:id/leaves/:studentId` | ✅ | Phase 4 新增 |
| 成績統計 | `GET /service/instructor/courses/:cid/tasks/:tids/scores` | ⚠️ | 形狀 |
| 期末總結 | `GET /service/instructor/courses/:cid/finalReports` | ✅ | 前端沒有畫面 → **Phase 6** |
| 學期清單 | `GET /service/semesters` | ✅ | Phase 4 新增 |
| 儀表板統計 | — | ❌ | `/instructor/dashboard/stud_count` **整段被註解掉** |

### 批次操作

前端有四個批次動作（`handleBatchGrade` / `handleBatchPublish` / `handleBatchReset` /
`handleProxySubmit`），後端**只有單筆的 endpoint**。

→ 先用前端迴圈逐筆呼叫（簡單、進度條也好做），確認會不會太慢再決定要不要做批次 endpoint。
**不要一開始就做批次** —— 批次 endpoint 的錯誤處理（一半成功一半失敗）比想像中麻煩，
而且目前一個班只有二三十人。

---

## 建議的施工順序

一個資源做完（後端調整 + 測試 + 前端接上）才做下一個。

| # | 資源 | 卡 migration？ |
|---|---|---|
| 1 | 身分與可視範圍（`/auth/me`、`my_identity`、身分切換） | ✅ **已完成** |
| 2 | 學期清單 | ✅ **已完成** |
| 3 | 課程 + 名冊（校務同步除外，見開放問題） | ✅ **大致完成** |
| 4 | 題目 | ✅ **已完成**（migration 002 套用後） |
| 5 + 9 | 作業**含**截止日與拖拉排序 | ✅ **已完成** |
| 6 + 10 + 11 | 繳交、狀態推導、作品標記、請假、清除繳交 | ✅ **已完成** |
| 7 | 批改結果 + 發還 + 重置 | ✅ **已完成** |

**9／10／11 已經併進 5 與 6。** migration 001 套用之後，截止日與排序本來就是
作業的欄位、標記與請假本來就掛在繳交上 —— 分開做等於同一段程式改兩次。
| 8 | 題庫資料夾 | ✅ **已完成** |

**1～7 完全不需要等 migration。** 做完這七項，主要流程
（派作業 → 學生繳交 → 老師批改 → 發還 → 學生看成績）就能整條跑在真資料上。

---

## 施工中發現的開放問題

### ✅ 資源 7 的模型已確認：**版本，不是欄位**

任何時刻一份繳交最多只有一筆 `is_valid = true`，`is_ai` 標示那一版是 AI 產的
還是教師改的。教師「修改評語」= 把舊的全部設為失效 + 寫一筆 `is_ai = false`
的新版本。學生只看得到目前有效的那一筆。

**所以不需要新欄位。** 前端要跟著改：

| 前端目前 | 要變成 |
|---|---|
| `aiFeedback`（可編輯）＋ `teacherFeedback`（另一欄） | **一個** `feedback` 欄位 + `isAi` 標示作者 |
| `suggestions: string[]` 獨立區塊 | 拿掉 —— 建議本來就在 markdown 報告裡 |
| 純文字渲染 | **markdown 渲染**（後端存的是 markdown，直接印會看到滿螢幕的 `###`） |

⚠️ `apps/web` **沒有 markdown 套件**，而且 `prose` 這些 class 也沒有裝
Tailwind 的 typography plugin —— 程式裡寫了但不產生任何樣式。兩個都要補。
（已上線的舊前端 bundle 裡有 `marked`，所以舊系統是有渲染的，新前端漏掉了。）

### 原本記錄的落差（保留給對照）

#### 批改結果的欄位對不起來

前端的 `GradingResult` 有六個欄位，資料庫的 `submission_feedback` 只有一團 markdown：

| 前端 | 資料庫 | 能不能對應 |
|---|---|---|
| `totalScore` | `score` | ✅ 直接對應（0–6 級分） |
| `isPublished` | `is_returned` | ✅ |
| `categoryScores`（四項） | `sub_scores` jsonb | ⚠️ 實際資料多半是 `null`；而且前端的 `SHOW_CATEGORY_SCORES` 是關的 |
| `aiFeedback` | `content` → `{ raw_score, score, response }` 的 `response` | ⚠️ 是**一整份 markdown 報告**，不是一段評語 |
| `teacherFeedback` | — | ❌ **沒有獨立欄位** |
| `suggestions: string[]` | — | ❌ **沒有**，建議夾在 markdown 裡 |

教師修改批改結果時，後端的做法是**另存一筆 `is_ai = false` 的紀錄**並讓舊的失效
（`saveFeedback`）—— 也就是「AI 的評語」與「老師的評語」在資料上是**同一個欄位的
兩個版本**，不是兩個並存的欄位。但前端是把兩者同時顯示的。

**需要決定**（見報告）：
1. `teacherFeedback` 要不要獨立欄位（migration 003），還是前端改成「只顯示目前有效的那一份，標示它是誰寫的」？
2. `suggestions` 要不要拆出來，還是接受它留在 markdown 裡？


### ⛔ 最重要：「形狀落差」在好幾處其實是「欄位不存在」

落差清單原本把題目、作業、繳交都歸在 ①**形狀**（欄位改名就好）。
實際接的時候發現不是 —— **有些欄位資料庫裡根本沒有**。

migration 001 已經補齊了作業與繳交那幾個（`deadline` / `sort_order` /
`is_submitted`）。**剩下的是 `task` 表的五個：**

| 欄位 | 用途 | 畫面上用到幾處 |
|---|---|---|
| `isArchived` | 封存／取消封存題目 | 24 |
| `gradeLevel` | 寫作類型（看圖寫作／記敘抒情／論說） | 11 |
| `maxScore` | 滿分 | 6 |
| `preferredAiModel` | 預選批改模型 | 20（目前被 `SHOW_AI_MODEL_PICKER` 關著） |
| `aiImageDescription` | 配圖的替代文字，也是 AI 對圖片的理解 | 3 |

**現在接上去的後果**：老師編輯題目按下儲存，這五樣會**安靜地消失**，
畫面上沒有任何異狀，要等重新載入才發現封存跑掉、寫作類型變空白。
比還沒接更糟，所以 `api/questions.ts` 的寫入路徑刻意沒有接到畫面。

→ ✅ **已決定補齊**：`docs/migrations/002-task-fields.sql`（待套用）。

欄位命名有一處刻意不照抄前端：`gradeLevel` → **`writing_type`**。
前端那個名字是誤導的 —— `types.ts` 自己就有註解警告「gradeLevel 存的是
寫作類型，不是學段」。照抄一個會誤導的名字進資料庫等於把誤會固定下來。
前端那個欄位名建議之後一併改。


### ⛔ 校務同步：兩邊的產品模型不一樣

|  | 流程 |
|---|---|
| 原型 | 教師打開同步視窗 → 從校務系統挑班級 → **匯入成自己的課程** |
| 後端 | 管理者跑 `POST /service/admin/sync/school` → 課程、授課關聯、學生名冊**一次全部**從 DevAPI 建好 → 教師只是「看到」自己的課 |

後端沒有「把這個班加進我的名下」這種動作。要做的話等於讓教師自己建立
`uc_instructor` 關聯 —— **那是權限問題**（同校的老師可以認領任何一個班嗎？），
需要產品決定。

在決定之前，`handleSyncCourses` 與 `SyncSchoolModal` 刻意維持原狀
（只動本地狀態），不做成半接的樣子 —— 接一半的話，老師按下匯入會看到
課程出現在畫面上，重新整理就不見了。

### ⚠️ `onUpdateCourse` 承載的欄位有三種命運

課程卡片的 `onUpdateCourse` 是一支統包的 callback，四個呼叫點送的東西性質完全不同：

| 呼叫點 | 改的欄位 | 能不能存 |
|---|---|---|
| 卡片選單「封存課程」 | `isArchived` | ✅ 存在 `course.is_active`（**已修**） |
| 刪除對話框的「改為封存」 | `isArchived` | ✅ 同上 |
| `EditCourseModal` | `aiModels` | ❌ **`course` 沒有這個欄位**。目前被 `SHOW_AI_MODEL_PICKER=false` 關著，所以還沒造成問題 |
| `CourseMappingModal` | `city` / `schoolName` / `schoolLevel` / `parseConfidence` | ❌ 來自 `school` 資料表，由校務同步維護，從課程寫回去不會是真相 |

**這個 bug 是怎麼發生的：** 資源 3 把 `deleteCourse` 接上了 API，卻把
`onUpdateCourse` 留在純本地狀態，畫面上看起來完全正常 —— 直到重新載入。
現在 `handleUpdateCourse` 只把有資料庫對應的那一項送出去，其餘仍留在本地
（行為不比之前差），但**後兩列要等產品決定**：aiModels 要不要加欄位，
以及「待確認」那套流程在真實資料下要不要整個拿掉（見下方校務同步那節）。

順帶修掉一個潛在的資料破壞：`CourseHelper.update` 原本無條件
`SET school_year=…, semester=…, course_name=…, course_type=…`，
而前端的 `updateCourse()` 只送 `course_name` —— 一旦接上，另外三欄會被寫成 NULL。
現在改成 COALESCE 的部分更新，並有測試釘住。

### ⚠️ 原型的四學期制在資料庫裡不存在

原型有第1學期／寒假(`W`)／第2學期／暑假(`S`)，但 `semesters` 只有 1 與 2，
`course.semester` 是 integer，裝不下 `W`／`S`。原型那兩個選項永遠對不到課程。
要開寒暑假班是 schema 異動。

---

## 決定結果

| # | 決定 |
|---|---|
| 1 | **轉換寫在前端的 api client**（方案 B）。後端不動，舊前端零風險 |
| 2 | **「清除繳交」要做** —— 新增 `DELETE /service/instructor/submissions/:id`。資料庫沒有外鍵，連鎖清理要自己寫全並且有測試 |
| 3 | **期末總結另列 Phase 6**，不併進 Phase 4 |
| 4 | ⬜ `docs/migrations/001-prototype-gaps.sql` 的審核（含外鍵）仍待辦 —— 但只擋第 8～10 號資源 |
