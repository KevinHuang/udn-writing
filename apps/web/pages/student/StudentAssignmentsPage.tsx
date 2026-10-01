import React, { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { StudentAssignments } from "../../components/StudentAssignments";
import { useAppState } from "../../state/appStateContext";
import { useGoBack } from "../../lib/useGoBack";
import {
  queryKeys, routes, STUDENT_ASSIGNMENT_TABS, type StudentAssignmentTab,
} from "../../lib/routes";

/**
 * 我的作業。**只顯示選定學期的作業**（預設今天的學期）。
 *
 * 學期的來源（2026-10-01 起）：網址的 `?semester=` 優先，沒帶就用學生在任何一頁
 * 選過的學期（AppState 的 currentSemester —— 學習概況、成績紀錄共用同一個）。
 * 以前這一頁寫死今天的學期、也沒有選單，學生在學習概況切到上學期，
 * 點「查看全部」過來卻又回到這學期。
 *
 * ⚠️ 兩個踩過的坑，改這一頁時要記得：
 *
 *    1. 這裡以前用 `a.courseId === studentCourseId` 過濾，而 studentCourseId 是
 *       寫死的示範值 `'c1'` —— 真實課程 id 是 229 / 1 / 2 / 12，清單**永遠是空的**，
 *       畫面只說「找不到相關作業」。根因是原型假設一個學生只屬於一個班，
 *       但實測這位學生同時在 4 個班。所以是依**學期**收斂，不是依單一班級。
 *
 *    2. 首頁的「進行中作業」也是同一條規則（StudentDashboard 的
 *       currentCourseAssignmentIds）。**兩邊要一致** —— 首頁的「查看全部」
 *       連到這裡，先前首頁有過濾、這裡沒有，同一位學生在兩個畫面看到
 *       不一樣的份數。現在「查看全部」會帶著學期過來。
 */
export const StudentAssignmentsPage: React.FC = () => {
  const navigate = useNavigate();
  const { goBack, canGoBack } = useGoBack();
  const [params] = useSearchParams();
  const {
    assignments, submissions, courses, todaySemester, semesterOptions,
    currentSemester, setCurrentSemester, handleSetPublishConsent,
  } = useAppState();

  const semester = params.get(queryKeys.semesterFilter) ?? currentSemester;
  const tabParam = params.get(queryKeys.assignmentTab);
  const initialTab = STUDENT_ASSIGNMENT_TABS.includes(tabParam as StudentAssignmentTab)
    ? (tabParam as StudentAssignmentTab)
    : undefined;

  const inSemester = useMemo(() => {
    const ids = new Set(courses.filter((c) => c.semester === semester).map((c) => c.id));
    return assignments.filter((a) => ids.has(a.courseId));
  }, [assignments, courses, semester]);

  return (
    <StudentAssignments
      // 網址帶了新的分頁籤（例如從學習概況的提醒過來）時重新掛載，讓初值生效
      key={initialTab ?? ""}
      assignments={inSemester}
      submissions={submissions}
      courseNameOf={(a) => courses.find((c) => c.id === a.courseId)?.name ?? ""}
      onBack={goBack}
      canGoBack={canGoBack}
      semester={semester}
      todaySemester={todaySemester}
      semesterOptions={semesterOptions}
      onSemesterChange={(s) => {
        setCurrentSemester(s);
        navigate(
          routes.studentAssignments({ semester: s === todaySemester ? undefined : s, tab: initialTab }),
          { replace: true },
        );
      }}
      initialTab={initialTab}
      onSetConsent={handleSetPublishConsent}
    />
  );
};
