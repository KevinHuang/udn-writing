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
| 課程清單 | `GET /service/instructor/courses` | ⚠️ | 形狀 |
| 課程 CRUD | `POST/PUT/DELETE /service/instructor/courses` | ⚠️ | 形狀；刪除的連鎖清理要驗（**沒有外鍵**） |
| 可匯入的課程 | `GET /service/instructor/school-courses` | ✅ | Phase 2 新增（C 方案） |
| 校務同步 | `POST /service/admin/sync/school` | ⚠️ | 目前寫死 `dsns` 與學年期 |
| 班級名冊 | `GET /service/instructor/courses/:courseId/students` | ⚠️ | 形狀 |
| 題目清單／CRUD | `GET/POST/PUT/DELETE /service/instructor/tasks` | ⚠️ | 形狀 |
| 單一題目 | `GET /service/task/:id` | ✅ | |
| 題庫資料夾 | — | ❌ | 卡 migration |
| 作業清單（依課程） | `GET /service/instructor/courses/:id/assignments` | ⚠️ | 形狀 + 排序（③.1） |
| 作業清單（依教師） | `GET /service/instructor/assignments` | ⚠️ | 形狀 |
| 建立作業 | `POST /service/instructor/courses/:id/assignments` | ⚠️ | 要能帶截止日（卡 migration） |
| 開關作業 | `PUT /service/instructor/assignments/:id/status` | ✅ | |
| 換題 | `PUT /service/instructor/assignments/:id/task` | ✅ | |
| 作業重新排序 | — | ❌ | 卡 migration |
| 學生的作業清單 | `GET /service/student/my_assignments` | ⚠️ | 形狀 |
| 學生繳交 | `POST /service/student/submit` | ✅ | |
| 學生看批改結果 | `GET /service/student/submission_feedback` | ⚠️ | 形狀 |
| 某作業的繳交狀況 | `GET /service/instructor/assignments/:id/submissions` | ⚠️ | 形狀 + 狀態推導（③.2） |
| 單筆批改（AI） | `POST /service/instructor/grading/:submissionId` | ✅ | |
| 存批改結果 | `POST /service/instructor/submissions/:id/feedback` | ⚠️ | 形狀 |
| 重置批改 | `POST /service/instructor/grading/reset/:id` | ✅ | |
| 發還 | `POST /service/instructor/submission_feedback/return` | ✅ | |
| 代繳交 | `POST /service/instructor/submissions/proxy` | ✅ | |
| 代繳交 OCR | `POST /service/instructor/submissions/ocr_proxy` | ✅ | |
| 清除繳交 | — | ❌ | **要做**（決定 2）。連鎖：submission → submission_feedback → 作品標記 |
| 作品標記 | — | ❌ | 卡 migration |
| 請假註記 | — | ❌ | 卡 migration |
| 成績統計 | `GET /service/instructor/courses/:cid/tasks/:tids/scores` | ⚠️ | 形狀 |
| 期末總結 | `GET /service/instructor/courses/:cid/finalReports` | ✅ | 前端沒有畫面 → **Phase 6** |
| 學期清單 | — | ❌ | `semesters` 表有資料，缺 endpoint |
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
| 2 | 學期清單 | 否 |
| 3 | 課程 + 名冊 + 校務同步 | 否 |
| 4 | 題目（不含資料夾） | 否 |
| 5 | 作業（不含截止日與排序） | 否 |
| 6 | 繳交 + 代繳交 + 狀態推導 | 否 |
| 7 | 批改結果 + 發還 + 重置 | 否 |
| 8 | 題庫資料夾 | **是** |
| 9 | 截止日 + 拖拉排序 | **是** |
| 10 | 作品標記 + 請假註記 | **是** |
| 11 | 清除繳交（新增 endpoint） | 否 |

**1～7 完全不需要等 migration。** 做完這七項，主要流程
（派作業 → 學生繳交 → 老師批改 → 發還 → 學生看成績）就能整條跑在真資料上。

---

## 決定結果

| # | 決定 |
|---|---|
| 1 | **轉換寫在前端的 api client**（方案 B）。後端不動，舊前端零風險 |
| 2 | **「清除繳交」要做** —— 新增 `DELETE /service/instructor/submissions/:id`。資料庫沒有外鍵，連鎖清理要自己寫全並且有測試 |
| 3 | **期末總結另列 Phase 6**，不併進 Phase 4 |
| 4 | ⬜ `docs/migrations/001-prototype-gaps.sql` 的審核（含外鍵）仍待辦 —— 但只擋第 8～10 號資源 |
