-- ============================================================
-- 012 — 同一篇繳交最多一筆有效批改：submission_feedback 的部分唯一索引
-- ============================================================
--
-- ## 背景
--
-- 「一篇繳交任何時刻只有一筆 is_valid = true」以前只靠程式維持，而程式沒做到
-- （見 011）。2026-10-20 InstructorHelper.saveFeedback 已經改成交易＋鎖住那篇繳交；
-- 這個索引讓**資料庫本身**擋住重複：之後就算有別的寫入路徑繞過那把鎖，
-- 也只會得到 unique_violation（23505）而失敗，不會悄悄多出一筆。
--
-- 附帶好處：這張表原本只有主鍵索引，「找某一篇的有效批改」每次都是整表掃描
-- （批改清單、成績管理、學生端、期末總結都在查）。
--
-- ## 執行身分
--
-- ⚠️ **必須以 postgres（表的擁有者）執行。** submission_feedback 的擁有者是 postgres，
--    建索引需要的是**擁有權**不是權限，用 writing_mng 會停在
--    「must be owner of table submission_feedback」（同 001 的情形）。
--
-- ## 套用順序
--
-- **先套 011**（清掉既有的重複），否則建索引會失敗 —— 下面第 1 步會先檢查，
-- 有重複就直接中止並說明，不會建到一半。
-- 程式不依賴這個索引：新程式可以先上線，這份之後再套。
--
-- 可以重複執行（IF NOT EXISTS）。
--
-- ## 鎖
--
-- 一般的 CREATE INDEX 會在建立期間擋住這張表的寫入。這張表只有幾千筆，
-- 幾百毫秒內就建完。若要完全不擋寫入，改用
--   CREATE UNIQUE INDEX CONCURRENTLY ...
-- 但那一句不能放在交易裡，要拿掉下面的 BEGIN／COMMIT 單獨執行。
--
-- ============================================================

BEGIN;

-- 1. 還有重複就中止（請先套 011）
DO $$
DECLARE
    dup integer;
BEGIN
    SELECT count(*) INTO dup FROM (
        SELECT ref_submission_id FROM public.submission_feedback
         WHERE is_valid = true AND ref_submission_id IS NOT NULL
         GROUP BY ref_submission_id HAVING count(*) > 1
    ) d;
    IF dup > 0 THEN
        RAISE EXCEPTION '還有 % 篇繳交有兩筆以上的有效批改，請先套用 011-dedupe-valid-feedback.sql', dup;
    END IF;
END $$;

-- 2. 索引本身。條件寫成 is_valid = true，與程式裡每一支查詢的寫法相同
CREATE UNIQUE INDEX IF NOT EXISTS submission_feedback_one_valid_per_submission
    ON public.submission_feedback (ref_submission_id)
    WHERE is_valid = true;

COMMENT ON INDEX public.submission_feedback_one_valid_per_submission IS
    '同一篇繳交最多一筆有效批改（批改結果是版本模型，見 InstructorHelper.saveFeedback）';

COMMIT;

-- ── 套用後檢查：應該看得到這個索引 ──
--
-- SELECT indexdef FROM pg_indexes
--  WHERE tablename = 'submission_feedback'
--    AND indexname = 'submission_feedback_one_valid_per_submission';


-- ════════════════════════════════════════════════════════════
-- 套用紀錄
-- ════════════════════════════════════════════════════════════
--
--   writing_classroom_test2     開發用      ⬜ 需要 postgres
--   writing_classroom_test      開發用      ⬜ 需要 postgres
--   writing_classroom_autotest  自動化測試  ⬜ 需要 postgres。套了之後測試才會走到資料庫這一道防護
--   writing_classroom           production  ⬜ ← 人工決定與執行
