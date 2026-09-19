-- ============================================================
-- 007 — 題目支援多張配圖（task.pics）
-- ============================================================
--
-- ## 背景
--
-- 題目原本只有一個配圖欄位 `task.pic1`（GCS `img/` 底下的檔名）。
-- 2026-09-19 使用者要求新增題目時可以上傳多張照片。
--
-- ## 做法：加一欄，不改舊欄
--
--     pics  jsonb  —— 檔名的陣列，依顯示順序，例如 ["a.png","b.jpg"]
--
-- `pic1` **保留，而且永遠等於 pics 的第一張**（程式寫入時一起維護）。
-- 只認得 pic1 的地方 —— 舊前端（apps/api/public）、AI 批改讀題目的查詢 ——
-- 照樣看得到第一張，不必一起改。
--
-- 既有題目把 pic1 搬進 pics，讀的一方就只要看 pics 一欄。
--
-- ## 套用順序
--
-- **先套這份，再部署新程式。** 新程式的 INSERT／UPDATE 會寫 pics，欄位不存在就失敗。
-- 反過來（先套、舊程式還在跑）沒有問題：舊程式不知道這一欄，只寫 pic1 ——
-- 那段期間建的題目 pics 會是 NULL，新程式讀的時候退回 pic1。
--
-- 可以重複執行。
--
-- ============================================================

BEGIN;

ALTER TABLE public.task ADD COLUMN IF NOT EXISTS pics jsonb;

COMMENT ON COLUMN public.task.pics IS
  '配圖檔名陣列（GCS img/ 底下），依顯示順序。pic1 永遠等於第一張，給只認得單張的舊程式用。';

UPDATE public.task
   SET pics = jsonb_build_array(pic1)
 WHERE pics IS NULL AND COALESCE(pic1, '') <> '';

COMMIT;

-- ── 套用後檢查：有 pic1 卻沒有 pics 的應該是 0 ──
--
-- SELECT count(*) FROM task WHERE COALESCE(pic1,'') <> '' AND pics IS NULL;
