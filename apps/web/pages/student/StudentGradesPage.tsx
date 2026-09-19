import React from "react";
import { useSearchParams } from "react-router-dom";
import { StudentGrades } from "../../components/StudentGrades";
import { useAppState } from "../../state/appStateContext";
import { useGoBack } from "../../lib/useGoBack";
import { queryKeys } from "../../lib/routes";

export const StudentGradesPage: React.FC = () => {
  const { goBack, canGoBack } = useGoBack();
  const [params] = useSearchParams();
  const { submissions, assignments, courses, questions, currentSemester, semesterOptions } = useAppState();

  /**
   * 學期與要展開哪一筆，都從網址讀。
   *
   * 先前這兩個是 App.tsx 的 useState，經由 viewParams 傳進來 ——
   * 重新整理就掉回預設值，也沒辦法把「我在看的這份成績」貼給別人。
   */
  return (
    <StudentGrades
      submissions={submissions}
      assignments={assignments}
      courses={courses}
      questions={questions}
      onBack={goBack}
      canGoBack={canGoBack}
      selectedSubmissionId={params.get(queryKeys.focus) ?? undefined}
      semester={params.get(queryKeys.semesterFilter) ?? undefined}
      currentSemester={currentSemester}
      semesterOptions={semesterOptions}
    />
  );
};
