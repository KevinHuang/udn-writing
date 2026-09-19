# 待處理的發現

移植新版 UI 的過程中看到、但不屬於當下階段的問題。依 `spec.md`「不要順手重構」的規則
記在這裡，不當場改。

---

## 1. `/student/submit` 沒有檢查學生是不是這個班的人

`apps/api/src/routes/student.ts` 的 `/submit` 只檢查作業是否收件（opened 與截止日），
沒有檢查 `uc_learner` 裡有沒有這個學生與這個班的關聯。任何有學生身分的帳號，
只要知道作業 id，就能對別班的作業繳交。

- 發現於：2026-09-18，第 1 階段（截止日規則）改這支路由時
- 影響：寫入面的授權缺口。讀取面（`getAssignments`）有照 `uc_learner` 過濾
- 建議：在收件檢查的 SQL 補 `AND EXISTS (SELECT 1 FROM uc_learner WHERE ref_course_id = a.ref_course_id AND ref_user_id = $2)`，並補一條授權測試

## 2. 舊作業的 `sort_order` 是 NULL，新作業會排到它前面

`AssignmentHelper.create` 用 `MAX(sort_order) + 1` 接在最後；但舊資料的 `sort_order`
全是 NULL 時 MAX 是 NULL，新作業拿到 0。清單是 `sort_order ASC NULLS LAST`，
所以新派的作業反而變成第 1 份、舊的變第 2 份。

- 發現於：2026-09-18 瀏覽器實測（忠孝國中 101 班，新作業編號顯示 1）
- 建議：一次性 migration 依 `assigned_at` 補齊既有作業的 `sort_order`，或 create 時把 NULL 的也算進去

## 3. 成績管理的「學生學習歷程」視窗用姓名比對繳交紀錄

`apps/web/components/GradeManagement.tsx` 的 `StudentHistoryModal` 以
`s.studentName === student.name` 篩選這位學生的成績。成績表本身已經改用 `studentId`
（因為實測同一個班有兩位學生都叫「udn教師用聯合報教育事業部」），但這個視窗沒跟上 ——
同名的兩個人點開會看到彼此的成績。

- 發現於：2026-09-18，第 2 階段改成績管理時
- 建議：改成 `s.studentId === student.studentId`（`student` 物件已經帶 studentId）

## 4. `submission.pic_files` 有 729 筆存成 JSON 字串，不是陣列

`SubmissionHelper.submit` 自己會 `JSON.stringify(pic_files)`，而 `/student/submit`
先轉了一次再傳進去 —— jsonb 裡存的是一個字串（`'"[...]"'`）。2026-09-18 盤點
writing_classroom_test：array 1,350 筆、string 729 筆、object 17 筆（object 應是
早期把空陣列當 Postgres 陣列送進來變成的 `{}`）。

- 第 4 階段已修正路由（新資料一律存陣列，有測試）；前端 `picFilesOf()` 三種都讀得懂，畫面沒有影響
- 既有資料沒動。要整理的話可以寫一支 migration：`UPDATE submission SET pic_files = (pic_files #>> '{}')::jsonb WHERE jsonb_typeof(pic_files) = 'string'`，object 的改成 `'[]'`
- 重掃會整份覆蓋 `pic_files`，被換掉的舊原稿檔案仍留在 GCS bucket 裡（沒有刪除），需要的話另外清

## 5. ~~聯合報管理人員以管理身分用不了題庫~~（2026-09-19 已處理）

原本整個 `/service/instructor` 只認授課教師，管理人員明確切換成管理身分之後題庫 API 一律 403；
共同題庫又改成只准管理人員編輯，結果沒有人能透過畫面編輯共同題庫。

依使用者決定處理：題庫 API（tasks／folders）開放給管理人員；管理人員看得到**全部**共用題
（不分組織），也能改、封存、刪除任何共用題與共享資料夾，但動不了別人的個人題。
順帶修掉：新系統建的共用題以前沒有寫 `ref_org_id`，老師看不到（程式已修，既有資料見 migration 006）。
測試在 `task.test.ts` 的「共同題庫的權限」。

## 6. 學期下拉選單列到 119 學年度（尚未查證）

教師端首頁、課程管理、成績管理的學期下拉，最新一項是「119學年度 第1學期」，
而今天（2026-09）是 115 學年度。預設選中的是正確的 115-1。
可能只是 `semesters` 表預先建好了未來學期，也可能是清單沒有排除未開始的學期。

- 發現於：2026-09-18 冒煙測試
- 待查：`GET /service/semesters` 的回傳與 `SemesterHelper.list()`
