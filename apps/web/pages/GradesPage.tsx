import React from "react";
import { useSearchParams } from "react-router-dom";
import { GradeManagement } from "../components/GradeManagement";
import { useAppState } from "../state/appStateContext";
import { useGoBack } from "../lib/useGoBack";
import { queryKeys } from "../lib/routes";
import { setLeave } from "../lib/leave";
import { SEMESTER_OPTIONS } from "../mockData";

export const GradesPage: React.FC = () => {
  const { goBack, canGoBack } = useGoBack();
  const [params] = useSearchParams();
  const {
    myCourses, assignments, submissions, rosters, currentSemester,
    setCurrentSemester, currentUser, leaveMarks, setLeaveMarks,
  } = useAppState();

  return (
    <GradeManagement
      courses={myCourses}
      assignments={assignments}
      submissions={submissions}
      rosters={rosters}
      currentSemester={currentSemester}
      onSemesterChange={setCurrentSemester}
      semesterOptions={SEMESTER_OPTIONS}
      // 先前是 selectedCourse?.id。放在網址裡，從課程頁點進來的班級
      // 重新整理之後還在，也可以把這個網址貼給別人。
      initialCourseId={params.get(queryKeys.course) ?? undefined}
      user={currentUser}
      leaveMarks={leaveMarks}
      onSetLeave={(assignmentId, studentId, onLeave) =>
        setLeaveMarks((prev) => setLeave(prev, assignmentId, studentId, onLeave))
      }
      onBack={goBack}
      canGoBack={canGoBack}
    />
  );
};
