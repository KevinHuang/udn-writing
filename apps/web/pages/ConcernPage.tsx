import React from "react";
import { ConcernListView } from "../components/ConcernListView";
import { useAppState } from "../state/appStateContext";
import { useGoBack } from "../lib/useGoBack";

export const ConcernPage: React.FC = () => {
  const { goBack } = useGoBack();
  const { myCourses, assignments, submissions, leaveMarks } = useAppState();
  return (
    <ConcernListView
      allCourses={myCourses}
      assignments={assignments}
      submissions={submissions}
      onBack={goBack}
      leaveMarks={leaveMarks}
    />
  );
};
