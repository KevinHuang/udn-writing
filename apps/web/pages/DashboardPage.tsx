import React from "react";
import { useNavigate } from "react-router-dom";
import { DashboardView } from "../components/DashboardView";
import { useAppState } from "../state/appStateContext";
import { routes } from "../lib/routes";

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    currentSemester, setCurrentSemester, myCourses, assignments, submissions,
    setIsGradedStatsOpen, courses, questions, setSelectedAiModel, leaveMarks,
  } = useAppState();

  return (
    <DashboardView
      currentSemester={currentSemester}
      onSemesterChange={setCurrentSemester}
      allCourses={myCourses}
      assignments={assignments}
      submissions={submissions}
      onShowGradedStats={() => setIsGradedStatsOpen(true)}
      onSelectSubmission={(assignmentId, submission) => {
        // 預設 AI 模型：題目指定的優先，否則用班級開通清單的第一個
        const assignment = assignments.find((a) => a.id === assignmentId);
        const course = courses.find((c) => c.id === assignment?.courseId);
        const question = questions.find((q) => q.id === assignment?.questionId);
        if (question?.preferredAiModel && course?.aiModels?.includes(question.preferredAiModel)) {
          setSelectedAiModel(question.preferredAiModel);
        } else if (course?.aiModels && course.aiModels.length > 0) {
          setSelectedAiModel(course.aiModels[0]);
        }
        navigate(routes.gradingEditor(assignmentId, submission.id));
      }}
      leaveMarks={leaveMarks}
    />
  );
};
