import React from 'react';
import { ArrowLeft, Bot, Users, Hash } from 'lucide-react';
import { Assignment, Course, Question, Submission } from '../types';
import { CourseAssignmentList } from './CourseAssignmentList';
import { semesterLabel } from '../lib/semester';
import { SHOW_AI_MODEL_PICKER } from '../lib/features';

interface CourseDetailProps {
  course: Course;
  assignments: Assignment[];
  submissions: Submission[];
  /** 供作業清單點題目時展示完整題目 */
  questions: Question[];
  onBack: () => void;
  onAssignmentOperation: (
    creates: Assignment[],
    updates: Assignment[],
    deleteIds: string[],
  ) => void;
  onSelectAssignment: (assignmentId: string) => void;
  onPublishNew: (courseId: string) => void;
  onRequestSwapQuestion: (assignment: Assignment) => void;
}

/**
 * 單一班級的作業工作台。
 *
 * 從課程卡片的「作業管理」進來。這一頁的職責很單一：
 * 看完這個班的所有作業、控制開放與否、換題、以及派發新的。
 *
 * 之所以做成獨立頁面而不是在卡片裡展開，是因為作業一多，
 * 卡片會被撐到無法使用。
 */
export const CourseDetail: React.FC<CourseDetailProps> = ({
  course,
  assignments,
  submissions,
  questions,
  onBack,
  onAssignmentOperation,
  onSelectAssignment,
  onPublishNew,
  onRequestSwapQuestion,
}) => {
  const models = course.aiModels || [];

  return (
    <div className="max-w-5xl mx-auto pb-12">
      {/* 頁首 */}
      <div className="flex items-start gap-3 mb-6">
        <button
          id="coursedetail-btn-back"
          onClick={onBack}
          className="shrink-0 mt-1 p-2 -ml-2 rounded-full text-text-secondary hover:bg-surface-soft hover:text-text-primary transition-colors"
          title="返回課程管理"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="min-w-0">
          <h1 className="text-heading font-bold text-text-primary">
            {course.name}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 bg-surface-soft text-text-secondary px-2.5 py-1 rounded-lg text-caption border border-border whitespace-nowrap">
              <Hash size={11} className="shrink-0" />
              {course.code}
            </span>
            <span className="inline-flex items-center gap-1 bg-surface-soft text-text-secondary px-2.5 py-1 rounded-lg text-caption border border-border whitespace-nowrap">
              <Users size={11} className="shrink-0" />
              {course.studentCount} 位學生
            </span>
            <span className="inline-flex items-center gap-1 bg-surface-soft text-text-secondary px-2.5 py-1 rounded-lg text-caption border border-border whitespace-nowrap">
              {semesterLabel(course.semester)}
            </span>
            {/* 批改模型的選擇目前隱藏（lib/features.ts），標籤跟著開關走 */}
            {SHOW_AI_MODEL_PICKER && models.length > 0 && (
              <span
                className="inline-flex items-center gap-1 bg-primary/10 text-primary px-2.5 py-1 rounded-lg text-caption border border-primary/20 whitespace-nowrap"
                title={models.join('、')}
              >
                <Bot size={11} className="shrink-0" />
                {models.length} 個批改助手
              </span>
            )}
          </div>
        </div>
      </div>

      <CourseAssignmentList
        courseId={course.id}
        assignments={assignments}
        submissions={submissions}
        questions={questions}
        onAssignmentOperation={onAssignmentOperation}
        onSelectAssignment={onSelectAssignment}
        onPublishNew={() => onPublishNew(course.id)}
        onRequestSwapQuestion={onRequestSwapQuestion}
      />
    </div>
  );
};
