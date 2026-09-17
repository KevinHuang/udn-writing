import React, { useMemo } from "react";
import { StudentAssignments } from "../../components/StudentAssignments";
import { useAppState } from "../../state/appStateContext";
import { useGoBack } from "../../lib/useGoBack";

/**
 * 我的作業。**只顯示本學年期的作業。**
 *
 * 學年期由 `semesters` 表依今天的日期決定（後端 SemesterHelper.current()），
 * 所以這份清單會自己前進，過去學期的作業不會再出現。
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
 *       不一樣的份數。
 */
export const StudentAssignmentsPage: React.FC = () => {
  const { goBack, canGoBack } = useGoBack();
  const { assignments, submissions, courses, currentSemester } = useAppState();

  const thisSemester = useMemo(() => {
    const ids = new Set(
      courses.filter((c) => c.semester === currentSemester).map((c) => c.id),
    );
    return assignments.filter((a) => ids.has(a.courseId));
  }, [assignments, courses, currentSemester]);

  return (
    <StudentAssignments
      assignments={thisSemester}
      submissions={submissions}
      courseNameOf={(a) => courses.find((c) => c.id === a.courseId)?.name ?? ""}
      onBack={goBack}
      canGoBack={canGoBack}
    />
  );
};
