-- ============================================================
-- 011 — 同一篇繳交只留一筆有效批改（清掉既有的重複，給 012 的唯一索引鋪路）
-- ============================================================
--
-- ## 背景
--
-- 批改結果的模型是**版本**：一篇繳交任何時刻只該有一筆 `is_valid = true`
-- （見 InstructorHelper.saveFeedback）。但 saveFeedback 以前是三句各自生效的 SQL
-- （讀上一版 → 舊的全部失效 → 插入新版），同一篇同時存兩次就兩邊都插入。
-- 實測同時存 10 次，留下 9～10 筆有效批改（grading.test.ts「同時存檔」）。
--
-- 會撞上的情境：連按兩下、開兩個分頁、批次 AI 批改的同時老師在存同一篇、
-- 授課教師與管理人員同時批同一篇。教師端的查詢用 DISTINCT ON 只取一筆所以
-- 看不出來，但學生端會出現兩筆、期末總結會把那一篇算兩次、發還會改到兩筆。
--
-- 2026-10-20 程式已經修好（交易＋鎖住那篇繳交）。這份處理**歷史殘留**；
-- 012 再加上部分唯一索引，讓資料庫本身擋住重複。
--
-- ## 留哪一筆
--
-- **每篇留最新的一筆**，規則與讀取端完全相同：
--   DISTINCT ON (ref_submission_id) ... ORDER BY created_time DESC, id DESC
-- 所以老師在畫面上看到的那一筆不會變。其餘的設成 `is_valid = false`
-- （不刪，與重批的做法一致，歷史留著）。
--
-- ⚠️ 學生端以前會看到全部重複的那幾筆。如果被失效的那一筆已發還、留下的沒有，
--    學生就看不到那篇的成績了。套用前的檢查查詢會列出 is_returned，
--    兩者不一致的請人工判斷（例如把留下的那一筆補發還）。
--
-- ## 執行身分
--
-- 只改資料，**writing_mng 就能執行**（012 才需要 postgres）。
-- 可以重複執行：沒有重複時什麼都不會改。
--
-- ## 可復原
--
-- 被失效的批改 id 先記進備份表。要還原：
--   UPDATE submission_feedback SET is_valid = true
--    WHERE id IN (SELECT id FROM submission_feedback_dedupe_backup_011);
-- 確認沒問題之後再手動 DROP 那張表。
--
-- ============================================================

-- ── 套用前檢查（唯讀）：有幾篇重複、各幾筆 ──
--
-- SELECT ref_submission_id,
--        array_agg(id          ORDER BY created_time DESC, id DESC) AS ids,
--        array_agg(score       ORDER BY created_time DESC, id DESC) AS scores,
--        array_agg(is_ai       ORDER BY created_time DESC, id DESC) AS is_ai,
--        array_agg(is_returned ORDER BY created_time DESC, id DESC) AS is_returned
--   FROM submission_feedback
--  WHERE is_valid = true AND ref_submission_id IS NOT NULL
--  GROUP BY ref_submission_id
-- HAVING count(*) > 1
--  ORDER BY ref_submission_id;
--
-- 每一列的第一個 id 是要留下的，其餘會被失效。

BEGIN;

-- 1. 記下要失效的是哪幾筆（只記 id 與當下的狀態，還原用）
CREATE TABLE IF NOT EXISTS public.submission_feedback_dedupe_backup_011 (
    id                bigint PRIMARY KEY,
    ref_submission_id bigint,
    score             real,
    is_ai             boolean,
    is_returned       boolean,
    invalidated_at    timestamptz NOT NULL DEFAULT now()
);

WITH keep AS (
    SELECT DISTINCT ON (ref_submission_id) id
      FROM public.submission_feedback
     WHERE is_valid = true AND ref_submission_id IS NOT NULL
     ORDER BY ref_submission_id, created_time DESC, id DESC
)
INSERT INTO public.submission_feedback_dedupe_backup_011 (id, ref_submission_id, score, is_ai, is_returned)
SELECT f.id, f.ref_submission_id, f.score, f.is_ai, f.is_returned
  FROM public.submission_feedback f
 WHERE f.is_valid = true
   AND f.ref_submission_id IS NOT NULL
   AND f.id NOT IN (SELECT id FROM keep)
ON CONFLICT (id) DO NOTHING;

-- 2. 失效。條件與上面完全一致
WITH keep AS (
    SELECT DISTINCT ON (ref_submission_id) id
      FROM public.submission_feedback
     WHERE is_valid = true AND ref_submission_id IS NOT NULL
     ORDER BY ref_submission_id, created_time DESC, id DESC
)
UPDATE public.submission_feedback f
   SET is_valid = false
 WHERE f.is_valid = true
   AND f.ref_submission_id IS NOT NULL
   AND f.id NOT IN (SELECT id FROM keep);

COMMIT;

-- ── 套用後檢查：應該是 0 ──
--
-- SELECT count(*) FROM (
--     SELECT ref_submission_id FROM submission_feedback
--      WHERE is_valid = true AND ref_submission_id IS NOT NULL
--      GROUP BY ref_submission_id HAVING count(*) > 1
-- ) d;


-- ════════════════════════════════════════════════════════════
-- 套用紀錄
-- ════════════════════════════════════════════════════════════
--
--   writing_classroom_test2     開發用      ⬜ 套用前檢查是 0 筆重複（2026-10-20），套了也不會改任何資料
--   writing_classroom_test      開發用      ⬜
--   writing_classroom_autotest  自動化測試  ⬜ 每個測試前都會清空，套不套都一樣；012 才需要
--   writing_classroom           production  ⬜ ← 人工決定與執行
