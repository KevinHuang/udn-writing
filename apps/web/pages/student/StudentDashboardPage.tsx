import React from "react";
import { StudentDashboard } from "../../components/StudentDashboard";
import { useAppState } from "../../state/appStateContext";
import { useGoBack } from "../../lib/useGoBack";

export const StudentDashboardPage: React.FC = () => {
  const { goBack, canGoBack } = useGoBack();
  const { studentName, assignments, submissions, questions, courses, currentSemester } = useAppState();
  return (
    <StudentDashboard
      studentName={studentName}
      assignments={assignments}
      submissions={submissions}
      questions={questions}
      courses={courses}
      onBack={goBack}
      canGoBack={canGoBack}
      currentSemester={currentSemester}
    />
  );
};
