-- ============================================================
-- 009 — 自動蓋佳作的標準（featured_rule_user／featured_rule_assignment）
--       與「已經自動判斷過」的紀錄（submission_mark_auto）
-- ============================================================
--
-- ## 背景
--
-- 老師在「批改作業」入口設定自己的佳作標準（例如 5 級分以上），之後
-- 不論哪所學校、哪個班，作品**第一次批改完成**時達到標準就自動蓋上佳作章。
-- 個別作業可以另外調整（例如這一班改成 6 級分、或這份作業不自動蓋）。
--
-- 使用者的三個決定（2026-10-01）：
--   1. 用**當下批改的人**的標準。作業另外調整過的，不論誰批改都以作業的為準。
--   2. **每篇只自動判斷一次。** 之後老師改分、改評語、取消章，系統都不再動 ——
--      老師的手動判斷永遠優先。
--   3. **只對之後的批改生效**，已經批改完的舊作品不回溯。
--
-- ## 三張表
--
--   featured_rule_user        每位使用者一筆：enabled、min_score（1～6）
--                             沒有資料列＝沒開自動蓋章
--
--   featured_rule_assignment  作業另外調整的標準。沒有資料列＝沿用批改者的標準
--                             min_score NULL ＝ 這份作業不自動蓋
--
--   submission_mark_auto      這篇已經自動判斷過了（不論有沒有達標）。
--                             有這一列就不再判斷 —— 這就是「只判斷一次」。
--
-- 為什麼不在 submission_mark 加一欄 is_auto：那張表的擁有者是 postgres，
-- writing_mng 不能 ALTER（同 008 的理由）。而且「判斷過但沒達標」也要記，
-- 那種情形根本沒有 submission_mark 的資料列可以加欄位。
--
-- ## 套用順序
--
-- **先套這份，再部署新程式。** 新程式存批改結果時會查這幾張表，
-- 表不存在的話自動蓋章會失敗（批改本身照樣存得進去，見 InstructorHelper.saveFeedback）。
--
-- 需要 001（submission_mark）已經套過。可以重複執行。
--
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.featured_rule_user (
    ref_user_id bigint PRIMARY KEY,
    enabled     boolean  NOT NULL DEFAULT false,
    min_score   smallint NOT NULL DEFAULT 5 CHECK (min_score BETWEEN 1 AND 6),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.featured_rule_user IS
  '使用者自己的自動蓋佳作標準。批改完成時用「當下批改的人」的這一筆。沒有資料列＝不自動蓋。';

CREATE TABLE IF NOT EXISTS public.featured_rule_assignment (
    ref_assignment_id bigint PRIMARY KEY
        REFERENCES public.assignment (id) ON DELETE CASCADE,
    min_score   smallint CHECK (min_score BETWEEN 1 AND 6),
    ref_user_id bigint,
    updated_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.featured_rule_assignment IS
  '個別作業另外調整的自動蓋佳作標準，不論誰批改都以這個為準。沒有資料列＝沿用批改者的標準。';
COMMENT ON COLUMN public.featured_rule_assignment.min_score IS
  '幾級分以上自動蓋佳作。NULL＝這份作業不自動蓋。';

CREATE TABLE IF NOT EXISTS public.submission_mark_auto (
    ref_submission_id bigint PRIMARY KEY
        REFERENCES public.submission (id) ON DELETE CASCADE,
    min_score   smallint NOT NULL,
    score       real,
    marked      boolean NOT NULL,
    ref_user_id bigint,
    judged_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.submission_mark_auto IS
  '這篇作品已經依標準自動判斷過（marked＝當時有沒有蓋章）。有資料列就不再判斷。';

COMMIT;


-- ════════════════════════════════════════════════════════════
-- 套用紀錄
-- ════════════════════════════════════════════════════════════
--
--   writing_classroom_test      開發用      ✅ 已套用（2026-10-01，以 writing_mng 執行）
--   writing_classroom_autotest  自動化測試  ✅ 已套用（2026-10-01，同上）
--   writing_classroom           production  ⬜ ← 人工決定與執行（001 要先套）
