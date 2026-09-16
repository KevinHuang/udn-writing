--
-- Migration 001：補齊原型有、既有 schema 沒有的五項功能
--
-- ⚠️ 這份是**草案，等待審核**。還沒有套用到任何資料庫。
--
-- ⛔ 審核通過後**先套用到 writing_classroom_test 驗證**。
--    writing_classroom 是 production，有線上使用者正在使用 ——
--    對它套用 migration 是另一件事，要人決定與執行，不要自動化。
--
-- 原則：
--   1. 既有的表只「加欄位」，不改型別、不改預設值、不刪任何東西。
--   2. 新增的欄位全部可為 NULL 或有預設值，既有資料不受影響。
--   3. 沿用既有 schema 的慣例：bigint id、ref_xxx_id 命名、timestamptz、
--      以及每個表與欄位都有 COMMENT。
--   4. 新表補上與既有表相同的角色授權（writing_mng / writing_showcase），
--      否則應用程式的角色讀不到。
--
-- 對應 artifacts/spec.md 第 2 節「原型有／schema 沒有」那張表。
--

BEGIN;

-- ════════════════════════════════════════════════════════════
-- 1. 作業的截止日與排序
-- ════════════════════════════════════════════════════════════
--
-- 決策：時間模型以原型為準（截止日 + 教師拖拉排序）。
-- assignment.week_no（第幾週）保留不動，本系統不寫入也不讀取 ——
-- 它可能有既有資料或其他系統在用。
--
-- deadline 必須可為 NULL：原型的註解明寫「老師派作業時預設不設截止日，
-- 需要才手動開啟，這是實際的操作習慣」。NULL = 沒有截止日。
--
-- 欄位叫 sort_order 不叫 order —— order 是 SQL 保留字。
-- 它是排序鍵不是顯示編號，畫面上的 1、2、3 一律用位置現算
-- （見 lib/assignmentOrder.ts），所以中間刪掉一份留下的空號不影響顯示。

ALTER TABLE public.assignment
  ADD COLUMN deadline timestamp with time zone,
  ADD COLUMN allow_late_submission boolean DEFAULT false NOT NULL,
  ADD COLUMN sort_order integer;

COMMENT ON COLUMN public.assignment.deadline IS
  '繳交截止時間。NULL 代表沒有截止日（預設）。';
COMMENT ON COLUMN public.assignment.allow_late_submission IS
  '是否允許逾期繳交。deadline 為 NULL 時無意義。';
COMMENT ON COLUMN public.assignment.sort_order IS
  '教師排定的順序（班級內、0 起算）。NULL 排在最後。這是排序鍵，不是顯示編號。';


-- ════════════════════════════════════════════════════════════
-- 2. 題庫資料夾
-- ════════════════════════════════════════════════════════════
--
-- task 表目前只有 ref_user_id / ref_org_id / shared，沒有任何分類結構，
-- 但前端有完整的資料夾樹（lib/folders.ts、QuestionBank.tsx）。
--
-- shared / ref_org_id 的規則與 task 一致：共享資料夾屬於組織，
-- 個人資料夾屬於教師。這樣「共享題庫」與「個人題庫」兩棵樹才分得開。
--
-- 題目數**不存在資料夾上**，一律用 count 算 —— 前端的 lib/folders.ts
-- 已經是這樣做的，原因見 CLAUDE.md「同一份資訊不要在多處各自解析」。

CREATE TABLE public.task_folder (
    id bigserial NOT NULL,
    name character varying NOT NULL,
    ref_parent_id bigint,
    ref_user_id bigint,
    ref_org_id bigint,
    shared boolean DEFAULT false NOT NULL,
    created_time timestamp with time zone DEFAULT now() NOT NULL,
    updated_time timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.task_folder OWNER TO postgres;
ALTER TABLE ONLY public.task_folder ADD CONSTRAINT task_folder_pkey PRIMARY KEY (id);

COMMENT ON TABLE  public.task_folder IS '題庫資料夾。個人資料夾屬於教師，共享資料夾屬於組織。';
COMMENT ON COLUMN public.task_folder.ref_parent_id IS '上層資料夾。NULL 代表根層級。ref: task_folder.id';
COMMENT ON COLUMN public.task_folder.ref_user_id IS '擁有者。ref: user.id';
COMMENT ON COLUMN public.task_folder.ref_org_id IS '所屬組織。shared 為 true 時必填。ref: org.id';
COMMENT ON COLUMN public.task_folder.shared IS '是否為組織共享資料夾。規則與 task.shared 相同。';

CREATE INDEX idx_task_folder_ref_parent_id ON public.task_folder USING btree (ref_parent_id);
CREATE INDEX idx_task_folder_ref_user_id   ON public.task_folder USING btree (ref_user_id);

ALTER TABLE public.task ADD COLUMN ref_folder_id bigint;
COMMENT ON COLUMN public.task.ref_folder_id IS '所屬資料夾。NULL 代表放在根層級。ref: task_folder.id';
CREATE INDEX idx_task_ref_folder_id ON public.task USING btree (ref_folder_id);


-- ════════════════════════════════════════════════════════════
-- 3. 作品標記（佳作／預選）
-- ════════════════════════════════════════════════════════════
--
-- 對應 lib/submissionMarks.ts。前端的結構是巢狀的
-- Record<submission.id, Partial<Record<'featured'|'preselect', Mark>>>，
-- 攤平成一列一個章。
--
-- UNIQUE (ref_submission_id, kind) 是這張表的重點 ——
-- 它就是那個巢狀結構的內層鍵，一份作品同一種章只能有一個。
--
-- 取消蓋章一律 DELETE 整列，**不要加 is_valid 之類的旗標留著**。
-- CLAUDE.md 明寫：「取消時把那個 key 整個刪掉，留 false 會讓
-- Object.keys() 數到不存在的標記」。同樣的道理在這裡是
-- 「留一列 is_valid=false 會讓 COUNT 數錯」。
--
-- kind 用 varchar 不用 enum：之後要加第三種章（選文、比賽送件…）時
-- 加 enum 值需要 ALTER TYPE，在生產庫上比較麻煩。值域由應用層驗證。

CREATE TABLE public.submission_mark (
    id bigserial NOT NULL,
    ref_submission_id bigint NOT NULL,
    kind character varying NOT NULL,
    ref_user_id bigint,
    marked_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.submission_mark OWNER TO postgres;
ALTER TABLE ONLY public.submission_mark ADD CONSTRAINT submission_mark_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.submission_mark ADD CONSTRAINT "UQIX_SUBMISSION_MARK" UNIQUE (ref_submission_id, kind);

COMMENT ON TABLE  public.submission_mark IS '作品標記（教師蓋在作文上的印章）。學生端完全不顯示。';
COMMENT ON COLUMN public.submission_mark.ref_submission_id IS '被蓋章的作品。ref: submission.id';
COMMENT ON COLUMN public.submission_mark.kind IS '章的種類：featured（佳作）／preselect（預選）。';
COMMENT ON COLUMN public.submission_mark.ref_user_id IS '蓋章的教師。ref: user.id';

CREATE INDEX idx_submission_mark_ref_submission_id ON public.submission_mark USING btree (ref_submission_id);


-- ════════════════════════════════════════════════════════════
-- 4. 請假註記
-- ════════════════════════════════════════════════════════════
--
-- 對應 lib/leave.ts。逾期沒交有兩種：真的沒寫，和請假。
--
-- 為什麼是獨立的表而不是 submission 上的欄位：
-- **請假的那一份根本沒有繳交紀錄**，沒有東西可以掛。
-- 所以鍵是「作業 × 學生」的複合鍵。
--
-- UNIQUE (ref_assignment_id, ref_user_id)：一個學生在一份作業上
-- 只能有一筆請假註記。取消請假一樣 DELETE 整列。

CREATE TABLE public.assignment_leave (
    id bigserial NOT NULL,
    ref_assignment_id bigint NOT NULL,
    ref_user_id bigint NOT NULL,
    ref_marker_id bigint,
    created_time timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.assignment_leave OWNER TO postgres;
ALTER TABLE ONLY public.assignment_leave ADD CONSTRAINT assignment_leave_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.assignment_leave ADD CONSTRAINT "UQIX_ASSIGNMENT_LEAVE" UNIQUE (ref_assignment_id, ref_user_id);

COMMENT ON TABLE  public.assignment_leave IS
  '請假註記。標成請假的學生不計入逾期未繳，關心名單（lib/concern.ts）也讀這張表。';
COMMENT ON COLUMN public.assignment_leave.ref_assignment_id IS '哪一份作業。ref: assignment.id';
COMMENT ON COLUMN public.assignment_leave.ref_user_id IS '請假的學生。ref: user.id';
COMMENT ON COLUMN public.assignment_leave.ref_marker_id IS '註記的教師。ref: user.id';

CREATE INDEX idx_assignment_leave_ref_assignment_id ON public.assignment_leave USING btree (ref_assignment_id);


-- ════════════════════════════════════════════════════════════
-- 5. 學生草稿  ⚠️ 待確認（spec.md 開放問題 3）
-- ════════════════════════════════════════════════════════════
--
-- 前端的 SubmissionStatus 有 Draft（學生寫了但還沒送出），
-- 但 schema 裡 submission 一旦有紀錄就等於已繳交，沒有草稿的表示方式。
--
-- DEFAULT true 的用意：既有資料全部視為已繳交，現況完全不變。
--
-- 如果你們的產品決定「不做草稿，學生按下去就是繳交」，
-- 請把這一段從 migration 刪掉，我會把前端的 Draft 狀態一併移除。

ALTER TABLE public.submission
  ADD COLUMN is_submitted boolean DEFAULT true NOT NULL;

COMMENT ON COLUMN public.submission.is_submitted IS
  'false 代表學生的草稿（尚未送出）。既有資料一律 true。';


-- ════════════════════════════════════════════════════════════
-- 6. 角色授權
-- ════════════════════════════════════════════════════════════
-- 沿用既有表的授權方式。沒有這段的話，應用程式的角色讀不到新表。

GRANT ALL    ON TABLE public.task_folder       TO writing_mng;
GRANT SELECT ON TABLE public.task_folder       TO writing_showcase;
GRANT ALL    ON TABLE public.submission_mark   TO writing_mng;
GRANT SELECT ON TABLE public.submission_mark   TO writing_showcase;
GRANT ALL    ON TABLE public.assignment_leave  TO writing_mng;
GRANT SELECT ON TABLE public.assignment_leave  TO writing_showcase;

GRANT ALL    ON SEQUENCE public.task_folder_id_seq      TO writing_mng;
GRANT ALL    ON SEQUENCE public.submission_mark_id_seq  TO writing_mng;
GRANT ALL    ON SEQUENCE public.assignment_leave_id_seq TO writing_mng;

COMMIT;


-- ════════════════════════════════════════════════════════════
-- 審核時請特別看這一項：要不要加外鍵？
-- ════════════════════════════════════════════════════════════
--
-- 既有資料庫**一個外鍵都沒有**（全庫 FOREIGN KEY 數量是 0），
-- 所以上面的新表也沿用同樣的慣例，沒有加。
--
-- 但這代表刪除連鎖完全靠應用層。而 CLAUDE.md 有整整一節在講
-- 「孤兒標記」踩過的坑 —— 那個坑現在在資料庫層級是敞開的：
-- 刪掉一份 submission，它的 submission_mark 會留下來指向不存在的作品。
--
-- **我的建議是對這三張新表加上外鍵**，理由是它們只由這個系統寫入，
-- 不會影響其他系統既有的寫入行為，而 ON DELETE CASCADE 正好
-- 自動處理掉那個孤兒問題：
--
--   ALTER TABLE public.submission_mark
--     ADD CONSTRAINT fk_submission_mark_submission
--     FOREIGN KEY (ref_submission_id) REFERENCES public.submission(id) ON DELETE CASCADE;
--
--   ALTER TABLE public.assignment_leave
--     ADD CONSTRAINT fk_assignment_leave_assignment
--     FOREIGN KEY (ref_assignment_id) REFERENCES public.assignment(id) ON DELETE CASCADE;
--
--   ALTER TABLE public.task_folder
--     ADD CONSTRAINT fk_task_folder_parent
--     FOREIGN KEY (ref_parent_id) REFERENCES public.task_folder(id) ON DELETE CASCADE;
--
-- 風險：若有其他系統在刪 submission / assignment，它們的刪除會連帶
-- 清掉這裡的標記與請假註記 —— 這正是我們要的行為，但那些系統的
-- 開發者不會預期到。**請 DBA 確認後再決定是否啟用。**
--
-- 決定之後請把結論寫回 artifacts/spec.md 第 3 節。
