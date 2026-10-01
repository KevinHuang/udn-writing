import React from "react";
import { useSearchParams } from "react-router-dom";
import { StudentDashboard } from "../../components/StudentDashboard";
import { useAppState } from "../../state/appStateContext";
import { useGoBack } from "../../lib/useGoBack";
import { queryKeys } from "../../lib/routes";

export const StudentDashboardPage: React.FC = () => {
  const { goBack, canGoBack } = useGoBack();
  const [params] = useSearchParams();
  const {
    studentName, assignments, submissions, questions, courses, todaySemester, semesterOptions,
    currentSemester, setCurrentSemester, handleSetPublishConsent,
  } = useAppState();
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
      // 網址優先；沒帶就用學生在任何一頁選過的學期（我的作業、成績紀錄共用這一個）
      semester={params.get(queryKeys.semesterFilter) ?? currentSemester}
      onSemesterChange={setCurrentSemester}
      onSetConsent={handleSetPublishConsent}
      semesterOptions={semesterOptions}
    />
  );
};
