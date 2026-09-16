import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  MOCK_QUESTIONS,
  MOCK_FOLDERS,
  MOCK_COURSES,
  MOCK_ASSIGNMENTS,
  MOCK_SUBMISSIONS,
  COURSE_ROSTERS,
  CURRENT_SEMESTER,
  } from "../mockData";

import {
  Submission,
  GradingResult,
  Assignment,
  Course,
  Question,
  Folder,
  UserRole,
  SchoolCourse,
} from "../types";
import { gradeEssayWithAI } from "../services/geminiService";
import { DEMO_STUDENT, STUDENT_ID, DEMO_TEACHER, newId } from "../lib/constants";
import { visibleCourses, type CurrentUser } from "../lib/access";
import { type LeaveMarks } from "../lib/leave";
import {
  setMark,
  dropMarks,
  hasMark,
  type MarkKind,
  type SubmissionMarks,
} from "../lib/submissionMarks";
import { parseCourseName } from "../lib/schoolName";
import { usePersistentState, useResetDemo } from "../lib/usePersistentState";
import { swapQuestion } from "../lib/assignments";
import { nextOrderFor } from "../lib/assignmentOrder";
import { routes, type SemesterFilter } from "../lib/routes";
import { ApiError } from "../api/client";
import {
  fetchSession, switchIdentity, toUserRole,
  type IdentityType, type Session,
} from "../api/auth";
import { AppStateContext } from "./appStateContext";

/**
 * 全站的資料與操作。
 *
 * 這裡放的東西，Phase 4 接上後端時會整批換成 API 呼叫 ——
 * **這個檔案就是那道接縫**。元件只透過 useAppState() 拿資料，
 * 不知道資料是從 localStorage 還是從伺服器來的，所以換掉時畫面不用動。
 *
 * 型別刻意用 ReturnType 推導而不是手寫介面：七十幾個欄位的介面
 * 一定會跟實作漂移，而漂移了編譯器不會說話。
 */
function useAppStateValue() {
  const navigate = useNavigate();
  /**
   * 登入狀態。
   *
   * Phase 4 的第一刀：身分不再是前端的假切換，而是後端 session 的實際內容。
   * `loading` 期間不要 render 畫面 —— 用「預設是老師」頂著會讓學生
   * 先看到一閃而過的教師介面。
   */
  const [session, setSession] = useState<Session | null>(null);
  const [sessionStatus, setSessionStatus] = useState<'loading' | 'ready' | 'anonymous'>('loading');

  useEffect(() => {
    let cancelled = false;
    fetchSession()
      .then((s) => { if (!cancelled) { setSession(s); setSessionStatus('ready'); } })
      .catch((e) => {
        if (cancelled) return;
        // 401 是「還沒登入」，不是錯誤。其他狀況（後端沒起來、網路斷了）
        // 也先當作未登入處理 —— 畫面至少給得出一個可以點的登入按鈕，
        // 比停在無限轉圈好。
        if (!(e instanceof ApiError) || !e.isUnauthenticated) {
          console.error('取得登入狀態失敗:', e);
        }
        setSessionStatus('anonymous');
      });
    return () => { cancelled = true; };
  }, []);

  /** 前端角色由後端的「目前身分」推導，不是獨立的一份狀態 */
  const userRole = toUserRole(session?.activeIdentity ?? null);

  /**
   * 切換身分。
   *
   * 後端會驗這個人是不是真的擁有它 —— 前端這裡不做判斷，
   * 拿回來的結果才是真的（切換失敗時 session 不會變）。
   */
  const switchIdentityTo = async (type: IdentityType) => {
    const active = await switchIdentity(type);
    setSession((prev) => (prev ? { ...prev, activeIdentity: active } : prev));
    return toUserRole(active);
  };

  /**
   * 目前的使用者。可視範圍一律走 lib/access.ts 的 visibleCourses()，
   * 不要在各個畫面自己判斷身分 —— 漏掉一個畫面就是把別人的班級露出去。
   */
  const currentUser: CurrentUser = {
    role: userRole,
    // ⚠️ 課程歸屬目前仍用姓名比對（lib/access.ts 自己也註明這是原型作法）。
    //    伺服器端已經用 user.id 過濾，這裡只影響畫面。
    name: session?.name ?? (userRole === UserRole.STUDENT ? DEMO_STUDENT.name : DEMO_TEACHER.name),
  };
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const resetDemo = useResetDemo();

  /**
   * 主題：宣紙（淺）／碑拓（深）。
   * 初值先看使用者上次的選擇，沒有就跟隨系統設定。
   * 用 useState 的初始化函式讀取，避免每次 render 都碰 localStorage。
   */
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem('theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {
      // 隱私模式或封鎖 site data 時會丟例外，忽略即可
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  /**
   * 換主題。
   *
   * class 必須在 setState **之前**就掛上去 —— 圖表（GradeManagement 的
   * readChartInk）是在 render 當下用 getComputedStyle 讀色票的，
   * 如果只靠下面那個 useEffect，切換後的第一次 render 讀到的還是舊主題，
   * 座標軸與長條會停在前一個顏色，直到下次不相干的重繪才跟上。
   */
  const applyTheme = (next: 'light' | 'dark') => {
    document.documentElement.classList.toggle('dark', next === 'dark');
    setTheme(next);
  };

  // 初次掛載與持久化仍交給 effect
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem('theme', theme);
    } catch {
      // 存不進去就算了，主題本身還是會生效
    }
  }, [theme]);
  const studentName = DEMO_STUDENT.name;
  const studentCourseId = DEMO_STUDENT.courseId;
  const [currentSemester, setCurrentSemester] = useState(CURRENT_SEMESTER);
  const [courses, setCourses] = usePersistentState<Course[]>("courses", MOCK_COURSES);
  const [questions, setQuestions] = usePersistentState<Question[]>("questions", MOCK_QUESTIONS);
  /**
   * 題庫資料夾。原本收在 QuestionBank 的 useState 裡，離開題庫中心
   * 元件就被卸載，新增或刪除的資料夾會整個復原 —— 看起來像沒存到。
   */
  const [folders, setFolders] = usePersistentState<Folder[]>("folders", MOCK_FOLDERS);
  const [rosters, setRosters] = usePersistentState<Record<string, { seatNo: number; name: string }[]>>("rosters", COURSE_ROSTERS);

  const handleSyncCourses = (selected: SchoolCourse[]) => {
    const newCourses: Course[] = selected.map((sc) => {
      // 校務系統只給一整串課程名稱。在這裡解析一次、把結果存起來，
      // 之後所有畫面讀存好的欄位，不再碰字串。原始字串保留在 name。
      const parsed = parseCourseName(sc.name);
      return {
        id: sc.id,
        code: sc.code,
        name: sc.name,
        semester: sc.semester,
        studentCount: sc.studentCount,
        aiModels: ["教育會考國寫輔助AI", "中階英文作文輔助AI"], // Default models
        teacherName: sc.teacherName,
        city: parsed.city ?? undefined,
        schoolName: parsed.schoolName ?? undefined,
        schoolLevel: parsed.schoolLevel ?? undefined,
        className: parsed.className ?? undefined,
        parseConfidence: parsed.confidence,
      };
    });

    const newRosters: Record<string, { seatNo: number; name: string }[]> = {};
    selected.forEach((sc) => {
      newRosters[sc.id] = sc.roster.map((name, index) => ({
        seatNo: index + 1,
        name,
      }));
    });

    setCourses((prev) => [...prev, ...newCourses]);
    setRosters((prev) => ({ ...prev, ...newRosters }));
  };
  /**
   * 永久刪除一個課程。
   *
   * 連同名單、該課程的作業與所有繳交紀錄一起刪 —— 只刪課程的話，
   * 作業與作文會變成指向不存在課程的孤兒資料，之後統計與關心名單
   * 都會把它們算進去。
   */
  const handleDeleteCourse = (courseId: string) => {
    const doomed = new Set(
      assignments.filter((a) => a.courseId === courseId).map((a) => a.id),
    );
    setSubmissions((prev) => prev.filter((s) => !doomed.has(s.assignmentId)));
    setAssignments((prev) => prev.filter((a) => a.courseId !== courseId));
    setRosters((prev) => {
      const next = { ...prev };
      delete next[courseId];
      return next;
    });
    setCourses((prev) => prev.filter((c) => c.id !== courseId));
  };

  /** 這個身分看得到的課程。所有教師端畫面都要用這一份，不要直接吃 courses */
  const myCourses = visibleCourses(courses, currentUser);

  const [assignments, setAssignments] = usePersistentState<Assignment[]>("assignments", MOCK_ASSIGNMENTS);
  /**
   * 請假註記（作業 × 學生）。逾期未繳分成真的沒寫和請假兩種，
   * 只有老師知道差別 —— 見 lib/leave.ts。
   */
  const [leaveMarks, setLeaveMarks] = usePersistentState<LeaveMarks>("leave", {});
  /**
   * 作品標記：佳作與預選（鍵是 submission.id）。取用的地方還沒決定，
   * 這裡只負責記住哪些作品被蓋了什麼章。見 lib/submissionMarks.ts
   */
  const [submissionMarks, setSubmissionMarks] = usePersistentState<SubmissionMarks>("marks", {});
  const [submissions, setSubmissions] =
    usePersistentState<Submission[]>("submissions", MOCK_SUBMISSIONS);

  /**
   * 作業的新增／修改／刪除。
   *
   * 派發精靈的 handlePublish 早就用這個契約在呼叫，
   * 但 App 端一直傳空函式，所以老師按「發布」會跳出成功訊息、資料卻被丟掉。
   * 這裡把它接起來。
   *
   * 一次處理三種操作是刻意的：編輯一組作業時可能同時
   * 新增班級（create）、改截止日（update）、取消某些班（delete），
   * 分開呼叫會產生中間狀態。
   */
  const handleAssignmentOperation = (
    creates: Assignment[],
    updates: Assignment[],
    deleteIds: string[],
  ) => {
    setAssignments((prev) => {
      const updateMap = new Map(updates.map((a) => [a.id, a]));
      const kept = prev
        .filter((a) => !deleteIds.includes(a.id))
        .map((a) => updateMap.get(a.id) ?? a);

      /*
        新作業一律接在該班級的最後面。

        order 是選填的，不給也還是排在最後（見 lib/assignmentOrder.ts），
        但那是「碰巧」排在最後 —— 老師拖過一次之後所有作業都會有 order，
        沒有 order 的新作業就會和已排好的混在一起。在唯一的建立入口
        直接補上，不管是誰呼叫的都不會漏。
        一次派多份時要逐一遞增，否則同一批全部拿到同一個號碼。
      */
      const nextOrder: Record<string, number> = {};
      const seeded = creates.map((a) => {
        if (a.order != null) return a;
        if (nextOrder[a.courseId] == null) {
          nextOrder[a.courseId] = nextOrderFor(kept, a.courseId);
        }
        return { ...a, order: nextOrder[a.courseId]++ };
      });

      return [...kept, ...seeded];
    });

    // 作業被刪除時，它底下的繳交紀錄也要一併清掉，否則會變成孤兒資料
    if (deleteIds.length) {
      // 標記指向 submission.id，作品沒了標記也要走，不然會變成孤兒。
      // 先從目前的 submissions 算出要清哪些，不要在 setSubmissions 的
      // updater 裡再呼叫 setState —— updater 必須是純函式
      const doomedIds = submissions
        .filter((sub) => deleteIds.includes(sub.assignmentId))
        .map((sub) => sub.id);
      setSubmissionMarks((marks) => dropMarks(marks, doomedIds));
      setSubmissions((prev) =>
        prev.filter((sub) => !deleteIds.includes(sub.assignmentId)),
      );
    }
  };
  /**
   * 蓋章／取消。清單與個人批改頁共用同一支 ——
   * 兩邊各寫一次 setSubmissionMarks 就是下一個不同步的來源。
   *
   * 標記**立即生效**，不進「存檔／已存檔」的未存判斷：
   * 章不是 GradingResult 的一部分，混進去只會讓老師分不清
   * 那顆存檔鍵在管什麼。
   */
  const toggleMark = (submissionId: string, kind: MarkKind) =>
    setSubmissionMarks((prev) =>
      setMark(prev, submissionId, kind, !hasMark(prev, submissionId, kind)),
    );

  const [selectedSubmissionIds, setSelectedSubmissionIds] = useState<string[]>(
    [],
  );
  const [isBatchGrading, setIsBatchGrading] = useState(false);
  const [batchGradingProgress, setBatchGradingProgress] = useState({
    current: 0,
    total: 0,
  });
  const [currentlyGradingId, setCurrentlyGradingId] = useState<string | null>(
    null,
  );
  const [isGradedStatsOpen, setIsGradedStatsOpen] = useState(false);
  const [semesterFilter, setSemesterFilter] = useState<SemesterFilter>("ALL");
  const [hideOverdueAssignments, setHideOverdueAssignments] = useState(false);
  const [selectedAiModel, setSelectedAiModel] = useState<string | null>(null);
  /** 代繳交視窗是否開著 */
  const [isProxySubmitOpen, setIsProxySubmitOpen] = useState(false);
  /**
   * 重置批改的世代編號。只有重置需要把 GradingEditor 整個重掛
   * （它把批改結果收在自己的 state 裡）。存檔不必 —— 存檔如果也重掛，
   * 老師收起來的原文欄會被還原，等於存一次版面跳一次。
   */
  const [gradingResetSeq, setGradingResetSeq] = useState(0);
 
  const handleSubmitEssay = async (assignmentId: string, content: string) => {
    // Simulate uploading delay
    await new Promise(resolve => setTimeout(resolve, 1500));

    const submittedAt = new Date().toISOString();
    // 同一位學生對同一份作業只該有一筆繳交紀錄，再次繳交時就地更新，
    // 不要再 prepend 一筆 —— 否則老師的批改清單會出現同一位學生的重複列。
    const existing = submissions.find(
      (s) => s.assignmentId === assignmentId && s.studentId === STUDENT_ID,
    );
    const submissionId = existing?.id ?? newId('sub-new');

    setSubmissions((prev) => {
      const exists = prev.some((s) => s.id === submissionId);
      if (!exists) {
        const created: Submission = {
          id: submissionId,
          assignmentId,
          studentId: STUDENT_ID,
          studentName,
          submittedAt,
          status: "Pending",
          content,
        };
        return [created, ...prev];
      }

      return prev.map((s) =>
        s.id === submissionId
          ? {
              ...s,
              content,
              submittedAt,
              status: "Pending" as const,
              result: undefined,
            }
          : s,
      );
    });

    // Simulate AI grading in background
    setTimeout(async () => {
      try {
        const assignment = assignments.find((a) => a.id === assignmentId);
        const question = questions.find(
          (q) => q.id === assignment?.questionId,
        );
        const result = await gradeEssayWithAI(
          content,
          question?.content || "",
          question?.gradingCriteria || "",
        );

        setSubmissions((prev) =>
          prev.map((s) =>
            s.id === submissionId
              ? {
                  ...s,
                  /*
                    批改完停在「已批改」，**不自動發還**。
                    這裡原本寫死 status: "Published"（註解是 Auto publish for
                    student view demo），等於學生交出去兩秒後就被自動批改並發還，
                    和批次批改、單篇批改的規則相反 —— 發還一律由老師決定。
                  */
                  status: "Graded" as const,
                  result: {
                    totalScore: result.totalScore,
                    categoryScores: result.categoryScores,
                    /*
                      AI 回傳的欄位叫 feedback，GradingResult 要的是 aiFeedback。
                      原本直接 ...result 展開，於是這條路徑存出來的批改結果
                      **沒有 AI 評語**（其他地方都有正確對應）。
                    */
                    aiFeedback: result.feedback,
                    suggestions: result.suggestions,
                    teacherFeedback: "",
                    isPublished: false,
                  },
                }
              : s,
          ),
        );
      } catch (e) {
        console.error("Background AI grading failed", e);
      }
    }, 2000);
  };
  const handleSaveGrading = (id: string, result: GradingResult, shouldNavigateBack: boolean = true) => {
    const status = result.isPublished ? "Published" : "Graded";

    setSubmissions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, result, status } : s)),
    );

    // 先前這裡要手動把 selectedSubmission 這份快照一起更新，否則畫面上的
    // 狀態還停在「待批改」。現在批改頁是**從網址的 submissionId 去
    // submissions 裡現查**的，submissions 一變畫面就跟著變 ——
    // 那個同步問題連同那份快照一起消失了。

    if (shouldNavigateBack) {
      // 先前是「手刻的 viewHistory 有東西就 pop，否則回批改清單」。
      // 現在交給瀏覽器的上一頁；直接把批改頁網址貼進來時沒有上一頁可退，
      // navigate(-1) 會留在原地，所以退回清單當作保底。
      if (window.history.state?.idx > 0) navigate(-1);
      else navigate(routes.gradingList());
    }
  };

  const handleBatchGrade = async (selectedAssignmentId: string) => {

    const assignment = assignments.find((a) => a.id === selectedAssignmentId);
    const topic = assignment
      ? assignment.title
      : "Write about a memorable experience";

    const filteredSubmissions = submissions.filter(
      (s) => s.assignmentId === selectedAssignmentId,
    );

    let targets = filteredSubmissions.filter(
      (s) => s.status === "Pending",
    );
    if (selectedSubmissionIds.length > 0) {
      targets = filteredSubmissions.filter(
        (s) =>
          selectedSubmissionIds.includes(s.id) &&
          s.status === "Pending",
      );
    }

    if (targets.length === 0) {
      alert("沒有需要批改的作業");
      return;
    }

    setIsBatchGrading(true);
    setBatchGradingProgress({ current: 0, total: targets.length });

    const newSubmissions = [...submissions];

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      setCurrentlyGradingId(target.id);
      try {
        const aiResponse = await gradeEssayWithAI(
          target.content,
          topic,
          "Standard high school essay criteria",
          selectedAiModel || "預設批改模型",
        );
        const newResult: GradingResult = {
          totalScore: aiResponse.totalScore,
          categoryScores: aiResponse.categoryScores,
          aiFeedback: aiResponse.feedback,
          teacherFeedback: "",
          suggestions: aiResponse.suggestions,
          isPublished: false,
        };

        const index = newSubmissions.findIndex((s) => s.id === target.id);
        if (index !== -1) {
          newSubmissions[index] = {
            ...newSubmissions[index],
            result: newResult,
            status: "Graded",
          };
        }
      } catch (err) {
        console.error(`Failed to grade submission ${target.id}`, err);
      }
      setBatchGradingProgress({ current: i + 1, total: targets.length });
      setSubmissions([...newSubmissions]); // Update state to show progress
    }

    setCurrentlyGradingId(null);
    setSelectedSubmissionIds([]);
    setIsBatchGrading(false);
  };

  const handleBatchPublish = (selectedAssignmentId: string) => {

    const filteredSubmissions = submissions.filter(
      (s) => s.assignmentId === selectedAssignmentId,
    );

    let targets = [];
    if (selectedSubmissionIds.length > 0) {
      targets = filteredSubmissions.filter(
        (s) => selectedSubmissionIds.includes(s.id) && s.status === "Graded",
      );
    } else {
      targets = filteredSubmissions.filter((s) => s.status === "Graded");
    }

    if (targets.length === 0) {
      alert("沒有需要發還的作業");
      return;
    }

    const newSubmissions = submissions.map((s) => {
      if (targets.find((t) => t.id === s.id)) {
        return {
          ...s,
          // as const：不加的話 status 會被推論成 string，對不上 SubmissionStatus
          status: "Published" as const,
          result: s.result ? { ...s.result, isPublished: true } : undefined,
        };
      }
      return s;
    });

    setSubmissions(newSubmissions);
    setSelectedSubmissionIds([]);
  };

  /**
   * 代繳交：老師替學生登錄紙本作文。
   *
   * 不能沿用 handleSubmitEssay —— 那一支寫死示範學生的 STUDENT_ID，
   * 而且 1.5 秒後會自動送 AI 批改。代繳交要記在**指定的**學生名下，
   * 而且停在「待批改」，讓老師自己決定何時按「批次批改」。
   */
  const handleProxySubmit = (selectedAssignmentId: string, studentId: string,
    studentName: string,
    content: string,) => {
    const submittedAt = new Date().toISOString();

    setSubmissions((prev) => {
      const existing = prev.find(
        (x) =>
          x.assignmentId === selectedAssignmentId && x.studentId === studentId,
      );
      // 學生留了草稿的話就地覆蓋，不要多長一筆出來
      if (existing) {
        return prev.map((x) =>
          x.id === existing.id
            ? {
                ...x,
                content,
                submittedAt,
                status: "Pending" as const,
                result: undefined,
              }
            : x,
        );
      }
      const created: Submission = {
        id: newId("sub-proxy"),
        assignmentId: selectedAssignmentId,
        studentId,
        studentName,
        content,
        submittedAt,
        status: "Pending",
      };
      return [created, ...prev];
    });
  };

  const handleBatchReset = (selectedAssignmentId: string) => {

    const filteredSubmissions = submissions.filter(
      (s) => s.assignmentId === selectedAssignmentId,
    );

    // 一定要先勾選 —— 與按鈕的啟動條件一致。
    // 這一步會清掉分數與評語，不該有「沒選就整批重置」的預設行為。
    if (selectedSubmissionIds.length === 0) {
      alert("請先勾選要重置的作業（僅限「已批改」、尚未發還的）。");
      return;
    }

    const targets = filteredSubmissions.filter(
      (s) => selectedSubmissionIds.includes(s.id) && s.status === "Graded",
    );

    if (targets.length === 0) {
      alert("勾選的項目裡沒有「已批改」的作業。已發還或待批改的無法重置。");
      return;
    }

    if (!window.confirm(`確定要重置這 ${targets.length} 份作業的批改嗎？批改結果會被清除，作業回到「待批改」。`)) return;

    const newSubmissions = submissions.map((s) => {
      if (targets.find((t) => t.id === s.id)) {
        return {
          ...s,
          status: "Pending" as const,
          result: undefined,
        };
      }
      return s;
    });

    setSubmissions(newSubmissions);
    setSelectedSubmissionIds([]);
  };

  const handleResetGrading = (id: string) => {
    const sub = submissions.find((s) => s.id === id);
    if (!sub) return;

    const targetStatus = "Pending" as const;

    setSubmissions((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, status: targetStatus, result: undefined } : s,
      ),
    );

    setGradingResetSeq((n) => n + 1);
  };

  /**
   * 清除繳交：把這一筆繳交紀錄整筆刪掉。
   *
   * 不是清空內容、也不是改狀態，而是**移除整筆** —— 批改清單與學生端
   * 都是「找不到紀錄就當作未繳交」（見 lib/gradingQueue.ts 的
   * assignmentRoster 與 StudentAssignments 的 `submission?.status || 'Unsubmitted'`），
   * 所以刪掉之後兩邊自動回到一份全新作業的樣子，學生可以重新繳交。
   *
   * 不可復原，一定要先確認。
   */
  const handleClearSubmission = (submission: Submission) => {
    setConfirmDialog({
      isOpen: true,
      title: "清除繳交內容",
      message:
        `確定要清除 ${submission.studentName} 這一份的繳交內容嗎？\n\n` +
        "作文內容、分數與評語都會被刪除，學生端也會一併清空，" +
        "這份作業會回到「未繳交」，學生可以重新繳交。\n\n" +
        "此操作無法復原。",
      onConfirm: () => {
        // 這篇被清掉了，它的佳作／預選標記也不該留著
        setSubmissionMarks((marks) => dropMarks(marks, [submission.id]));
        setSubmissions((prev) => prev.filter((x) => x.id !== submission.id));
        setSelectedSubmissionIds((prev) =>
          prev.filter((id) => id !== submission.id),
        );
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
      },
    });
  };

  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({ isOpen: false, title: "", message: "", onConfirm: () => {} });

  /** 正在等待更換題目的作業。非 null 時開啟題庫選擇器 */
  const [swappingAssignment, setSwappingAssignment] = useState<Assignment | null>(null);

  /** 從課程工作台按「派發新作業」進來時為 true，直接跳到派發流程並預選該班 */
  const [publishFlowCourseId, setPublishFlowCourseId] = useState<string | null>(null);

  /**
   * 更換作業的題目。
   *
   * 只在作業已關閉時開放（canSwapQuestion 會擋）。舊的繳交紀錄一律清除 ——
   * 那些作文是照舊題目寫的，留著會被掛到新題目底下，包括已批改的。
   * 這是不可逆的，所以走二次確認並明確說出會刪幾筆。
   */
  const handleSwapQuestion = (assignment: Assignment, question: Question) => {
    const affected = submissions.filter(
      (sub) => sub.assignmentId === assignment.id,
    ).length;

    setConfirmDialog({
      isOpen: true,
      title: "更換題目",
      message:
        `將「${assignment.title}」換成「${question.title}」。` +
        (affected > 0
          ? `\n\n這個班已經有 ${affected} 筆繳交紀錄（含已批改的），換題後會全部刪除，無法復原。`
          : "\n\n目前沒有繳交紀錄。"),
      onConfirm: () => {
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        handleAssignmentOperation(
          [],
          [swapQuestion(assignment, question.id, question.title)],
          [],
        );
        // 換題等於整份作業重來，該作業的標記一併清掉
        const doomedIds = submissions
          .filter((sub) => sub.assignmentId === assignment.id)
          .map((sub) => sub.id);
        setSubmissionMarks((marks) => dropMarks(marks, doomedIds));
        setSubmissions((prev) =>
          prev.filter((sub) => sub.assignmentId !== assignment.id),
        );
        setSwappingAssignment(null);
      },
    });
  };


  return {
    applyTheme,
    session,
    sessionStatus,
    userRole,
    switchIdentityTo,
    currentUser,
    isSettingsOpen,
    setIsSettingsOpen,
    resetDemo,
    theme,
    setTheme,
    studentName,
    studentCourseId,
    currentSemester,
    setCurrentSemester,
    courses,
    setCourses,
    questions,
    setQuestions,
    folders,
    setFolders,
    rosters,
    setRosters,
    handleSyncCourses,
    handleDeleteCourse,
    myCourses,
    assignments,
    setAssignments,
    leaveMarks,
    setLeaveMarks,
    submissionMarks,
    setSubmissionMarks,
    submissions,
    setSubmissions,
    handleAssignmentOperation,
    toggleMark,
    selectedSubmissionIds,
    setSelectedSubmissionIds,
    isBatchGrading,
    setIsBatchGrading,
    batchGradingProgress,
    setBatchGradingProgress,
    currentlyGradingId,
    setCurrentlyGradingId,
    isGradedStatsOpen,
    setIsGradedStatsOpen,
    semesterFilter,
    setSemesterFilter,
    hideOverdueAssignments,
    setHideOverdueAssignments,
    selectedAiModel,
    setSelectedAiModel,
    isProxySubmitOpen,
    setIsProxySubmitOpen,
    gradingResetSeq,
    setGradingResetSeq,
    handleSubmitEssay,
    handleSaveGrading,
    handleBatchGrade,
    handleBatchPublish,
    handleProxySubmit,
    handleBatchReset,
    handleResetGrading,
    handleClearSubmission,
    confirmDialog,
    setConfirmDialog,
    swappingAssignment,
    setSwappingAssignment,
    publishFlowCourseId,
    setPublishFlowCourseId,
    handleSwapQuestion,
  };
}

export type AppState = ReturnType<typeof useAppStateValue>;

export const AppStateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AppStateContext.Provider value={useAppStateValue()}>{children}</AppStateContext.Provider>
);
