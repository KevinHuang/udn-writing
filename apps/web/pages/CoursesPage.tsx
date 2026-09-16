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
    setCurrentSemester, setCourses, handleSyncCourses, handleDeleteCourse,
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
      onSemesterChange={setCurrentSemester}
      onBack={goBack}
      canGoBack={canGoBack}
      onUpdateCourse={(updatedCourse) => {
        setCourses((prev) =>
          prev.map((c) => (c.id === updatedCourse.id ? updatedCourse : c)),
        );
      }}
      onAddCourses={handleSyncCourses}
      onDeleteCourse={handleDeleteCourse}
    />
  );
};
