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
  Edit,
  Users,
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
import { SHOW_AI_MODEL_PICKER } from "../lib/features";
import {
  groupCoursesBySchool,
  cityCountsOf,
  cityChipsOf,
  UNASSIGNED_GROUP as UNASSIGNED,
} from "../lib/courseGroups";

import { SyncSchoolModal } from "./SyncSchoolModal";

import { EditCourseModal } from "./EditCourseModal";
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
}) => {
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"active" | "archived">("active");
  const [cityFilter, setCityFilter] = useState<string>("all");
  /** 關鍵字搜尋。管理人員看得到全省課程，光靠縣市晶片還是要一張張找 */
  const [searchQuery, setSearchQuery] = useState("");
  const [isMappingOpen, setIsMappingOpen] = useState(false);
  /** 正在確認刪除的課程 */
  const [deletingCourse, setDeletingCourse] = useState<Course | null>(null);

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
                      <button id="course-menu-btn-set-ai-model"
                        onClick={() => {
                          setEditingCourse(course);
                          setActiveDropdown(null);
                        }}
                        className="w-full text-left px-4 py-3 text-body font-normal text-text-primary hover:bg-surface-soft flex items-center gap-3 transition-colors"
                      >
                        <Edit size={18} className="text-text-secondary" />
                        設定批改模型
                      </button>
                      <button id="course-menu-btn-manage-students" className="w-full text-left px-4 py-3 text-body font-normal text-text-primary hover:bg-surface-soft flex items-center gap-3 transition-colors">
                        <Users size={18} className="text-text-secondary" />
                        管理學生名單
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
      {editingCourse && (
        <EditCourseModal
          course={editingCourse}
          onClose={() => setEditingCourse(null)}
          onSave={(updatedCourse) => {
            onUpdateCourse(updatedCourse);
            setEditingCourse(null);
          }}
        />
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

      <div className="flex border-b border-border mb-6 overflow-x-auto scrollbar-hide">
        <button id="dashboard-tab-active-courses"
          onClick={() => setActiveTab("active")}
          className={`px-4 md:px-6 py-2.5 md:py-3 font-bold text-body border-b-2 transition-colors whitespace-nowrap ${activeTab === "active" ? "border-primary text-primary" : "border-transparent text-text-secondary hover:text-text-primary"}`}
        >
          進行中課程
        </button>
        <button id="dashboard-tab-archived-courses"
          onClick={() => setActiveTab("archived")}
          className={`px-4 md:px-6 py-2.5 md:py-3 font-bold text-body border-b-2 transition-colors whitespace-nowrap ${activeTab === "archived" ? "border-primary text-primary" : "border-transparent text-text-secondary hover:text-text-primary"}`}
        >
          已封存課程
        </button>

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
            className="w-full bg-surface/60 border border-border rounded-brand pl-10 pr-10 py-2.5 text-ui text-text-primary placeholder:text-text-muted outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/20 transition-colors [&::-webkit-search-cancel-button]:hidden"
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
                  ? "bg-primary text-on-accent"
                  : "text-text-secondary hover:bg-surface-soft border border-border"
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
                <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border flex-wrap">
                  <School size={15} className="text-primary shrink-0" />
                  <h3 className="text-ui text-text-primary">{group.label}</h3>
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

