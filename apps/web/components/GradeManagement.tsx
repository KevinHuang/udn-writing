import { Markdown } from './Markdown';

import React, { useState, useMemo } from 'react';
import { 
  Download, 
  Calendar, 
  ChevronDown, 
  Search, 
  Users,
  ArrowLeft,
  FileClock,
  X,
  ChevronRight,
  CheckCircle2,
  TrendingUp,
  GraduationCap,
  ClipboardList,
  Target,
  Sparkles
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, LabelList,
} from 'recharts';
import { Course, Assignment, Submission, CATEGORY_LABELS } from '../types';
import { MAX_LEVEL, MIN_LEVEL, levelStyle, toLevel, CRITERIA_SHORT_LABELS } from '../lib/scoring';
import { SHOW_CATEGORY_SCORES } from '../lib/features';
import { studentIdFor } from '../mockData';
import { semesterLabel } from '../lib/semester';
import { isOnLeave, type LeaveMarks } from '../lib/leave';
import { isAdmin, type CurrentUser } from '../lib/access';
import { isOverdue as isAssignmentOverdue } from '../lib/assignments';
import { orderedAssignments, orderNumbers } from '../lib/assignmentOrder';
import { CoursePickerModal } from './CoursePickerModal';

interface GradeManagementProps {
  courses: Course[];
  assignments: Assignment[];
  submissions: Submission[];
  rosters: Record<string, { seatNo: number; name: string }[]>;
  currentSemester: string;
  onSemesterChange: (s: string) => void;
  semesterOptions: { value: string; label: string }[];
  initialCourseId?: string | null;
  /** 請假註記（作業 × 學生），見 lib/leave.ts */
  leaveMarks?: LeaveMarks;
  /** 目前身分。管理人員的班級改用挑選視窗，教師維持簡單下拉 */
  user: CurrentUser;
  onSetLeave?: (assignmentId: string, studentId: string, onLeave: boolean) => void;
  onBack?: () => void;
  canGoBack?: boolean;
  /** 開這個班的期末總結。由頁面負責導向 */
  onOpenFinalReport?: (courseId: string) => void;
}

// --- STUDENT HISTORY MODAL ---
interface StudentHistoryModalProps {
    isOpen: boolean;
    onClose: () => void;
    student: { seatNo: number; name: string } | null;
    courseName: string;
    submissions: Submission[];
    assignments: Assignment[];
}

const StudentHistoryModal: React.FC<StudentHistoryModalProps> = ({ 
    isOpen, onClose, student, courseName, submissions, assignments 
}) => {
    const [selectedSubmissionId, setSelectedSubmissionId] = useState<string | null>(null);

    if (!isOpen || !student) return null;

    // Filter relevant submissions for this student (Graded or Published only)
    const studentHistory = submissions
        .filter(s => 
            s.studentName === student.name && 
            (s.status === 'Graded' || s.status === 'Published')
        )
        .map(s => {
            const assignment = assignments.find(a => a.id === s.assignmentId);
            return {
                ...s,
                assignmentTitle: assignment?.title || '未知作業',
                maxScore: MAX_LEVEL
            };
        })
        .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()); // Newest first

    // Detailed view data
    const selectedDetail = selectedSubmissionId 
        ? studentHistory.find(s => s.id === selectedSubmissionId) 
        : null;

    return (
        <div id="grademanagement-studenthistorymodal" className="fixed inset-0 z-50 flex items-center justify-center bg-text-primary/40 backdrop-blur-sm p-4 animate-fade-in">
            <div className="bg-surface rounded-brand shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col h-[85vh] border border-border relative">
                
                {/* Header - Solid White for readability */}
                <div className="p-4 sm:p-6 border-b border-border flex justify-between items-center bg-surface shrink-0 z-10">
                    <div>
                        <div className="flex items-center gap-2 mb-0.5 sm:mb-1">
                            <span className="bg-text-primary text-surface text-caption px-1.5 sm:px-2 py-0.5 rounded-md font-mono">
                                {student.seatNo.toString().padStart(2, '0')}
                            </span>
                            <h3 className="text-title font-bold text-text-primary">{student.name}</h3>
                        </div>
                        <p className="text-body text-text-secondary font-normal flex items-center gap-1.5 sm:gap-2">
                            <GraduationCap size={12} className="sm:size-3.5" />
                            {courseName} • 學習歷程檔案
                        </p>
                    </div>
                    <button id="grademanagement-studenthistorymodal-btn-close" onClick={onClose} className="text-text-primary hover:text-primary p-1.5 sm:p-2 hover:bg-secondary/10 rounded-full transition-colors">
                        <X size={20} className="sm:size-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto bg-secondary/5">
                    {selectedDetail ? (
                        // DETAIL VIEW
                        <div className="p-4 sm:p-8 animate-slide-in-right">
                            <button 
                                id="grademanagement-studenthistorymodal-btn-back"
                                onClick={() => setSelectedSubmissionId(null)}
                                className="flex items-center gap-1 text-body text-text-primary hover:text-primary mb-4 sm:mb-6 transition-colors"
                            >
                                <ArrowLeft size={14} className="sm:size-4" /> 返回列表
                            </button>

                            <div className="bg-surface rounded-brand shadow-sm border border-border overflow-hidden">
                                <div className="p-4 sm:p-6 border-b border-border flex justify-between items-start bg-secondary/5">
                                    <div>
                                        <h2 className="text-title font-bold text-text-primary mb-1 sm:mb-2">{selectedDetail.assignmentTitle}</h2>
                                        <div className="flex items-center gap-2 sm:gap-3 text-caption font-normal text-text-secondary">
                                            <span className="flex items-center gap-1"><Calendar size={10} className="sm:size-3"/> {new Date(selectedDetail.submittedAt).toLocaleDateString()}</span>
                                            {selectedDetail.status === 'Published' && (
                                                <span className="flex items-center gap-1 text-success-700 bg-success-50 px-1.5 sm:px-2 py-0.5 rounded-full border border-success-100">
                                                    <CheckCircle2 size={10} className="sm:size-3"/> 已發還
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="text-center">
                                        <div className="text-display font-bold text-primary">{selectedDetail.result?.totalScore}</div>
                                        <div className="text-caption text-text-secondary uppercase">Total Score</div>
                                    </div>
                                </div>

                                <div className="p-4 sm:p-6 space-y-6 sm:space-y-8">
                                    {/* 四項評分要素：依需求先隱藏，資料與 AI 回傳都保留（見 lib/features.ts） */}
                                    {SHOW_CATEGORY_SCORES && (
                                    <div>
                                        <h4 className="text-caption text-text-secondary uppercase tracking-widest mb-3 sm:mb-4">得分細項</h4>
                                        <div className="grid grid-cols-2 gap-3 sm:gap-4">
                                            {selectedDetail.result?.categoryScores && Object.entries(selectedDetail.result.categoryScores).map(([key, score]) => (
                                                <div key={key} className="bg-secondary/5 p-2.5 sm:p-3 rounded-brand border border-border">
                                                    <div className="flex justify-between text-body mb-1.5 sm:mb-2">
                                                        <span className="font-bold text-text-secondary">{CATEGORY_LABELS[key]}</span>
                                                        <span className="font-bold text-text-primary">{score}/{MAX_LEVEL}</span>
                                                    </div>
                                                    <div className="h-1 sm:h-1.5 bg-secondary/20 rounded-full overflow-hidden">
                                                        <div 
                                                            className="h-full bg-primary rounded-full" 
                                                            style={{ width: `${(Number(score) / MAX_LEVEL) * 100}%` }}
                                                        />
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    )}

                                    {/* Feedback */}
                                    {selectedDetail.result?.feedback && (
                                        <div className="mt-4">
                                            <p className="text-caption text-text-muted mb-1">
                                                {/* 評語只有一版 —— is_ai 決定它是誰寫的 */}
                                                {selectedDetail.result.isAi ? 'AI 批改評語' : '教師評語'}
                                            </p>
                                            <Markdown>{selectedDetail.result.feedback}</Markdown>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    ) : (
                        // LIST VIEW
                        <div className="p-6">
                            {studentHistory.length > 0 ? (
                                <div className="space-y-3">
                                    {studentHistory.map(item => (
                                        <div 
                                            key={item.id}
                                            id={`grademanagement-studenthistorymodal-listitem-${item.id}`}
                                            onClick={() => setSelectedSubmissionId(item.id)}
                                            className="group bg-surface p-4 rounded-brand border border-border hover:border-primary/30 hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer flex items-center justify-between"
                                        >
                                            <div className="flex items-center gap-4">
                                                <div className={`w-12 h-12 rounded-brand flex items-center justify-center font-bold text-title shadow-sm ${
                                                    levelStyle(item.result?.totalScore).badge
                                                }`}>
                                                    {item.result?.totalScore}
                                                </div>
                                                <div>
                                                    <h4 className="font-bold text-text-primary group-hover:text-primary transition-colors mb-0.5">
                                                        {item.assignmentTitle}
                                                    </h4>
                                                    <p className="text-caption text-text-secondary font-normal">
                                                        {new Date(item.submittedAt).toLocaleDateString()}
                                                    </p>
                                                </div>
                                            </div>
                                            <ChevronRight size={18} className="text-text-muted group-hover:text-primary transition-colors" />
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="flex flex-col items-center justify-center h-64 text-text-secondary">
                                    <FileClock size={48} className="mb-3 opacity-80" />
                                    <p className="font-normal">尚無已完成的作業記錄</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

/**
 * Recharts 只接受實際色碼，不吃 Tailwind class，
 * 所以從 CSS 變數把當前主題的顏色讀出來給圖表用。
 * 主題切換時 html.dark 會變動，這裡在每次 render 讀取即可。
 */
function readChartInk() {
  if (typeof window === 'undefined') {
    return { text: '#17150F', muted: '#8A8271', border: '#DED7C4', card: '#FCFAF3', cursor: 'rgba(0,0,0,.04)', scheme: 'light' as const };
  }
  const cs = getComputedStyle(document.documentElement);
  const get = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  const dark = document.documentElement.classList.contains('dark');
  return {
    text: get('--color-text-primary', '#17150F'),
    muted: get('--color-ink-500', '#8A8271'),
    border: get('--color-border', '#DED7C4'),
    card: get('--color-card', '#FCFAF3'),
    cursor: dark ? 'rgba(255,255,255,.06)' : 'rgba(23,21,15,.04)',
    scheme: (dark ? 'dark' : 'light') as 'dark' | 'light',
  };
}

export const GradeManagement: React.FC<GradeManagementProps> = ({
  courses,
  assignments,
  submissions,
  rosters,
  currentSemester,
  onSemesterChange,
  semesterOptions,
  initialCourseId,
  leaveMarks,
  onSetLeave,
  user,
  onBack,
  canGoBack,
  onOpenFinalReport
}) => {
  // Filter courses by semester
  const semesterCourses = useMemo(() => 
    courses.filter(c => c.semester === currentSemester), 
  [courses, currentSemester]);


  /**
   * 使用者在左側清單點選的班級。
   *
   * 原本這裡有兩個 effect 在互相修正同一個值：一個把 initialCourseId 寫進來，
   * 另一個在值不合法時退回第一個班級。兩者都是 render 後才跑，會多一輪
   * render，換學期時還會先閃一下不屬於該學期的班級。
   * 改成：使用者的選擇留在 state，真正生效的值在 render 階段算出來。
   */
  const chartInk = readChartInk();

  const [pickedCourseId, setPickedCourseId] = useState<string | null>(initialCourseId || null);
  
  // History Modal State
  const [historyModalStudent, setHistoryModalStudent] = useState<{ seatNo: number; name: string } | null>(null);

  /** 任務篩選。'ALL' 代表全部任務 —— 圖表與成績表都吃這個值 */
  const [pickedAssignmentId, setPickedAssignmentId] = useState<string>('ALL');
  /** 班級挑選視窗（只有管理人員用得到） */
  const [isCoursePickerOpen, setIsCoursePickerOpen] = useState(false);

  /**
   * 換班。兩個入口（教師的下拉、管理人員的挑選視窗）都要走這一支 ——
   * 少了 setPickedAssignmentId('ALL')，換班後會停在一個新班沒有的任務上。
   */
  const changeCourse = (courseId: string) => {
    setPickedCourseId(courseId);
    setPickedAssignmentId('ALL');
  };

  // 從別的頁帶著 initialCourseId 重新導覽進來時，該班級要蓋掉先前的選擇。
  // 這是 React 官方的「render 階段依 prop 變化調整 state」寫法，
  // 會在 commit 前重跑一次 render，不會讓使用者看到中間狀態。
  const [lastInitialCourseId, setLastInitialCourseId] = useState(initialCourseId);
  if (initialCourseId !== lastInitialCourseId) {
    setLastInitialCourseId(initialCourseId);
    if (initialCourseId) setPickedCourseId(initialCourseId);
  }

  // 真正生效的班級：選到的若不在本學期清單裡（例如剛換學期），退回第一個班級
  const selectedCourseId =
    pickedCourseId && semesterCourses.some((c) => c.id === pickedCourseId)
      ? pickedCourseId
      : semesterCourses[0]?.id ?? null;

  const selectedCourse = courses.find(c => c.id === selectedCourseId);

  /*
    這個班的作業，依**老師在課程作業清單裡排定的順序**。
    以前是照建立時間排，但建立時間不等於教學順序（同一天派三份、
    補派一份舊題目都會排錯）。順序的唯一來源在 lib/assignmentOrder.ts，
    這裡不要自己 sort —— 表格欄位與下拉選單都要跟課程頁看到的一樣。
  */
  const courseAssignments = useMemo(
    () => orderedAssignments(assignments, selectedCourseId || ''),
    [assignments, selectedCourseId],
  );

  /** 作業編號。與課程作業清單上的卡片號碼是同一組數字 */
  const assignmentNo = useMemo(
    () => orderNumbers(courseAssignments),
    [courseAssignments],
  );

  /** 真正生效的任務：選到的若不屬於這個班（換班後），退回全部 */
  const selectedAssignmentId =
    pickedAssignmentId !== 'ALL' &&
    courseAssignments.some((a) => a.id === pickedAssignmentId)
      ? pickedAssignmentId
      : 'ALL';

  /** 納入統計的任務。單選時只算那一份，全部時算整學期 */
  const scopedAssignments = useMemo(
    () =>
      selectedAssignmentId === 'ALL'
        ? courseAssignments
        : courseAssignments.filter((a) => a.id === selectedAssignmentId),
    [courseAssignments, selectedAssignmentId],
  );

  /**
   * 這個範圍內所有「批改完成」的成績。
   *
   * 只採計 Graded 與 Published —— 待批改的還沒有分數，
   * 把它們算成 0 會把全班平均整個拉下來，那是假的。
   */
  const scopedResults = useMemo(() => {
    const ids = new Set(scopedAssignments.map((a) => a.id));
    return submissions.filter(
      (sub) =>
        ids.has(sub.assignmentId) &&
        (sub.status === 'Graded' || sub.status === 'Published') &&
        sub.result,
    );
  }, [submissions, scopedAssignments]);

  /** 六級分分布：0-6 各有幾份 */
  const levelDistribution = useMemo(() => {
    const counts = new Array(MAX_LEVEL + 1).fill(0);
    scopedResults.forEach((sub) => {
      counts[toLevel(sub.result?.totalScore)] += 1;
    });
    return counts.map((count, level) => ({ level, name: `${level}級分`, count }));
  }, [scopedResults]);

  /** 四向度平均。鍵與標籤都取自 types.ts 的 CATEGORY_LABELS，不要另寫一份 */
  const categoryAverages = useMemo(() => {
    const keys = ['content', 'structure', 'vocabulary', 'grammar'] as const;
    return keys.map((key) => {
      const values = scopedResults
        .map((sub) => sub.result?.categoryScores?.[key])
        .filter((v): v is number => typeof v === 'number');
      const avg = values.length
        ? values.reduce((a, b) => a + b, 0) / values.length
        : 0;
      return {
        key,
        // 軸上用短標籤，滑鼠停留的 Tooltip 仍是官方全名
        label: CRITERIA_SHORT_LABELS[key],
        fullLabel: CATEGORY_LABELS[key],
        value: Number(avg.toFixed(1)),
      };
    });
  }, [scopedResults]);

  // Get students for the selected course, sorted by seat number
  const students = useMemo(() => 
    selectedCourseId ? (rosters[selectedCourseId] || []).sort((a, b) => a.seatNo - b.seatNo) : [],
  [rosters, selectedCourseId]);

  // Search filter
  const [searchTerm, setSearchTerm] = useState('');
  const filteredStudents = students.filter(student => 
    student.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    student.seatNo.toString().includes(searchTerm)
  );

  // Helper to get score
  const getSubmission = (studentName: string, assignmentId: string) => {
      return submissions.find(s => s.studentName === studentName && s.assignmentId === assignmentId);
  };

  // Export to CSV function
  const handleDownloadExcel = () => {
      if (!selectedCourse) return;

      // 1. CSV Header
      let csvContent = "座號,學生姓名";
      scopedAssignments.forEach(a => {
          csvContent += `,${a.title}`;
      });
      csvContent += ",平均級分\n";

      // 2. CSV Rows
      students.forEach(student => {
          let row = `${student.seatNo},${student.name}`;
          let totalScore = 0;
          let gradedCount = 0;

          const studentId = studentIdFor(selectedCourseId || '', student.seatNo);

          scopedAssignments.forEach(a => {
              const sub = getSubmission(student.name, a.id);
              const missing = !sub || sub.status === 'Unsubmitted' || sub.status === 'Draft';
              let scoreText: string;

              // 判斷順序要和表格一致，否則畫面寫請假、報表寫未繳交
              if (missing) {
                  scoreText = isOnLeave(leaveMarks, a.id, studentId) ? "請假" : "未繳交";
              } else if (sub!.status === 'Graded' || sub!.status === 'Published') {
                  const score = sub!.result?.totalScore || 0;
                  scoreText = score.toString();
                  totalScore += score;
                  gradedCount++;
              } else {
                  scoreText = "待批改";
              }
              row += `,${scoreText}`;
          });

          const avg = gradedCount > 0 ? (totalScore / gradedCount).toFixed(1) : "0.0";
          row += `,${avg}\n`;
          csvContent += row;
      });

      // 3. Create Download Link with BOM for Excel Chinese support
      const blob = new Blob(["\ufeff" + csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `${selectedCourse.name}_${semesterLabel(selectedCourse.semester)}_成績表.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
  };

  return (
    <div className="max-w-[1400px] mx-auto flex flex-col pb-12">
      {/* Student History Modal */}
      {historyModalStudent && (
        <StudentHistoryModal 
            isOpen={true}
            onClose={() => setHistoryModalStudent(null)}
            student={historyModalStudent}
            courseName={selectedCourse?.name || ''}
            assignments={assignments}
            submissions={submissions}
        />
      )}

      {/*
        標題列 + 篩選列。

        原本三個篩選各自是一顆獨立的膠囊，每顆約 300px，但真正在顯示的值
        只需要 170px —— 圖示、標題文字、分隔線、內距、箭頭合計吃掉三分之一，
        三顆就是 390px 的純裝飾，1200px 左右就被擠到換行。

        改成一條「一個容器、三個欄位」的篩選列：
          · 只畫一次外框與底色，不是三次
          · 每欄各拿三分之一寬度，班級全名不必再截斷
          · 讀起來是一組設定，不是三顆不相干的按鈕
      */}
      <div className="mb-4 sm:mb-6 shrink-0">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-3 sm:mb-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 sm:gap-3">
              {canGoBack && onBack && (
                <button
                  id="grademanagement-btn-back"
                  onClick={onBack}
                  className="tap-target p-1.5 sm:p-2 -ml-1 sm:-ml-2 rounded-full hover:bg-surface/50 text-text-primary transition-colors shrink-0"
                >
                  <ArrowLeft size={18} className="sm:size-6" />
                </button>
              )}
              <h2 className="text-display font-bold text-text-primary tracking-tight whitespace-nowrap">成績管理</h2>
            </div>
            <p className="text-ui text-text-secondary mt-0.5 sm:mt-1 font-normal">查看課程成績總表與匯出報表</p>
          </div>

          {selectedCourseId && (
            <div className="shrink-0 flex items-center gap-2">
              {/*
                期末總結是次要動作（一學期按一次），所以走描邊樣式，
                不跟「匯出 EXCEL」搶同一個實心主色 —— 兩顆實心按鈕並排，
                老師分不出哪一個才是這一頁的主要動作。
              */}
              {onOpenFinalReport && (
                <button
                  id="grademanagement-btn-finalreport"
                  onClick={() => onOpenFinalReport(selectedCourseId)}
                  className="bg-card hover:bg-surface-soft border border-border-strong text-text-primary px-4 sm:px-5 py-2 sm:py-2.5 rounded-full text-body transition-all flex items-center justify-center gap-2 hover:scale-[1.02]"
                >
                  <Sparkles size={16} className="shrink-0 text-primary" /> 期末總結
                </button>
              )}
              <button
                id="grademanagement-btn-export"
                onClick={handleDownloadExcel}
                className="bg-primary hover:bg-primary/90 text-on-accent px-4 sm:px-5 py-2 sm:py-2.5 rounded-full text-body shadow-lg shadow-primary/20 transition-all flex items-center justify-center gap-2 hover:scale-[1.02]"
              >
                <Download size={16} className="shrink-0" /> 匯出 EXCEL
              </button>
            </div>
          )}
        </div>

        <div className="bg-surface/60 backdrop-blur-md border border-border rounded-brand shadow-sm flex flex-col sm:flex-row divide-y sm:divide-y-0 sm:divide-x divide-border overflow-hidden">
          <label className="flex-1 min-w-0 px-4 py-2.5 hover:bg-surface/80 transition-colors cursor-pointer">
            <span className="flex items-center gap-1.5 text-caption text-text-secondary uppercase tracking-wider">
              <Calendar size={12} className="shrink-0 text-primary" />
              學期
            </span>
            <div className="relative mt-0.5">
              <select
                id="grademanagement-select-semester"
                value={currentSemester}
                onChange={(e) => onSemesterChange(e.target.value)}
                className="w-full appearance-none bg-transparent text-ui text-text-primary outline-none cursor-pointer pr-6 truncate"
              >
                {semesterOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <ChevronDown size={14} className="text-text-secondary absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </label>

          {/*
            班級。管理人員看得到全省數十個班，攤成一條下拉找不到東西，
            所以改成開挑選視窗（縣市篩選 → 搜尋 → 學校分組）。
            授課教師只有三個班，維持原本的下拉反而快。
          */}
          <div className="flex-1 min-w-0 px-4 py-2.5 hover:bg-surface/80 transition-colors">
            <span className="flex items-center gap-1.5 text-caption text-text-secondary uppercase tracking-wider">
              <Users size={12} className="shrink-0 text-primary" />
              班級
            </span>
            {isAdmin(user) ? (
              <button
                id="grademanagement-btn-pick-course"
                onClick={() => setIsCoursePickerOpen(true)}
                disabled={semesterCourses.length === 0}
                title="搜尋並選擇班級"
                className="tap-target mt-0.5 w-full flex items-center gap-2 text-left text-ui text-text-primary cursor-pointer disabled:cursor-not-allowed"
              >
                <span className="flex-1 min-w-0 truncate">
                  {selectedCourse?.name ?? '本學期沒有課程'}
                </span>
                <Search size={14} className="shrink-0 text-text-secondary" />
              </button>
            ) : (
              <div className="relative mt-0.5">
                <select
                  id="grademanagement-select-course"
                  value={selectedCourseId ?? ''}
                  onChange={(e) => changeCourse(e.target.value)}
                  disabled={semesterCourses.length === 0}
                  className="w-full appearance-none bg-transparent text-ui text-text-primary outline-none cursor-pointer pr-6 truncate disabled:cursor-not-allowed"
                >
                  {semesterCourses.length === 0 ? (
                    <option value="">本學期沒有課程</option>
                  ) : (
                    semesterCourses.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))
                  )}
                </select>
                <ChevronDown size={14} className="text-text-secondary absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            )}
          </div>

          <label className="flex-1 min-w-0 px-4 py-2.5 hover:bg-surface/80 transition-colors cursor-pointer">
            <span className="flex items-center gap-1.5 text-caption text-text-secondary uppercase tracking-wider">
              <ClipboardList size={12} className="shrink-0 text-primary" />
              任務
            </span>
            <div className="relative mt-0.5">
              <select
                id="grademanagement-select-assignment"
                value={selectedAssignmentId}
                onChange={(e) => setPickedAssignmentId(e.target.value)}
                className="w-full appearance-none bg-transparent text-ui text-text-primary outline-none cursor-pointer pr-6 truncate"
              >
                <option value="ALL">全部任務</option>
                {courseAssignments.map((a) => (
                  <option key={a.id} value={a.id}>
                    {assignmentNo[a.id]}. {a.title}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} className="text-text-secondary absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </label>
        </div>
      </div>

      {isCoursePickerOpen && (
        <CoursePickerModal
          courses={semesterCourses}
          selectedCourseId={selectedCourseId}
          onSelect={changeCourse}
          onClose={() => setIsCoursePickerOpen(false)}
        />
      )}

      {/*
        班級診斷：左邊看分數怎麼散開，右邊看四個向度誰強誰弱。
        兩張都吃上方的「班級 × 任務」篩選，只採計已批改與已發還的成績 ——
        待批改的還沒有分數，算成 0 會把平均整個拉下來。
      */}
      {selectedCourse && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-4 sm:mb-6 shrink-0">
          {/* 六級分分布 */}
          <div className="bg-surface/60 backdrop-blur-xl p-3 sm:p-6 rounded-brand border border-border shadow-sm">
            <div className="flex items-baseline justify-between gap-3 mb-2 sm:mb-4">
              <h3 className="text-title font-bold text-text-primary flex items-center gap-2">
                <TrendingUp size={16} className="sm:size-5 text-primary shrink-0" />
                全班會考六級分分布
              </h3>
              <span className="text-caption text-text-muted whitespace-nowrap tabular-nums">
                共 {scopedResults.length} 份
              </span>
            </div>
            {scopedResults.length === 0 ? (
              <div className="h-40 sm:h-56 flex items-center justify-center text-body text-text-muted">
                這個範圍還沒有批改完成的成績
              </div>
            ) : (
              <div className="h-40 sm:h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={levelDistribution} margin={{ top: 20, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartInk.border} vertical={false} />
                    <XAxis dataKey="name" tick={{ fill: chartInk.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fill: chartInk.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip
                      cursor={{ fill: chartInk.cursor }}
                      contentStyle={{ background: chartInk.card, border: `1px solid ${chartInk.border}`, borderRadius: 12, color: chartInk.text }}
                      formatter={(value: number) => [`${value} 份`, '人數']}
                    />
                    <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={44}>
                      <LabelList dataKey="count" position="top" fill={chartInk.muted} fontSize={11} />
                      {levelDistribution.map((d) => (
                        // 顏色沿用 lib/scoring.ts 的級分色階，和表格裡的分數同一套
                        <Cell key={d.level} fill={levelStyle(d.level).hex[chartInk.scheme]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* 四向度平均 */}
          <div className="bg-surface/60 backdrop-blur-xl p-3 sm:p-6 rounded-brand border border-border shadow-sm">
            <h3 className="text-title font-bold text-text-primary mb-2 sm:mb-4 flex items-center gap-2">
              <Target size={16} className="sm:size-5 text-primary shrink-0" />
              全班寫作四向度平均
            </h3>
            {scopedResults.length === 0 ? (
              <div className="h-40 sm:h-56 flex items-center justify-center text-body text-text-muted">
                這個範圍還沒有批改完成的成績
              </div>
            ) : (
              <div className="h-40 sm:h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={categoryAverages} outerRadius="70%">
                    <PolarGrid stroke={chartInk.border} />
                    <PolarAngleAxis dataKey="label" tick={{ fill: chartInk.muted, fontSize: 11 }} />
                    <PolarRadiusAxis domain={[MIN_LEVEL, MAX_LEVEL]} tickCount={4} tick={{ fill: chartInk.muted, fontSize: 10 }} axisLine={false} />
                    <Tooltip
                      contentStyle={{ background: chartInk.card, border: `1px solid ${chartInk.border}`, borderRadius: 12, color: chartInk.text }}
                      formatter={(value: number, _n, item) => [`${value} 級分`, item?.payload?.fullLabel ?? '平均']}
                    />
                    <Radar dataKey="value" stroke="var(--color-secondary)" fill="var(--color-secondary)" fillOpacity={0.25} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex flex-col items-start">
         {/* Right: Grade Table */}
         <div className="flex-1 w-full bg-surface/60 backdrop-blur-2xl rounded-brand border border-border shadow-sm flex flex-col transition-all duration-300">
             {selectedCourse ? (
                 <>
                    <div className="p-3 sm:p-6 border-b border-border flex flex-col md:flex-row justify-between items-start md:items-center gap-3 sm:gap-4 bg-surface/40 backdrop-blur-md">
                        <div className="flex items-center gap-2 sm:gap-4">
                             <div>
                                <h2 className="text-heading font-bold text-text-primary leading-none">
                                    {selectedCourse.name}
                                </h2>
                                 <div className="flex items-center gap-2 mt-1 sm:mt-2">
                                    <span className="text-caption text-text-secondary bg-surface px-1.5 sm:px-3 py-0.5 sm:py-1 rounded-full border border-border shadow-sm flex items-center gap-1 sm:gap-1.5">
                                        <Users size={9} className="sm:size-3 text-primary" />
                                        共 {students.length} 位學生
                                    </span>
                                </div>
                             </div>
                        </div>

                        <div className="relative w-full md:w-64">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary sm:size-4" size={12} />
                            <input 
                                id="grademanagement-input-searchstudent"
                                type="text" 
                                placeholder="搜尋學生或座號..." 
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-8 sm:pl-10 pr-3 sm:pr-4 py-1.5 sm:py-2.5 text-body border border-border rounded-brand bg-surface/80 focus:outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary transition-all shadow-sm"
                            />
                        </div>
                    </div>

                    <div className="overflow-x-auto rounded-b-brand">
                        <table className="w-full text-left border-collapse min-w-[600px] sm:min-w-[800px]">
                            <thead className="bg-secondary/5 backdrop-blur-sm sticky top-0 z-10 shadow-sm">
                                <tr>
                                    <th className="p-2 sm:p-4 px-1 sm:px-2 text-body text-text-primary sticky left-0 bg-secondary/5 z-20 border-b border-r border-border w-10 sm:w-14 min-w-[2.5rem] sm:min-w-[3.5rem] text-center">
                                        座號
                                    </th>
                                    <th className="p-2 sm:p-4 px-1.5 sm:px-3 text-body text-text-primary sticky left-10 sm:left-14 bg-secondary/5 z-20 border-b border-r border-border w-20 sm:w-28 min-w-[5rem] sm:min-w-[7rem]">
                                        學生姓名
                                    </th>
                                    {scopedAssignments.map(a => {
                                        const isOverdue = isAssignmentOverdue(a);
                                        return (
                                            <th key={a.id} className={`py-2 sm:py-4 px-1 text-body font-bold text-text-primary border-b border-border w-16 sm:w-24 min-w-[4rem] sm:min-w-[6rem] max-w-[4rem] sm:max-w-[6rem] text-center transition-colors ${isOverdue ? 'bg-danger-50/80 text-danger-700' : ''}`}>
                                                <div className="flex flex-col items-center justify-center gap-0.5 w-full overflow-hidden" title={`第 ${assignmentNo[a.id]} 份・${a.title}${isOverdue ? '（已截止）' : ''}`}>
                                                    <div className="flex items-center justify-center gap-0.5 sm:gap-1 w-full px-0.5 sm:px-1">
                                                        {/*
                                                          欄位順序＝老師在課程作業清單排定的順序，
                                                          所以把編號寫出來，兩邊對得起來。
                                                          欄寬很窄，用編號取代圖示，不要兩個都塞。
                                                        */}
                                                        <span className={`shrink-0 text-caption tabular-nums ${isOverdue ? 'text-danger-600' : 'text-text-muted'}`}>
                                                            {assignmentNo[a.id]}
                                                        </span>
                                                        <span className="truncate text-caption">{a.title}</span>
                                                    </div>
                                                    {isOverdue && <span className="text-caption text-danger-600 uppercase tracking-tighter shrink-0">已截止</span>}
                                                </div>
                                            </th>
                                        );
                                    })}
                                    <th className="p-2 sm:p-4 px-1 sm:px-2 text-body text-text-primary border-b border-l border-border text-center sticky right-0 bg-secondary/5 z-20 w-16 sm:w-24 min-w-[4rem] sm:min-w-[6rem]">
                                        平均級分
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/50">
                                {filteredStudents.map(student => {
                                    let totalScore = 0;
                                    let gradedCount = 0;

                                    return (
                                        <tr key={student.seatNo} id={`grademanagement-table-row-${student.seatNo}`} className="hover:bg-surface/60 transition-colors group">
                                            <td className="p-3 sm:p-4 px-1.5 sm:px-2 text-text-primary font-mono text-center sticky left-0 bg-surface group-hover:bg-secondary/5 border-r border-border/50 z-10 w-12 sm:w-14 min-w-[3rem] sm:min-w-[3.5rem] text-body">
                                                {student.seatNo.toString().padStart(2, '0')}
                                            </td>
                                            <td className="p-3 sm:p-4 px-2 sm:px-3 text-text-primary sticky left-12 sm:left-14 bg-surface group-hover:bg-secondary/5 border-r border-border/50 z-10 w-24 sm:w-28 min-w-[6rem] sm:min-w-[7rem] text-body">
                                                <div className="flex items-center justify-between gap-1">
                                                    <span className="truncate">{student.name}</span>
                                                    <button 
                                                        id={`grademanagement-btn-history-${student.seatNo}`}
                                                        onClick={() => setHistoryModalStudent(student)}
                                                        className="tap-target text-text-primary/60 hover:text-primary hover:bg-primary/5 p-1 rounded-full transition-colors opacity-100 md:opacity-0 md:group-hover:opacity-100 shrink-0"
                                                        title="查看歷史作業"
                                                    >
                                                        <FileClock size={14} className="sm:size-4" />
                                                    </button>
                                                </div>
                                            </td>
                                            {scopedAssignments.map(a => {
                                                const sub = getSubmission(student.name, a.id);
                                                const isOverdue = isAssignmentOverdue(a);
                                                let content;
                                                
                                                const studentId = studentIdFor(selectedCourseId || '', student.seatNo);
                                                const onLeave = isOnLeave(leaveMarks, a.id, studentId);

                                                if (!sub || sub.status === 'Unsubmitted') {
                                                    if (isOverdue || onLeave) {
                                                        /*
                                                          逾期沒交有兩種：真的沒寫，和請假。
                                                          只有老師知道差別，所以這裡做成可以改的下拉，
                                                          而不是一個寫死的紅色標籤。
                                                          請假不算逾期未繳，關心名單也一起排除。
                                                        */
                                                        content = (
                                                            <select
                                                                id={`grademanagement-select-leave-${a.id}-${student.seatNo}`}
                                                                value={onLeave ? 'leave' : 'missing'}
                                                                onChange={(e) => onSetLeave?.(a.id, studentId, e.target.value === 'leave')}
                                                                title={onLeave ? '已標為請假，不列入逾期未繳。點擊可改回缺繳' : '逾期未繳。點擊可改標為請假'}
                                                                /*
                                                                  不放箭頭圖示：這一欄每個學生每份作業都有一格，
                                                                  多一個小三角會讓整張表變得很吵。
                                                                  滑鼠移上去會變色、變游標，再加上 title 說明就夠了。
                                                                */
                                                                className={`appearance-none text-center text-caption px-1.5 sm:px-2 py-0.5 rounded-md border shadow-sm cursor-pointer outline-none transition-all hover:shadow focus:ring-2 focus:ring-primary/30 ${
                                                                    onLeave
                                                                    ? 'text-ink-600 bg-ink-100 border-ink-200 hover:bg-ink-200 hover:border-ink-400'
                                                                    : 'text-danger-700 bg-danger-100 border-danger-200 hover:bg-danger-200 hover:border-danger-400'
                                                                }`}
                                                            >
                                                                <option value="missing">缺繳</option>
                                                                <option value="leave">請假</option>
                                                            </select>
                                                        );
                                                    } else {
                                                        content = <span className="text-text-muted text-caption font-normal">-</span>;
                                                    }
                                                } else if (sub.status === 'Pending') {
                                                    content = <span className="text-warning-700 text-caption bg-warning-50 px-1 sm:px-1.5 py-0.5 rounded">待批</span>;
                                                } else {
                                                    const score = sub.result?.totalScore || 0;
                                                    totalScore += score;
                                                    gradedCount++;
                                                    
                                                    content = (
                                                      <span className={`text-ui font-bold ${levelStyle(score).text}`}>
                                                        {score}
                                                      </span>
                                                    );
                                                }
 
                                                return (
                                                    <td key={a.id} className={`py-3 sm:py-4 px-1.5 sm:px-2 text-center border-border/10 w-20 sm:w-24 min-w-[5rem] sm:min-w-[6rem] max-w-[5rem] sm:max-w-[6rem] transition-colors ${isOverdue && !onLeave && (!sub || sub.status === 'Unsubmitted') ? 'bg-danger-50/30' : ''}`}>
                                                        {content}
                                                    </td>
                                                );
                                            })}
                                            <td className="p-3 sm:p-4 px-1.5 sm:px-2 text-center border-l border-border/50 sticky right-0 bg-surface group-hover:bg-secondary/5 z-10 w-20 sm:w-24 min-w-[5rem] sm:min-w-[6rem]">
                                                {gradedCount > 0 ? (
                                                    <span className="text-primary bg-primary/5 px-2 sm:px-3 py-0.5 sm:py-1 rounded-brand text-body">
                                                        {(totalScore / gradedCount).toFixed(1)}
                                                    </span>
                                                ) : (
                                                    <span className="text-text-muted text-body">-</span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                                {filteredStudents.length === 0 && (
                                    <tr>
                                        <td id="grademanagement-table-empty" colSpan={scopedAssignments.length + 3} className="p-12 text-center text-text-muted">
                                            無符合搜尋結果
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                 </>
             ) : (
                 <div id="grademanagement-empty-state" className="flex flex-col items-center justify-center py-32 text-text-muted">
                     <Users size={48} className="mb-4 opacity-80" />
                     <p className="font-normal">請選擇左側課程以查看成績</p>
                 </div>
             )}
         </div>
      </div>
    </div>
  );
};
