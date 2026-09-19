import { useNavigate } from 'react-router-dom';
import { routes } from '../lib/routes';
import { useGoBack } from '../lib/useGoBack';
import React, { useMemo } from "react";
import {
  Clock,
  CheckCircle,
  AlertCircle,
  ChevronRight,
  TrendingUp,
  Archive,
  FileCheck,
  Edit,
  Heart,
} from "lucide-react";
import {
  Submission,
  Assignment,
  Course,
} from "../types";
import { concernStudentCount } from "../lib/concern";
import { deadlineOf } from "../lib/assignments";
import { type LeaveMarks } from "../lib/leave";
import { CURRENT_SEMESTER, seatLabel } from "../mockData";

import { getGreeting } from "../lib/constants";
import { PageHeader, PAGE_CONTAINER } from "./PageHeader";
import { SemesterSelect } from "./SemesterSelect";

export const DashboardView = ({
  currentSemester,
  semesterOptions,
  todaySemester,
  onSemesterChange,
  allCourses,
  assignments,
  submissions,
  leaveMarks,
  onShowGradedStats,
  onSelectSubmission,
  teacherName,
}: {
  currentSemester: string;
  semesterOptions: { value: string; label: string }[];
  /** 今天落在的學期，選單上標「本學期」。currentSemester 是老師選的那一個 */
  todaySemester?: string;
  onSemesterChange: (s: string) => void;
  allCourses: Course[];
  assignments: Assignment[];
  submissions: Submission[];
  /** 請假註記。標了請假的不算欠交，卡片數字才會跟成績表一致 */
  leaveMarks?: LeaveMarks;
  onShowGradedStats: () => void;
  onSelectSubmission: (assignmentId: string, submission: Submission) => void;
  /** 登入者的姓名。以前這裡是寫死的「Charles 老師」（原型的示範教師） */
  teacherName: string;
}) => {
  const navigate = useNavigate();
  const { goBack, canGoBack } = useGoBack();
  const activeCourses = allCourses.filter(
    (c) => c.semester === currentSemester,
  );
  const activeCourseIds = activeCourses.map((c) => c.id);
  const semesterAssignmentIds = assignments
    .filter((a) => activeCourseIds.includes(a.courseId))
    .map((a) => a.id);

  const gradedCount = submissions.filter(
    (s) =>
      semesterAssignmentIds.includes(s.assignmentId) &&
      (s.status === "Graded" || s.status === "Published"),
  ).length;

  /*
    ⚠️ 這兩個數字以前**沒有依學期過濾**，而旁邊的 gradedCount 與 concernCount
       有 —— 同一張首頁上，「本學期已批改 0 份」旁邊寫著「待批改 16 份」，
       而底下那張表（pendingSubmissions，有過濾）只列得出本學期的幾筆。
       實測就是這個畫面。四張卡片與那張表現在都以本學期為準。
  */
  const pendingGradingCount = submissions.filter(
    (s) => semesterAssignmentIds.includes(s.assignmentId) && s.status === "Pending",
  ).length;

  /** 本學期已批改佔本學期繳交的比例。沒有繳交時不顯示，不要變成 0% */
  const semesterSubmissionCount = submissions.filter(
    (s) => semesterAssignmentIds.includes(s.assignmentId),
  ).length;
  const gradedRatio = semesterSubmissionCount
    ? Math.round((gradedCount / semesterSubmissionCount) * 100)
    : null;

  // 「即將截止」只看有設截止日的。沒設的作業不會催 ——
  // 先前是靠 new Date(undefined) 變成 NaN 才被濾掉，那是巧合不是設計
  const upcomingAssignments = assignments
    .filter((a) => {
      if (!semesterAssignmentIds.includes(a.id)) return false;
      const deadline = deadlineOf(a);
      if (!deadline) return false;
      const now = new Date();
      const diffDays = Math.ceil(
        (deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );
      return diffDays > 0 && diffDays <= 3;
    })
    .sort((a, b) => +(deadlineOf(a) as Date) - +(deadlineOf(b) as Date));

  const upcomingCount = upcomingAssignments.length;

  // 需關注人數：本學期各班有逾期未繳的學生。
  // 用 lib/concern.ts 的定義，與點進去的關心名單頁面一致，
  // 免得卡片寫 5 位、內頁列出 7 位。
  // 班級篩選放進 memo 裡：activeCourses 每次 render 都是新陣列，
  // 拿它當相依會讓記憶化失效
  const concernCount = useMemo(
    () =>
      concernStudentCount(
        allCourses.filter((c) => c.semester === currentSemester),
        assignments,
        submissions,
        leaveMarks,
      ),
    [allCourses, currentSemester, assignments, submissions, leaveMarks],
  );

  const pendingSubmissions = submissions
    .filter(
      (s) =>
        semesterAssignmentIds.includes(s.assignmentId) &&
        s.status === "Pending",
    )
    .sort(
      (a, b) =>
        new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime(),
    )
    .slice(0, 10);

  return (
    <div className={`${PAGE_CONTAINER} space-y-8 pb-10`}>
      <PageHeader
        title={<>{getGreeting()}，{teacherName} 👋</>}
        subtitle="這是您今天的教學概況與待辦事項。"
        onBack={canGoBack ? goBack : undefined}
        backId="dashboard-btn-back"
        actions={
          <SemesterSelect
            id="dashboard-select-semester"
            value={currentSemester}
            options={semesterOptions}
            current={todaySemester}
            onChange={onSemesterChange}
          />
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        {/* Card 1: Graded */}
        <div
          id="dashboard-card-graded"
          onClick={onShowGradedStats}
          className="bg-card p-4 md:p-5 rounded-2xl border-t-[6px] border-brand-blue shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 cursor-pointer group"
        >
          <div className="mb-3">
              <p className="text-text-secondary text-body font-serif mb-2">
                本學期已批改
              </p>
              <div className="flex items-center gap-3">
            <div className="w-9 h-9 md:w-10 md:h-10 rounded-full bg-surface-soft text-primary flex items-center justify-center shrink-0 shadow-inner group-hover:bg-primary group-hover:text-on-accent transition-colors">
              <FileCheck size={18} className="md:size-[20px]" strokeWidth={2} />
            </div>
            <h3 className="text-display font-serif font-bold tracking-tight text-text-primary mt-0.5">
                {gradedCount}{" "}
                <span className="text-body text-text-secondary font-normal font-sans">
                  份
                </span>
              </h3>
              </div>
          </div>
          {/*
            ⚠️ 這裡原本是寫死的「+5 本週新增」—— 不管實際批了幾份都顯示 +5，
               實測時「本學期已批改 0 份」旁邊照樣掛著「+5 本週新增」。
               「本週」目前**算不出來**：submission_feedback 沒有回傳批改時間，
               Submission 上也只有繳交與發還的時間。要做真的週增量得先把
               批改時間帶上來。在那之前顯示算得出來的比例。
          */}
          {gradedRatio !== null && (
            <div className="flex items-center text-caption text-text-primary bg-surface-soft w-fit px-2.5 py-1 md:px-3 md:py-1.5 rounded-lg">
              <TrendingUp size={10} className="mr-1 md:mr-1.5 md:size-[12px]" />
              佔本學期繳交的 {gradedRatio}%
            </div>
          )}
        </div>

        {/* Card 2: Pending */}
        <div
          id="dashboard-card-pending"
          className="bg-card p-4 md:p-5 rounded-2xl border-t-[6px] border-brand-blue shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 cursor-pointer group"
          onClick={() => navigate(routes.gradingList())}
        >
          <div className="mb-3">
              <p className="text-text-secondary text-body font-serif mb-2">
                待批改作業
              </p>
              <div className="flex items-center gap-3">
            <div className="w-9 h-9 md:w-10 md:h-10 rounded-full bg-secondary/10 text-secondary flex items-center justify-center shrink-0 shadow-inner group-hover:bg-secondary group-hover:text-on-accent transition-colors">
              <Clock size={18} className="md:size-[20px]" strokeWidth={2} />
            </div>
            <h3 className="text-display font-serif font-bold tracking-tight text-text-primary mt-0.5">
                {pendingGradingCount}{" "}
                <span className="text-body text-text-secondary font-normal font-sans">
                  份
                </span>
              </h3>
              </div>
          </div>
          <div className="text-caption text-secondary flex items-center hover:translate-x-1 transition-transform duration-300 cursor-pointer">
            立即前往處理 <ChevronRight size={12} className="ml-1 md:size-[14px]" />
          </div>
        </div>

        {/* Card 3: Due Soon */}
        <div
          id="dashboard-card-upcoming"
          className="bg-card p-4 md:p-5 rounded-2xl border-t-[6px] border-brand-blue shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 cursor-pointer group"
          onClick={() => navigate(routes.courses())}
        >
          <div className="mb-3">
              <p className="text-text-secondary text-body font-serif mb-2">
                即將截止
              </p>
              <div className="flex items-center gap-3">
            <div className="w-9 h-9 md:w-10 md:h-10 rounded-full bg-surface-soft text-text-secondary flex items-center justify-center shrink-0 shadow-inner group-hover:bg-primary group-hover:text-on-accent transition-colors">
              <AlertCircle size={18} className="md:size-[20px]" strokeWidth={2} />
            </div>
            <h3 className="text-display font-serif font-bold tracking-tight text-text-primary mt-0.5">
                {upcomingCount}{" "}
                <span className="text-body text-text-secondary font-normal font-sans">
                  項
                </span>
              </h3>
              </div>
          </div>
          {upcomingAssignments.length > 0 ? (
            <div className="space-y-1.5">
              {upcomingAssignments.slice(0, 1).map((a) => {
                // 這裡的清單已經濾掉沒有截止日的，deadline 一定存在
                const deadline = deadlineOf(a) as Date;
                const now = new Date();
                const diffDays = Math.ceil(
                  (deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
                );
                let dayText = `${diffDays} 天後`;
                if (diffDays === 1) dayText = "明天";
                if (diffDays === 0) dayText = "今天";

                return (
                  <p
                    key={a.id}
                    className="text-caption font-normal text-text-secondary flex items-center gap-1.5"
                  >
                    <span className="w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-secondary/40 shrink-0"></span>
                    <span className="truncate">
                      {a.title}（{dayText}）
                    </span>
                  </p>
                );
              })}
              {upcomingAssignments.length > 1 && (
                <p className="text-caption text-primary flex items-center gap-1 mt-1">
                  另有 {upcomingAssignments.length - 1} 項，到課程管理查看{" "}
                  <ChevronRight size={10} />
                </p>
              )}
            </div>
          ) : (
            <p className="text-caption font-normal text-text-muted italic">
              目前無即將截止作業
            </p>
          )}
        </div>

        {/* Card 4: Concern List */}
        <div
          id="dashboard-card-concern"
          className="bg-card p-4 md:p-5 rounded-2xl border-t-[6px] border-danger-500 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 cursor-pointer group"
          onClick={() => navigate(routes.concern())}
        >
          <div className="mb-3">
            <p className="text-text-secondary text-body font-serif mb-2">
              關心名單
            </p>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 md:w-10 md:h-10 rounded-full bg-danger-50 text-danger-600 flex items-center justify-center shrink-0 shadow-inner group-hover:bg-danger-500 group-hover:text-on-accent transition-colors">
                <Heart size={18} className="md:size-[20px]" strokeWidth={2} />
              </div>
              <h3 className="text-display font-serif font-bold tracking-tight text-text-primary">
                {concernCount}
                <span className="text-body text-text-secondary font-normal ml-1">
                  位
                </span>
              </h3>
            </div>
          </div>
          <div className="text-caption text-danger-600 flex items-center hover:translate-x-1 transition-transform duration-300">
            {concernCount > 0 ? "有逾期未繳，前往關心名單" : "目前無逾期未繳"}
            <ChevronRight size={12} className="ml-1 shrink-0 md:size-[14px]" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8">
        {/* Recent Submissions Table */}
        <div className="lg:col-span-3">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-title font-serif font-bold text-text-primary tracking-tight flex items-center gap-2">
              <Clock size={20} className="text-primary" />
              最新繳交狀況
            </h3>
            <button
              id="dashboard-btn-viewallsubmissions"
              onClick={() => navigate(routes.gradingList())}
              className="text-body text-primary hover:text-text-primary hover:bg-surface-soft px-4 py-2 rounded-xl transition-all active:scale-95"
            >
              查看全部
            </button>
          </div>

          <div className="bg-card rounded-2xl shadow-sm border border-border overflow-hidden">
            {/* 只有本學期有近期動態，其餘學期一律視為封存 */}
            {currentSemester === CURRENT_SEMESTER ? (
              pendingSubmissions.length > 0 ? (
                <>
                  {/* Desktop View */}
                  <div className="hidden lg:block overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-surface-soft/50 border-b border-border">
                          <th className="px-6 py-4 text-caption text-text-secondary uppercase tracking-wider">
                            班級
                          </th>
                          <th className="px-6 py-4 text-caption text-text-secondary uppercase tracking-wider">
                            座號
                          </th>
                          <th className="px-6 py-4 text-caption text-text-secondary uppercase tracking-wider">
                            姓名
                          </th>
                          <th className="px-6 py-4 text-caption text-text-secondary uppercase tracking-wider">
                            繳交時間
                          </th>
                          <th className="px-6 py-4 text-caption text-text-secondary uppercase tracking-wider">
                            作業名稱
                          </th>
                          <th className="px-6 py-4 text-caption text-text-secondary uppercase tracking-wider">
                            操作
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {pendingSubmissions.map((sub) => {
                          const assignment = assignments.find(
                            (a) => a.id === sub.assignmentId,
                          );
                          const course = allCourses.find(
                            (c) => c.id === assignment?.courseId,
                          );
                          const seatNo = seatLabel(sub.studentId);
                          const submittedDate = new Date(sub.submittedAt);

                          return (
                            <tr
                              key={sub.id}
                              className="hover:bg-surface-soft/30 transition-colors group"
                            >
                              <td className="px-6 py-4">
                                <span className="text-body text-text-primary">
                                  {course?.name || "-"}
                                </span>
                              </td>
                              <td className="px-6 py-4">
                                <span className="text-body font-mono font-normal text-text-secondary">
                                  {seatNo}
                                </span>
                              </td>
                              <td className="px-6 py-4">
                                <span className="text-body text-text-primary">
                                  {sub.studentName}
                                </span>
                              </td>
                              <td className="px-6 py-4">
                                <div className="flex flex-col">
                                  <span className="text-body font-normal text-text-primary">
                                    {submittedDate.toLocaleDateString("zh-TW", {
                                      month: "2-digit",
                                      day: "2-digit",
                                    })}
                                  </span>
                                  <span className="text-caption text-text-secondary">
                                    {submittedDate.toLocaleTimeString("zh-TW", {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                      hour12: false,
                                    })}
                                  </span>
                                </div>
                              </td>
                              <td className="px-6 py-4">
                                <span
                                  className="text-body font-normal text-text-primary line-clamp-1"
                                  title={assignment?.title}
                                >
                                  {assignment?.title}
                                </span>
                              </td>
                              <td className="px-6 py-4">
                                <button id="dashboard-btn-grade-submission"
                                  onClick={() =>
                                    assignment &&
                                    onSelectSubmission(assignment.id, sub)
                                  }
                                  className="p-2 rounded-lg bg-primary/5 text-primary hover:bg-primary hover:text-on-accent transition-all"
                                  title="前往批改"
                                >
                                  <Edit size={16} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile View */}
                  <div className="lg:hidden divide-y divide-border">
                    {pendingSubmissions.map((sub) => {
                      const assignment = assignments.find(
                        (a) => a.id === sub.assignmentId,
                      );
                      const course = allCourses.find(
                        (c) => c.id === assignment?.courseId,
                      );
                      const seatNo = seatLabel(sub.studentId);
                      const submittedDate = new Date(sub.submittedAt);

                      return (
                        <div
                          key={sub.id}
                          className="p-4 active:bg-surface-soft transition-colors"
                          onClick={() =>
                            assignment && onSelectSubmission(assignment.id, sub)
                          }
                        >
                          <div className="flex justify-between items-start mb-2">
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-caption">
                                {seatNo}
                              </div>
                              <div>
                                <p className="text-body text-text-primary">
                                  {sub.studentName}
                                </p>
                                <p className="text-caption text-text-secondary font-normal">
                                  {course?.name || "-"}
                                </p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-caption text-text-primary">
                                {submittedDate.toLocaleDateString("zh-TW", {
                                  month: "2-digit",
                                  day: "2-digit",
                                })}
                              </p>
                              <p className="text-caption text-text-secondary">
                                {submittedDate.toLocaleTimeString("zh-TW", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                  hour12: false,
                                })}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <p className="text-caption text-text-secondary truncate flex-1 min-w-0">
                              {assignment?.title}
                            </p>
                            <ChevronRight size={14} className="text-text-muted" />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="h-48 flex flex-col items-center justify-center text-text-secondary">
                  <CheckCircle
                    size={32}
                    className="mb-2 opacity-50 text-success-500"
                  />
                  <p className="font-normal">目前沒有待批改的繳交紀錄</p>
                </div>
              )
            ) : (
              <div className="flex flex-col items-center justify-center h-48 text-text-secondary">
                <Archive size={32} className="mb-2 opacity-50" />
                <p className="text-body font-normal">
                  此學期為封存狀態，無近期動態
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

