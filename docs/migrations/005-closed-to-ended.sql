-- ============================================================
-- 005 — 取消「已關閉」狀態：把已關閉的作業轉成「已截止」
-- ============================================================
--
-- ## 背景
--
-- 作業以前有三種狀態，由兩個欄位組合出來：
--
--     opened = true                          → 進行中
--     opened = false, opened_at IS NULL      → 未開放（從沒開過）
--     opened = false, opened_at IS NOT NULL  → 已關閉（開過又收回，不收件，學生看得到成績）
--
-- 新版 UI（2026-09-18 決定以新版為主）拿掉「已關閉」：**收不收件只看截止日**。
-- 狀態只剩「學生看不看得到」（opened），階段由截止日算：
--
--     未開放  opened = false
--     收件中  opened = true，沒有截止日或還沒到
--     已截止  opened = true，截止時間已過（allow_late_submission = true 時仍收遲交）
--
-- 程式改完之後，opened = false 一律顯示成「未開放」—— 舊的已關閉作業
-- 會從學生的作業清單消失（成績紀錄仍在，因為 opened_at 有值）。
-- 老師當初按「結束收件」的意思是「學生看得到、但不能再交」，那在新模型裡是
-- **已截止**，所以這裡把它們轉過去：
--
--     opened                = true
--     deadline              = 原本的截止日與現在取早的；沒有截止日就是現在
--     allow_late_submission = false（已關閉本來就不收件）
--
-- opened_at 不動（仍是第一次開放的時間）。
--
-- 截止日寫成「套用當下」而不是當初關閉的時間 —— 資料庫沒有記關閉時間。
-- 副作用只有一個：遲交判斷用 submited_time > deadline，已關閉的作業在關閉後
-- 本來就交不進來，所以既有的繳交都早於這個時間，不會被誤標成遲交。
--
-- 2026-09-18 在 writing_classroom_test 盤點：
--
--     已關閉總數                 15
--       其中沒有截止日            15
--       截止日在未來               0
--       截止日已過                 0
--       允許遲交                   0
--
-- ## ⚠️ 套用順序
--
-- **先部署新程式，再套這份。** 反過來的話，舊程式會把轉過去的作業顯示成
-- 「進行中」—— 舊程式不看截止日決定能不能交，學生就又能繳交了。
--
-- **部署完立刻套，而且只套一次。** 新程式裡老師「改回未開放」產生的列，
-- 長得和舊的已關閉一模一樣（opened = false、opened_at 有值）。晚套或重套，
-- 就會把老師刻意收回的作業也轉成已截止、重新讓學生看到。
-- 部署到套用之間的空檔，舊的已關閉作業會暫時從學生的作業清單消失
-- （成績紀錄仍在），套完就回來。
--
-- ## 可復原
--
-- 更新前先把受影響的列整筆複製到備份表。確認沒問題之後再手動 DROP 那張表。
--
-- ============================================================

-- ── 套用前檢查：要轉的筆數 ──
--
-- SELECT count(*) FROM assignment WHERE opened = false AND opened_at IS NOT NULL;

BEGIN;

-- 1. 備份。整列複製，之後要還原用 UPDATE ... FROM 這張表即可
CREATE TABLE IF NOT EXISTS public.assignment_closed_backup_005 AS
  SELECT * FROM public.assignment WHERE false;

INSERT INTO public.assignment_closed_backup_005
  SELECT a.* FROM public.assignment a
   WHERE a.opened = false AND a.opened_at IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.assignment_closed_backup_005 b WHERE b.id = a.id);

-- 2. 轉成已截止
UPDATE public.assignment
   SET opened = true,
       deadline = LEAST(COALESCE(deadline, now()), now()),
       allow_late_submission = false
 WHERE opened = false AND opened_at IS NOT NULL;

COMMIT;

-- ── 套用後檢查：應該是 0 ──
--
-- SELECT count(*) FROM assignment WHERE opened = false AND opened_at IS NOT NULL;
--
-- ── 還原（萬一需要）──
--
-- UPDATE public.assignment a
--    SET opened = b.opened, deadline = b.deadline, allow_late_submission = b.allow_late_submission
--   FROM public.assignment_closed_backup_005 b
--  WHERE a.id = b.id;
