-- ============================================================
-- 008 — 班級的「展示區是否顯示級分」設定（course_showcase）
-- ============================================================
--
-- ## 背景
--
-- 數位作品集（另一個獨立平台，給學生與家長用）會從這個系統取得作品，
-- 其中「同校佳作觀摩」要不要讓學生看到同儕的級分，由**授課教師逐班決定**。
-- 老師在這個系統設定，作品集讀取這個設定。分工見數位作品集的
-- `UDN_整合分析.md`。
--
-- ## 做法：另開一張表，不在 course 加欄位
--
--     course_showcase
--       ref_course_id  bigint  PK，ref: course.id（刪課程時一起刪）
--       show_score     boolean 預設 false
--       ref_user_id    bigint  最後修改的人
--       updated_at     timestamptz
--
-- 為什麼不直接在 course 加一欄：
--   1. `course` 的擁有者是 postgres，應用程式用的 writing_mng 沒有 ALTER 權限
--      （見 artifacts/action-items.md 第 5 項）。開新表 writing_mng 自己就能做，
--      開發與測試庫不必等 DBA。
--   2. 這是「給作品集用的班級設定」，跟課程本身的資料（名稱、學期、校務同步）
--      無關。之後作品集若還需要別的班級設定，加在這張表，不必再動 course。
--
-- **沒有資料列＝不顯示級分。** 使用者決定預設隱藏（對學生隱私較保守），
-- 讀的一方一律 `COALESCE(show_score, false)`。所以既有班級不需要補資料。
--
-- writing_showcase（給展示端用的唯讀角色，見 001）同樣給 SELECT。
--
-- ## 套用順序
--
-- **先套這份，再部署新程式。** 新程式的課程清單會 LEFT JOIN 這張表，
-- 表不存在整個課程清單就載不出來。反過來（先套、舊程式還在跑）沒有影響。
--
-- 可以重複執行。
--
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.course_showcase (
    ref_course_id bigint PRIMARY KEY
        REFERENCES public.course (id) ON DELETE CASCADE,
    show_score    boolean NOT NULL DEFAULT false,
    ref_user_id   bigint,
    updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.course_showcase IS
  '班級給數位作品集用的展示設定。沒有資料列＝全部用預設值（不顯示級分）。';
COMMENT ON COLUMN public.course_showcase.show_score IS
  '數位作品集的同校佳作觀摩是否顯示這一班作品的級分。預設 false。';
COMMENT ON COLUMN public.course_showcase.ref_user_id IS
  '最後修改的人。ref: user.id';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'writing_showcase') THEN
        GRANT SELECT ON public.course_showcase TO writing_showcase;
    END IF;
END $$;

COMMIT;


-- ════════════════════════════════════════════════════════════
-- 套用紀錄
-- ════════════════════════════════════════════════════════════
--
--   writing_classroom_test      開發用      ✅ 已套用（2026-10-01，以 writing_mng 執行，表的擁有者是 writing_mng）
--   writing_classroom_autotest  自動化測試  ✅ 已套用（2026-10-01，同上）
--   writing_classroom           production  ⬜ ← 人工決定與執行
