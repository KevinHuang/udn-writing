import React from "react";
import { useNavigate, useParams } from "react-router-dom";
import { PublishAssignmentWizard } from "../components/PublishAssignmentWizard";
import { useAppState } from "../state/appStateContext";
import { useGoBack } from "../lib/useGoBack";
import { routes } from "../lib/routes";
import { NotFoundPage } from "./NotFoundPage";

/**
 * 派發作業精靈。沒有導覽入口，只從課程頁的「新增作業」進來。
 *
 * 要派給哪個班寫在網址裡（先前是 publishFlowCourseId 這個 state）。
 * 好處是重新整理不會把老師丟回空的精靈，而且派發完要回哪裡是算出來的，
 * 不需要另外記一個旗標再清掉。
 */
export const NewAssignmentPage: React.FC = () => {
  const navigate = useNavigate();
  const { goBack } = useGoBack();
  const { courseId } = useParams();
  const { myCourses, questions, folders, handleAssignmentOperation } = useAppState();

  const course = myCourses.find((c) => c.id === courseId);
  if (!course) return <NotFoundPage message="找不到這個班級，或它不在你的授課範圍內。" />;

  return (
    <PublishAssignmentWizard
      courses={myCourses}
      questions={questions}
      folders={folders}
      onAssignmentOperation={handleAssignmentOperation}
      onBack={goBack}
      initialCourseId={course.id}
      // 派發完回到出發的那個班級頁，不要把老師丟在空的精靈裡
      onPublished={() => navigate(routes.courseDetail(course.id))}
    />
  );
};
