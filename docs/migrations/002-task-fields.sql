--
-- Migration 002：補齊 task 表缺的五個欄位
--
-- ✅ **已套用**（2026-09-16，writing_classroom_test 與 writing_classroom_autotest）。 與 001 一樣必須以 **postgres（或表的擁有者）身分**執行 ——
--    應用程式用的 writing_mng 有 GRANT ALL 但不是 task 的擁有者，
--    ALTER TABLE 需要的是擁有權不是權限。
--
-- 為什麼需要這一份：接題目（Phase 4 資源 4）時發現，前端在用的五個欄位
-- 資料庫裡根本沒有。沒有它們就把 QuestionBank 接上 API 的話，
-- 老師編輯題目按下儲存，這五樣會**安靜地消失** —— 畫面上沒有任何異狀，
-- 要等重新載入才發現封存跑掉、寫作類型變空白。那比還沒接更糟。
--
-- 原則與 001 相同：只加欄位，全部可為 NULL 或有預設值，既有資料不受影響。
--
-- 對應 artifacts/api-gap.md 的「形狀落差在好幾處其實是欄位不存在」。
--

BEGIN;

-- ════════════════════════════════════════════════════════════
-- 1. 封存
-- ════════════════════════════════════════════════════════════
--
-- 題庫的封存／取消封存（QuestionBank，畫面上 24 處用到）。
-- 封存的題目不出現在挑題清單裡，但已經派出去的作業不受影響 ——
-- 所以是一個旗標，不是刪除。
--
-- 命名沿用既有慣例（is_valid / is_active / is_submitted）。

ALTER TABLE public.task
  ADD COLUMN is_archived boolean DEFAULT false NOT NULL;

COMMENT ON COLUMN public.task.is_archived IS
  '是否已封存。封存的題目不出現在挑題清單，但已派發的作業不受影響。';


-- ════════════════════════════════════════════════════════════
-- 2. 寫作類型
-- ════════════════════════════════════════════════════════════
--
-- ⚠️ **欄位刻意不叫 grade_level。**
--
-- 前端這個欄位叫 `Question.gradeLevel`，但它存的**不是學段** ——
-- types.ts 自己就留了一條註解警告這件事：
--
--     注意：與 Question.gradeLevel 是兩件事 —— gradeLevel 存的是
--     「寫作類型」（看圖寫作／記敘抒情／論說），這裡才是學段。
--
-- 學段是另一個欄位（前端的 targetGrades，資料庫的 task.level）。
-- 照抄一個會誤導的名字進資料庫，等於把那個誤會固定下來 ——
-- 欄位名就叫它實際裝的東西。前端那個名字建議之後一併改掉。
--
-- 值是自由文字（`一般`、`看圖寫作`、`記敘抒情`、`論說`…），不是列舉 ——
-- 原型的表單就是讓老師自己填，值域還在長，現在鎖死會擋路。

ALTER TABLE public.task
  ADD COLUMN writing_type character varying;

COMMENT ON COLUMN public.task.writing_type IS
  '寫作類型（看圖寫作／記敘抒情／論說…）。自由文字。'
  '注意：這**不是**學段 —— 學段在 task.level。前端該欄位名為 gradeLevel，是誤導。';


-- ════════════════════════════════════════════════════════════
-- 3. 滿分
-- ════════════════════════════════════════════════════════════
--
-- NULL 代表「用系統預設」，也就是會考的六級分（lib/scoring.ts 的 MAX_LEVEL）。
-- 不給 DEFAULT 6 是刻意的：預設值寫在資料庫的話，之後改級分制度要同時改
-- 兩個地方，而且既有資料會分不出「沒設定」與「剛好設成 6」。

ALTER TABLE public.task
  ADD COLUMN max_score smallint;

COMMENT ON COLUMN public.task.max_score IS
  '滿分。NULL 代表用系統預設（會考六級分，見 lib/scoring.ts 的 MAX_LEVEL）。';


-- ════════════════════════════════════════════════════════════
-- 4. 預選批改模型
-- ════════════════════════════════════════════════════════════
--
-- 題目可以指定用哪個 AI 模型批改；沒指定就用班級開通清單的第一個。
--
-- ⚠️ 這個功能目前被前端的 SHOW_AI_MODEL_PICKER 開關**關著**（使用者選不了），
--    但機制整個保留 —— 欄位、自動帶入的邏輯、批改時傳模型參數都還在。
--    補這一欄是為了那個開關打開時資料是完整的，不是為了現在的畫面。

ALTER TABLE public.task
  ADD COLUMN preferred_ai_model character varying;

COMMENT ON COLUMN public.task.preferred_ai_model IS
  '預選的批改模型。NULL 代表用班級開通清單的第一個。'
  '目前前端的 SHOW_AI_MODEL_PICKER 關著，使用者選不了，但機制保留。';


-- ════════════════════════════════════════════════════════════
-- 5. 配圖的文字描述
-- ════════════════════════════════════════════════════════════
--
-- 兩個用途合而為一：給視障使用者的替代文字，以及 AI 對這張圖的理解
-- （批改看圖寫作時要把圖的內容餵給模型）。
--
-- 命名對齊既有的 task.pic1。

ALTER TABLE public.task
  ADD COLUMN pic1_description character varying;

COMMENT ON COLUMN public.task.pic1_description IS
  '配圖（pic1）的文字描述。同時是無障礙替代文字與 AI 對圖片的理解。';


COMMIT;


-- ════════════════════════════════════════════════════════════
-- 套用紀錄
-- ════════════════════════════════════════════════════════════
--
--   writing_classroom_test      開發用      ✅ 已套用（2026-09-16）
--   writing_classroom_autotest  自動化測試  ✅ 已套用（2026-09-16）
--   writing_classroom           production  ⬜ ← 人工決定與執行
