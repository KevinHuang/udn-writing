import React from 'react';
import { ArrowLeft, Bot, Users, Hash, Eye, EyeOff } from 'lucide-react';
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
  /** 數位作品集的佳作觀摩是否顯示這一班的級分 */
  onSetShowcaseScore: (showScore: boolean) => void;
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
  onSetShowcaseScore,
}) => {
  const models = course.aiModels || [];
  const showScore = course.showcaseShowScore === true;

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

      {/*
        數位作品集的展示設定。數位作品集是給學生與家長用的另一個平台，
        老師在那邊沒有角色 —— 所以要影響那邊的顯示，設定就只能放在這裡。
        放在班級頁而不是批改頁：它管的是整個班，不是某一份作業。
      */}
      <div className="mb-6 bg-card border border-border-card shadow-paper rounded-brand px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-body text-text-primary flex items-center gap-2">
            {showScore
              ? <Eye size={16} className="shrink-0 text-primary" />
              : <EyeOff size={16} className="shrink-0 text-text-muted" />}
            數位作品集：佳作觀摩{showScore ? '顯示' : '不顯示'}級分
          </p>
          <p className="text-caption text-text-muted mt-0.5">
            同校學生在數位作品集觀摩這一班的佳作時，是否看得到每篇的級分。預設不顯示。
          </p>
        </div>
        <button
          id="coursedetail-toggle-showcase-score"
          type="button"
          role="switch"
          aria-checked={showScore}
          aria-label="數位作品集的佳作觀摩顯示級分"
          onClick={() => onSetShowcaseScore(!showScore)}
          className={`tap-target shrink-0 self-start sm:self-auto relative inline-flex h-7 w-12 items-center rounded-full border transition-colors ${
            showScore ? 'bg-primary border-primary' : 'bg-surface-soft border-border-strong'
          }`}
        >
          <span
            className={`inline-block h-5 w-5 rounded-full bg-card shadow-paper transition-transform ${
              showScore ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
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
