import React from "react";
import { useSearchParams } from "react-router-dom";
import { StudentGrades } from "../../components/StudentGrades";
import { useAppState } from "../../state/appStateContext";
import { useGoBack } from "../../lib/useGoBack";
import { queryKeys, type SemesterFilter } from "../../lib/routes";

export const StudentGradesPage: React.FC = () => {
  const { goBack, canGoBack } = useGoBack();
  const [params] = useSearchParams();
  const { submissions, assignments, courses, questions, currentSemester } = useAppState();

  /**
   * 學期範圍與要展開哪一筆，都從網址讀。
   *
   * 先前這兩個是 App.tsx 的 useState，經由 viewParams 傳進來 ——
   * 重新整理就掉回預設值，也沒辦法把「我在看的這份成績」貼給別人。
   */
  const raw = params.get(queryKeys.semesterFilter);
  const semesterFilter: SemesterFilter | undefined =
    raw === "PAST" || raw === "CURRENT" || raw === "ALL" ? raw : undefined;

  return (
    <StudentGrades
      submissions={submissions}
      assignments={assignments}
      courses={courses}
      questions={questions}
      onBack={goBack}
      canGoBack={canGoBack}
      selectedSubmissionId={params.get(queryKeys.focus) ?? undefined}
      semesterFilter={semesterFilter}
      currentSemester={currentSemester}
    />
  );
};
