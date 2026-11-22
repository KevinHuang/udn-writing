-- ============================================================
-- 012 — 簡易批改：只給老師看的細節（simple_grading_result）
-- ============================================================
--
-- ## 背景
--
-- 稿紙代繳交、經逐格辨識的作文，學生沒有校稿，AI 批改改用**簡易批改**（docs/simple-grading.md）：
-- 不逐句批改、辨識不確定的字不引用也不批評。結果分兩份存：
--
--   學生看得到的   級分、評語（總評＋亮點、建議、成語鼓勵）→ 照舊存 submission_feedback（老師可以改）
--   只給老師看的   評分依據、判 0 級分的原因、請老師留意、系統拿掉了哪些引用，
--                 以及結構化的卡片（每個引用落在哪幾格，第三階段在原稿上畫線用）→ 這張表
--
-- 只給老師看的內容**不能**放進 submission_feedback.content：學生端讀的就是那一欄。
-- 學生端的 API 完全不讀這張表。
--
-- ## 一篇作文一列
--
-- 重新 AI 批改就整列換掉；「重置批改」刪掉（作文回到待批改，舊的評分依據不再對得上）。
-- 老師手動改級分、改評語不動這一列 —— 卡片與請老師留意照樣有參考價值。
--
-- ## 套用順序
--
-- 先套 011，再套這份，再部署新程式。可以重複執行。
--
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.simple_grading_result (
    id                  bigserial PRIMARY KEY,
    ref_submission_id   bigint NOT NULL UNIQUE,
    -- 批改時用的是哪一份逐格辨識結果（之後原稿紅筆要用同一份的格子）
    ref_grid_result_id  bigint
        REFERENCES public.handwriting_grid_result (id) ON DELETE SET NULL,
    -- 這次 AI 批改存成的那一版（submission_feedback.id）
    ref_feedback_id     bigint,
    detail              jsonb NOT NULL,
    model               text,
    prompt_version      integer,
    ai_calls            integer NOT NULL DEFAULT 0,
    input_tokens        integer NOT NULL DEFAULT 0,
    output_tokens       integer NOT NULL DEFAULT 0,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.simple_grading_result IS
    '簡易批改只給老師看的細節（評分依據、請老師留意、卡片的格子位置）。學生端不讀。docs/simple-grading.md';

COMMIT;


-- ════════════════════════════════════════════════════════════
-- 套用紀錄
-- ════════════════════════════════════════════════════════════
--
--   writing_classroom_test2     開發用      ✅ 已套用（2026-11-20，以 writing_mng 執行）
--   writing_classroom_autotest  自動化測試  ✅ 已套用（2026-11-20，同上）
--   writing_classroom           production  ⬜ ← 人工決定與執行（要先套 011）
