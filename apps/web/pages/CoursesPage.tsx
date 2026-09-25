import React from "react";
import { useNavigate } from "react-router-dom";
import { CourseList } from "../components/CourseList";
import { useAppState } from "../state/appStateContext";
import { useGoBack } from "../lib/useGoBack";
import { routes } from "../lib/routes";

export const CoursesPage: React.FC = () => {
  const navigate = useNavigate();
  const { goBack, canGoBack } = useGoBack();
  const {
    currentUser, myCourses, assignments, submissions, currentSemester,
    semesterOptions, todaySemester,
    setCurrentSemester, handleUpdateCourse, handleSyncCourses, handleDeleteCourse,
    reloadCourses, ensureRoster,
  } = useAppState();

  return (
    <CourseList
      user={currentUser}
      courses={myCourses}
      assignments={assignments}
      submissions={submissions}
      onOpenCourse={(course) => navigate(routes.courseDetail(course.id))}
      onSelectCourse={(course) => navigate(routes.grades({ courseId: course.id }))}
      currentSemester={currentSemester}
      semesterOptions={semesterOptions}
      todaySemester={todaySemester}
      onSemesterChange={setCurrentSemester}
      onBack={goBack}
      canGoBack={canGoBack}
      onUpdateCourse={handleUpdateCourse}
      onAddCourses={handleSyncCourses}
      onDeleteCourse={handleDeleteCourse}
      onRosterSynced={async (courseId) => {
        // 人數在課程清單上、名冊在另一份快取，兩邊都要重讀
        await reloadCourses();
        await ensureRoster(courseId);
      }}
    />
  );
};
