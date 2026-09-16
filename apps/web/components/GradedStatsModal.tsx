import React from "react";
import { X, FileCheck } from "lucide-react";
import { Submission, Assignment, Course } from "../types";

interface GradedStatsModalProps {
  isOpen: boolean;
  onClose: () => void;
  courses: Course[];
  assignments: Assignment[];
  submissions: Submission[];
  currentSemester: string;
}

export const GradedStatsModal: React.FC<GradedStatsModalProps> = ({
  isOpen,
  onClose,
  courses,
  assignments,
  submissions,
  currentSemester,
}) => {
  if (!isOpen) return null;

  // Logic to calculate stats
  const activeCourses = courses.filter((c) => c.semester === currentSemester);

  const stats = activeCourses
    .map((course) => {
      const courseAssignmentIds = assignments
        .filter((a) => a.courseId === course.id)
        .map((a) => a.id);
      const gradedCount = submissions.filter(
        (s) =>
          courseAssignmentIds.includes(s.assignmentId) &&
          (s.status === "Graded" || s.status === "Published"),
      ).length;

      return {
        ...course,
        gradedCount,
      };
    })
    .sort((a, b) => b.gradedCount - a.gradedCount);

  const totalGraded = stats.reduce((sum, item) => sum + item.gradedCount, 0);

  return (
    <div
      id="dashboard-modal-graded-stats"
      className="fixed inset-0 z-50 flex items-center justify-center bg-text-primary/40 backdrop-blur-sm p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-card/90 backdrop-blur-2xl rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[85vh] border border-card/50 ring-1 ring-white/60"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b border-border flex justify-between items-center bg-card/40">
          <h3 className="text-title font-serif font-bold text-text-primary flex items-center gap-2">
            <FileCheck size={24} className="text-primary" />
            本學期批改概況
          </h3>
          <button
            id="gradedstats-btn-close"
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary p-2 hover:bg-black/5 rounded-full transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-6">
          {/* Total Card */}
          <div className="bg-gradient-to-br from-primary to-text-primary rounded-2xl p-6 text-white shadow-lg shadow-primary/20 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-card/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
            <p className="text-surface-soft text-body mb-1">
              本學期累計批改
            </p>
            <div className="text-display font-serif font-bold">
              {totalGraded}{" "}
              <span className="text-title font-sans font-normal opacity-80">
                份作業
              </span>
            </div>
          </div>

          {/* List */}
          <div className="space-y-3">
            <h4 className="text-caption text-text-secondary uppercase tracking-widest pl-1">
              課程明細
            </h4>
            {stats.map((course) => (
              <div
                key={course.id}
                className="bg-card p-4 rounded-xl border border-border flex items-center justify-between shadow-sm"
              >
                <div>
                  <h5 className="font-bold text-text-primary">{course.name}</h5>
                  <p className="text-caption text-text-secondary font-mono">
                    {course.code}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-title font-bold text-primary">
                    {course.gradedCount}
                  </span>
                  <span className="text-caption text-text-secondary bg-surface-soft px-1.5 py-0.5 rounded">
                    份
                  </span>
                </div>
              </div>
            ))}
            {stats.length === 0 && (
              <p className="text-center text-text-secondary py-4 text-body">
                本學期尚無課程資料
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
