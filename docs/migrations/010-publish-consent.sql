-- ============================================================
-- 010 — 學生對佳作的公開意願（submission_publish_consent）
-- ============================================================
--
-- ## 背景
--
-- 被老師選為佳作的作品，可以放到數位作品集（另一個獨立平台）的「同校佳作觀摩」。
-- 公開需要兩個人都同意：
--   學生本人   —— 在這個系統的「我的作品集」頁設定（使用者決定，2026-10-01）
--   家長       —— 在數位作品集那邊（不在這個系統）
--
-- 這張表只記學生的意願。數位作品集之後透過資料介面讀這一欄。
--
-- ## 欄位
--
--   ref_submission_id  PK，ref: submission.id（作品刪掉時一起刪）
--   willing            true 願意公開／false 不公開
--   ref_user_id        誰設的（學生本人）
--   updated_at
--
-- **沒有資料列＝還沒決定，一律當成不公開。** 對學生隱私較保守，
-- 也和「展示區預設不顯示級分」（008）同一個方向。
--
-- 只有**已發還、而且蓋了佳作章**的作品可以設定（後端 API 擋）。
-- 老師之後取消佳作章，這一列留著也沒關係 —— 觀摩只列佳作，意願只是其中一個條件。
--
-- ## 套用順序
--
-- 先套這份，再部署新程式（學生的作業清單會 LEFT JOIN 這張表）。可以重複執行。
--
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.submission_publish_consent (
    ref_submission_id bigint PRIMARY KEY
        REFERENCES public.submission (id) ON DELETE CASCADE,
    willing     boolean NOT NULL,
    ref_user_id bigint,
    updated_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.submission_publish_consent IS
  '學生對自己佳作的公開意願（數位作品集的同校觀摩用）。沒有資料列＝還沒決定，當成不公開。家長同意在數位作品集那邊。';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'writing_showcase') THEN
        GRANT SELECT ON public.submission_publish_consent TO writing_showcase;
    END IF;
END $$;

COMMIT;


-- ════════════════════════════════════════════════════════════
-- 套用紀錄
-- ════════════════════════════════════════════════════════════
--
--   writing_classroom_test      開發用      ✅ 已套用（2026-10-01，以 writing_mng 執行）
--   writing_classroom_autotest  自動化測試  ✅ 已套用（2026-10-01，同上）
--   writing_classroom           production  ⬜ ← 人工決定與執行
