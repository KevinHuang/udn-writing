-- ============================================================
-- 003 — 校正 assignment.deadline 的時區偏移
-- ============================================================
--
-- ## 問題
--
-- 前端的截止日輸入是 `<input type="datetime-local">`，它的值長得像
-- `2026-09-24T23:59` —— **不帶時區**。先前 api/assignments.ts 把這個原字串
-- 直接送給後端，而 `assignment.deadline` 是 `timestamp with time zone`，
-- Postgres 於是用**伺服器時區（UTC）**去解讀它。
--
-- 結果：老師設「9/24 23:59」，實際存成 `2026-09-24 23:59 UTC`，
-- 在台灣顯示是 **9/25 07:59** —— 整整晚了 8 小時。
--
-- 程式端已修（api/assignments.ts 的 toIsoDeadline()，送出前轉成帶時區的 ISO）。
-- 這份 migration 處理的是**在那之前就寫進去的資料**。
--
-- ## 校正方式
--
-- 把「UTC 的牆上時間」重新當成「台北的牆上時間」：
--
--     (deadline AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Taipei'
--
--   第一步 → naive timestamp，取出 UTC 的 23:59
--   第二步 → 把那個 23:59 當成台北時間，得到正確的 timestamptz
--
-- ## ⚠️ 只改指名的這幾筆
--
-- **刻意不用 `WHERE deadline IS NOT NULL` 一次全改。** 程式修好之後新建的
-- 截止日是正確的，若這份 migration 晚一步才套用，會把那些正確的資料也往前
-- 推 8 小時 —— 一個只能套用一次、而且順序不能錯的 migration 太脆弱。
--
-- 下面的 id 是 2026-09-17 盤點 writing_classroom_test 時，**所有**設了截止日
-- 的作業（共 3 筆，全部都是台北時間 07:59，也就是這個 bug 的指紋）。
-- 套用到別的資料庫之前，請先跑「套用前檢查」確認 id 與筆數相符。
--
-- ============================================================

-- ── 套用前檢查：應該列出 3 筆，時間全部是 07:59 ──
--
-- SELECT a.id, t.title,
--        to_char(a.deadline AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD HH24:MI') AS 目前_台北,
--        to_char((a.deadline AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Taipei'
--                  AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD HH24:MI')          AS 校正後_台北
--   FROM assignment a JOIN task t ON t.id = a.ref_task_id
--  WHERE a.deadline IS NOT NULL
--  ORDER BY a.id;

BEGIN;

UPDATE assignment
   SET deadline = (deadline AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Taipei'
 WHERE id IN (92, 98, 99)
   AND deadline IS NOT NULL
   -- 再確認一次指紋：只有台北時間剛好是 07:59 的才是受影響的資料。
   -- 已經校正過的會變成 23:59，再跑一次不會重複扣。
   AND to_char(deadline AT TIME ZONE 'Asia/Taipei', 'HH24:MI') = '07:59';

COMMIT;

-- ── 套用後檢查：時間應該全部變成 23:59 ──
--
-- SELECT a.id, t.title,
--        to_char(a.deadline AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD HH24:MI') AS 台北時間
--   FROM assignment a JOIN task t ON t.id = a.ref_task_id
--  WHERE a.deadline IS NOT NULL
--  ORDER BY a.id;
