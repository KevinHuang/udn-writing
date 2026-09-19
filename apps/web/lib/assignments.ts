/**
 * 作業的純計算邏輯 —— 全站唯一來源。
 *
 * 這裡的函式都沒有副作用、不依賴 React，可以直接在 console 驗證。
 * 比照 lib/folders.ts、lib/concern.ts、lib/statusStyles.ts 的做法。
 *
 * ── 作業的三個階段（assignmentPhase）──────────────────────────
 *   未開放  status = Draft。學生完全看不到，老師可以先準備好
 *   收件中  status = Published，沒有截止日或還沒到
 *   已截止  status = Published，截止時間已過。學生看得到成績，
 *           不能再交 —— 除非這份作業允許遲交
 *
 * **收不收件只看截止日。** 「結束收件」就是把截止日設成現在，
 * 「重新開放」就是把截止日往後改。資料裡只存「看不看得到」與截止日，
 * 階段一律用 assignmentPhase() 算，不要在畫面裡自己判斷。
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

/** 作業的階段。徽章、篩選、學生端都用這一份 */
export type AssignmentPhase = 'draft' | 'open' | 'ended';

export const PHASE_LABEL: Record<AssignmentPhase, string> = {
  draft: '未開放',
  open: '收件中',
  ended: '已截止',
};

export function assignmentPhase(assignment: Assignment, now: Date = new Date()): AssignmentPhase {
  if (assignment.status === 'Draft') return 'draft';
  return isOverdue(assignment, now) ? 'ended' : 'open';
}

/** 截止之後是否仍收件 */
export function allowsLate(assignment: Assignment): boolean {
  return assignment.config.allowLateSubmission === true;
}

/**
 * 學生現在能不能繳交（含儲存草稿、掃描）。
 * 老師代繳交**不受這個限制** —— 紙本本來就是老師收的。
 */
export function canStudentSubmit(assignment: Assignment, now: Date = new Date()): boolean {
  const phase = assignmentPhase(assignment, now);
  if (phase === 'draft') return false;
  if (phase === 'open') return true;
  return allowsLate(assignment);
}

/**
 * 這份作品是不是遲交的：繳交時間晚於截止時間。
 * 用算的不存 —— 老師事後改截止日，遲交與否要跟著變。
 */
export function isLateSubmission(
  submission: Pick<Submission, 'submittedAt'>,
  assignment: Assignment,
): boolean {
  const d = deadlineOf(assignment);
  if (!d || !submission.submittedAt) return false;
  const t = new Date(submission.submittedAt);
  return !Number.isNaN(t.getTime()) && t > d;
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

  return list.find((a) => assignmentPhase(a) === 'open') ?? list[0];
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
 * 作業開關：Draft ⇄ Published（學生看不看得到）。
 * 第一次開放時記錄 publishedAt，之後再關再開不會覆蓋原始開放時間。
 */
export function toggleVisibility(assignment: Assignment): Assignment {
  if (assignment.status === 'Draft') return openAssignment(assignment);
  return { ...assignment, status: 'Draft' };
}

/** 對學生開放 */
export function openAssignment(assignment: Assignment): Assignment {
  return {
    ...assignment,
    status: 'Published',
    publishedAt: assignment.publishedAt || new Date().toISOString(),
  };
}

/** 是否已對學生開放 */
export function isVisibleToStudents(assignment: Assignment): boolean {
  return assignment.status !== 'Draft';
}

/**
 * 修改截止設定。
 * @param deadline 空字串＝不設截止日；否則是 datetime-local 字串（YYYY-MM-DDTHH:mm）
 */
export function setDeadline(
  assignment: Assignment,
  deadline: string,
  allowLate: boolean,
): Assignment {
  return {
    ...assignment,
    config: { ...assignment.config, deadline, allowLateSubmission: allowLate },
  };
}

/** 現在時間的 datetime-local 字串（到分鐘） */
export function localDateTimeString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 立即截止：截止日設成現在。＝以前的「結束收件」。
 *
 * 往前挪一分鐘 —— datetime-local 只到分鐘，設成「這一分鐘」的話，
 * 這一分鐘剩下的秒數內作業仍然算收件中，老師按了卻看不到變化。
 */
export function endNow(assignment: Assignment, now: Date = new Date()): Assignment {
  const past = new Date(now.getTime() - 60_000);
  return setDeadline(assignment, localDateTimeString(past), allowsLate(assignment));
}

/**
 * 是否允許更換題目。換題會清掉這份作業所有的繳交紀錄，
 * 所以只在「確定沒有人正在寫」的時候開放：
 *
 *   未開放             學生根本沒看過，沒有風險
 *   已截止且不收遲交    收件已經結束
 *
 * 收件中、或已截止但允許遲交，都可能還有學生正在寫，不允許。
 */
export function canSwapQuestion(assignment: Assignment, now: Date = new Date()): boolean {
  const phase = assignmentPhase(assignment, now);
  return phase === 'draft' || (phase === 'ended' && !allowsLate(assignment));
}

/** 不能換題時給老師看的原因 */
export function swapBlockedReason(assignment: Assignment, now: Date = new Date()): string {
  if (canSwapQuestion(assignment, now)) return '';
  return assignmentPhase(assignment, now) === 'open'
    ? '收件中不能換題。請先把截止日設為現在（立即截止），或把作業改回未開放。'
    : '這份作業允許遲交，可能還有學生正在寫。請先取消「允許遲交」。';
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
