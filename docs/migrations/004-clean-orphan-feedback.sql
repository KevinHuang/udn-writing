-- ============================================================
-- 004 — 清除指向已不存在繳交的批改結果（孤兒列）
-- ============================================================
--
-- ## 背景
--
-- 這個資料庫**幾乎沒有外鍵**（只有 migration 001 加的三個），所以刪除繳交時
-- 必須手動把底下的 submission_feedback 一起刪掉。過去顯然發生過漏刪。
--
-- 2026-09-17 在 writing_classroom_test 盤點的結果：
--
--     submission_feedback 總筆數                      3,171
--     其中 ref_submission_id > 0 但那筆繳交已不存在       38   ← 這份 migration 要清的
--     涉及幾個已消失的 submission                        34
--     這 38 筆的 id 範圍                            274 ~ 481
--
-- 現行程式**已經不會再產生**這種孤兒 —— 刪除作業、清除繳交、重置批改三條路徑
-- 都在瀏覽器實測過，連鎖清理完整（見那次測試的紀錄）。這裡處理的是歷史殘留。
--
-- ## ⚠️ 刻意不碰的三類「看起來像孤兒」的資料
--
-- 資料庫裡另外有一批參照是**負數**，它們是軟刪除，不是漏刪：
--
--     submission.ref_user_id  < 0        35 筆  ← **現行功能產生的，絕對不要動**
--     submission_feedback.ref_submission_id < 0  31 筆
--     submission.ref_assignment_id < 0            1 筆
--
-- 第一類是「重置繳交」（`SubmissionHelper.resetSubmissions`）做的：把擁有者的
-- id 取負數，等於把作品從學生身上摘掉。**那是還在使用中的功能**，刪掉會毀掉
-- 可能還想復原的資料。
--
-- 後兩類的產生方式在 `apps/api` 與 `legacy-server` 裡都找不到，是更早的系統
-- 留下的。要不要清需要另外判斷，這份 migration 不處理。
--
-- ## 可復原
--
-- 刪除前先把要刪的列整筆複製到備份表。確認沒問題之後再手動 DROP 那張表。
--
-- ============================================================

-- ── 套用前檢查：應該是 38 ──
--
-- SELECT count(*) FROM submission_feedback f
--  WHERE f.ref_submission_id > 0
--    AND NOT EXISTS (SELECT 1 FROM submission s WHERE s.id = f.ref_submission_id);

BEGIN;

-- 1. 備份。整表複製，含所有欄位，之後要還原直接 INSERT ... SELECT 回去
CREATE TABLE IF NOT EXISTS public.submission_feedback_orphan_backup_004
    AS SELECT * FROM public.submission_feedback WHERE false;

INSERT INTO public.submission_feedback_orphan_backup_004
SELECT f.*
  FROM public.submission_feedback f
 WHERE f.ref_submission_id > 0
   AND NOT EXISTS (SELECT 1 FROM public.submission s WHERE s.id = f.ref_submission_id);

-- 2. 刪除。條件與備份完全一致 —— 負數的參照不在範圍內
DELETE FROM public.submission_feedback f
 WHERE f.ref_submission_id > 0
   AND NOT EXISTS (SELECT 1 FROM public.submission s WHERE s.id = f.ref_submission_id);

COMMIT;

-- ── 套用後檢查 ──
--
-- 應該是 0：
-- SELECT count(*) FROM submission_feedback f
--  WHERE f.ref_submission_id > 0
--    AND NOT EXISTS (SELECT 1 FROM submission s WHERE s.id = f.ref_submission_id);
--
-- 應該是 38（備份拿到了）：
-- SELECT count(*) FROM submission_feedback_orphan_backup_004;
--
-- 負數那批應該原封不動（31 / 35 / 1）：
-- SELECT
--   (SELECT count(*) FROM submission_feedback WHERE ref_submission_id < 0) AS 負數_feedback,
--   (SELECT count(*) FROM submission        WHERE ref_user_id       < 0) AS 重置繳交_submission,
--   (SELECT count(*) FROM submission        WHERE ref_assignment_id < 0) AS 負數_assignment;

-- ── 要還原的話 ──
--
-- INSERT INTO public.submission_feedback
-- SELECT * FROM public.submission_feedback_orphan_backup_004;
--
-- ── 確認不需要了之後 ──
--
-- DROP TABLE public.submission_feedback_orphan_backup_004;
