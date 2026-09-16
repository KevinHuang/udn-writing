
/** 作業的發布狀態 */
export type AssignmentStatus = 'Published' | 'Draft' | 'Closed';

/** 學生繳交紀錄的狀態 */
export type SubmissionStatus =
  | 'Draft'
  | 'Pending'
  | 'Graded'
  | 'Published'
  | 'Unsubmitted';

export enum UserRole {
  /** 聯合報管理人員：看得到全省所有學校與課程 */
  ADMIN = 'ADMIN',
  /** 授課教師：只看得到掛在自己名下的班級 */
  TEACHER = 'TEACHER',
  STUDENT = 'STUDENT'
}

/** 身分的顯示名稱。字串集中在這裡，避免三個畫面各寫一份 */
export const ROLE_LABEL: Record<UserRole, string> = {
  [UserRole.ADMIN]: '聯合報管理人員',
  [UserRole.TEACHER]: '授課教師',
  [UserRole.STUDENT]: '學生',
};


export interface Course {
  id: string;
  code: string;
  /** 校務系統給的完整課程名稱，例：新北市淡江中學國三孝班。永遠保留原樣 */
  name: string;
  semester: string;
  studentCount: number;
  aiModels?: string[]; // List of enabled AI assistant model names
  isArchived?: boolean;

  // ── 以下由 lib/schoolName.ts 的 parseCourseName 於匯入時寫入 ──
  //    全部選填，解析不到就留空並標記待確認，不猜
  city?: string;
  schoolName?: string;
  schoolLevel?: SchoolLevel;
  className?: string;
  /** 'low' 代表解析不完整，需要管理人員在「待確認」補齊 */
  parseConfidence?: 'high' | 'low';
  /** 授課教師。授課教師身分只看得到自己名下的課程 */
  teacherName?: string;
}

/** 學校層級。決定班級的命名方式（國中用忠孝仁愛，國小用班號） */
export type SchoolLevel = '國中' | '國小';

/**
 * 校務系統目錄裡的一個班級。
 *
 * city / schoolName 只給同步視窗篩選與分組用，**不會寫進 Course** ——
 * 匯入之後課程只留合併好的 name（例：「新北市淡江中學 國三孝班」）。
 */
/**
 * 校務系統回傳的一個班級。
 *
 * name 是**一整串**（「新北市淡江中學國三孝班」）—— 真實校務系統就是這樣給的，
 * 縣市、學校、班級沒有分開。要拆開請用 lib/schoolName.ts 的 parseCourseName，
 * 不要在各處自己 split。
 */
export interface SchoolCourse {
  id: string;
  code: string;
  name: string;
  semester: string;
  studentCount: number;
  roster: string[];
  /** 校務系統登記的授課教師 */
  teacherName: string;
}

export interface Student {
  id: string;
  name: string;
  courseId: string;
}

export enum QuestionType {
  SHARED = 'SHARED',
  PERSONAL = 'PERSONAL'
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  type: QuestionType;
  /**
   * 題目數不放在這裡。改用 lib/folders.ts 的 questionCountsByFolder() 算，
   * 避免新增／刪除／搬移／匯入／封存各自記帳而數字漂移。
   */
}

/**
 * 適用階段。
 *
 * 注意：與 Question.gradeLevel 是兩件事 —— gradeLevel 存的是「寫作類型」
 * （看圖寫作／記敘抒情／論說），這裡才是學段。
 */
export type TargetGrade = 'elementary' | 'junior' | 'senior';

/** 題目來源。用於任務庫檢索與命題比例統計 */
export type QuestionSource = 'exam_archive' | 'udn' | 'udn_cup' | 'original' | 'textbook';

export interface Question {
  id: string;
  title: string;
  content: string; // 題說：給學生看的簡短說明
  type: QuestionType;
  folderId: string | null; // null means root level
  folderName?: string; // For display convenience
  gradeLevel: string; // Now used for Writing Type as per previous change
  maxScore?: number;
  gradingCriteria?: string; // 評分規準：給 AI 批改用，不進學生端
  isArchived?: boolean;
  imageUrl?: string; // Base64 or URL of the uploaded image
  aiImageDescription?: string; // 配圖的替代文字，也是 AI 對圖片的理解
  preferredAiModel?: string; // Pre-selected AI model for grading

  /**
   * 寫作語言。決定稿紙樣式與字數統計方式（中文算字、英文算單字）。
   * 未指定時一律視為中文 —— 這個系統的主場是國中國文寫作。
   */
  subject?: 'Chinese' | 'English';

  // ── 任務建置模組移植進來的欄位。全部選填，舊資料不受影響 ──
  /** 適用階段，可複選 */
  targetGrades?: TargetGrade[];
  /** 題目來源，可複選 */
  sources?: QuestionSource[];
  /** 教師的話：詳細寫作引導，學生看得到。與 gradingCriteria 不同，後者只給 AI */
  teacherNotes?: string;
  /** 配圖相對於題說的位置 */
  imagePosition?: 'before' | 'after';
}

export interface AssignmentConfig {
  /**
   * 截止時間。**選填** —— 老師派作業時預設不設截止日，
   * 需要才手動開啟（這是實際的操作習慣）。
   *
   * 空字串或 undefined 都代表「沒有截止日」。判斷一律用
   * lib/assignments.ts 的 hasDeadline() / deadlineOf()，
   * 不要在畫面裡直接 new Date(config.deadline) ——
   * 沒有截止日時那會得到 Invalid Date，比較永遠是 false，
   * 而顯示會變成「Invalid Date」。
   */
  deadline?: string;
  allowLateSubmission?: boolean;
}

export interface Assignment {
  id: string;
  title: string; // Display title (usually question title)
  courseId: string; // targetClassId
  questionId: string; // sourceQuestionId
  config: AssignmentConfig;
  status: AssignmentStatus;
  totalStudents: number;
  createdAt?: string;
  /**
   * 第一次對學生開放的時間。status 為 Draft 時沒有意義。
   * 「預定計畫模式」是先建成 Draft，老師決定時機再手動開啟。
   */
  publishedAt?: string;
  /**
   * 老師排定的順序（班級內、0 起算）。**選填** —— 沒排過的排在最後。
   *
   * 這是一個排序鍵，不是畫面上看到的編號。卡片的 1、2、3 一律用位置
   * 現算（見 lib/assignmentOrder.ts），所以刪掉中間一份留下的空號
   * 不會讓序號跳號。要讀順序請走 orderedAssignments()，不要自己排。
   */
  order?: number;
}

export interface GradingResult {
  /**
   * 整體級分（0-6 整數）。這是綜觀全文的整體評定，
   * 不是 categoryScores 的平均 —— 詳見 lib/scoring.ts 的說明。
   * 欄位沿用 totalScore 這個名字以免大規模改名，語意已是級分。
   */
  totalScore: number;
  categoryScores: {
    content: number;
    structure: number;
    grammar: number;
    vocabulary: number;
  };
  aiFeedback: string;
  teacherFeedback: string;
  suggestions: string[];
  isPublished: boolean;
}

export interface Submission {
  id: string;
  assignmentId: string;
  studentId: string;
  studentName: string;
  content: string;
  submittedAt: string;
  publishedAt?: string;
  status: SubmissionStatus;
  result?: GradingResult;
}

/**
 * 四項評分要素的顯示名稱 —— 用國中教育會考寫作測驗的官方用語。
 * 實際的級分定義與規準在 lib/scoring.ts。
 */
export const CATEGORY_LABELS: Record<string, string> = {
  content: '立意取材',
  structure: '結構組織',
  vocabulary: '遣詞造句',
  grammar: '錯別字、格式與標點符號'
};

// Helper interface for the AI service response
export interface AiGradingResponse {
  totalScore: number;
  categoryScores: {
    content: number;
    structure: number;
    grammar: number;
    vocabulary: number;
  };
  feedback: string;
  suggestions: string[];
}
