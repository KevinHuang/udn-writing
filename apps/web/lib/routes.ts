/**
 * 全站網址的**唯一來源**。
 *
 * 這一支取代了先前的 `ViewState` enum ——「現在在哪一頁」不再是一個
 * React state，而是網址本身。
 *
 * **不要在元件裡寫死路徑字串。** 改一條路徑時，散落各處的字面值一定會漏掉
 * 一兩個，而那不會有任何編譯錯誤 —— 只會在使用者按下去的時候變成 404。
 * 這個專案已經在「同一份資訊在多處各自解析」這件事上吃過四次虧
 * （見 CLAUDE.md）。
 *
 * 用法：
 *   navigate(routes.courseDetail(course.id))
 *   <Route path={routePatterns.courseDetail} … />
 */

export type SemesterFilter = 'PAST' | 'CURRENT' | 'ALL';

/**
 * 篩選條件放 query string，網址才能完整還原畫面。
 *
 * 這些先前是 App.tsx 的 useState，重新整理就沒了，也沒辦法把
 * 「我正在看的這個篩選結果」貼給別人。
 */
export const queryKeys = {
  /** 學期範圍：PAST / CURRENT / ALL */
  semesterFilter: 'semester',
  /** 批改清單選中的作業 */
  assignment: 'assignment',
  /** 成績管理頁預設選中的班級 */
  course: 'course',
  /** 進頁面時要聚焦的那一筆（作業或成績） */
  focus: 'focus',
  /** 學生作業清單是否隱藏逾期 */
  hideOverdue: 'hideOverdue',
} as const;

/** 只把有值的參數接上去，空的不要留在網址裡變成雜訊。 */
function withQuery(path: string, params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

/** 實際可以導向的網址。參數用函式帶進去，不要自己拼字串。 */
export const routes = {
  // ── 教師端 ──
  dashboard: () => '/',
  courses: () => '/courses',
  courseDetail: (courseId: string) => `/courses/${courseId}`,
  /** 派發作業精靈。沒有導覽入口，只從課程頁的「新增作業」進來 */
  newAssignment: (courseId: string) => `/courses/${courseId}/assignments/new`,
  questionBank: () => '/questions',
  /** assignmentId：批改清單目前選中的作業。放 query 才能重新整理還原 */
  gradingList: (opts?: { assignmentId?: string }) =>
    withQuery('/grading', { [queryKeys.assignment]: opts?.assignmentId }),
  gradingEditor: (assignmentId: string, submissionId: string) =>
    `/grading/${assignmentId}/${submissionId}`,
  /** courseId：成績管理頁預設選中的班級 */
  grades: (opts?: { courseId?: string }) =>
    withQuery('/grades', { [queryKeys.course]: opts?.courseId }),
  concern: () => '/concern',

  // ── 學生端 ──
  studentDashboard: () => '/student',
  /** focusId：進來時要捲到／highlight 哪一份作業 */
  studentAssignments: (opts?: { focusId?: string }) =>
    withQuery('/student/assignments', { [queryKeys.focus]: opts?.focusId }),
  studentEditor: (assignmentId: string) => `/student/assignments/${assignmentId}`,
  /** semester：學期範圍篩選；focusId：要展開哪一份成績 */
  studentGrades: (opts?: { semester?: SemesterFilter; focusId?: string }) =>
    withQuery('/student/grades', {
      [queryKeys.semesterFilter]: opts?.semester,
      [queryKeys.focus]: opts?.focusId,
    }),
} as const;

/**
 * 給 `<Route path={…}>` 用的樣式字串。
 *
 * 與上面的 routes 是同一組路徑的兩種形態：一個帶實際的值，一個帶 `:param`。
 * 分成兩份是不得已 —— React Router 需要樣式，導向需要實際值。
 * **改動時兩邊要一起改**，底下的型別會強迫你至少不會漏掉整條。
 */
export const routePatterns: Record<keyof typeof routes, string> = {
  dashboard: '/',
  courses: '/courses',
  courseDetail: '/courses/:courseId',
  newAssignment: '/courses/:courseId/assignments/new',
  questionBank: '/questions',
  gradingList: '/grading',
  gradingEditor: '/grading/:assignmentId/:submissionId',
  grades: '/grades',
  concern: '/concern',
  studentDashboard: '/student',
  studentAssignments: '/student/assignments',
  studentEditor: '/student/assignments/:assignmentId',
  studentGrades: '/student/grades',
};

/** 學生端的路徑前綴。用來判斷某個網址屬於哪一邊。 */
export const STUDENT_PREFIX = '/student';

export const isStudentPath = (pathname: string): boolean =>
  pathname === STUDENT_PREFIX || pathname.startsWith(STUDENT_PREFIX + '/');
