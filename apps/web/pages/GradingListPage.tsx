import React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Clock, CheckCircle, ChevronRight, ArrowRight, ArrowLeft, Bot, ChevronDown, CheckSquare, Wand2, Loader2, Send, RotateCcw, SendHorizontal,
  Check, Camera, AlertTriangle, Image as ImageIcon,
} from "lucide-react";
import { StatusBadge } from "../components/StatusBadge";
import { SubmissionStampRow } from "../components/SubmissionStamp";
import { ProxySubmitModal } from "../components/ProxySubmitModal";
import { useAppState } from "../state/appStateContext";
import { useGoBack } from "../lib/useGoBack";
import { routes, queryKeys } from "../lib/routes";
import { canMark, hasMark } from "../lib/submissionMarks";
import { assignmentRoster } from "../lib/gradingQueue";
import {
  assignmentsForCourse, isOverdue as isAssignmentOverdue, hasDeadline, deadlineLabel,
  firstWorthGrading,
} from "../lib/assignments";
import { orderedAssignments, orderNumbers } from "../lib/assignmentOrder";
import { levelStyle, MAX_LEVEL } from "../lib/scoring";
import { seatLabel, COURSE_ROSTERS } from "../mockData";
import { SHOW_AI_MODEL_PICKER } from "../lib/features";

export const GradingListPage: React.FC = () => {
  const navigate = useNavigate();
  const { goBack } = useGoBack();
  const [params] = useSearchParams();
  const {
    assignments,
    courses,
    currentSemester,
    currentlyGradingId,
    handleBatchGrade,
    handleBatchPublish,
    handleBatchReset,
    handleClearSubmission,
    handleProxySubmit,
    hideOverdueAssignments,
    isBatchGrading,
    isProxySubmitOpen,
    myCourses,
    selectedAiModel,
    selectedSubmissionIds,
    setHideOverdueAssignments,
    setIsProxySubmitOpen,
    setSelectedAiModel,
    setSelectedSubmissionIds,
    submissionMarks,
    submissions,
    toggleMark,
  } = useAppState();

  /**
   * 目前正在批改哪一份作業。**存在網址的 query 裡，不是 state。**
   *
   * 沒有值時這一頁是「作業牆」，有值時是那份作業的批改清單 ——
   * 兩者是同一條路徑的兩種狀態，所以重新整理與返回鍵都是自然的。
   */
  const selectedAssignmentId = params.get(queryKeys.assignment);
  const setSelectedAssignmentId = (id: string) =>
    navigate(routes.gradingList({ assignmentId: id }), { replace: true });

  /**
   * 批改頁的橫向切換（換班級／換任務）。
   *
   * 三件事一定要一起做，少一件就會出現「看起來壞掉」的畫面：
   *   1. 清掉勾選 —— 舊作業的 id 留著會對不到任何一筆，
   *      三顆批次按鈕會一起變成 (0) 而且灰掉
   *   2. 清掉 AI 模型 —— 模型清單來自 course.aiModels，換班後可能不存在
   *   3. 不動網址 —— 這是同一頁之內的切換，不是導覽。
   *      push 了返回鍵就要按很多次才回得到作業牆
   */
  const switchGradingTarget = (assignmentId: string) => {
    setSelectedAssignmentId(assignmentId);
    setSelectedSubmissionIds([]);
    setSelectedAiModel(null);
    setIsProxySubmitOpen(false);
  };

      // Sub-view: Student List for specific assignment
      if (selectedAssignmentId) {
        const assignment = assignments.find(
          (a) => a.id === selectedAssignmentId,
        );
        const course = courses.find((c) => c.id === assignment?.courseId);
        const availableModels = course?.aiModels || [];

        /*
          右上兩個下拉的選項。
          班級一律走 visibleCourses —— 授課教師只該看到自己名下的班，
          在這裡自己寫 if (role === ADMIN) 就是漏一個畫面漏一次資料。
          只留有作業的班，選了卻沒東西可批是死路。
        */
        const switchableCourses = myCourses.filter(
          (c) => !c.isArchived && assignmentsForCourse(assignments, c.id).length > 0,
        );
        /*
           下拉的順序＝老師在課程作業清單排定的順序。
           同一個班的作業有三個地方會列出來（課程作業清單、成績管理、這裡），
           三個地方要是同一個順序，不然老師會覺得系統在跟他鬧。
           順序的唯一來源在 lib/assignmentOrder.ts，這裡不要自己 sort。
         */
        const switchableAssignments = course
          ? orderedAssignments(assignments, course.id)
          : [];
        const switchableNo = orderNumbers(switchableAssignments);

        // 名冊 × 繳交紀錄。批改頁的「上一位／下一位」用的是同一支函式，
        // 兩邊的順序才會一致（見 lib/gradingQueue.ts）
        const roster = assignment
          ? COURSE_ROSTERS[assignment.courseId] || []
          : [];
        const sortedSubmissions = assignment
          ? assignmentRoster(assignment, roster, submissions)
          : [];
        const filteredSubmissions = sortedSubmissions;

        const totalStudents = assignment?.totalStudents || roster.length || 0;
        const unsubmittedCount = filteredSubmissions.filter(
          (s) => s.status === "Unsubmitted" || s.status === "Draft",
        ).length;
        const pending = filteredSubmissions.filter(
          (s) => s.status === "Pending",
        ).length;
        const graded = filteredSubmissions.filter(
          (s) => s.status === "Graded",
        ).length;
        const published = filteredSubmissions.filter(
          (s) => s.status === "Published",
        ).length;

        const selectedPendingCount =
          selectedSubmissionIds.length > 0
            ? filteredSubmissions.filter(
                (s) =>
                  selectedSubmissionIds.includes(s.id) &&
                  s.status === "Pending",
              ).length
            : pending;
        /*
          兩顆按鈕的目標都是「已批改、還沒發還」（status === 'Graded'），
          但啟動條件刻意不同：

            發還     自動偵測。沒勾選就是整批全發，勾了就只發勾到的。
            重置批改 一定要先勾選。沒勾選時是 0、停用 ——
                     它會清掉分數與評語，不該有「沒選就全部重置」這種預設。
        */
        const gradedOf = (ids?: string[]) =>
          filteredSubmissions.filter(
            (s) =>
              s.status === "Graded" && (!ids || ids.includes(s.id)),
          ).length;

        const hasSelection = selectedSubmissionIds.length > 0;
        const selectedGradedCount = hasSelection
          ? gradedOf(selectedSubmissionIds)
          : graded;
        const selectedResetCount = hasSelection
          ? gradedOf(selectedSubmissionIds)
          : 0;

        // Helper to simulate has draft check (same logic as Editor)
        const hasDraft = (id: string) => id.charCodeAt(id.length - 1) % 2 === 0;

        return (
          <div className="max-w-7xl mx-auto space-y-6">
            <div className="flex flex-wrap items-center gap-3 md:gap-4 mb-4 md:mb-6">
              <button id="gradinglist-btn-back"
                onClick={goBack}
                className="tap-target w-9 h-9 md:w-10 md:h-10 flex items-center justify-center rounded-full bg-card/50 border border-card/60 text-ink-500 hover:bg-card hover:text-ink-900 transition-all shadow-sm"
              >
                <ArrowLeft size={18} className="md:size-[20px]" />
              </button>
              <div>
                <h2 className="text-display font-bold text-text-primary tracking-tight">
                  批改作業
                </h2>
              </div>

              {/*
                原本副標寫「正在批改：某某作業」，現在下拉本身就顯示那個名字，
                留著只是同一句話講兩次，拿掉。
              */}
              <div className="ml-auto flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-caption text-text-secondary">切換班級</span>
                  <div className="relative">
                    <select
                      id="gradinglist-select-course"
                      value={course?.id ?? ""}
                      onChange={(e) => {
                        /*
                          換班之後要落在哪一份，不能直接取老師排序的第一份 ——
                          那很可能是還沒開放、一份繳交都沒有的草稿，
                          切過去會是空畫面，看起來像切換失敗。
                        */
                        const next = firstWorthGrading(
                          assignmentsForCourse(assignments, e.target.value),
                          submissions,
                        );
                        if (next) switchGradingTarget(next.id);
                      }}
                      className="appearance-none bg-card border border-border rounded-xl pl-3 pr-9 py-2 text-body text-text-primary outline-none cursor-pointer hover:border-primary/40 focus:ring-2 focus:ring-primary/30 transition-colors max-w-[15rem] truncate"
                    >
                      {switchableCourses.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size={15}
                      className="text-text-secondary absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
                    />
                  </div>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-caption text-text-secondary">選擇任務</span>
                  <div className="relative">
                    <select
                      id="gradinglist-select-assignment"
                      value={assignment?.id ?? ""}
                      onChange={(e) => switchGradingTarget(e.target.value)}
                      className="appearance-none bg-card border border-border rounded-xl pl-3 pr-9 py-2 text-body text-text-primary outline-none cursor-pointer hover:border-primary/40 focus:ring-2 focus:ring-primary/30 transition-colors max-w-[15rem] truncate"
                    >
                      {switchableAssignments.map((a) => (
                        <option key={a.id} value={a.id}>
                          {switchableNo[a.id]}. {a.title}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size={15}
                      className="text-text-secondary absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
                    />
                  </div>
                </label>
              </div>
            </div>

            {/* AI 模型設定。依需求隱藏，機制保留 —— 見 lib/features.ts */}
            {SHOW_AI_MODEL_PICKER && availableModels.length > 0 && (
              <label 
                htmlFor="grading-select-ai-model"
                className="bg-card/40 backdrop-blur-md p-4 rounded-brand border border-border/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-2 cursor-pointer hover:bg-card/60 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary shadow-inner">
                    <Bot size={20} />
                  </div>
                  <div>
                    <h4 className="text-body text-text-primary">AI 批改模型設定</h4>
                    <p className="text-caption text-text-secondary font-normal">選擇此作業使用的 AI 評分引擎</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-4 w-full sm:w-auto">
                  <div className="relative bg-card border border-border rounded-xl shadow-sm min-w-full sm:min-w-[240px] hover:border-primary/30 transition-colors group">
                    <select
                      id="grading-select-ai-model"
                      value={selectedAiModel || ""}
                      onChange={(e) => setSelectedAiModel(e.target.value)}
                      className="w-full px-4 py-2 pr-10 text-body text-text-primary bg-transparent outline-none appearance-none cursor-pointer"
                    >
                      {availableModels.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size={16}
                      className="text-text-secondary absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none group-hover:text-primary transition-colors"
                    />
                  </div>
                </div>
              </label>
            )}

            {/* Stats & Actions Toolbar */}
            <div className="bg-card/80 backdrop-blur-xl p-3 md:p-4 rounded-brand shadow-sm border border-border flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-3 md:gap-6 px-1 md:px-4 w-full lg:w-auto">
                <div className="flex items-center gap-2">
                  <span className="text-body text-text-primary">
                    全班人數
                  </span>
                  <span className="text-title font-bold bg-surface-soft text-text-secondary px-2 py-0.5 rounded-lg">
                    {totalStudents}
                  </span>
                </div>
                <div className="hidden lg:block h-8 w-px bg-border"></div>
                <div className="flex flex-col gap-1 text-caption w-full lg:w-auto">
                  <div className="flex items-center gap-3 md:gap-4">
                    <span className="flex items-center gap-1.5 md:gap-2 text-ink-400">
                      <span className="w-2 h-2 md:w-2.5 md:h-2.5 rounded-full bg-ink-300"></span>
                      未繳交 {unsubmittedCount}
                    </span>
                    <span className="flex items-center gap-1.5 md:gap-2 text-secondary">
                      <span className="w-2 h-2 md:w-2.5 md:h-2.5 rounded-full bg-secondary"></span>
                      待批改 {pending}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 md:gap-4">
                    <span className="flex items-center gap-1.5 md:gap-2 text-primary">
                      <span className="w-2 h-2 md:w-2.5 md:h-2.5 rounded-full bg-primary"></span>
                      已批改 {graded}
                    </span>
                    <span className="flex items-center gap-1.5 md:gap-2 text-accent">
                      <span className="w-2 h-2 md:w-2.5 md:h-2.5 rounded-full bg-accent"></span>
                      已發還 {published}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
                {/*
                  代繳交開的是視窗，不吃勾選數，所以不加 (n)。
                  用朱砂與旁邊三顆區隔 —— 它是「把紙本變成資料」，
                  和批改／發還／重置不是同一類動作。
                */}
                <button id="gradinglist-btn-proxy-submit"
                  onClick={() => setIsProxySubmitOpen(true)}
                  disabled={isBatchGrading}
                  className="flex-1 lg:flex-none flex items-center justify-center gap-2 bg-secondary hover:bg-text-primary text-on-accent px-3 md:px-4 py-2 md:py-2.5 rounded-xl text-body shadow-lg shadow-secondary/30 transition-all hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  <Camera size={14} className="md:size-[16px]" />
                  批次代繳交
                </button>
                <button id="gradinglist-btn-batch-grade"
                  onClick={() => handleBatchGrade(selectedAssignmentId)}
                  disabled={isBatchGrading || selectedPendingCount === 0}
                  className="flex-1 lg:flex-none flex items-center justify-center gap-2 bg-primary hover:bg-text-primary text-on-accent px-3 md:px-4 py-2 md:py-2.5 rounded-xl text-body shadow-lg shadow-primary/30 transition-all hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  {isBatchGrading ? (
                    <Loader2 size={14} className="animate-spin md:size-[16px]" />
                  ) : (
                    <Wand2 size={14} className="md:size-[16px]" />
                  )}
                  {isBatchGrading
                    ? `批改中...`
                    : `批次批改 (${selectedPendingCount})`}
                </button>
                <button id="gradinglist-btn-batch-publish"
                  onClick={() => handleBatchPublish(selectedAssignmentId)}
                  disabled={isBatchGrading || selectedGradedCount === 0}
                  title={
                    selectedGradedCount === 0
                      ? "目前沒有「已批改、尚未發還」的作業"
                      : hasSelection
                        ? `發還勾選中的 ${selectedGradedCount} 份`
                        : `發還全部 ${selectedGradedCount} 份已批改的作業`
                  }
                  className="flex-1 lg:flex-none flex items-center justify-center gap-2 bg-accent hover:bg-text-primary text-on-accent px-3 md:px-4 py-2 md:py-2.5 rounded-xl text-body shadow-lg shadow-accent/30 transition-all hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  <Send size={14} className="md:size-[16px]" />
                  發還 ({selectedGradedCount})
                </button>
                <button id="gradinglist-btn-batch-reset"
                  onClick={() => handleBatchReset(selectedAssignmentId)}
                  disabled={isBatchGrading || selectedResetCount === 0}
                  title={
                    !hasSelection
                      ? "請先勾選已批改、尚未發還的作業"
                      : selectedResetCount === 0
                        ? "勾選的項目裡沒有「已批改」的作業"
                        : `清除這 ${selectedResetCount} 份的分數與評語，退回「待批改」`
                  }
                  className="flex-1 lg:flex-none flex items-center justify-center gap-2 bg-card hover:bg-danger-50 text-danger-700 border border-danger-200 hover:border-danger-300 px-3 md:px-4 py-2 md:py-2.5 rounded-xl text-body transition-all disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  <RotateCcw size={14} className="md:size-[16px]" />
                  重置批改 ({selectedResetCount})
                </button>
              </div>
            </div>

            {isProxySubmitOpen && assignment && (
              <ProxySubmitModal
                assignment={assignment}
                rosterSubmissions={sortedSubmissions}
                onClose={() => setIsProxySubmitOpen(false)}
                onProxySubmit={(studentId, content, picFiles) =>
                  handleProxySubmit(selectedAssignmentId, studentId, content, picFiles)
                }
              />
            )}

            {/* Mobile Card List View */}
            <div className="lg:hidden space-y-3">
              {/* Select All for Mobile */}
              <div className="flex items-center justify-between px-1">
                <div
                  onClick={() => {
                    if (
                      selectedSubmissionIds.length === sortedSubmissions.length
                    ) {
                      setSelectedSubmissionIds([]);
                    } else {
                      setSelectedSubmissionIds(
                        sortedSubmissions.map((s) => s.id),
                      );
                    }
                  }}
                  className="flex items-center gap-2 text-text-secondary text-caption cursor-pointer"
                >
                  <div
                    className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                      selectedSubmissionIds.length ===
                        sortedSubmissions.length && sortedSubmissions.length > 0
                        ? "bg-primary border-primary text-on-accent"
                        : "border-border bg-card"
                    }`}
                  >
                    {selectedSubmissionIds.length ===
                      sortedSubmissions.length &&
                      sortedSubmissions.length > 0 && <Check size={12} />}
                  </div>
                  全選
                </div>
                <span className="text-caption text-text-secondary opacity-50">
                  共 {sortedSubmissions.length} 份
                </span>
              </div>

              {sortedSubmissions.map((s) => {
                const hasDraftFile = hasDraft(s.id);
                const score = s.result?.totalScore;
                const isSelected = selectedSubmissionIds.includes(s.id);

                return (
                  <div
                    key={s.id}
                    onClick={() => {
                      navigate(routes.gradingEditor(s.assignmentId, s.id));
                    }}
                    className={`bg-card p-3 rounded-brand border shadow-sm transition-all active:scale-[0.98] ${isSelected ? "border-primary/30 ring-1 ring-primary/10" : "border-border/50"}`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isSelected) {
                              setSelectedSubmissionIds(
                                selectedSubmissionIds.filter(
                                  (id) => id !== s.id,
                                ),
                              );
                            } else {
                              setSelectedSubmissionIds([
                                ...selectedSubmissionIds,
                                s.id,
                              ]);
                            }
                          }}
                          className={`w-5 h-5 rounded border flex items-center justify-center transition-colors shrink-0 ${
                            isSelected
                              ? "bg-primary border-primary text-on-accent"
                              : "border-border bg-surface-soft"
                          }`}
                        >
                          {isSelected && <Check size={14} />}
                        </div>
                        <div className="flex items-center gap-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-body text-text-primary">
                                {s.studentName}
                              </span>
                              <span className="text-caption text-text-secondary opacity-60">
                                #{seatLabel(s.studentId)}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 mt-1.5">
                              <StatusBadge status={s.status} />
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-1.5">
                        {score !== undefined ? (
                          <div className="text-title font-bold text-primary leading-none">
                            {score}
                            {/*
                              分母是六級分的 6，不是 100 —— 這裡原本寫死 /100，
                              是改成會考級分制之前留下來的。5 分寫成「5/100」
                              看起來像慘敗，實際上是相當好的成績。
                            */}
                            <span className="text-caption text-text-secondary opacity-40 ml-0.5">
                              /{MAX_LEVEL}
                            </span>
                          </div>
                        ) : (
                          <div className="text-title font-bold text-ink-200 leading-none">
                            --
                          </div>
                        )}
                        {hasDraftFile && (
                          <div className="flex items-center gap-1 text-caption text-accent font-normal">
                            <ImageIcon size={10} /> 有原稿
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/30 mt-2">
                      <span className="text-caption text-text-secondary opacity-50 min-w-0 truncate">
                        {s.submittedAt
                          ? `繳交於 ${new Date(s.submittedAt).toLocaleDateString()}`
                          : "尚未繳交"}
                      </span>
                      {/*
                        章自己會 stopPropagation（見 SubmissionStamp），
                        不然在這張卡片上蓋個章就被帶進批改頁了。
                      */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <SubmissionStampRow
                          submissionId={s.id}
                          idPrefix="gradingcard-stamp"
                          size="sm"
                          canMark={canMark(s.status)}
                          isOn={(kind) => hasMark(submissionMarks, s.id, kind)}
                          onToggle={(kind) => toggleMark(s.id, kind)}
                        />
                        <ChevronRight size={14} className="text-text-secondary opacity-30" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="hidden lg:block bg-card rounded-xl shadow-sm border border-ink-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-ink-50/80 border-b border-ink-100 text-ink-600 text-caption uppercase tracking-wider">
                    <tr>
                      <th className="p-6 w-14 text-center">
                        <div
                          onClick={() => {
                            if (
                              selectedSubmissionIds.length ===
                              sortedSubmissions.length
                            ) {
                              setSelectedSubmissionIds([]);
                            } else {
                              setSelectedSubmissionIds(
                                sortedSubmissions.map((s) => s.id),
                              );
                            }
                          }}
                          className={`w-5 h-5 rounded border-2 flex items-center justify-center cursor-pointer transition-colors ${
                            selectedSubmissionIds.length ===
                              sortedSubmissions.length &&
                            sortedSubmissions.length > 0
                              ? "bg-primary border-primary text-on-accent"
                              : "border-ink-300 hover:border-primary/60 bg-card"
                          }`}
                        >
                          {selectedSubmissionIds.length ===
                            sortedSubmissions.length &&
                            sortedSubmissions.length > 0 && <Check size={14} />}
                        </div>
                      </th>
                      <th className="py-4 px-2 w-14 whitespace-nowrap">座號</th>
                      <th className="py-4 px-4 w-40">學生姓名</th>
                      <th className="py-4 px-2 text-center w-16">原稿</th>
                      <th className="py-4 px-4 w-44">狀態</th>
                      <th className="py-4 px-4 text-ink-600 whitespace-nowrap">繳交時間</th>
                      {/*
                        標記欄。夾在繳交時間與分數中間 —— 蓋章是看完分數之前
                        的判斷（這篇好不好），放在分數旁邊比放在最右邊的操作欄
                        更符合閱讀順序。
                      */}
                      <th className="py-4 px-3 text-center w-28 whitespace-nowrap">標記</th>
                      <th className="py-4 px-2 text-center w-20">分數</th>
                      <th className="py-4 px-4 text-right w-32 whitespace-nowrap">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {sortedSubmissions.map((s) => {
                      const hasDraftFile = hasDraft(s.id);
                      const score = s.result?.totalScore;

                      return (
                        <tr
                          key={s.id}
                          className="hover:bg-ink-50/80 transition-colors group"
                        >
                          <td className="py-2 px-6 text-center">
                            <div
                              onClick={() => {
                                if (selectedSubmissionIds.includes(s.id)) {
                                  setSelectedSubmissionIds(
                                    selectedSubmissionIds.filter(
                                      (id) => id !== s.id,
                                    ),
                                  );
                                } else {
                                  setSelectedSubmissionIds([
                                    ...selectedSubmissionIds,
                                    s.id,
                                  ]);
                                }
                              }}
                              className={`w-5 h-5 rounded border-2 flex items-center justify-center cursor-pointer transition-colors ${
                                selectedSubmissionIds.includes(s.id)
                                  ? "bg-primary border-primary text-on-accent"
                                  : "border-ink-200 group-hover:border-primary/60 bg-card"
                              }`}
                            >
                              {selectedSubmissionIds.includes(s.id) && (
                                <Check size={14} />
                              )}
                            </div>
                          </td>
                          <td className="py-2 px-2 font-mono font-bold text-ink-500">
                            {seatLabel(s.studentId)}
                          </td>
                          <td className="py-2 px-4">
                            <div className="flex items-center gap-3">
                              <span className="font-bold text-ink-700 text-ui">
                                {s.studentName}
                              </span>
                            </div>
                          </td>
                          <td className="py-2 px-4 text-center">
                            <div className="flex justify-center">
                              {s.status === "Unsubmitted" || s.status === "Draft" ? (
                                <div
                                  className="w-3 h-3 rounded-full bg-ink-200"
                                  title="未繳交"
                                ></div>
                              ) : hasDraftFile ? (
                                <div
                                  className="w-3 h-3 rounded-full bg-success-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"
                                  title="有手寫原稿"
                                ></div>
                              ) : (
                                <div
                                  className="w-3 h-3 rounded-full bg-danger-400"
                                  title="無手寫原稿"
                                ></div>
                              )}
                            </div>
                          </td>
                          <td className="py-2 px-4">
                            <div className="flex flex-col gap-1.5">
                              {s.status === "Pending" && (
                                <span className="inline-block px-3 py-1 rounded-lg bg-warning-100 text-warning-700 text-caption border border-warning-200 shadow-sm w-fit whitespace-nowrap">
                                  待批改
                                </span>
                              )}
                              {s.status === "Graded" && (
                                <span className="inline-block px-3 py-1 rounded-lg bg-mauve-100 text-mauve-700 text-caption border border-mauve-200 shadow-sm w-fit whitespace-nowrap">
                                  已批改
                                </span>
                              )}
                              {s.status === "Published" && (
                                <span className="inline-block px-3 py-1 rounded-lg bg-success-100 text-success-700 text-caption border border-success-200 shadow-sm w-fit whitespace-nowrap">
                                  已發還
                                </span>
                              )}
                              {(s.status === "Unsubmitted" || s.status === "Draft") && (
                                <span className="inline-block px-3 py-1 rounded-lg bg-ink-100 text-ink-700 text-caption border border-ink-200 shadow-sm w-fit whitespace-nowrap">
                                  未繳交
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-2 px-4 text-ink-500 text-caption font-normal whitespace-nowrap">
                            {s.status === "Unsubmitted" || s.status === "Draft" || !s.submittedAt
                              ? "-"
                              : `${new Date(s.submittedAt).toLocaleDateString()} ${new Date(s.submittedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
                          </td>
                          {/*
                            不能蓋的列照樣把兩顆章畫出來（disabled）。
                            整格空掉會讓每一列的高度對不齊，也讓老師看不出
                            有這個功能 —— 能不能蓋一律問 canMark()，
                            不要在這裡自己比對 status。
                          */}
                          <td className="py-2 px-3 text-center">
                            <SubmissionStampRow
                              submissionId={s.id}
                              idPrefix="gradinglist-stamp"
                              canMark={canMark(s.status)}
                              isOn={(kind) => hasMark(submissionMarks, s.id, kind)}
                              onToggle={(kind) => toggleMark(s.id, kind)}
                            />
                          </td>
                          <td className="py-2 px-4 text-center">
                            {currentlyGradingId === s.id ? (
                              <div className="flex justify-center items-center h-full">
                                <Loader2
                                  size={20}
                                  className="animate-spin text-mauve-500"
                                />
                              </div>
                            ) : score ? (
                              <span
                                className={`text-title font-bold ${levelStyle(score).text} animate-in fade-in zoom-in duration-300`}
                              >
                                {score}
                              </span>
                            ) : (
                              <span className="text-ink-500 font-bold">
                                -
                              </span>
                            )}
                          </td>
                          {/*
                            操作欄固定高度並垂直置中。76 是量出來的：兩顆按鈕 35+35 加間距 4 是 74，
                            但那樣還會被別欄的 91.89px 蓋過去，未繳交列就矮了 0.9px。
                            只有一顆「尚未繳交」的列若不撐開，整張表會一列高一列矮，
                            視線往下掃的時候會一直被打斷。
                          */}
                          <td className="py-2 px-4 text-right whitespace-nowrap">
                            {s.status === "Pending" ? (
                              <div className="flex flex-col items-end justify-center gap-1 min-h-[76px]">
                                <button id="gradinglist-btn-start-grading"
                                  onClick={() => {
                                    navigate(routes.gradingEditor(s.assignmentId, s.id));
                                  }}
                                  className="w-24 px-2 py-1.5 rounded-lg text-caption whitespace-nowrap transition-all bg-primary hover:bg-primary/90 text-on-accent border border-transparent shadow-sm shadow-primary/25"
                                >
                                  開始批改
                                </button>
                                {/*
                                  清除繳交：把整筆紀錄刪掉，師生兩端都回到
                                  「這份作業還沒交過」。放在主要動作下方，
                                  用描邊而非實心 —— 它是少用的補救手段，
                                  不該和每天要按的批改鍵搶注意力。
                                */}
                                <button id={`gradinglist-btn-clear-submission-${s.id}`}
                                  onClick={() => handleClearSubmission(s)}
                                  title="刪除這份繳交內容與批改結果，讓學生重新繳交"
                                  className="w-24 px-2 py-1.5 rounded-lg text-caption whitespace-nowrap transition-all bg-card hover:bg-danger-50 text-danger-700 border border-danger-200 hover:border-danger-300"
                                >
                                  清除繳交
                                </button>
                              </div>
                            ) : (s.status === "Unsubmitted" || s.status === "Draft") ? (
                              /* 也包一層 flex，讓它跟其他列的按鈕靠同一條右邊界 */
                              <div className="flex flex-col items-end justify-center gap-1 min-h-[76px]">
                              <button id="gradinglist-btn-not-submitted"
                                disabled
                                className="w-24 px-2 py-1.5 rounded-lg text-caption whitespace-nowrap transition-all bg-ink-100 text-ink-700 border border-transparent cursor-not-allowed"
                              >
                                尚未繳交
                              </button>
                              </div>
                            ) : (
                              <div className="flex flex-col items-end justify-center gap-1 min-h-[76px]">
                                <button id="gradinglist-btn-view-graded"
                                  onClick={() => {
                                    navigate(routes.gradingEditor(s.assignmentId, s.id));
                                  }}
                                  className="w-24 px-2 py-1.5 rounded-lg text-caption whitespace-nowrap transition-all bg-card hover:bg-ink-50 text-ink-700 border border-ink-200 hover:border-ink-300 shadow-sm"
                                >
                                  檢視
                                </button>
                                {/*
                                  清除繳交：把整筆紀錄刪掉，師生兩端都回到
                                  「這份作業還沒交過」。放在主要動作下方，
                                  用描邊而非實心 —— 它是少用的補救手段，
                                  不該和每天要按的批改鍵搶注意力。
                                */}
                                <button id={`gradinglist-btn-clear-submission-${s.id}`}
                                  onClick={() => handleClearSubmission(s)}
                                  title="刪除這份繳交內容與批改結果，讓學生重新繳交"
                                  className="w-24 px-2 py-1.5 rounded-lg text-caption whitespace-nowrap transition-all bg-card hover:bg-danger-50 text-danger-700 border border-danger-200 hover:border-danger-300"
                                >
                                  清除繳交
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      }

      const activeAssignments = assignments
        .filter((a) => {
          const course = courses.find((c) => c.id === a.courseId);
          const isOverdue = isAssignmentOverdue(a);
          if (hideOverdueAssignments && isOverdue) return false;
          return course?.semester === currentSemester && a.status !== "Draft";
        })
        .map((a) => {
          const pendingCount = submissions.filter(
            (s) => s.assignmentId === a.id && s.status === "Pending",
          ).length;
          const gradedCount = submissions.filter(
            (s) => s.assignmentId === a.id && s.status === "Graded",
          ).length;
          const publishedCount = submissions.filter(
            (s) => s.assignmentId === a.id && s.status === "Published",
          ).length;
          const course = courses.find((c) => c.id === a.courseId);
          const isOverdue = isAssignmentOverdue(a);

          return {
            ...a,
            courseName: course?.name,
            pendingCount,
            gradedCount,
            publishedCount,
            totalCount: pendingCount + gradedCount + publishedCount,
            isOverdue,
          };
        })
        // Sort: Has pending -> Overdue -> Date
        .sort((a, b) => {
          if (a.pendingCount > 0 && b.pendingCount === 0) return -1;
          if (a.pendingCount === 0 && b.pendingCount > 0) return 1;
          return (
            new Date(b.createdAt || "").getTime() -
            new Date(a.createdAt || "").getTime()
          );
        });

      return (
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="flex items-center gap-3 md:gap-4 mb-4 md:mb-6">
            <button id="grading-btn-back"
              onClick={goBack}
              className="p-2 -ml-2 rounded-full hover:bg-card/50 text-text-secondary transition-colors"
            >
              <ArrowLeft size={24} />
            </button>
            <div>
              <h2 className="text-display font-bold text-text-primary tracking-tight">
                批改作業
              </h2>
              <p className="text-text-secondary font-normal text-ui">選擇一份作業開始批改</p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button id="grading-btn-hide-overdue"
                onClick={() =>
                  setHideOverdueAssignments(!hideOverdueAssignments)
                }
                className={`flex items-center gap-2 px-3 md:px-4 py-1.5 md:py-2 rounded-xl text-body font-bold transition-all ${
                  hideOverdueAssignments
                    ? "bg-primary text-on-accent shadow-md"
                    : "bg-card text-text-secondary border border-border hover:bg-surface-soft"
                }`}
              >
                {hideOverdueAssignments ? (
                  <CheckCircle size={14} className="text-accent md:size-[16px]" />
                ) : (
                  <Clock size={14} className="md:size-[16px]" />
                )}
                {hideOverdueAssignments ? "已隱藏截止" : "隱藏截止"}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {activeAssignments.map((assignment) => (
              <div
                key={assignment.id}
                onClick={() => {
                  // 「回到這一頁時應該落在作業牆，而不是某一份作業」——
                  // 先前要手動 push 一筆 viewHistory 才做得到。
                  // 現在作業牆就是 /grading，選定某份是 /grading?assignment=…，
                  // 返回鍵自然會退回作業牆，不需要任何額外處理。
                  navigate(routes.gradingList({ assignmentId: assignment.id }));
                }}
                className={`relative bg-card p-4 rounded-xl border transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg cursor-pointer group flex flex-col h-full ${
                  assignment.isOverdue
                    ? "border-danger-200 shadow-card"
                    : "border-border shadow-card hover:border-primary/30"
                }`}
              >
                {/* Overdue Badge */}
                {assignment.isOverdue && (
                  <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-danger-600 text-on-accent text-caption px-2.5 py-0.5 rounded-full shadow-sm flex items-center gap-1 z-10">
                    <AlertTriangle size={12} /> 已過截止
                  </div>
                )}

                <div className="flex justify-between items-start gap-2 mb-2.5">
                  {/*
                    課程名稱可壓縮並截斷。原本它和右邊的徽章都是 whitespace-nowrap，
                    名稱一長就把徽章往外推 —— 實測「桃園市東門國小彈性學習：閱讀與寫作」
                    在 375px 把徽章推到螢幕外 11px。要讓步的是描述文字，不是狀態徽章。
                  */}
                  <span
                    title={assignment.courseName}
                    className="min-w-0 truncate bg-surface-soft text-text-secondary text-caption px-2.5 py-1 rounded-md border border-border"
                  >
                    {assignment.courseName}
                  </span>
                  {/*
                    手機不顯示：下方統計列本來就有「待批改: N」，這裡是重複資訊，
                    而窄卡片上它正是把版面擠爆的那一個。
                  */}
                  {assignment.pendingCount > 0 && (
                    <span className="hidden sm:flex shrink-0 bg-secondary/10 text-secondary text-caption px-2.5 py-1 rounded-full border border-secondary/20 items-center gap-1 whitespace-nowrap">
                      <div className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse"></div>
                      {assignment.pendingCount} 份待批改
                    </span>
                  )}
                </div>

                <h3 className="text-title font-bold text-text-primary mb-3 leading-snug group-hover:text-primary transition-colors">
                  {assignment.title}
                </h3>

                <div className="space-y-1 mb-3 mt-auto">
                  <div className="flex items-center gap-1.5 text-caption text-text-secondary font-normal">
                    <SendHorizontal size={14} className="text-text-muted" />
                    <span>派發時間：</span>
                    <span className="font-mono text-text-primary/80">
                      {new Date(
                        assignment.createdAt || "",
                      ).toLocaleDateString()}{" "}
                      {new Date(assignment.createdAt || "").toLocaleTimeString(
                        [],
                        { hour: "2-digit", minute: "2-digit" },
                      )}
                    </span>
                  </div>
                  <div
                    className={`flex items-center gap-1.5 text-caption font-normal ${assignment.isOverdue ? "text-danger-600" : "text-text-secondary"}`}
                  >
                    <Clock
                      size={14}
                      className={
                        assignment.isOverdue ? "text-danger-600" : "text-text-muted"
                      }
                    />
                    <span>截止時間：</span>
                    <span className="font-mono">
                      {/* 沒設截止日時顯示「無截止日」，不要印出 Invalid Date */}
                      {hasDeadline(assignment)
                        ? deadlineLabel(assignment, { withTime: true })
                        : deadlineLabel(assignment)}
                    </span>
                  </div>
                </div>

                <div className="pt-3 border-t border-border">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-baseline gap-1 text-caption text-text-secondary">
                      <span>
                        總計: {assignment.totalCount}/{assignment.totalStudents}
                      </span>
                    </div>
                    <div
                      className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center transition-colors ${assignment.pendingCount > 0 ? "bg-secondary/10 text-secondary group-hover:bg-secondary group-hover:text-on-accent" : "bg-surface-soft text-text-secondary group-hover:bg-primary group-hover:text-on-accent"}`}
                    >
                      <ArrowRight size={16} />
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-caption px-2 py-0.5 rounded bg-secondary/10 text-secondary whitespace-nowrap">
                      待批改: {assignment.pendingCount}
                    </span>
                    <span className="text-caption px-2 py-0.5 rounded bg-primary/10 text-primary whitespace-nowrap">
                      已批改: {assignment.gradedCount}
                    </span>
                    <span className="text-caption px-2 py-0.5 rounded bg-accent/10 text-accent whitespace-nowrap">
                      已發還: {assignment.publishedCount}
                    </span>
                    <span className="text-caption px-2 py-0.5 rounded bg-surface-soft text-text-secondary whitespace-nowrap">
                      未繳交: {assignment.totalStudents - assignment.totalCount}
                    </span>
                  </div>
                </div>
              </div>
            ))}

            {activeAssignments.length === 0 && (
              <div className="col-span-full py-20 text-center text-ink-400 bg-card/40 rounded-xl border border-dashed border-ink-300">
                <CheckSquare size={48} className="mx-auto mb-3 opacity-30" />
                <p className="font-normal">目前沒有進行中的作業</p>
              </div>
            )}
          </div>
        </div>
      );
};
