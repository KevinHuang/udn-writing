import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  CURRENT_SEMESTER,
  } from "../mockData";

import {
  QuestionType,
  Submission,
  GradingResult,
  Assignment,
  Course,
  Question,
  Folder,
  UserRole,
  SchoolCourse,
} from "../types";
import { DEMO_STUDENT, DEMO_TEACHER } from "../lib/constants";
import { type CurrentUser } from "../lib/access";
import { type LeaveMarks, setLeave as setLeaveLocal } from "../lib/leave";
import {
  setMark,
  dropMarks,
  hasMark,
  type MarkKind,
  type SubmissionMarks,
} from "../lib/submissionMarks";
import { parseCourseName } from "../lib/schoolName";
import { useResetDemo } from "../lib/usePersistentState";
import { orderedAssignments } from "../lib/assignmentOrder";
import { routes, type SemesterFilter } from "../lib/routes";
import {
  fetchSubmissionSummary, fetchSubmissionsByAssignment, fetchMarks, fetchLeaves,
  saveGrading, resetGrading, returnFeedback, gradeWithAi,
  clearSubmission, proxySubmit, submitEssay, setMark as setMarkApi, setLeave as setLeaveApi,
} from "../api/submissions";
import { ApiError } from "../api/client";
import { fetchSemesters } from "../api/semesters";
import { fetchCourses, fetchRoster, deleteCourse, setCourseArchived } from "../api/courses";
import { fetchStudentData, type StudentData } from "../api/student";
import {
  fetchAssignments, createAssignment, setAssignmentOpened, updateAssignmentConfig,
  swapAssignmentQuestion, reorderAssignments, deleteAssignment,
} from "../api/assignments";
import {
  fetchQuestions, createQuestion, updateQuestion, deleteQuestion, setQuestionArchived,
} from "../api/questions";
import {
  fetchFolders, createFolder, renameFolder, deleteFolder,
} from "../api/folders";
import { useApiList } from "./useApiList";
import type { Semester } from "../lib/semester";
import {
  fetchSession, switchIdentity, toUserRole, logout,
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
   * **載哪一組資料，由目前身分決定。**
   *
   * 以前不分身分，一律載教師端那七支 —— 學生登入之後每一支都 403，
   * console 一整片紅字，而且學生端的四個畫面本來就從這些陣列讀資料，
   * 所以全部是空的。學生端等於沒有資料來源（實際登入測出來的）。
   *
   * 教師端的資料量大（作業、繳交摘要、題庫、名冊），學生端只有一支
   * `my_assignments`，兩邊沒有交集，所以是「二選一」不是「都載」。
   */
  const isStudentRole = userRole === UserRole.STUDENT;
  const teacherDataReady = sessionStatus === 'ready' && !isStudentRole;
  const studentDataReady = sessionStatus === 'ready' && isStudentRole;

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
   * 登出。
   *
   * ⚠️ 兩顆「登出系統」按鈕（教師端的 Navigation、學生端的 StudentPortal）
   *    以前**都沒有 onClick** —— api/auth.ts 的 logout() 寫好了卻沒有人呼叫，
   *    按下去完全沒有反應。與那顆什麼都沒存的「儲存草稿」是同一類問題。
   *
   * 後端清掉 session 之後，這裡把前端狀態也退回匿名，SessionGate 就會
   * 顯示登入頁（見 App.tsx）。**即使後端那一步失敗也要退**：使用者按了登出
   * 卻留在原畫面，會以為自己還登著。
   */
  const handleLogout = async () => {
    try {
      await logout();
    } catch (e) {
      console.error('登出失敗:', e);
    } finally {
      setSession(null);
      setSessionStatus('anonymous');
    }
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
    /*
      **預設淺色（宣紙），不跟隨系統偏好。**

      以前是 `matchMedia('(prefers-color-scheme: dark)')` —— 把作業系統設成
      深色的老師一登入就掉進碑拓模式，而那是個刻意做得很重的主題。
      第一次看到的畫面應該是我們設計時的基準樣貌，深色留給使用者自己選。

      使用者選過就記住（上面那段讀 localStorage），所以這只影響第一次。
    */
    return 'light';
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
  /**
   * 學生端顯示的姓名。
   *
   * 以前是寫死的 `DEMO_STUDENT.name` —— 不管誰登入，學生首頁都喊
   * 「早安，林冠宇」（原型示範資料裡的第一個學生）。實際登入才看得出來。
   */
  const studentName = session?.name ?? '';
  const studentCourseId = DEMO_STUDENT.courseId;
  /**
   * 學年期。來自後端的 `semesters` 表，不再是 mockData 的寫死清單。
   *
   * 初值先用 CURRENT_SEMESTER 頂著（避免第一次 render 時各處
   * `course.semester === currentSemester` 全部落空），拿到真的就換掉。
   */
  const [currentSemester, setCurrentSemester] = useState(CURRENT_SEMESTER);
  const [semesterOptions, setSemesterOptions] = useState<Semester[]>([]);

  useEffect(() => {
    if (sessionStatus !== 'ready') return;   // 未登入時打了也是 401
    let cancelled = false;
    fetchSemesters()
      .then(({ options, current }) => {
        if (cancelled) return;
        setSemesterOptions(options);
        if (current) setCurrentSemester(current.value);
      })
      .catch((e) => console.error('取得學年期失敗:', e));
    return () => { cancelled = true; };
  }, [sessionStatus]);
  /**
   * 課程。**目前身分看得到的那些** —— 範圍由 GET /service/courses 決定，
   * 管理者拿到全部、教師只拿到自己的。前端不再自己過濾。
   */
  const loadCourses = useCallback(() => fetchCourses(), []);
  const {
    items: courses, setItems: setCourses, reload: reloadCourses,
  } = useApiList<Course>(loadCourses, teacherDataReady);

  /**
   * 班級名冊，依課程 id 快取。
   *
   * **不預先全部載入** —— 一位教師可能有四十幾個班，開一個畫面打四十幾個
   * 請求只為了其中一個班的名冊，不划算。需要的頁面呼叫 ensureRoster()。
   */
  const [rosters, setRosters] = useState<Record<string, { seatNo: number; name: string }[]>>({});
  const ensureRoster = useCallback(async (courseId: string) => {
    if (!courseId) return;
    setRosters((prev) => (courseId in prev ? prev : prev));   // 已有就不重打
    try {
      const entries = await fetchRoster(courseId);
      setRosters((prev) => ({ ...prev, [courseId]: entries.map(({ seatNo, name }) => ({ seatNo, name })) }));
    } catch (e) {
      console.error(`載入名冊失敗 (course ${courseId}):`, e);
    }
  }, []);
  /**
   * 題目與題庫資料夾。
   *
   * 兩者的可視範圍在後端是**同一套規則**（自己建的 + 所屬組織的共享），
   * 所以一起載入 —— 分開載的話會短暫出現「題目在、它的資料夾還沒到」，
   * 畫面上那一題會跳到未分類。
   */
  const loadQuestions = useCallback(() => fetchQuestions(), []);
  const {
    items: questions, reload: reloadQuestions,
  } = useApiList<Question>(loadQuestions, teacherDataReady);

  const loadFolders = useCallback(() => fetchFolders(), []);
  const {
    items: folders, reload: reloadFolders,
  } = useApiList<Folder>(loadFolders, teacherDataReady);

  /**
   * 題目與資料夾的異動。
   *
   * 一律「呼叫 API → 重新載入」，不做樂觀更新 —— 樂觀更新要自己維護
   * 一份與伺服器平行的真相，而這個專案已經在「同一份資訊存兩處」上
   * 吃過四次虧（見 CLAUDE.md）。題庫的操作不頻繁，多一次往返換掉一整類
   * 不同步的 bug，划算。
   */
  const questionOps = {
    create: async (q: Partial<Question>) => { await createQuestion(q); await reloadQuestions(); },
    update: async (id: string, q: Partial<Question>) => { await updateQuestion(id, q); await reloadQuestions(); },
    remove: async (id: string) => { await deleteQuestion(id); await reloadQuestions(); },
    setArchived: async (id: string, archived: boolean) => {
      await setQuestionArchived(id, archived); await reloadQuestions();
    },
  };

  const folderOps = {
    create: async (name: string, parentId: string | null, type: QuestionType) => {
      await createFolder(name, parentId, type); await reloadFolders();
    },
    rename: async (id: string, name: string, parentId: string | null) => {
      await renameFolder(id, name, parentId); await reloadFolders();
    },
    // 刪資料夾會把底下的題目退回上一層，所以題目也要重載
    remove: async (id: string) => {
      await deleteFolder(id);
      await Promise.all([reloadFolders(), reloadQuestions()]);
    },
  };
  /**
   * 題庫資料夾。原本收在 QuestionBank 的 useState 裡，離開題庫中心
   * 元件就被卸載，新增或刪除的資料夾會整個復原 —— 看起來像沒：教師打開同步視窗 → 從校務系統挑班級 → 匯入成自己的課程
   *   後端：管理者跑 POST /service/admin/sync/school → 課程、授課關聯、
   *         學生名冊一次全部從 DevAPI 建好 → 教師只是「看到」自己的課
   *
   * 後端沒有「把這個班加進我的名下」這種動作。要做的話等於是讓教師
   * 自己建立 uc_instructor 關聯 —— 那是權限問題（同校的老師可以認領
   * 任何一個班嗎？），不是我可以逕自決定的。
   *
   * 在決定之前刻意維持原狀，不要做成半接的樣子：接一半的話，
   * 老師按下匯入會看到課程出現在畫面上，重新整理就不見了。
   *
   * 見 artifacts/api-gap.md 的開放問題。
   */
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
  /**
   * 刪除課程。
   *
   * 資料庫**沒有任何外鍵**，所以底下的作業、繳交、批改結果要靠後端
   * 自己清乾淨（見 artifacts/spec.md）。前端這裡只負責呼叫與重新載入 ——
   * 不要在前端「順便」清本地狀態裡的關聯資料，那會變成兩套清理邏輯，
   * 而只有其中一套跑得到真正的資料庫。
   */
  /**
   * 課程卡片上的異動。目前唯一**存得進資料庫**的是封存（`course.is_active`）。
   *
   * 其餘欄位刻意只留在本地：`aiModels` 沒有欄位可存，
   * `city` / `schoolName` / `schoolLevel` 來自 school 資料表、由校務同步維護，
   * 從這裡寫回去也不會是真相。跟題庫一樣「呼叫 API → 重新載入」，
   * 不做樂觀更新。
   */
  const handleUpdateCourse = async (updated: Course) => {
    const before = courses.find((c) => c.id === updated.id);
    // 先把本地換掉，沒有後端對應的欄位（aiModels…）就只能靠這一步
    setCourses((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    if (!before || before.isArchived === updated.isArchived) return;
    try {
      await setCourseArchived(updated.id, updated.isArchived === true);
      await reloadCourses();
    } catch (e) {
      console.error('封存課程失敗:', e);
      // 寫不進資料庫就把畫面退回去，不要讓使用者以為已經封存了
      setCourses((prev) => prev.map((c) => (c.id === before.id ? before : c)));
    }
  };

  const handleDeleteCourse = async (courseId: string) => {
    try {
      await deleteCourse(courseId);
      await reloadCourses();
      setRosters((prev) => {
        const next = { ...prev };
        delete next[courseId];
        return next;
      });
    } catch (e) {
      console.error('刪除課程失敗:', e);
    }
  };

  /**
   * 這個身分看得到的課程。
   *
   * **現在就是 courses 本身** —— 範圍已經由伺服器端決定（GET /service/courses），
   * 前端再過濾一次不但多餘，而且危險：`visibleCourses()` 是用**姓名**比對的，
   * 姓名對不上就會把整份清單濾成空的，而畫面上看起來只是「你沒有課」。
   *
   * 保留這個名字是因為十幾個畫面都在用它，而且語意沒變。
   */
  const myCourses = courses;


  /** 這位教師所有班級的作業。狀態與排序都由後端給（見 api/assignments.ts） */
  const loadAssignments = useCallback(() => fetchAssignments(), []);
  const {
    items: assignments, reload: reloadAssignments,
  } = useApiList<Assignment>(loadAssignments, teacherDataReady);
  /**
   * 請假註記（作業 × 學生）。逾期未繳分成真的沒寫和請假兩種，
   * 只有老師知道差別 —— 見 lib/leave.ts。
   */
  /**
   * 繳交、作品標記、請假註記。
   *
   * 繳交分兩層：這裡載的是**摘要**（不含作文全文）—— 實測最忙的教師有
   * 2,091 筆、內容合計 2.8 MB，全部拉下來不可行。批改頁需要全文時再
   * 用 ensureSubmissions() 補那一份作業（見 api/submissions.ts）。
   */
  const loadSubmissions = useCallback(() => fetchSubmissionSummary(), []);
  const {
    items: submissions, setItems: setSubmissions, reload: reloadSubmissions,
  } = useApiList<Submission>(loadSubmissions, teacherDataReady);

  /**
   * 學生端的全部資料。
   *
   * 一支 `GET /service/student/my_assignments` 拆成四個陣列（見 api/student.ts）。
   * 學生端的元件吃的是與教師端同一組型別，所以拆好之後它們不必知道自己
   * 是從哪一支端點來的。
   *
   * 走 useApiList 是為了拿它的兩個既有決定：初值就是 loading、
   * 以及重新載入失敗時不清空既有資料。
   */
  const loadStudentData = useCallback(
    () => fetchStudentData(session?.id ?? '', session?.name ?? '').then((d) => [d]),
    [session?.id, session?.name],
  );
  const {
    items: studentDataList, reload: reloadStudentData,
  } = useApiList<StudentData>(loadStudentData, studentDataReady);
  const studentData = studentDataList[0];

  const loadMarks = useCallback(() => fetchMarks(), []);
  const [submissionMarks, setSubmissionMarks] = useState<SubmissionMarks>({});
  const loadLeaves = useCallback(() => fetchLeaves(), []);
  const [leaveMarks, setLeaveMarks] = useState<LeaveMarks>({});

  useEffect(() => {
    // 作品標記與請假註記都是教師端的概念，學生端完全不顯示
    if (!teacherDataReady) return;
    let cancelled = false;
    void Promise.all([loadMarks(), loadLeaves()])
      .then(([marks, leaves]) => {
        if (cancelled) return;
        setSubmissionMarks(marks);
        setLeaveMarks(leaves);
      })
      .catch((e) => console.error('載入標記／請假失敗:', e));
    return () => { cancelled = true; };
  }, [teacherDataReady, loadMarks, loadLeaves]);

  /**
   * 設定／取消請假註記。
   *
   * 先前是把 setLeaveMarks 直接交給畫面，讓它自己改本地的 Record ——
   * 接上後端之後那行不通：改本地不會寫進資料庫，重新整理就回去了。
   * 樂觀更新一次（畫面立刻反應），失敗再退回去。
   */
  const toggleLeave = async (assignmentId: string, studentId: string, onLeave: boolean) => {
    setLeaveMarks((prev) => setLeaveLocal(prev, assignmentId, studentId, onLeave));
    try {
      await setLeaveApi(assignmentId, studentId, onLeave);
    } catch (e) {
      console.error('請假註記失敗:', e);
      setLeaveMarks((prev) => setLeaveLocal(prev, assignmentId, studentId, !onLeave));
    }
  };

  /**
   * 補上某一份作業的**完整**繳交（含作文與評語），就地併進 submissions。
   * 批改清單與批改頁進來時呼叫 —— 摘要沒有作文，直接開會是一張空白稿。
   */
  const ensureSubmissions = useCallback(async (assignmentId: string) => {
    if (!assignmentId) return;
    try {
      const full = await fetchSubmissionsByAssignment(assignmentId);
      setSubmissions((prev) => {
        const others = prev.filter((s) => s.assignmentId !== assignmentId);
        return [...others, ...full];
      });
    } catch (e) {
      console.error(`載入繳交失敗 (assignment ${assignmentId}):`, e);
    }
  }, [setSubmissions]);


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
  /**
   * 作業的批次異動（派發精靈與課程作業清單都走這一支）。
   *
   * 介面維持「建立／更新／刪除」三份清單不變，但內部改成**比對差異**再
   * 發對應的 API —— 後端沒有「整包覆蓋」的 endpoint，而且也不該有：
   * 開關、改截止日、換順序是三件不同的事，各自有各自的授權與副作用。
   *
   * 更新的部分只發真的變了的那幾項。全部送一遍看起來比較簡單，
   * 但那會把「老師只是拖了一下順序」變成「順便重設了截止日」。
   */
  const handleAssignmentOperation = async (
    creates: Assignment[],
    updates: Assignment[],
    deleteIds: string[],
  ) => {
    try {
      for (const a of creates) {
        await createAssignment(a.courseId, {
          questionId: a.questionId,
          deadline: a.config?.deadline,
          allowLateSubmission: a.config?.allowLateSubmission,
        });
      }

      const reorderedCourses = new Set<string>();
      for (const next of updates) {
        const prev = assignments.find((x) => x.id === next.id);
        if (!prev) continue;

        if (prev.status !== next.status) {
          // 三態只有 Draft ⇄ Published 是老師按得到的；Closed 是
          // 「開過又收回」的結果，所以這裡只需要送 opened 布林
          await setAssignmentOpened(next.id, next.status === 'Published');
        }
        if (prev.config?.deadline !== next.config?.deadline
            || prev.config?.allowLateSubmission !== next.config?.allowLateSubmission) {
          await updateAssignmentConfig(next.id, {
            deadline: next.config?.deadline,
            allowLateSubmission: next.config?.allowLateSubmission,
          });
        }
        if (prev.order !== next.order) reorderedCourses.add(next.courseId);
      }

      // 順序整班一起送 —— 後端收的是「這個班的作業依序排好的 id 陣列」。
      // 先把更新後的版本疊回這個班的清單，再用 orderedAssignments() 排序，
      // 與畫面上看到的順序走同一支函式（見 lib/assignmentOrder.ts）。
      for (const courseId of reorderedCourses) {
        const merged = assignments.map((a) => updates.find((u) => u.id === a.id) ?? a);
        const ordered = orderedAssignments(merged, courseId);
        await reorderAssignments(courseId, ordered.map((a) => a.id));
      }

      // 刪除的連鎖清理（繳交、批改、標記、請假）在後端一個交易裡做完
      for (const id of deleteIds) await deleteAssignment(id);

      await reloadAssignments();
    } catch (e) {
      console.error('作業異動失敗:', e);
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
  const toggleMark = async (submissionId: string, kind: MarkKind) => {
    const next = !hasMark(submissionMarks, submissionId, kind);
    try {
      await setMarkApi(submissionId, kind, next);
      setSubmissionMarks((prev) => setMark(prev, submissionId, kind, next));
    } catch (e) {
      console.error('蓋章失敗:', e);
    }
  };

  /** 批改清單上被勾選的那些（批次批改／發還／重置用） */
  const [selectedSubmissionIds, setSelectedSubmissionIds] = useState<string[]>([]);
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
 
  /**
   * 學生繳交，或存草稿（`isSubmitted: false`）。
   *
   * 重新載入的是**學生自己那一份**（reloadStudentData）——
   * reloadSubmissions 打的是教師端端點，學生會拿到 403。
   */
  const handleSubmitEssay = async (
    assignmentId: string, content: string,
    opts: { isSubmitted?: boolean; wordCount?: number; picFiles?: string[] } = {},
  ) => {
    try {
      await submitEssay(assignmentId, content, opts);
      await reloadStudentData();
    } catch (e) {
      console.error('繳交失敗:', e);
      throw e;   // 讓畫面知道沒成功，不要顯示「已繳交」
    }
  };
  const handleSaveGrading = async (
    id: string, result: GradingResult, shouldNavigateBack: boolean = true,
  ) => {
    try {
      await saveGrading(id, result);
      // 存檔會產生一筆新版本讓舊的失效，所以整批重載才看得到正確的狀態
      await reloadSubmissions();
      await ensureSubmissions(
        submissions.find((s) => s.id === id)?.assignmentId ?? '',
      );
    } catch (e) {
      console.error('存檔失敗:', e);
      return;
    }

    if (shouldNavigateBack) {
      // 先前是「手刻的 viewHistory 有東西就 pop，否則回批改清單」。
      // 現在交給瀏覽器的上一頁；直接把批改頁網址貼進來時沒有上一頁可退，
      // navigate(-1) 會留在原地，所以退回清單當作保底。
      if (window.history.state?.idx > 0) navigate(-1);
      else navigate(routes.gradingList());
    }
  };

  /**
   * 批次 AI 批改。
   *
   * 逐筆呼叫後端而不是做一支批次 endpoint —— 一個班二三十人，
   * 而批次的錯誤處理（一半成功一半失敗）比省下的往返麻煩得多。
   * 逐筆也才做得出進度條。
   */
  const handleBatchGrade = async (selectedAssignmentId: string) => {
    const pool = submissions.filter(
      (s) => s.assignmentId === selectedAssignmentId && s.status === 'Pending',
    );
    const targets = selectedSubmissionIds.length > 0
      ? pool.filter((s) => selectedSubmissionIds.includes(s.id))
      : pool;
    if (targets.length === 0) return;

    setIsBatchGrading(true);
    setBatchGradingProgress({ current: 0, total: targets.length });
    try {
      for (let i = 0; i < targets.length; i++) {
        setCurrentlyGradingId(targets[i].id);
        setBatchGradingProgress({ current: i + 1, total: targets.length });
        await gradeWithAi(targets[i].id);
      }
      await reloadSubmissions();
      await ensureSubmissions(selectedAssignmentId);
    } catch (e) {
      console.error('批次批改失敗:', e);
    } finally {
      setCurrentlyGradingId(null);
      setIsBatchGrading(false);
      setSelectedSubmissionIds([]);
    }
  };

  /** 批次發還。後端只會動到呼叫者教的班，別班的 id 會被安靜略過。 */
  const handleBatchPublish = async (selectedAssignmentId: string) => {
    const pool = submissions.filter(
      (s) => s.assignmentId === selectedAssignmentId && s.status === 'Graded',
    );
    const targets = selectedSubmissionIds.length > 0
      ? pool.filter((s) => selectedSubmissionIds.includes(s.id))
      : pool;
    if (targets.length === 0) return;

    try {
      await returnFeedback(targets.map((s) => s.id));
      await reloadSubmissions();
      await ensureSubmissions(selectedAssignmentId);
    } catch (e) {
      console.error('發還失敗:', e);
    } finally {
      setSelectedSubmissionIds([]);
    }
  };

  /**
   * 代繳交：老師替學生登錄紙本作文。
   *
   * 不能沿用 handleSubmitEssay —— 那一支寫死示範學生的 STUDENT_ID，
   * 而且 1.5 秒後會自動送 AI 批改。代繳交要記在**指定的**學生名下，
   * 而且停在「待批改」，讓老師自己決定何時按「批次批改」。
   */
  /** 教師代學生繳交（拍照 + OCR 之後把文字送上來）。也算已送出。 */
  const handleProxySubmit = async (
    selectedAssignmentId: string,
    studentId: string,
    _studentName: string,
    content: string,
  ) => {
    try {
      await proxySubmit(selectedAssignmentId, studentId, content);
      await reloadSubmissions();
      await ensureSubmissions(selectedAssignmentId);
      setIsProxySubmitOpen(false);
    } catch (e) {
      console.error('代繳交失敗:', e);
    }
  };

  /**
   * 批次重置批改。
   *
   * **一定要先勾選** —— 與按鈕的啟動條件一致。這一步會清掉分數與評語，
   * 不該有「沒選就整批重置」的預設行為。
   */
  const handleBatchReset = async (selectedAssignmentId: string) => {
    if (selectedSubmissionIds.length === 0) return;
    const targets = submissions.filter(
      (s) => s.assignmentId === selectedAssignmentId
        && selectedSubmissionIds.includes(s.id)
        && (s.status === 'Graded' || s.status === 'Published'),
    );
    if (targets.length === 0) return;

    try {
      for (const s of targets) await resetGrading(s.id);
      await reloadSubmissions();
      await ensureSubmissions(selectedAssignmentId);
      setGradingResetSeq((n) => n + 1);
    } catch (e) {
      console.error('批次重置失敗:', e);
    } finally {
      setSelectedSubmissionIds([]);
    }
  };

  /**
   * 單篇 AI 批改。
   *
   * 走的是批次批改同一支後端端點 —— 它會把結果**直接寫成一筆
   * `is_ai = true` 的有效版本**，並記下 token 用量。所以按完就已經存好了，
   * 不需要老師再按一次儲存；老師之後修改評語會另外產生 `is_ai = false` 的新版本。
   *
   * 完成後把 GradingEditor 重掛（理由同重置：它把結果收在自己的 state 裡）。
   *
   * **這一支刻意讓錯誤往外丟**，不像其他 handler 自己吞掉 ——
   * 呼叫端 GradingEditor 要靠它決定是否跳出「AI 批改失敗」。
   */
  const handleAutoGrade = async (id: string) => {
    const assignmentId = submissions.find((s) => s.id === id)?.assignmentId;
    await gradeWithAi(id);
    await reloadSubmissions();
    if (assignmentId) await ensureSubmissions(assignmentId);
    setGradingResetSeq((n) => n + 1);
  };

  /**
   * 重置批改：把有效的那一筆設為失效，狀態退回待批改。**作文還在。**
   * 歷史紀錄留著（is_valid = false），老師會重批。
   */
  const handleResetGrading = async (id: string) => {
    try {
      await resetGrading(id);
      await reloadSubmissions();
      const assignmentId = submissions.find((s) => s.id === id)?.assignmentId;
      if (assignmentId) await ensureSubmissions(assignmentId);
      // 只有重置需要把 GradingEditor 重掛 —— 它把結果收在自己的 state 裡
      setGradingResetSeq((n) => n + 1);
    } catch (e) {
      console.error('重置批改失敗:', e);
    }
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
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        try {
          // 後端會一併刪掉批改結果與作品標記（作品標記靠外鍵 CASCADE）
          await clearSubmission(submission.id);
          await reloadSubmissions();
          await ensureSubmissions(submission.assignmentId);
          // 本地那份標記快取也要跟著清，不然畫面上那顆章會留到下次重載
          setSubmissionMarks((marks) => dropMarks(marks, [submission.id]));
          setSelectedSubmissionIds((prev) => prev.filter((id) => id !== submission.id));
        } catch (e) {
          console.error('清除繳交失敗:', e);
        }
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
  /**
   * 換題。只有作業已關閉時前端才讓按（見 lib/assignments.ts 的 swapQuestion）——
   * 換題會把既有的繳交作廢，開放中換掉等於把學生寫到一半的東西抽走。
   */
  const handleSwapQuestion = async (assignment: Assignment, question: Question) => {
    try {
      await swapAssignmentQuestion(assignment.id, question.id);
      await reloadAssignments();
      setSwappingAssignment(null);
    } catch (e) {
      console.error('換題失敗:', e);
    }
  };


  /**
   * **對外的四個陣列**。學生身分時換成學生自己那一份。
   *
   * 學生端的四個畫面（概況、我的作業、作答、成績）讀的就是這幾個名字，
   * 而它們以前只被教師端的端點填 —— 學生看到的永遠是空的。
   * 在這裡做一次切換，畫面端就不必知道自己的資料是從哪支端點來的。
   *
   * 學生沒有題庫資料夾、作品標記、請假註記這些概念，那幾項不切換，
   * 學生身分時本來就是空的。
   */
  const visibleCourses = isStudentRole ? (studentData?.courses ?? []) : myCourses;
  const visibleQuestions = isStudentRole ? (studentData?.questions ?? []) : questions;
  const visibleAssignments = isStudentRole ? (studentData?.assignments ?? []) : assignments;
  const visibleSubmissions = isStudentRole ? (studentData?.submissions ?? []) : submissions;

  return {
    applyTheme,
    session,
    sessionStatus,
    userRole,
    switchIdentityTo,
    handleLogout,
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
    semesterOptions,
    courses: visibleCourses,
    setCourses,
    handleUpdateCourse,
    questions: visibleQuestions,
    questionOps,
    folders,
    folderOps,
    rosters,
    ensureRoster,
    reloadCourses,
    handleSyncCourses,
    handleDeleteCourse,
    myCourses: visibleCourses,
    assignments: visibleAssignments,
    reloadAssignments,
    leaveMarks,
    toggleLeave,
    submissionMarks,
    setSubmissionMarks,
    submissions: visibleSubmissions,
    ensureSubmissions,
    reloadSubmissions,
    reloadStudentData,
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
    handleAutoGrade,
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
