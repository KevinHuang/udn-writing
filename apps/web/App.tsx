import React from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppStateProvider } from "./state/AppState";
import { useAppState } from "./state/appStateContext";
import { TeacherLayout } from "./layouts/TeacherLayout";
import { StudentPortal } from "./components/StudentPortal";
import { routePatterns, routes } from "./lib/routes";
import { UserRole } from "./types";

import { DashboardPage } from "./pages/DashboardPage";
import { CoursesPage } from "./pages/CoursesPage";
import { CourseDetailPage } from "./pages/CourseDetailPage";
import { NewAssignmentPage } from "./pages/NewAssignmentPage";
import { QuestionBankPage } from "./pages/QuestionBankPage";
import { GradingListPage } from "./pages/GradingListPage";
import { GradingEditorPage } from "./pages/GradingEditorPage";
import { FinalReportPage } from "./pages/FinalReportPage";
import { GradesPage } from "./pages/GradesPage";
import { ConcernPage } from "./pages/ConcernPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { LoginPage, SessionLoading } from "./pages/LoginPage";
import { StudentDashboardPage } from "./pages/student/StudentDashboardPage";
import { StudentAssignmentsPage } from "./pages/student/StudentAssignmentsPage";
import { StudentGradesPage } from "./pages/student/StudentGradesPage";
import { StudentEditorPage } from "./pages/student/StudentEditorPage";

/**
 * 擋下身分不符的路徑。
 *
 * 教師端與學生端是兩棵不同的路由樹。直接把網址貼到另一邊時，
 * 導回自己那棵的根，而不是顯示一個半殘的畫面。
 *
 * ⚠️ 這是**畫面層級**的導引，不是存取控制。真正的把關在伺服器端
 *    （見 apps/api 的 OAuthMiddleware 與 docs/auth.md）——
 *    `lib/access.ts` 自己也註明原型的權限「不是真的存取控制」。
 */
const RequireRole: React.FC<{ allow: "student" | "teacher"; children: React.ReactElement }> =
  ({ allow, children }) => {
    const { userRole } = useAppState();
    const isStudent = userRole === UserRole.STUDENT;
    if (allow === "student" && !isStudent) return <Navigate to={routes.dashboard()} replace />;
    if (allow === "teacher" && isStudent) return <Navigate to={routes.studentDashboard()} replace />;
    return children;
  };

/** 路由樹。export 是為了讓冒煙測試能直接用同一份，不要另外抄一份。 */
export const AppRoutes: React.FC = () => (
  <Routes>
    {/* ── 教師端 ── */}
    <Route element={<RequireRole allow="teacher"><TeacherLayout /></RequireRole>}>
      <Route path={routePatterns.dashboard} element={<DashboardPage />} />
      <Route path={routePatterns.courses} element={<CoursesPage />} />
      <Route path={routePatterns.courseDetail} element={<CourseDetailPage />} />
      <Route path={routePatterns.newAssignment} element={<NewAssignmentPage />} />
      <Route path={routePatterns.questionBank} element={<QuestionBankPage />} />
      <Route path={routePatterns.gradingList} element={<GradingListPage />} />
      <Route path={routePatterns.gradingEditor} element={<GradingEditorPage />} />
      <Route path={routePatterns.finalReport} element={<FinalReportPage />} />
      <Route path={routePatterns.grades} element={<GradesPage />} />
      <Route path={routePatterns.concern} element={<ConcernPage />} />
      {/* 打不到的網址仍然留在版面裡，才不會突然沒有導覽列 */}
      <Route path="*" element={<NotFoundPage />} />
    </Route>

    {/* ── 學生端 ── */}
    <Route element={<RequireRole allow="student"><StudentPortal /></RequireRole>}>
      <Route path={routePatterns.studentDashboard} element={<StudentDashboardPage />} />
      <Route path={routePatterns.studentAssignments} element={<StudentAssignmentsPage />} />
      <Route path={routePatterns.studentEditor} element={<StudentEditorPage />} />
      <Route path={routePatterns.studentGrades} element={<StudentGradesPage />} />
      <Route path="/student/*" element={<NotFoundPage />} />
    </Route>
  </Routes>
);

/**
 * 登入閘門。
 *
 * 身分現在來自後端的 session，所以在確認完之前不要 render 畫面 ——
 * 先用「預設是老師」頂著的話，學生會看到一閃而過的教師介面。
 */
const SessionGate: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const { sessionStatus } = useAppState();
  if (sessionStatus === "loading") return <SessionLoading />;
  if (sessionStatus === "anonymous") return <LoginPage />;
  return children;
};

/**
 * 「現在在哪一頁」由網址決定，不再是一個 React state。
 *
 * AppStateProvider 要在 BrowserRouter 裡面 —— 它的 handler 會呼叫
 * useNavigate()（例如批改存檔後退回清單）。
 */
const App: React.FC = () => (
  <BrowserRouter>
    <AppStateProvider>
      <SessionGate>
        <AppRoutes />
      </SessionGate>
    </AppStateProvider>
  </BrowserRouter>
);

export default App;
