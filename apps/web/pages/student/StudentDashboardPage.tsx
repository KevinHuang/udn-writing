import React from "react";
import { useSearchParams } from "react-router-dom";
import { StudentDashboard } from "../../components/StudentDashboard";
import { useAppState } from "../../state/appStateContext";
import { useGoBack } from "../../lib/useGoBack";
import { queryKeys } from "../../lib/routes";

export const StudentDashboardPage: React.FC = () => {
  const { goBack, canGoBack } = useGoBack();
  const [params] = useSearchParams();
  const { studentName, assignments, submissions, questions, courses, todaySemester, semesterOptions } = useAppState();
  // 學期從網址讀（與成績紀錄同一個參數），重新整理不會跳回目前學期
  return (
    <StudentDashboard
      studentName={studentName}
      assignments={assignments}
      submissions={submissions}
      questions={questions}
      courses={courses}
      onBack={goBack}
      canGoBack={canGoBack}
      currentSemester={todaySemester}
      semester={params.get(queryKeys.semesterFilter) ?? undefined}
      semesterOptions={semesterOptions}
    />
  );
};
