-- ============================================================
-- 013 — 原稿紅筆：老師對錯字、格式提醒的決定（manuscript_mark_decision）
-- ============================================================
--
-- ## 背景
--
-- 稿紙代繳交的作文，老師在批改頁的原稿上確認錯字（docs/manuscript.md）：
--   待確認的錯字  → 是錯字／改正確的字／不是錯字
--   系統標的錯字  → 改正確的字／不是錯字（可以復原）
--   原稿上任何一格 → 老師自己加錯字
--   格式提醒      → 不是格式問題（可以復原）
-- 每按一下就存一列。辨識服務的原始結果（handwriting_grid_result）**不改**，顯示時再合起來
-- （apps/api/src/lib/manuscript/marks.ts）。
--
-- ## 鍵
--
-- (ref_grid_result_id, target, cell_key)：決定跟著**那一次的辨識結果**走。老師重拍、重新辨識之後
-- 是新的一份結果、新的格子，舊的決定對不上，就不再用。和批改結果分開：重置批改不會清掉。
--
--   target    typo（錯字）／format（格式提醒）
--   cell_key  標記的第一格，`第N頁:行:格`
--   decision  confirm（是錯字，或改了正確的字）／veto（不是）／add（老師加的錯字）
--             復原、刪掉老師加的錯字＝刪掉那一列
--
-- 發還之後鎖住（程式擋），要改先收回發還。
--
-- ## 套用順序
--
-- 先套 011、012，再套這份，再部署新程式。可以重複執行。
--
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.manuscript_mark_decision (
    id                  bigserial PRIMARY KEY,
    ref_grid_result_id  bigint NOT NULL
        REFERENCES public.handwriting_grid_result (id) ON DELETE CASCADE,
    ref_submission_id   bigint NOT NULL,
    target              text NOT NULL CHECK (target IN ('typo', 'format')),
    cell_key            text NOT NULL CHECK (char_length(cell_key) <= 64),
    decision            text NOT NULL CHECK (decision IN ('confirm', 'veto', 'add')),
    correct             text CHECK (correct IS NULL OR char_length(correct) <= 4),
    note                text CHECK (note IS NULL OR char_length(note) <= 200),
    decided_by          bigint,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT manuscript_mark_decision_mark UNIQUE (ref_grid_result_id, target, cell_key),
    -- 格式提醒只能否決；老師加的錯字一定要有正確的字
    CONSTRAINT manuscript_mark_decision_format_veto CHECK (target = 'typo' OR decision = 'veto'),
    CONSTRAINT manuscript_mark_decision_add_correct CHECK (decision <> 'add' OR (correct IS NOT NULL AND char_length(correct) > 0))
);

CREATE INDEX IF NOT EXISTS manuscript_mark_decision_submission
    ON public.manuscript_mark_decision (ref_submission_id);

COMMENT ON TABLE public.manuscript_mark_decision IS
    '原稿紅筆：老師對錯字、格式提醒的決定；跟著那一次的逐格辨識結果，和批改結果分開。docs/manuscript.md';

COMMIT;


-- ════════════════════════════════════════════════════════════
-- 套用紀錄
-- ════════════════════════════════════════════════════════════
--
--   writing_classroom_test2     開發用      ✅ 已套用（2026-11-20，以 writing_mng 執行）
--   writing_classroom_autotest  自動化測試  ✅ 已套用（2026-11-20，同上）
--   writing_classroom           production  ⬜ ← 人工決定與執行（要先套 011、012）
