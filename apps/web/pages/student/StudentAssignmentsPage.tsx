import React from "react";
import { StudentAssignments } from "../../components/StudentAssignments";
import { useAppState } from "../../state/appStateContext";
import { useGoBack } from "../../lib/useGoBack";

export const StudentAssignmentsPage: React.FC = () => {
  const { goBack, canGoBack } = useGoBack();
  const { assignments, submissions, courses, studentCourseId } = useAppState();
  const courseName = courses.find((c) => c.id === studentCourseId)?.name ?? "";
  return (
    <StudentAssignments
      assignments={assignments.filter((a) => a.courseId === studentCourseId)}
      submissions={submissions}
      courseName={courseName}
      onBack={goBack}
      canGoBack={canGoBack}
    />
  );
};
