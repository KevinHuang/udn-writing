import React from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CourseDetail } from "../components/CourseDetail";
import { useAppState } from "../state/appStateContext";
import { useGoBack } from "../lib/useGoBack";
import { routes } from "../lib/routes";
import { NotFoundPage } from "./NotFoundPage";

export const CourseDetailPage: React.FC = () => {
  const navigate = useNavigate();
  const { goBack } = useGoBack();
  const { courseId } = useParams();
  const {
    myCourses, assignments, submissions, questions,
    handleAssignmentOperation, setSwappingAssignment,
  } = useAppState();

  /**
   * 課程從網址現查，不存在就是 404。
   *
   * 先前這是 selectedCourse 這個 state：直接把網址貼進來會看到空白，
   * 而刪掉正在看的課程時要另外寫一行把它設回 null。現在兩件事都不用管了。
   * 注意查的是 myCourses 不是 courses —— 不能讓教師從網址直接開別人的班。
   */
  const course = myCourses.find((c) => c.id === courseId);
  if (!course) return <NotFoundPage message="找不到這個班級，或它不在你的授課範圍內。" />;

  return (
    <CourseDetail
      course={course}
      assignments={assignments}
      submissions={submissions}
      questions={questions}
      onBack={goBack}
      onAssignmentOperation={handleAssignmentOperation}
      onSelectAssignment={(id) => navigate(routes.gradingList({ assignmentId: id }))}
      onPublishNew={(cid) => navigate(routes.newAssignment(cid))}
      onRequestSwapQuestion={(assignment) => setSwappingAssignment(assignment)}
    />
  );
};
