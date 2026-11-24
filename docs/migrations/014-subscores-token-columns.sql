-- ============================================================
-- 014 — 修正四向度批次補分寫錯的兩個 token 欄位
-- ============================================================
--
-- ## 背景
--
-- `SubmissionFeedbackHelper.saveSubscores()`（管理員的 /admin/grading_subscores
-- 批次補分）那一句 UPDATE 的位置參數整排往左錯一格：
--
--     SET sub_scores = $4, sub_scores_input_tokens = $1, sub_scores_output_tokens = $2
--     WHERE id = $1
--     -- 參數是 [feedback_id, inputTokens, outputTokens, sub_scores]
--
-- 於是寫進資料庫的是：
--
--     sub_scores_input_tokens   = feedback 的 id      ← 完全不是 token 數
--     sub_scores_output_tokens  = 真正的 inputTokens
--     真正的 outputTokens       = 沒有被寫入（留 NULL 或舊值）
--
-- 四向度（sub_scores）本身是對的，`WHERE id` 也剛好對，所以補分功能看起來
-- 完全正常 —— 只有花費統計是錯的，而且數字很大，看起來像真的 token 數。
--
-- 程式已經修好（改用具名參數，並有測試釘住三個欄位：`grading.test.ts`
-- 的「批次補分：四向度與 token 各自寫進對的欄位」）。這份 migration 處理
-- **既有資料**。
--
-- ## 要不要跑：不急
--
-- **系統裡沒有任何畫面或查詢讀這兩欄**（全 repo 搜過，只有這支 helper 會寫）。
-- 它們純粹是對帳用的，所以不跑也不會有人看到錯的東西；只有在之後要統計
-- AI 花費時才需要乾淨的資料。
--
-- ## 能救回多少
--
-- `output` 欄位裡存的是**真正的 inputTokens**，所以往左挪回來就對了。
-- 真正的 outputTokens 當初沒有被寫入，**救不回來** —— 留 NULL，不要猜。
-- （「留白看得見，猜錯看不見」。）
--
-- ## ⚠️ 只能執行一次
--
-- 判斷哪幾列壞掉是靠「sub_scores_input_tokens 剛好等於這一列的 id」這個指紋。
-- 跑完之後那一欄變成真的 token 數，理論上**有可能**又剛好等於 id
-- （id 是四位數，而一次批改的 input token 數也是四位數），再跑一次就會把
-- 一列正確的資料挪錯。所以：先用下面的 SELECT 看筆數，跑一次，確認筆數變 0。
--
-- 這份 migration 不改 schema，只改資料；沒有交易以外的風險。
--
-- ============================================================

-- ── 套用前：看有幾列是壞的，以及它們長什麼樣子 ──
--
-- SELECT count(*) FROM public.submission_feedback WHERE sub_scores_input_tokens = id;
--
-- SELECT id, sub_scores_input_tokens, sub_scores_output_tokens, sub_scores_time
--   FROM public.submission_feedback
--  WHERE sub_scores_input_tokens = id
--  ORDER BY id
--  LIMIT 20;

BEGIN;

-- 壞掉的那幾列備份起來（只留三個欄位與 id，夠還原了）
CREATE TABLE IF NOT EXISTS public.subscores_tokens_backup_014 AS
SELECT id, sub_scores_input_tokens, sub_scores_output_tokens, sub_scores_time
  FROM public.submission_feedback
 WHERE sub_scores_input_tokens = id;

UPDATE public.submission_feedback
   SET sub_scores_input_tokens  = sub_scores_output_tokens,  -- 這裡才是真的 input
       sub_scores_output_tokens = NULL                       -- 當初沒寫進來，救不回來
 WHERE sub_scores_input_tokens = id;

COMMIT;

-- ── 套用後確認：應該是 0 ──
--
-- SELECT count(*) FROM public.submission_feedback WHERE sub_scores_input_tokens = id;

-- ── 要還原的話 ──
--
-- UPDATE public.submission_feedback f
--    SET sub_scores_input_tokens  = b.sub_scores_input_tokens,
--        sub_scores_output_tokens = b.sub_scores_output_tokens
--   FROM public.subscores_tokens_backup_014 b
--  WHERE b.id = f.id;

-- ── 確認不需要了之後 ──
--
-- DROP TABLE public.subscores_tokens_backup_014;


-- ════════════════════════════════════════════════════════════
-- 套用紀錄
-- ════════════════════════════════════════════════════════════
--
--   writing_classroom_test2     開發用      ⬜
--   writing_classroom_autotest  自動化測試  ⬜（測試庫每次都重建，其實不需要）
--   writing_classroom           production  ⬜ ← 人工決定與執行
