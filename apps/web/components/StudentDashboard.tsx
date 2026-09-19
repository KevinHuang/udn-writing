import { Markdown } from './Markdown';
import { useNavigate } from 'react-router-dom';
import { routes } from '../lib/routes';
import React from 'react';
import { 
  BookOpen, 
  CheckCircle2, 
  Star, 
  Clock, 
  ChevronRight, 
  ArrowRight,
  ArrowLeft,
  Save,
  FileText,
  Calendar,
} from 'lucide-react';
import { Assignment, Submission, Question, Course } from '../types';
import {
  deadlineOf,
  NO_DEADLINE_LABEL,
  assignmentPhase,
  canStudentSubmit,
} from '../lib/assignments';
import { SemesterSelect } from './SemesterSelect';

interface StudentDashboardProps {
  studentName: string;
  assignments: Assignment[];
  submissions: Submission[];
  questions: Question[];
  courses: Course[];
  onBack?: () => void;
  canGoBack?: boolean;
  currentSemester: string;
  /** 網址指定的學期（例如 114-2）。沒帶就是目前學期 */
  semester?: string;
  /** 學期下拉的選項（後端 semesters 表） */
  semesterOptions: { value: string; label: string }[];
}

export const StudentDashboard: React.FC<StudentDashboardProps> = ({
  studentName,
  assignments,
  submissions,
  courses,
  onBack,
  canGoBack,
  currentSemester,
  semester,
  semesterOptions,
}) => {
  const navigate = useNavigate();
  /*
    看哪個學期的概況。預設目前學期，可以用右上角的下拉切到別的學期。
    學期放網址（?semester=），與成績紀錄同一個參數，重新整理不會跳走。
  */
  const pickedSemester = semester ?? currentSemester;
  const isCurrentSemester = pickedSemester === currentSemester;
  // Calculate stats
  const totalGradedAndReturned = submissions.filter(s => s.status === 'Published').length;
  
  const currentCourseAssignmentIds = new Set(assignments.filter(a => {
    const course = courses.find(c => c.id === a.courseId);
    return course && course.semester === pickedSemester;
  }).map(a => a.id));
  
  const completedThisSemester = submissions.filter(s => 
    currentCourseAssignmentIds.has(s.assignmentId) && 
    s.status === 'Published'
  ).length;
  
  const currentSemesterSubmissions = submissions.filter(s => 
    currentCourseAssignmentIds.has(s.assignmentId) && s.result
  );
  
  const averageScore = currentSemesterSubmissions.length > 0
    ? (currentSemesterSubmissions.reduce((acc, s) => acc + (s.result?.totalScore || 0), 0) / currentSemesterSubmissions.length).toFixed(1)
    : '0.0';

  /*
    進行中：**選定學期**、還沒繳交或還在草稿的作業。

    ⚠️ 這裡以前沒有依學期過濾，所以首頁自己前後矛盾：「本學期 0 篇」用
       currentCourseAssignmentIds 算（有過濾），底下的「進行中作業」卻把
       過去學期的也列出來。實測一位學生看到三份 114-2 的作業掛在
       「進行中」，而標頭寫的是 115-1。

       學年期由 semesters 表依今天的日期決定（後端 SemesterHelper.current()），
       所以「本學期」是會自己前進的 —— 過去學期的作業不該再催學生去寫。
  */
  const inProgressAssignments = assignments
    .filter(a => {
      if (!currentCourseAssignmentIds.has(a.id)) return false;

      const submission = submissions.find(s => s.assignmentId === a.id);
      const subStatus = submission?.status || 'Unsubmitted';
      
      // Align with StudentAssignments "IN_PROGRESS" logic
      const isInProgress = subStatus === 'Unsubmitted' || subStatus === 'Draft';
      
      /*
        ⚠️ **只列還能交的。** 已截止又不收遲交的作業掛在「進行中」、
           按鈕寫著「開始寫作」，但學生其實已經不能繳交了。
           能不能交一律問 canStudentSubmit()，不要自己比 status 或時間。
      */
      return canStudentSubmit(a) && isInProgress;
    })
    .sort((a, b) => {
      // 沒有截止日的排最後 —— 它不在時間軸上，不是「很晚才到期」
      const da = deadlineOf(a), db = deadlineOf(b);
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return +da - +db;
    })
    .slice(0, 3);

  // Recent feedback
  /*
    近期發還：**選定學期**已發還的作品，最新的兩份。

    ⚠️ 這裡以前沒有依學期過濾，是首頁最後一處沒收斂的地方 ——
       標頭寫 115-1，卡片卻是 114-2 的作品（實測看到的就是這個）。
       規則與上面的 inProgressAssignments 一致，都走 currentCourseAssignmentIds。

    「學習紀錄」那張卡刻意**不**過濾（見 totalGradedAndReturned）——
    它與旁邊的「本學期」是一組對照：一個是累計、一個是這學期。
  */
  const recentFeedback = submissions
    .filter(s => currentCourseAssignmentIds.has(s.assignmentId) && s.result && s.status === 'Published')
    .sort((a, b) => {
      const dateA = new Date(a.publishedAt || a.submittedAt).getTime();
      const dateB = new Date(b.publishedAt || b.submittedAt).getTime();
      return dateB - dateA;
    })
    .slice(0, 2);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return "早安";
    if (hour >= 12 && hour < 18) return "午安";
    return "晚安";
  };

  return (
    <div className="space-y-4 sm:space-y-8 animate-fade-in">
      {/* Greeting */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 mb-4 sm:mb-8 shrink-0">
        <div className="flex flex-col gap-1 sm:gap-2">
          <div className="flex items-center gap-2 sm:gap-3">
            {canGoBack && onBack && (
              <button 
                id="studentdashboard-btn-back"
                onClick={onBack}
                className="p-1.5 sm:p-2 -ml-1 sm:-ml-2 rounded-full hover:bg-card/50 text-text-primary transition-colors active:scale-90"
              >
                <ArrowLeft size={18} className="sm:size-6" />
              </button>
            )}
            <h1 className="text-display font-bold text-text-primary tracking-tight">
              {getGreeting()}，{studentName} 👋
            </h1>
          </div>
          <p className="text-ui text-text-secondary font-normal">準備好開始今天的寫作練習了嗎？</p>
        </div>
        {/* 換學期就換網址（replace，不塞歷史）。選回目前學期時拿掉參數，網址保持乾淨 */}
        <SemesterSelect
          id="studentdashboard-select-semester"
          value={pickedSemester}
          options={semesterOptions}
          current={currentSemester}
          onChange={(s) => navigate(
            routes.studentDashboard({ semester: s === currentSemester ? undefined : s }),
            { replace: true },
          )}
          className="self-stretch md:self-end"
        />
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-3 gap-2 sm:gap-6">
        <div 
          id="studentdashboard-card-stats-history"
          onClick={() => navigate(routes.studentGrades())}
          className="bg-card p-2.5 sm:p-4 md:p-6 rounded-2xl border-t-[6px] border-brand-blue shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 cursor-pointer group flex flex-col sm:block"
        >
          <p className="text-text-secondary text-title font-bold font-serif mb-1.5 sm:mb-0 text-center sm:text-left whitespace-nowrap tracking-tighter sm:tracking-normal">
            學習紀錄
          </p>
          <div className="flex flex-col sm:flex-row items-center gap-1 sm:gap-3 sm:mt-4">
            <div className="w-7 h-7 sm:w-9 sm:h-9 md:w-12 md:h-12 rounded-full bg-surface-soft text-primary flex items-center justify-center shadow-inner group-hover:bg-primary group-hover:text-on-accent transition-colors shrink-0">
              <BookOpen size={14} className="sm:size-[18px] md:size-[24px]" strokeWidth={2} />
            </div>
            <div className="flex sm:block items-baseline sm:items-stretch gap-0.5 sm:gap-0 text-center sm:text-left">
              <h3 className="text-display font-serif font-bold tracking-tight text-text-primary sm:mt-0.5">
                {totalGradedAndReturned}{" "}
                <span className="text-ui text-text-secondary font-normal font-sans whitespace-nowrap">
                  篇
                </span>
              </h3>
            </div>
          </div>
        </div>

        <div 
          id="studentdashboard-card-stats-semester"
          onClick={() => navigate(routes.studentGrades({ semester: pickedSemester }))}
          className="bg-card p-2.5 sm:p-4 md:p-6 rounded-2xl border-t-[6px] border-brand-blue shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 cursor-pointer group flex flex-col sm:block"
        >
          <p className="text-text-secondary text-title font-bold font-serif mb-1.5 sm:mb-0 text-center sm:text-left whitespace-nowrap tracking-tighter sm:tracking-normal">
            {isCurrentSemester ? '本學期' : '該學期'}
          </p>
          <div className="flex flex-col sm:flex-row items-center gap-1 sm:gap-3 sm:mt-4">
            <div className="w-7 h-7 sm:w-9 sm:h-9 md:w-12 md:h-12 rounded-full bg-success-50 text-success-600 flex items-center justify-center shadow-inner group-hover:bg-success-600 group-hover:text-on-accent transition-colors shrink-0">
              <CheckCircle2 size={14} className="sm:size-[18px] md:size-[24px]" strokeWidth={2} />
            </div>
            <div className="flex sm:block items-baseline sm:items-stretch gap-0.5 sm:gap-0 text-center sm:text-left">
              <h3 className="text-display font-serif font-bold tracking-tight text-text-primary sm:mt-0.5">
                {completedThisSemester}{" "}
                <span className="text-ui text-text-secondary font-normal font-sans whitespace-nowrap">
                  篇
                </span>
              </h3>
            </div>
          </div>
        </div>

        <div 
          id="studentdashboard-card-stats-average"
          className="bg-card p-2.5 sm:p-4 md:p-6 rounded-2xl border-t-[6px] border-brand-blue shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 group flex flex-col sm:block"
        >
          <p className="text-text-secondary text-title font-bold font-serif mb-1.5 sm:mb-0 text-center sm:text-left whitespace-nowrap tracking-tighter sm:tracking-normal">
            平均成績
          </p>
          <div className="flex flex-col sm:flex-row items-center gap-1 sm:gap-3 sm:mt-4">
            <div className="w-7 h-7 sm:w-9 sm:h-9 md:w-12 md:h-12 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center shadow-inner group-hover:bg-amber-500 group-hover:text-on-solid transition-colors shrink-0">
              <Star size={14} className="sm:size-[18px] md:size-[24px]" strokeWidth={2} />
            </div>
            <div className="flex sm:block items-baseline sm:items-stretch gap-0.5 sm:gap-0 text-center sm:text-left">
              <h3 className="text-display font-serif font-bold tracking-tight text-text-primary sm:mt-0.5">
                {averageScore}{" "}
                <span className="text-ui text-text-secondary font-normal font-sans whitespace-nowrap">
                  分
                </span>
              </h3>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8">
        {/* In-progress Assignments */}
        <div className="lg:col-span-2 space-y-3 sm:space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-primary font-bold">
              <Clock size={18} className="sm:size-5" />
              <span className="text-title tracking-tight">進行中作業</span>
            </div>
            <button 
              id="studentdashboard-btn-viewall-assignments"
              onClick={() => navigate(routes.studentAssignments())}
              className="tap-target text-body text-text-primary opacity-70 hover:text-primary flex items-center gap-1 transition-colors"
            >
              查看全部 <ChevronRight size={14} className="sm:size-4" />
            </button>
          </div>

          <div className="space-y-3 sm:space-y-4">
            {inProgressAssignments.length > 0 ? (
              inProgressAssignments.map(assignment => {
                const submission = submissions.find(s => s.assignmentId === assignment.id);
                const isDraft = submission && submission.status === 'Draft';
                const isPending = submission && submission.status === 'Pending';
                const deadline = deadlineOf(assignment);
                /*
                  這裡只會出現還能交的作業（見 inProgressAssignments），
                  所以過了截止的一定是「可遲交」，不是「已截止」。
                */
                const isOverdue = !isPending && assignmentPhase(assignment) === 'ended';

                return (
                  <div 
                    key={assignment.id} 
                    id={`studentdashboard-item-progress-${assignment.id}`}
                    onClick={() => navigate(routes.studentEditor(assignment.id))}
                    className="bg-card p-4 sm:p-5 rounded-brand shadow-sm border border-border hover:border-primary/30 hover:bg-surface/80 hover:shadow-md hover:-translate-y-1 transition-all duration-300 group cursor-pointer active:scale-[0.99] relative"
                  >
                    <div className="flex items-center gap-3 sm:gap-4">
                      <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center border transition-colors shrink-0 ${
                        isDraft ? 'bg-amber-50 text-amber-600 border-amber-100' : isPending ? 'bg-primary/10 text-primary border-primary/20' : isOverdue ? 'bg-warning-100 text-warning-700 border-warning-200' : 'bg-primary/10 text-primary border-primary/20'
                      }`}>
                        {isDraft ? <Save size={18} className="sm:size-6" /> : isPending ? <CheckCircle2 size={18} className="sm:size-6" /> : <FileText size={18} className="sm:size-6" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 sm:gap-2 mb-1 flex-wrap">
                          <span className="text-caption text-primary bg-primary/10 px-1.5 sm:px-2 py-0.5 rounded-full uppercase tracking-wider inline-block">
                            {courses.find(c => c.id === assignment.courseId)?.name || '未知課程'}
                          </span>
                          {isDraft && (
                            <span className="px-1.5 sm:px-2 py-0.5 bg-amber-100 text-amber-700 text-caption rounded-full uppercase tracking-wider border border-amber-200">
                              草稿
                            </span>
                          )}
                          {isPending && (
                            <span className="px-1.5 sm:px-2 py-0.5 bg-primary/10 text-primary text-caption rounded-full uppercase tracking-wider border border-primary/20">
                              已繳交
                            </span>
                          )}
                        </div>
                        <h3 className="text-title font-serif font-bold text-text-primary group-hover:text-primary transition-colors truncate">
                          {assignment.title}
                        </h3>
                        <div className="flex items-center gap-2 sm:gap-4 mt-1">
                          <div className="flex items-center gap-1 sm:gap-1.5 text-ui text-text-primary opacity-70 font-normal">
                            <Calendar size={12} className="sm:size-4" />
                            <span>{deadline ? `截止：${deadline.toLocaleDateString()} ${deadline.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : NO_DEADLINE_LABEL}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 mt-3 sm:mt-0 sm:absolute sm:right-5 sm:top-1/2 sm:-translate-y-1/2">
                      <div className="text-right hidden sm:block">
                        <p className={`text-ui font-bold uppercase tracking-wider flex items-center justify-end gap-1.5 ${
                          isDraft || isPending ? 'text-primary' : isOverdue ? 'text-warning-700' : 'text-primary'
                        }`}>
                          {isPending ? '已繳交' : isOverdue ? '可遲交' : '進行中'}
                        </p>
                      </div>
                      
                      <button 
                        id={`studentdashboard-btn-action-${assignment.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(routes.studentEditor(assignment.id));
                        }}
                        className={`w-full sm:w-auto px-4 sm:px-6 py-2 sm:py-2.5 rounded-xl text-ui font-bold flex items-center justify-center gap-1.5 sm:gap-2 transition-all shadow-sm active:scale-95 ${
                          isDraft 
                            ? 'bg-amber-500 text-on-accent hover:bg-amber-600 shadow-amber-200' 
                            : isPending
                            ? 'bg-surface-soft text-text-primary hover:bg-border border border-border/50 shadow-none'
                            : 'bg-primary text-on-accent hover:bg-primary/90 shadow-primary/20'
                        }`}
                      >
                        {isDraft ? (
                          <><Save size={14} className="sm:size-5" /> 繼續寫作</>
                        ) : isPending ? (
                          <><CheckCircle2 size={14} className="sm:size-5" /> 已繳交</>
                        ) : (
                          <><BookOpen size={14} className="sm:size-5" /> 開始寫作</>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="bg-surface/40 border-2 border-dashed border-border rounded-brand p-8 sm:p-12 text-center">
                <p className="text-body text-text-primary opacity-70 font-normal">{isCurrentSemester ? '目前沒有進行中的作業' : '這個學期沒有進行中的作業'}</p>
              </div>
            )}
          </div>
        </div>

        {/* Recently Returned */}
        <div className="space-y-3 sm:space-y-4">
          <div className="flex items-center gap-2 text-secondary font-bold">
            <Star size={18} className="sm:size-5" />
            <span className="text-title tracking-tight">近期發還</span>
          </div>

          <div className="space-y-3 sm:space-y-4">
            {recentFeedback.length > 0 ? (
              recentFeedback.map(submission => {
                const assignment = assignments.find(a => a.id === submission.assignmentId);
                return (
                  <div key={submission.id} id={`studentdashboard-item-feedback-${submission.id}`} className="bg-card p-4 sm:p-5 rounded-brand shadow-sm border border-border hover:bg-surface/80 hover:shadow-md hover:-translate-y-1 transition-all duration-300 group">
                    <div className="flex items-center justify-between mb-2 sm:mb-3">
                      <div className="flex flex-col gap-0.5 sm:gap-1 min-w-0 pr-2">
                        <h4 className="text-title font-serif font-bold text-text-primary truncate group-hover:text-primary transition-colors">
                          {assignment?.title || '作業'}
                        </h4>
                      </div>
                      <div className="bg-primary/10 text-primary px-2 py-0.5 sm:py-1 rounded-lg text-ui font-bold border border-primary/20 shrink-0">
                        {submission.result?.totalScore} 分
                      </div>
                    </div>
                    {/*
                      ⚠️ 這裡**不能用 `<p>`**。評語是一整份 markdown，Markdown 元件會
                      產出 <div>／<h2>／<ul>／<hr> —— 全都不允許出現在 <p> 裡面，
                      React 會丟十筆 hydration 警告，瀏覽器也會把 <p> 提前收掉，
                      line-clamp 因此夾不住。示範資料是純文字所以看不出來，
                      真實的 AI 評語一進來就爆。
                    */}
                    <div className="text-ui text-text-primary opacity-80 line-clamp-2 sm:line-clamp-3 mb-3 sm:mb-4 leading-relaxed font-normal">
                      {submission.result?.feedback
                        ? <Markdown>{submission.result.feedback}</Markdown>
                        : '尚無評語'}
                    </div>
                    <button 
                      id={`studentdashboard-btn-viewdetail-feedback-${submission.id}`}
                      onClick={() => navigate(routes.studentGrades({ focusId: submission.id }))}
                      className="tap-target text-primary text-ui font-bold flex items-center gap-1 hover:underline active:scale-95 transition-transform"
                    >
                      查看詳細分析 <ArrowRight size={14} className="sm:size-4" />
                    </button>
                  </div>
                );
              })
            ) : (
              <div className="bg-surface/40 border-2 border-dashed border-border rounded-brand p-6 sm:p-8 text-center">
                <p className="text-body text-text-primary opacity-60 font-normal">{isCurrentSemester ? '暫無發還紀錄' : '這個學期沒有發還紀錄'}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
