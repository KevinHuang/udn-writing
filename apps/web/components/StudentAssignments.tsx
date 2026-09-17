import { useNavigate } from 'react-router-dom';
import { routes } from '../lib/routes';
import React, { useState } from 'react';
import { 
  Search, 
  Clock, 
  CheckCircle2, 
  ChevronRight,
  BookOpen,
  FileText,
  Calendar,
  ArrowLeft,
  Save,
} from 'lucide-react';
import { Assignment, Submission } from '../types';
import { deadlineOf, NO_DEADLINE_LABEL } from '../lib/assignments';

interface StudentAssignmentsProps {
  assignments: Assignment[];
  submissions: Submission[];
  /**
   * 作業 id → 班級名稱。
   *
   * 以前這裡是單一的 `courseName: string`，因為原型假設**一個學生只屬於一個班**。
   * 真實資料不是這樣 —— 實測這位學生同時在 4 個班，而且四個班都派了同一題
   * 「那次失敗之後」。少了班級名，清單上就是四筆一模一樣的卡片。
   */
  courseNameOf: (assignment: Assignment) => string;
  onBack?: () => void;
  canGoBack?: boolean;
}

export const StudentAssignments: React.FC<StudentAssignmentsProps> = ({
  assignments,
  submissions,
  courseNameOf,
  onBack,
  canGoBack
}) => {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<'IN_PROGRESS' | 'SUBMITTED' | 'RETURNED'>('IN_PROGRESS');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredAssignments = assignments
    .filter(a => {
      // Only show Published or Closed assignments to students
      if (a.status === 'Draft') return false;

      const submission = submissions.find(s => s.assignmentId === a.id);
      const subStatus = submission?.status || 'Unsubmitted';
      
      const isInProgress = subStatus === 'Unsubmitted' || subStatus === 'Draft';
      const isSubmitted = subStatus === 'Pending' || subStatus === 'Graded';
      const isReturned = subStatus === 'Published';
      
      if (filter === 'IN_PROGRESS' && !isInProgress) return false;
      if (filter === 'SUBMITTED' && !isSubmitted) return false;
      if (filter === 'RETURNED' && !isReturned) return false;
      
      return a.title.toLowerCase().includes(searchQuery.toLowerCase());
    })
    // 沒有截止日的排最後，規則與教師端共用（lib/assignments.ts）
    .sort((a, b) => {
      const da = deadlineOf(a), db = deadlineOf(b);
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return +db - +da;
    });

  return (
    <div className="space-y-4 sm:space-y-6 animate-fade-in">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 sm:gap-3 mb-1">
            {canGoBack && onBack && (
              <button 
                id="studentassignments-btn-back"
                onClick={onBack}
                className="tap-target p-1.5 sm:p-2 -ml-1 sm:-ml-2 rounded-full hover:bg-card/50 text-text-primary transition-colors active:scale-90"
              >
                <ArrowLeft size={20} className="sm:size-6" />
              </button>
            )}
            <h1 className="text-display font-serif font-bold text-text-primary tracking-tight">我的作業</h1>
          </div>
          <p className="text-caption sm:text-text-primary font-normal ml-0 sm:ml-12 opacity-80">本學期所有班級的寫作任務</p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative group flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-primary opacity-60 group-focus-within:text-primary transition-colors" size={18} />
            <input
              id="studentassignments-input-search"
              type="text"
              placeholder="搜尋作業標題..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-2 sm:py-2.5 bg-card border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 w-full sm:w-64 shadow-sm transition-all text-body"
            />
          </div>
          <div className="flex bg-card border border-border rounded-xl p-1 shadow-sm overflow-x-auto no-scrollbar">
            <button
              id="studentassignments-btn-filter-inprogress"
              onClick={() => setFilter('IN_PROGRESS')}
              className={`tap-target flex-1 sm:flex-none px-3 sm:px-4 py-1.5 rounded-lg text-body font-bold transition-all active:scale-95 whitespace-nowrap ${
                filter === 'IN_PROGRESS' ? 'bg-primary text-on-accent shadow-md shadow-primary/20' : 'text-text-primary hover:bg-surface'
              }`}
            >
              進行中
            </button>
            <button
              id="studentassignments-btn-filter-submitted"
              onClick={() => setFilter('SUBMITTED')}
              className={`tap-target flex-1 sm:flex-none px-3 sm:px-4 py-1.5 rounded-lg text-body font-bold transition-all active:scale-95 whitespace-nowrap ${
                filter === 'SUBMITTED' ? 'bg-primary text-on-accent shadow-md shadow-primary/20' : 'text-text-primary hover:bg-surface'
              }`}
            >
              已繳交
            </button>
            <button
              id="studentassignments-btn-filter-returned"
              onClick={() => setFilter('RETURNED')}
              className={`flex-1 sm:flex-none px-3 sm:px-4 py-1.5 rounded-lg text-body font-bold transition-all active:scale-95 whitespace-nowrap ${
                filter === 'RETURNED' ? 'bg-primary text-on-accent shadow-md shadow-primary/20' : 'text-text-primary hover:bg-surface'
              }`}
            >
              已發還
            </button>
          </div>
        </div>
      </div>

      <div className="tap-target grid grid-cols-1 gap-4">
        {filteredAssignments.length > 0 ? (
          filteredAssignments.map(assignment => {
            const submission = submissions.find(s => s.assignmentId === assignment.id);
            const isReturned = submission && submission.status === 'Published';
            const isDraft = submission && submission.status === 'Draft';
            /*
              **學生端不分辨「批閱中」與「已批改未發還」。**

              Graded 的意思是老師批完了但**還沒發還**，那正是發還這個動作
              存在的理由 —— 在老師按下發還之前，學生看到的就該是「批閱中」。

              ⚠️ 底下的顯示分支以前只處理 isReturned / isPending / isDraft，
                 Graded 掉進最後的 else，於是狀態寫「進行中」、按鈕是「開始寫作」
                 （實測：老師批完 5 分之後，學生那一列變回可以重寫）。
                 用 isUnderReview 一起涵蓋兩種狀態。
            */
            const isPending = submission && submission.status === 'Pending';
            /** 已結束收件。學生仍看得到（要能查自己的成績），但不能再寫 */
            const isClosed = assignment.status === 'Closed';
            const isGraded = submission && submission.status === 'Graded';
            const isUnderReview = isPending || isGraded;
            const isSubmitted = isUnderReview;
            
            const deadline = deadlineOf(assignment);
            // 沒有截止日就永遠不是「已逾期」
            const isOverdue = !isReturned && !isSubmitted && !isDraft && deadline !== null && deadline < new Date();

            return (
              <div 
                key={assignment.id} 
                id={`studentassignments-item-${assignment.id}`}
                onClick={() => {
                  if (isReturned) {
                    navigate(routes.studentGrades({ focusId: submission.id }));
                  } else {
                    navigate(routes.studentEditor(assignment.id));
                  }
                }}
                className="bg-surface/60 backdrop-blur-xl p-4 sm:p-5 rounded-2xl sm:rounded-3xl shadow-sm border border-card/20 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:border-primary/30 hover:shadow-md transition-all duration-300 group cursor-pointer active:scale-[0.99]"
              >
                <div className="flex items-start sm:items-center gap-3 sm:gap-4">
                  <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl flex items-center justify-center shrink-0 shadow-sm ${
                    isReturned ? 'bg-success-50 text-success-600 border border-success-100/50' : 
                    isDraft ? 'bg-amber-50 text-amber-600 border border-amber-100/50' : 
                    isPending ? 'bg-info-50 text-info-600 border border-info-100/50' :
                    isOverdue ? 'bg-danger-50 text-danger-600 border border-danger-100/50' : 
                    'bg-primary/10 text-primary border border-primary/20'
                  }`}>
                    {isReturned ? <CheckCircle2 size={20} className="sm:size-24" /> : 
                     isDraft ? <Save size={20} className="sm:size-24" /> : 
                     isPending ? <Clock size={20} className="sm:size-24" /> :
                     <FileText size={20} className="sm:size-24" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    {/* 同一題可能同時派給好幾個班，沒有班級名就分不出是哪一筆 */}
                    <div className="text-caption text-text-muted truncate mb-0.5">
                      {courseNameOf(assignment)}
                    </div>
                    <div className="flex items-center flex-wrap gap-2 mb-1 sm:mb-1.5">
                      <h3 className="text-title font-bold text-text-primary group-hover:text-primary transition-colors truncate max-w-full">
                        {assignment.title}
                      </h3>
                      <div className="flex gap-1 shrink-0">
                        {isDraft && (
                          <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-body rounded-full border border-amber-200/50 whitespace-nowrap">
                            草稿
                          </span>
                        )}
                        {isUnderReview && (
                          <span className="px-2 py-0.5 bg-info-100 text-info-700 text-body rounded-full border border-info-200/50 whitespace-nowrap">
                            批閱中
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
                      <div className="flex items-center gap-1.5 text-ui text-text-secondary font-normal">
                        <Calendar size={14} className="sm:size-4" />
                        <span>{deadline ? `截止：${deadline.toLocaleDateString()}` : NO_DEADLINE_LABEL}</span>
                      </div>
                      {/*
                        還沒交的學生系統也會先建一筆 status='Unsubmitted' 的紀錄，
                        它的 submittedAt 是空字串 —— 只判斷 submission 存在的話，
                        這裡會印出「繳交：Invalid Date」。要看的是有沒有繳交時間。
                      */}
                      {submission?.submittedAt && !isDraft && (
                        <div className="flex items-center gap-1.5 text-ui text-text-secondary font-normal">
                          <Clock size={14} className="sm:size-4" />
                          <span>繳交：{new Date(submission.submittedAt).toLocaleDateString()}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-3 sm:gap-4 mt-3 sm:mt-0 pt-3 sm:pt-0 border-t border-border/50 sm:border-t-0">
                  <div className="text-left sm:text-right">
                    <p className={`text-ui font-bold flex items-center sm:justify-end gap-1.5 ${
                      isReturned ? 'text-success-600' : 
                      isDraft ? 'text-amber-600' : 
                      isUnderReview ? 'text-info-600' :
                      isOverdue ? 'text-danger-600' : 
                      'text-primary'
                    }`}>
                      {isReturned ? '已完成' : isUnderReview ? '批閱中'
                        : isClosed ? '已結束'
                        : isOverdue && !isDraft ? '已逾期' : '進行中'}
                    </p>
                    {isReturned && submission.result && (
                      <p className="text-ui text-text-primary font-bold mt-0.5">{submission.result.totalScore} 分</p>
                    )}
                  </div>
                  
                  <button 
                    id={`studentassignments-btn-action-${assignment.id}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isReturned) {
                        navigate(routes.studentGrades({ focusId: submission.id }));
                      } else {
                        navigate(routes.studentEditor(assignment.id));
                      }
                    }}
                    className={`flex-1 sm:flex-none px-4 sm:px-6 py-2 sm:py-2.5 rounded-xl text-ui font-bold flex items-center justify-center gap-2 transition-all active:scale-95 ${
                      isReturned || isUnderReview || isClosed
                        ? 'bg-card text-text-primary hover:bg-surface border border-border/50 shadow-sm' 
                        : isDraft
                        ? 'bg-amber-500 text-on-accent hover:bg-amber-600 shadow-sm shadow-amber-500/20'
                        : 'bg-primary text-on-accent hover:bg-primary/90 shadow-sm shadow-primary/20'
                    }`}
                  >
                    {isReturned ? (
                      <>查看回饋 <ChevronRight size={16} className="sm:size-[18px]" /></>
                    ) : isUnderReview ? (
                      <>已繳交 <CheckCircle2 size={16} className="sm:size-[18px]" /></>
                    ) : isClosed ? (
                      // 已結束收件就不要再叫他去寫
                      <>已結束收件</>
                    ) : isDraft ? (
                      <><Save size={16} className="sm:size-[18px]" /> 繼續寫作</>
                    ) : (
                      <><BookOpen size={16} className="sm:size-[18px]" /> 開始寫作</>
                    )}
                  </button>
                </div>
              </div>
            );
          })
        ) : (
          <div className="bg-card/50 border-2 border-dashed border-border rounded-brand p-20 text-center">
            <div className="w-16 h-16 bg-surface-soft rounded-full flex items-center justify-center mx-auto mb-4 text-text-primary opacity-60">
              <Search size={32} />
            </div>
            <h3 className="text-title font-bold text-text-primary mb-2">找不到相關作業</h3>
            <p className="text-text-primary opacity-70">請嘗試更換搜尋關鍵字或篩選條件</p>
          </div>
        )}
      </div>
    </div>
  );
};
