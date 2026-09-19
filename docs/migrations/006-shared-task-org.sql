-- ============================================================
-- 006 — 共用題目／資料夾補上組織（ref_org_id）
-- ============================================================
--
-- ## 背景
--
-- 授課教師看得到的共用題，是「ref_org_id 屬於自己任教組織」的那些
-- （TaskHelper.getByInstructorUserId）。但新系統的 TaskHelper.create 以前
-- **完全沒寫 ref_org_id** —— 透過新系統建的共用題一律是 NULL，老師永遠看不到。
-- 程式已經修好（create／update 會補上組織，見 task_helper.ts 的 orgOfUser），
-- 這份處理修好之前建的那些。
--
-- 2026-09-19 在 writing_classroom_test 盤點：
--
--     共用題  ref_org_id = 1（聯合報）   4 題   ← 舊系統建的，正常
--     共用題  ref_org_id IS NULL         3 題   ← 這份要補的
--     共用資料夾                         0 個
--     組織                               1 個（聯合報）
--
-- 組織的取法與程式一致：建立者任教班級的組織，沒有就取第一個組織。
-- 正式資料只有一個組織，所以結果就是聯合報。
--
-- 可以重複執行：只動 ref_org_id 還是 NULL 的共用列。
--
-- ============================================================

-- ── 套用前檢查 ──
--
-- SELECT count(*) FROM task        WHERE shared = true AND ref_org_id IS NULL;
-- SELECT count(*) FROM task_folder WHERE shared = true AND ref_org_id IS NULL;

BEGIN;

UPDATE public.task AS t
   SET ref_org_id = COALESCE(
         (SELECT crs.ref_org_id FROM public.uc_instructor AS inst
             INNER JOIN public.course AS crs ON crs.id = inst.ref_course_id
           WHERE inst.ref_user_id = t.ref_user_id AND crs.ref_org_id IS NOT NULL LIMIT 1),
         (SELECT id FROM public.org ORDER BY id LIMIT 1))
 WHERE t.shared = true AND t.ref_org_id IS NULL;

UPDATE public.task_folder AS f
   SET ref_org_id = COALESCE(
         (SELECT crs.ref_org_id FROM public.uc_instructor AS inst
             INNER JOIN public.course AS crs ON crs.id = inst.ref_course_id
           WHERE inst.ref_user_id = f.ref_user_id AND crs.ref_org_id IS NOT NULL LIMIT 1),
         (SELECT id FROM public.org ORDER BY id LIMIT 1))
 WHERE f.shared = true AND f.ref_org_id IS NULL;

COMMIT;

-- ── 套用後檢查：兩個都應該是 0 ──
--
-- SELECT count(*) FROM task        WHERE shared = true AND ref_org_id IS NULL;
-- SELECT count(*) FROM task_folder WHERE shared = true AND ref_org_id IS NULL;
