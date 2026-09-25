import React, { useMemo, useState } from "react";
import {
  Clock,
  AlertCircle,
  MoreHorizontal,
  ChevronRight,
  ArrowRight,
  Archive,
  Bot,
  RefreshCcw,
  RefreshCw,
  Loader2,
  Trash2,
  ClipboardList,
  School,
  Search,
  X,
} from "lucide-react";
import {
  Submission,
  Assignment,
  Course,
  SchoolCourse,
} from "../types";
import { semesterLabel } from "../lib/semester";
import { isAdmin, coursesNeedingReview, type CurrentUser } from "../lib/access";
import { CourseMappingModal } from "./CourseMappingModal";
import { DeleteCourseModal } from "./DeleteCourseModal";
import { courseFootprint, isOverdue } from "../lib/assignments";
import { filterCoursesByQuery } from "../lib/courseSearch";
import { syncCourseRoster, type RosterSyncResult } from "../api/courses";
import { ApiError } from "../api/client";
import { SHOW_AI_MODEL_PICKER } from "../lib/features";
import {
  groupCoursesBySchool,
  cityCountsOf,
  cityChipsOf,
  UNASSIGNED_GROUP as UNASSIGNED,
} from "../lib/courseGroups";

import { SyncSchoolModal } from "./SyncSchoolModal";

import { PageHeader, PAGE_CONTAINER } from "./PageHeader";
import { SemesterSelect } from "./SemesterSelect";

export const CourseList = ({
  courses,
  assignments,
  submissions,
  onSelectCourse,
  currentSemester,
  semesterOptions,
  todaySemester,
  onSemesterChange,
  onBack,
  canGoBack,
  onUpdateCourse,
  onAddCourses,
  onOpenCourse,
  user,
  onDeleteCourse,
  onRosterSynced,
}: {
  courses: Course[];
  assignments: Assignment[];
  submissions: Submission[];
  onSelectCourse: (c: Course) => void;
  currentSemester: string;
  semesterOptions: { value: string; label: string }[];
  /** 今天落在的學期，選單上標「本學期」。currentSemester 是老師選的那一個 */
  todaySemester?: string;
  onSemesterChange: (s: string) => void;
  onBack: () => void;
  canGoBack: boolean;
  onUpdateCourse: (c: Course) => void;
  onAddCourses: (selected: SchoolCourse[]) => void;
  /** 目前身分。管理人員多出縣市篩選、學校分組與「待確認」入口 */
  user: CurrentUser;
  /** 永久刪除課程。連同名單、作業、繳交紀錄一起消失 */
  onDeleteCourse: (courseId: string) => void;
  /** 進入該班級的作業工作台（獨立頁面） */
  onOpenCourse: (course: Course) => void;
  /** 名單同步完成後重讀課程與名冊（人數會變） */
  onRosterSynced?: (courseId: string) => Promise<void> | void;
}) => {
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"active" | "archived">("active");
  const [cityFilter, setCityFilter] = useState<string>("all");
  /** 關鍵字搜尋。管理人員看得到全省課程，光靠縣市晶片還是要一張張找 */
  const [searchQuery, setSearchQuery] = useState("");
  const [isMappingOpen, setIsMappingOpen] = useState(false);
  /** 正在確認刪除的課程 */
  const [deletingCourse, setDeletingCourse] = useState<Course | null>(null);
  /** 正在同步名單的課程 id。同一時間只讓一個班在跑 */
  const [syncingCourseId, setSyncingCourseId] = useState<string | null>(null);
  /** 同步完成後要給老師看的結果（或失敗訊息） */
  const [syncReport, setSyncReport] = useState<
    { course: Course; result?: RosterSyncResult; error?: string } | null
  >(null);

  /**
   * 重新從校務系統讀這一班的名單。
   *
   * 結果一定要講出來 —— 同步是會刪人的動作（轉出的學生會從名冊上移除），
   * 只回一句「完成」的話，老師不會知道剛剛班上少了誰。
   */
  const handleSyncRoster = async (course: Course) => {
    if (!course.code || syncingCourseId) return;
    setSyncingCourseId(course.id);
    try {
      const result = await syncCourseRoster(course.id);
      setSyncReport({ course, result });
      // 卡片上的人數與名冊都會變，兩邊都要重讀
      await onRosterSynced?.(course.id);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : '同步失敗，請稍後再試';
      setSyncReport({ course, error: message });
    } finally {
      setSyncingCourseId(null);
    }
  };

  React.useEffect(() => {
    const handleClickOutside = () => {
      if (activeDropdown) {
        setActiveDropdown(null);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [activeDropdown]);

  const semesterCourses = courses.filter(
    (c) =>
      c.semester === currentSemester &&
      (activeTab === "active" ? !c.isArchived : c.isArchived),
  );

  /*
    縣市篩選、搜尋、依學校分組：所有身分都有。
    以前只給管理人員，但授課教師也可能跨縣市、跨校授課
    （實測一位老師有 8 所學校的班），兩頁才一致。
  */
  const cityCounts = useMemo(() => cityCountsOf(semesterCourses), [semesterCourses]);

  const filteredCourses = useMemo(() => {
    const byCity =
      cityFilter === "all"
        ? semesterCourses
        : semesterCourses.filter((c) => (c.city ?? UNASSIGNED) === cityFilter);
    // 關鍵字比對走 lib/courseSearch.ts，不要在畫面裡自己拼 includes
    return filterCoursesByQuery(byCity, searchQuery);
  }, [semesterCourses, cityFilter, searchQuery]);

  /** 依學校分組。規則收在 lib/courseGroups.ts，與班級挑選視窗共用 */
  const schoolGroups = useMemo(
    () => groupCoursesBySchool(filteredCourses),
    [filteredCourses],
  );

  const needsReview = coursesNeedingReview(semesterCourses);

  /** 只列出真的有課程的縣市；待確認歸屬排最後（規則在 lib/courseGroups.ts） */
  const cityChips = cityChipsOf(cityCounts);

  /** 一張課程卡片。兩種身分共用同一份，差別只在外層怎麼分組 */
  const renderCourseCard = (course: Course) => {
          const courseAssignments = assignments.filter(
            (a) => a.courseId === course.id,
          );
          // 進行中：已發布、未關閉，且尚未逾期。沒設截止日的一直算進行中
          const activeAssignmentsCount = courseAssignments.filter(
            (a) =>
              a.status === "Published" &&
              !isOverdue(a),
          ).length;

          // Pending: Submissions that are pending for assignments in this course
          const pendingGradingCount = courseAssignments.filter(
            (a) =>
              a.status !== "Draft" &&
              submissions.some(
                (s) => s.assignmentId === a.id && s.status === "Pending",
              ),
          ).length;

          return (
            <div
              key={course.id}
              id={`course-card-${course.id}`}
              className={`bg-card p-5 md:p-6 rounded-2xl shadow-sm border border-border transition-all duration-300 group relative overflow-hidden`}
            >
              {/* Header Tags */}
              <div className="flex justify-between items-start mb-4">
                <span className="bg-surface-soft text-primary px-3 py-1 rounded-full text-caption font-mono">
                  {semesterLabel(course.semester)}
                </span>
                <div className="relative">
                  <button
                    id={`course-btn-more-${course.id}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveDropdown(
                        activeDropdown === course.id ? null : course.id,
                      );
                    }}
                    className="tap-target text-text-secondary hover:text-text-primary p-1 rounded-full hover:bg-surface-soft transition-colors"
                  >
                    <MoreHorizontal size={20} />
                  </button>

                  {activeDropdown === course.id && (
                    <div
                      className="absolute right-0 mt-2 w-48 bg-card rounded-xl shadow-lg border border-border overflow-hidden z-20 py-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/*
                        同步學生名單：重新去校務系統讀這一班最新的名冊。
                        轉入、轉出、換座號都靠這個更新，不必等整校的批次同步。

                        ⚠️ 手動建立的班沒有校務系統的班級代碼（course.code 是空的），
                           同步只會失敗，所以停用並說明原因 —— 直接藏起來的話，
                           老師會以為這個功能壞了。
                      */}
                      <button
                        id="course-menu-btn-sync-roster"
                        disabled={!course.code || syncingCourseId === course.id}
                        title={course.code ? undefined : '這個班不是從校務系統匯入的，沒有可同步的名單'}
                        onClick={() => {
                          setActiveDropdown(null);
                          void handleSyncRoster(course);
                        }}
                        className="w-full text-left px-4 py-3 text-body font-normal text-text-primary hover:bg-surface-soft flex items-center gap-3 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                      >
                        {syncingCourseId === course.id
                          ? <Loader2 size={18} className="text-text-secondary animate-spin" />
                          : <RefreshCw size={18} className="text-text-secondary" />}
                        {syncingCourseId === course.id ? '同步中…' : '同步學生名單'}
                      </button>
                      <button id="course-menu-btn-archive-course"
                        onClick={() => {
                          onUpdateCourse({
                            ...course,
                            isArchived: !course.isArchived,
                          });
                          setActiveDropdown(null);
                        }}
                        className="w-full text-left px-4 py-3 text-body font-normal text-text-primary hover:bg-surface-soft flex items-center gap-3 transition-colors"
                      >
                        <Archive size={18} className="text-text-secondary" />
                        {course.isArchived ? "復原課程" : "封存課程"}
                      </button>
                      <div className="h-px bg-border mx-4 my-1"></div>
                      <button
                        id="course-menu-btn-delete-course"
                        onClick={() => {
                          setDeletingCourse(course);
                          setActiveDropdown(null);
                        }}
                        className="w-full text-left px-4 py-3 text-body font-normal text-danger-500 hover:bg-danger-50 flex items-center gap-3 transition-colors"
                      >
                        <Trash2 size={18} />
                        刪除課程
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Title & Info */}
              <h3 className="text-title font-bold text-text-primary mb-3 group-hover:text-primary transition-colors">
                {course.name}
              </h3>

              <div className="flex items-center gap-2 mb-4 flex-wrap">
                <span className="bg-surface-soft text-text-secondary px-2 py-1 rounded-lg text-caption border border-border">
                  {course.code}
                </span>
                {/* 管理人員要知道這班是誰在教；授課教師看自己的班不需要 */}
                {isAdmin(user) && course.teacherName && (
                  <span className="bg-surface-soft text-text-secondary px-2 py-1 rounded-lg text-caption border border-border whitespace-nowrap">
                    {course.teacherName}
                  </span>
                )}
                {course.parseConfidence === "low" && (
                  <span
                    title="縣市或學校無法自動判定，請到「待確認」補齊"
                    className="bg-warning-100 text-warning-700 border border-warning-200 px-2 py-1 rounded-lg text-caption whitespace-nowrap"
                  >
                    待確認歸屬
                  </span>
                )}
                {/* 批改模型的選擇目前隱藏（lib/features.ts），只顯示數量沒有意義，跟著開關走 */}
                {SHOW_AI_MODEL_PICKER && course.aiModels && course.aiModels.length > 0 && (
                  <div className="relative group/tooltip">
                    <span className="bg-surface-soft text-primary px-2 py-1 rounded-lg text-caption flex items-center gap-1 border border-border cursor-help">
                      <Bot size={12} /> {course.aiModels.length} 個助手
                    </span>
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover/tooltip:block w-max max-w-[200px] p-2 bg-ink-800 text-ink-50 text-caption rounded-lg shadow-lg z-10">
                      <div className="font-bold mb-1 border-b border-card/20 pb-1">
                        已啟用助手模型
                      </div>
                      <ul className="list-disc list-inside space-y-0.5">
                        {course.aiModels.map((model, idx) => (
                          <li key={idx}>{model}</li>
                        ))}
                      </ul>
                      <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-ink-800"></div>
                    </div>
                  </div>
                )}
              </div>

              {/*
                主要動作放在卡片上半部。原本壓在最下面一排、和學生頭像
                與箭頭擠在一起，老師得看到底才知道從哪裡進去。
              */}
              <button
                id={`course-btn-open-${course.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenCourse(course);
                }}
                className="w-full mb-5 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-brand bg-primary text-on-accent text-ui whitespace-nowrap hover:opacity-90 active:scale-[0.98] transition-all shadow-sm shadow-primary/20"
              >
                <ClipboardList size={16} className="shrink-0" />
                作業管理
              </button>

              {/* Stats Rows */}
              <div className="space-y-3 mb-6">
                <div
                  className="bg-accent/10 rounded-brand p-3 flex justify-between items-center text-accent border border-accent/20 cursor-pointer hover:bg-accent/20 transition-colors cursor-pointer hover:bg-accent/20 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenCourse(course);
                  }}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-card flex items-center justify-center text-accent shadow-sm">
                      <Clock size={16} />
                    </div>
                    <span className="text-body">進行中作業</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-title font-bold">
                      {activeAssignmentsCount}
                    </span>
                    <ChevronRight size={16} className="text-accent/60" />
                  </div>
                </div>

                <div
                  className="bg-secondary/10 rounded-brand p-3 flex justify-between items-center text-secondary border border-secondary/20 cursor-pointer hover:bg-secondary/20 transition-colors cursor-pointer hover:bg-secondary/20 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenCourse(course);
                  }}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-card flex items-center justify-center text-secondary shadow-sm">
                      <AlertCircle size={16} />
                    </div>
                    <span className="text-body">待批改作業</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-title font-bold">
                      {pendingGradingCount}
                    </span>
                    <ChevronRight size={16} className="text-secondary/60" />
                  </div>
                </div>
              </div>

              {/* Footer: Student Info */}
              <div className="flex items-center justify-between pt-4 border-t border-border">
                <div className="flex items-center gap-3">
                  <div className="flex -space-x-2">
                    {[...Array(3)].map((_, i) => (
                      <div
                        key={i}
                        className="w-8 h-8 rounded-full border-2 border-card bg-surface-soft overflow-hidden"
                      >
                        <img
                          src={`https://api.dicebear.com/7.x/notionists/svg?seed=${course.id}-${i}`}
                          alt="student"
                          className="w-full h-full bg-surface-soft"
                        />
                      </div>
                    ))}
                  </div>
                  <span className="text-body font-normal text-text-secondary">
                    {course.studentCount} 位學生
                  </span>
                </div>

                {/* 作業管理搬到上面之後，這裡只剩成績管理。
                    原本是一顆沒有文字的箭頭，補上標籤才知道會去哪裡 */}
                <button
                  id={`course-btn-grades-${course.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectCourse(course);
                  }}
                  className="tap-target inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-caption text-text-secondary border border-border whitespace-nowrap hover:border-primary hover:text-primary hover:bg-surface-soft transition-all"
                >
                  成績管理
                  <ArrowRight size={14} className="shrink-0" />
                </button>
              </div>
            </div>
          );
  };

  return (
    <div className={`${PAGE_CONTAINER} space-y-6 pb-12`}>
      {/*
        同步結果。用自己的小視窗而不是 alert：要列出「加了誰、移了誰」，
        而且移除的人要附一句「作文還在」，否則老師會以為資料被刪掉了。
      */}
      {syncReport && (
        <div
          id="course-roster-sync-report"
          className="fixed inset-0 z-[1100] flex items-center justify-center p-4 sm:p-6"
        >
          <div className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm" onClick={() => setSyncReport(null)} />
          <div className="relative w-full max-w-md bg-surface rounded-2xl shadow-2xl border border-border overflow-hidden flex flex-col max-h-[80vh]">
            <div className="p-5 border-b border-border">
              <h2 className="text-title font-bold text-text-primary">
                {syncReport.error ? '名單沒有更新' : '名單已同步'}
              </h2>
              <p className="text-caption text-text-secondary mt-1 truncate">{syncReport.course.name}</p>
            </div>

            <div className="p-5 overflow-y-auto space-y-4">
              {syncReport.error ? (
                <p className="text-body text-danger-600">{syncReport.error}</p>
              ) : (
                <>
                  <p className="text-body text-text-primary">
                    目前共 {syncReport.result?.total ?? 0} 位學生
                    {!syncReport.result?.added.length && !syncReport.result?.removed.length && (
                      <span className="text-text-secondary">（名單沒有變動）</span>
                    )}
                  </p>
                  {!!syncReport.result?.added.length && (
                    <div>
                      <p className="text-caption text-success-700 mb-1">
                        新加入 {syncReport.result.added.length} 位
                      </p>
                      <p className="text-body text-text-secondary">
                        {syncReport.result.added.map((s) => s.name || s.account).join('、')}
                      </p>
                    </div>
                  )}
                  {!!syncReport.result?.removed.length && (
                    <div>
                      <p className="text-caption text-warning-700 mb-1">
                        移出 {syncReport.result.removed.length} 位
                      </p>
                      <p className="text-body text-text-secondary">
                        {syncReport.result.removed.map((s) => s.name || s.account).join('、')}
                      </p>
                      <p className="text-caption text-text-secondary mt-1">
                        他們已經繳交的作文仍然留著，只是不再出現在這一班的名單與統計裡。
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="p-4 border-t border-border bg-surface-soft/50 flex justify-end">
              <button
                id="course-roster-sync-report-close"
                onClick={() => setSyncReport(null)}
                className="px-4 py-2 rounded-xl bg-primary text-on-accent font-bold hover:opacity-90 transition-opacity"
              >
                知道了
              </button>
            </div>
          </div>
        </div>
      )}
      {isSyncModalOpen && (
        <SyncSchoolModal
          onClose={() => setIsSyncModalOpen(false)}
          currentSemester={currentSemester}
          existingCourseCodes={courses.map((c) => c.code)}
          user={user}
          onConfirm={(selected) => {
            onAddCourses(selected);
            setIsSyncModalOpen(false);
          }}
        />
      )}
      <PageHeader
        title="課程管理"
        subtitle="管理您的授課班級與學生名單，追蹤作業進度"
        onBack={canGoBack ? onBack : undefined}
        backId="course-btn-back"
        className="mb-8"
        actions={<>

        {/*
          手機上兩個控制各佔一整行。以前同一行各分一半，按鈕窄到「同步校務系統」
          被擠成直排，整行跟著變高，圓角的學期選單也被撐成橢圓。
          平板以上才並排，而且都不伸縮。
        */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 w-full md:w-auto">
          <SemesterSelect
            id="course-select-semester"
            value={currentSemester}
            options={semesterOptions}
            current={todaySemester}
            onChange={onSemesterChange}
            className="w-full sm:w-auto"
          />

          <button
            id="course-btn-sync"
            onClick={() => setIsSyncModalOpen(true)}
            className="bg-primary hover:bg-text-primary text-on-accent px-4 py-2 md:px-5 md:py-2.5 rounded-xl text-body shadow-lg shadow-primary/20 transition-all flex items-center justify-center gap-2 hover:scale-[1.02] whitespace-nowrap shrink-0 w-full sm:w-auto"
          >
            <RefreshCcw size={14} className="md:size-[16px]" /> 同步校務系統
          </button>
        </div>
        </>}
      />

      {/*
        分頁改成實色的分段切換器（與題庫中心的「共用／個人題庫」同一套語彙）。
        原本是「底線 + 文字」浮在頁面底色上 —— 未選的那一個對底色幾乎沒有對比，
        看起來不像可以按的東西，也看不出目前在哪一頁。
      */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <div className="inline-flex bg-surface-soft p-1 rounded-2xl border border-border-strong shadow-sm">
          <button id="dashboard-tab-active-courses"
            onClick={() => setActiveTab("active")}
            className={`px-4 md:px-6 py-2 md:py-2.5 font-bold text-body rounded-xl transition-all whitespace-nowrap ${activeTab === "active" ? "bg-primary text-on-accent shadow-sm" : "text-text-secondary hover:text-text-primary"}`}
          >
            進行中課程
          </button>
          <button id="dashboard-tab-archived-courses"
            onClick={() => setActiveTab("archived")}
            className={`px-4 md:px-6 py-2 md:py-2.5 font-bold text-body rounded-xl transition-all whitespace-nowrap ${activeTab === "archived" ? "bg-primary text-on-accent shadow-sm" : "text-text-secondary hover:text-text-primary"}`}
          >
            已封存課程
          </button>
        </div>

        {isAdmin(user) && needsReview.length > 0 && (
          <button
            id="course-btn-open-mapping"
            onClick={() => setIsMappingOpen(true)}
            className="ml-auto self-center inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-warning-100 text-warning-700 border border-warning-200 text-caption whitespace-nowrap hover:bg-warning-200 transition-colors"
          >
            <AlertCircle size={13} className="shrink-0" />
            待確認 {needsReview.length}
          </button>
        )}
      </div>

      {deletingCourse && (
        <DeleteCourseModal
          course={deletingCourse}
          footprint={courseFootprint(
            deletingCourse.id,
            assignments,
            submissions,
            deletingCourse.studentCount,
          )}
          onCancel={() => setDeletingCourse(null)}
          onArchive={() => {
            onUpdateCourse({ ...deletingCourse, isArchived: true });
            setDeletingCourse(null);
          }}
          onConfirm={() => {
            onDeleteCourse(deletingCourse.id);
            setDeletingCourse(null);
          }}
        />
      )}

      {isMappingOpen && (
        <CourseMappingModal
          courses={needsReview}
          onClose={() => setIsMappingOpen(false)}
          onSave={(updated) => updated.forEach(onUpdateCourse)}
        />
      )}

      {/*
        關鍵字搜尋。空白分隔的多個字要「全部命中」——
        「淡江 國二」是縮小範圍，用 OR 會把所有淡江和所有國二都倒出來。
        比對涵蓋整串課名與解析出的縣市／學校／班級，解析失敗的課程也搜得到。
      */}
      <div className="relative">
          <Search
            size={16}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
          />
          <input
            id="course-search-input"
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜尋學校、縣市、班級、課程代碼或授課教師"
            className="w-full bg-card border border-border-strong shadow-sm rounded-brand pl-10 pr-10 py-2.5 text-ui text-text-primary placeholder:text-text-muted outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-colors [&::-webkit-search-cancel-button]:hidden"
          />
          {searchQuery && (
            <button
              id="course-search-clear"
              onClick={() => setSearchQuery("")}
              title="清除搜尋"
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full text-text-secondary hover:bg-surface-soft transition-colors"
            >
              <X size={14} />
            </button>
          )}
      </div>

      {cityChips.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {cityChips.map((chip) => (
            <button
              key={chip}
              id={`course-filter-city-${chip}`}
              onClick={() => setCityFilter(chip)}
              className={`px-3 py-1.5 rounded-lg text-caption whitespace-nowrap transition-colors ${
                cityFilter === chip
                  ? "bg-primary text-on-accent shadow-sm"
                  : "bg-card text-text-secondary hover:bg-surface-soft border border-border-strong"
              }`}
            >
              {chip === "all" ? "全部" : chip}
              <span className="tap-target ml-1.5 tabular-nums">
                {cityCounts[chip] ?? 0}
              </span>
            </button>
          ))}
        </div>
      )}

      {filteredCourses.length > 0 && (
        <div className="flex flex-col gap-7">
          {schoolGroups.map((group) => {
            const students = group.courses.reduce((n, c) => n + c.studentCount, 0);
            return (
              <section key={group.key} id={`course-group-${group.key}`}>
                {/*
                  學校那一層一律是淡藍色橫帶 —— 批改作業頁與班級挑選視窗都是這個語彙。
                  原本只有一行文字加一條細線，整條浮在頁面底色上，分不出這是一個分組。
                */}
                <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-xl bg-primary-50 border border-primary-200 flex-wrap">
                  <School size={15} className="text-primary shrink-0" />
                  <h3 className="text-ui text-text-primary font-bold">{group.label}</h3>
                  <span className="text-caption text-text-secondary whitespace-nowrap">
                    {group.courses.length} 班・{students} 位學生
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                  {group.courses.map(renderCourseCard)}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {filteredCourses.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 bg-card/40 rounded-brand border border-border border-dashed text-text-secondary">
          {/*
            搜尋沒結果和「這學期本來就沒課」是兩件事。
            講錯的話管理人員會以為資料掉了，跑去重新同步校務系統。
          */}
          {searchQuery.trim() ? (
            <>
              <Search size={48} className="mb-4 opacity-30" />
              <p className="font-normal text-title">
                找不到符合「{searchQuery.trim()}」的課程
              </p>
              <button
                id="course-search-reset"
                onClick={() => setSearchQuery("")}
                className="text-body mt-3 text-primary hover:underline"
              >
                清除搜尋條件
              </button>
            </>
          ) : (
            <>
              <AlertCircle size={48} className="mb-4 opacity-30" />
              <p className="font-normal text-title">
                {activeTab === "active" ? "此學期尚無課程" : "此學期尚無已封存課程"}
              </p>
              {activeTab === "active" && (
                <p className="text-body mt-2 opacity-70">請同步校務系統或切換學期</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

