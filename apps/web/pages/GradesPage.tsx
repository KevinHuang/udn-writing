import React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { GradeManagement } from "../components/GradeManagement";
import { useAppState } from "../state/appStateContext";
import { useGoBack } from "../lib/useGoBack";
import { queryKeys, routes } from "../lib/routes";

export const GradesPage: React.FC = () => {
  const navigate = useNavigate();
  const { goBack, canGoBack } = useGoBack();
  const [params] = useSearchParams();
  const {
    myCourses, assignments, submissions, currentSemester,
    setCurrentSemester, currentUser, leaveMarks, toggleLeave, semesterOptions,
  } = useAppState();

  return (
    <GradeManagement
      courses={myCourses}
      assignments={assignments}
      submissions={submissions}
      currentSemester={currentSemester}
      onSemesterChange={setCurrentSemester}
      semesterOptions={semesterOptions}
      // 先前是 selectedCourse?.id。放在網址裡，從課程頁點進來的班級
      // 重新整理之後還在，也可以把這個網址貼給別人。
      initialCourseId={params.get(queryKeys.course) ?? undefined}
      user={currentUser}
      leaveMarks={leaveMarks}
      onSetLeave={(assignmentId, studentId, onLeave) =>
        void toggleLeave(assignmentId, studentId, onLeave)
      }
      onBack={goBack}
      canGoBack={canGoBack}
      onOpenFinalReport={(courseId) => navigate(routes.finalReport(courseId))}
    />
  );
};
