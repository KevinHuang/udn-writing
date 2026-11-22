-- ============================================================
-- 011 — 稿紙逐格辨識（handwriting_grid_result）
-- ============================================================
--
-- ## 背景
--
-- 老師批次代繳交時，照片是「我的稿紙」印的稿紙（四角有定位標記：聯合報國中、聯合盃、會考、學測）
-- 就改走**逐格辨識**（services/handwriting-ocr ＋ Gemini），不再交給黑箱的 Cloud Run Job `ocr-job`。
-- 逐格辨識除了全文，還有每一格的字與可信度、錯別字、格式問題、拉正的稿紙圖 ——
-- 之後的簡易批改與原稿紅筆都要用。設計見 docs/grid-ocr.md。
--
-- ## 一列＝一批照片
--
-- 對到 batch_proxy_submission（一位學生、一次上傳＝一批）。上傳時服務 /check 認出是我們的稿紙，
-- 就先建一列 status='pending'；沒有這一列的批次照舊走 ocr-job。
--
-- ⚠️ 不要用 batch_proxy_submission.is_valid 過濾這張表：老師校對完會把那一批退役（is_valid=false），
--    但逐格辨識的結果（之後的原稿紅筆）還要用。
--
-- ## 狀態
--
--   pending   已上傳、還沒按「開始辨識」
--   queued    已送出、等背景工作領取
--   running   辨識中（started_at）
--   done      完成：全文已寫進 submission.content（已批改的不覆寫）
--   failed    失敗：error_code、error_message 給老師看（例如缺角請重拍）
--
-- 逾時（running 太久）由程式判斷，不另存狀態。
--
-- ## 套用順序
--
-- 先套這份，再部署新程式。可以重複執行。
--
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.handwriting_grid_result (
    id                bigserial PRIMARY KEY,
    ref_batch_id      bigint NOT NULL UNIQUE
        REFERENCES public.batch_proxy_submission (id) ON DELETE CASCADE,
    ref_assignment_id bigint NOT NULL,
    ref_user_id       bigint NOT NULL,
    status            text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'queued', 'running', 'done', 'failed')),
    error_code        text,
    error_message     text,
    attempts          integer NOT NULL DEFAULT 0,
    -- 上傳時 /check 認出的稿紙（例如 udn、ucup、cap、gsat），給名冊顯示用
    sheet_template    text,

    -- 辨識結果（done 才有）
    marked_text       text,          -- 全文，辨識不確定的字標〔?〕
    chars             integer,
    paragraphs        integer,
    completion        real,          -- 辨識完成度：可信的格子 ÷ 有寫字的格子
    pages             jsonb,         -- 每頁：template、format、paper、每格的字與狀態（原稿紅筆用）
    format_issues     jsonb,         -- 段首空兩格、標點在行首
    typo_marks        jsonb,         -- 錯別字（kind=typo 確定／check 待確認）
    warnings          jsonb,
    page_image_files  jsonb,         -- 拉正的稿紙圖：GCS 裸檔名，依頁序（資料夾同照片）
    prompt_version    integer,
    model             text,
    ai_calls          integer,
    input_tokens      integer,
    output_tokens     integer,
    timing            jsonb,

    created_at        timestamptz NOT NULL DEFAULT now(),
    started_at        timestamptz,
    finished_at       timestamptz,
    updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS handwriting_grid_result_assignment_user
    ON public.handwriting_grid_result (ref_assignment_id, ref_user_id);

COMMENT ON TABLE public.handwriting_grid_result IS
  '稿紙逐格辨識：一批代繳交照片一列（對到 batch_proxy_submission）。狀態、失敗原因、逐格結果、錯別字、拉正圖。見 docs/grid-ocr.md。';

COMMIT;


-- ════════════════════════════════════════════════════════════
-- 套用紀錄
-- ════════════════════════════════════════════════════════════
--
--   writing_classroom_test2     開發用      ✅ 已套用（2026-11-20，以 writing_mng 執行）
--   writing_classroom_autotest  自動化測試  ✅ 已套用（2026-11-20，同上）
--   writing_classroom           production  ⬜ ← 人工決定與執行
