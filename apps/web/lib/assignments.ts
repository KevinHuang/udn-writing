/**
 * 作業的純計算邏輯 —— 全站唯一來源。
 *
 * 這裡的函式都沒有副作用、不依賴 React，可以直接在 console 驗證。
 * 比照 lib/folders.ts、lib/concern.ts、lib/statusStyles.ts 的做法。
 *
 * ── 三種狀態的語意 ──────────────────────────────────────────
 *   Draft      未開放。學生完全看不到，老師可以先把題目與截止日準備好
 *              （＝「預定計畫模式」）
 *   Published  進行中。學生看得到、可以繳交
 *   Closed     已關閉。學生仍可看到成績，但不能再繳交；
 *              也只有在這個狀態下才允許更換題目
 *
 * 學生端的可見性判斷早就存在（StudentAssignments 排除 Draft、
 * StudentDashboard 只顯示 Published/Closed），所以「作業開關」
 * 就是在 Draft ⇄ Published 之間切換，不需要額外欄位。
 */

import { Assignment, Submission } from '../types';

/* ══════════════════════════════════════════════════════════════
   查詢
   ══════════════════════════════════════════════════════════════ */

/** 某個班級的所有作業（含未開放的草稿，老師才看得到） */
export function assignmentsForCourse(
  assignments: Assignment[],
  courseId: string,
): Assignment[] {
  return assignments.filter((a) => a.courseId === courseId);
}

/** 沒有截止日時的顯示字樣。全站共用一個講法 */
export const NO_DEADLINE_LABEL = '無截止日';

/**
 * 這份作業有沒有設截止日。
 *
 * 老師派作業時預設**不設**截止日，需要才手動開啟。所以 config.deadline
 * 可能是 undefined 或空字串，也可能是壞掉的字串 —— 三種都算沒有。
 * 專案沒有開 strictNullChecks，TypeScript 不會幫忙抓，一律走這一支。
 */
export function hasDeadline(assignment: Assignment): boolean {
  const d = assignment.config.deadline;
  return Boolean(d) && !Number.isNaN(new Date(d as string).getTime());
}

/** 截止時間。沒有設就回 null —— 不要回 Invalid Date 讓它繼續往下流 */
export function deadlineOf(assignment: Assignment): Date | null {
  return hasDeadline(assignment) ? new Date(assignment.config.deadline as string) : null;
}

/** 截止日的顯示字串。沒設就是「無截止日」 */
export function deadlineLabel(
  assignment: Assignment,
  options: { withTime?: boolean } = {},
): string {
  const d = deadlineOf(assignment);
  if (!d) return NO_DEADLINE_LABEL;
  return options.withTime ? d.toLocaleString() : d.toLocaleDateString();
}

/**
 * 是否已過截止時間。
 *
 * **沒有設截止日就永遠不算逾期** —— 這一條會一路影響到缺繳、
 * 關心名單與學生端的「已逾期」標記。
 */
export function isOverdue(assignment: Assignment, now: Date = new Date()): boolean {
  const d = deadlineOf(assignment);
  return d !== null && d < now;
}

/**
 * 作業在課程工作台裡的分組。
 * 「進行中」只算已開放且未過期的，這與 AssignmentsModal 原本的判斷一致。
 */
export type AssignmentBucket = 'active' | 'draft' | 'closed';

export function bucketOf(assignment: Assignment, now: Date = new Date()): AssignmentBucket {
  if (assignment.status === 'Draft') return 'draft';
  if (assignment.status === 'Closed') return 'closed';
  return isOverdue(assignment, now) ? 'closed' : 'active';
}

/* ══════════════════════════════════════════════════════════════
   挑一份作業
   ══════════════════════════════════════════════════════════════ */

/**
 * 切換班級時要落在哪一份作業。
 *
 * 課程作業清單的順序是**老師自己排的**（見 lib/assignmentOrder.ts），
 * 而老師排的第一份很可能是還沒開放、一份繳交都沒有的草稿 ——
 * 直接取第一份會把老師丟到一個空畫面，看起來像切換失敗。
 *
 * 所以這裡不照任何一種「順序」挑，而是挑一份**真的有東西可以做**的：
 * 有待批改的優先（那就是他切過來的目的），其次是已經開放在收件的，
 * 都沒有才退回第一份。
 *
 * 這裡刻意不接受排序參數 —— 這支函式只有一個用途，
 * 名字就要說清楚它在挑什麼，而不是「排一排取 [0]」。
 */
export function firstWorthGrading(
  list: Assignment[],
  submissions: Submission[],
): Assignment | undefined {
  if (!list.length) return undefined;

  const withPending = list.filter((a) => submissionStats(a, submissions).pending > 0);
  if (withPending.length) {
    // 同樣有待批改時，待批改多的先來
    return [...withPending].sort(
      (a, b) =>
        submissionStats(b, submissions).pending -
          submissionStats(a, submissions).pending ||
        a.id.localeCompare(b.id),
    )[0];
  }

  return list.find((a) => a.status === 'Published') ?? list[0];
}

/* ══════════════════════════════════════════════════════════════
   繳交統計
   ══════════════════════════════════════════════════════════════ */

export interface SubmissionStats {
  /** 名冊人數 */
  total: number;
  /** 已繳交（不含未繳與草稿） */
  submitted: number;
  pending: number;
  graded: number;
  published: number;
  missing: number;
}

export function submissionStats(
  assignment: Assignment,
  submissions: Submission[],
): SubmissionStats {
  const mine = submissions.filter((s) => s.assignmentId === assignment.id);
  const count = (...statuses: Submission['status'][]) =>
    mine.filter((s) => statuses.includes(s.status)).length;

  const pending = count('Pending');
  const graded = count('Graded');
  const published = count('Published');
  const submitted = pending + graded + published;

  return {
    total: assignment.totalStudents,
    submitted,
    pending,
    graded,
    published,
    missing: Math.max(0, assignment.totalStudents - submitted),
  };
}

/* ══════════════════════════════════════════════════════════════
   狀態變更（回傳新物件，不修改傳入的作業）
   ══════════════════════════════════════════════════════════════ */

/**
 * 作業開關：Draft ⇄ Published。
 * 第一次開放時記錄 publishedAt，之後再關再開不會覆蓋原始開放時間。
 */
export function toggleVisibility(assignment: Assignment): Assignment {
  if (assignment.status === 'Draft') {
    return {
      ...assignment,
      status: 'Published',
      publishedAt: assignment.publishedAt || new Date().toISOString(),
    };
  }
  // Published 或 Closed 都收回成未開放
  return { ...assignment, status: 'Draft' };
}

/** 是否已對學生開放 */
export function isVisibleToStudents(assignment: Assignment): boolean {
  return assignment.status !== 'Draft';
}

/** 關閉作業：學生看得到成績但不能再繳交 */
export function closeAssignment(assignment: Assignment): Assignment {
  return { ...assignment, status: 'Closed' };
}

/** 重新開放 */
export function reopenAssignment(assignment: Assignment): Assignment {
  return { ...assignment, status: 'Published' };
}

/**
 * 是否允許更換題目。
 *
 * 未開放：學生根本沒看過這份作業，換題沒有任何風險。
 * 已關閉：老師已經明確宣告不收件了，換題前還會再確認一次。
 *
 * 已開放與已逾期不允許 —— 換題會清掉該作業所有的繳交紀錄，
 * 而這兩種狀態下可能還有學生正在寫（逾期作業若允許遲交仍收得到）。
 */
export function canSwapQuestion(assignment: Assignment): boolean {
  return assignment.status === 'Closed' || assignment.status === 'Draft';
}

/**
 * 更換題目。呼叫端必須另外清除這份作業的繳交紀錄 ——
 * 舊作文是照舊題目寫的，留著會對不上新題目。
 */
export function swapQuestion(
  assignment: Assignment,
  questionId: string,
  questionTitle: string,
): Assignment {
  return {
    ...assignment,
    questionId,
    title: questionTitle,
  };
}

/**
 * 一個課程底下累積了多少資料。
 *
 * 刪除課程前要據實告訴老師會失去什麼 —— 尤其是「學生已經寫的作文」，
 * 那是唯一真正救不回來的東西：名單可以重新從校務系統同步，
 * 作業可以重新派發，學生寫過的字不行。
 */
export interface CourseFootprint {
  students: number;
  assignments: number;
  /** 學生已經寫出來的篇數（含草稿） */
  submissions: number;
  /** 其中已經批改完成的 */
  graded: number;
}

export function courseFootprint(
  courseId: string,
  assignments: Assignment[],
  submissions: Submission[],
  studentCount: number,
): CourseFootprint {
  const ids = new Set(
    assignments.filter((a) => a.courseId === courseId).map((a) => a.id),
  );
  const rows = submissions.filter((s) => ids.has(s.assignmentId));
  return {
    students: studentCount,
    assignments: ids.size,
    submissions: rows.length,
    graded: rows.filter((s) => s.status === 'Graded' || s.status === 'Published')
      .length,
  };
}

/** 沒有任何學生寫過東西，刪掉不會弄丟救不回來的內容 */
export const isCourseEmptyOfWork = (footprint: CourseFootprint): boolean =>
  footprint.submissions === 0;
