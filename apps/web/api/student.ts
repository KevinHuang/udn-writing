import { api } from './client';
import { semesterValue } from '../lib/semester';
import {
  QuestionType, submissionStatusOf,
  type Assignment, type Course, type Question, type Submission,
} from '@udn/shared';

/**
 * 學生端的資料來源。
 *
 * **一支端點撐起學生端全部三個畫面。** `GET /service/student/my_assignments`
 * 每一列是「這位學生的一份作業」，而且把課程、題目、繳交、批改攤平在同一列上，
 * 所以這裡的工作是**把攤平的列拆回四個陣列** —— 學生端的元件吃的是與教師端
 * 同一組 Course / Question / Assignment / Submission，拆好之後元件完全不必改。
 *
 * 為什麼不是各打各的：學生一次最多幾十份作業，一支請求就拿得完；
 * 拆成四支只會讓四份資料有機會不一致（同一份作業在 A 清單有、B 清單沒有）。
 *
 * ⚠️ **這支端點舊前端（`apps/api/public`）也在吃。** 所以後端只往上疊欄位、
 *    不改既有欄位的語意 —— 特別是 `is_submitted`，它其實是「有沒有繳交紀錄」，
 *    草稿也會是 true。真正的已送出旗標是新加的 `submission_is_submitted`。
 */
interface RawStudentAssignment {
  assignment_id: string;
  task_id: string;
  course_id: string;
  school_name: string | null;
  course_name: string | null;
  school_year: number;
  semester: number;
  title: string | null;
  description: string | null;
  pic1: string | null;
  pic_position: string | null;
  note: string | null;
  assigned_at: string | null;
  deadline: string | null;
  allow_late_submission: boolean | null;
  submission_id: string | null;
  /** ⚠️ 「有沒有繳交紀錄」，不是「已送出」。草稿也是 true。舊前端在用，語意不能改 */
  is_submitted: boolean | null;
  /** 真正的已送出旗標。false = 學生存成草稿 */
  submission_is_submitted: boolean | null;
  submited_time: string | null;
  submission_content: string | null;
  word_count: number | null;
  last_update: string | null;
  has_feedback: boolean | null;
  feedback_id: string | null;
  score: number | null;
  feedback_content: string | null;
  is_returned: boolean | null;
  is_ai: boolean | null;
}

export interface StudentData {
  courses: Course[];
  questions: Question[];
  assignments: Assignment[];
  submissions: Submission[];
}

/**
 * 從 `submission_feedback.content` 取出評語本文。
 *
 * 與 api/submissions.ts 的 feedbackTextOf 同一件事 —— 後端存的是
 * `{ raw_score, score, response }` 的 JSON 字串，`response` 才是那份 markdown。
 * 解析失敗就把原字串當評語，舊資料的格式可能不一樣。
 */
function feedbackTextOf(raw: string | null): string {
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.response === 'string') return parsed.response;
    if (typeof parsed?.feedback === 'string') return parsed.feedback;
    return raw;
  } catch {
    return raw;
  }
}

/** 四項分數在學生端是關著的（features.ts 的 SHOW_CATEGORY_SCORES），給零即可 */
const NO_CATEGORY_SCORES = { content: 0, structure: 0, grammar: 0, vocabulary: 0 };

export async function fetchStudentData(
  studentId: string,
  studentName: string,
): Promise<StudentData> {
  const rows = await api.get<RawStudentAssignment[]>('/service/student/my_assignments');

  const courses = new Map<string, Course>();
  const questions = new Map<string, Question>();
  const assignments: Assignment[] = [];
  const submissions: Submission[] = [];

  for (const r of rows) {
    const courseId = String(r.course_id);
    const taskId = String(r.task_id);

    if (!courses.has(courseId)) {
      const school = r.school_name ?? '';
      const className = r.course_name ?? '';
      courses.set(courseId, {
        id: courseId,
        code: '',
        // 與教師端同樣組成「校名 + 班級」—— 學生可能同時在兩間學校有課
        name: [school, className].filter(Boolean).join(' '),
        semester: semesterValue(r.school_year, r.semester),
        // 學生看不到也不需要班級人數
        studentCount: 0,
        schoolName: school || undefined,
        className: className || undefined,
      });
    }

    if (!questions.has(taskId)) {
      questions.set(taskId, {
        id: taskId,
        title: r.title ?? '',
        content: r.description ?? '',
        // 學生拿到的題目一律當共用題 —— 題庫的分類是教師端的概念
        type: QuestionType.SHARED,
        folderId: null,
        gradeLevel: '',
        // **評分規準刻意不帶**：那是給 AI 與教師看的，後端也沒有回傳
        imageUrl: r.pic1 ?? undefined,
        imagePosition: r.pic_position === 'before' ? 'before' : 'after',
        teacherNotes: r.note ?? undefined,
      });
    }

    assignments.push({
      id: String(r.assignment_id),
      title: r.title ?? '',
      courseId,
      questionId: taskId,
      config: {
        deadline: r.deadline ?? undefined,
        allowLateSubmission: r.allow_late_submission ?? false,
      },
      // 學生只看得到已開放的作業（後端 WHERE a.opened = true），所以一律 Published
      status: 'Published',
      totalStudents: 0,
      createdAt: r.assigned_at ?? undefined,
    });

    if (r.submission_id == null) continue;

    const returned = !!r.is_returned;
    submissions.push({
      id: String(r.submission_id),
      assignmentId: String(r.assignment_id),
      studentId,
      studentName,
      content: r.submission_content ?? '',
      submittedAt: r.submited_time ?? '',
      status: submissionStatusOf({
        submissionId: r.submission_id,
        // 用真正的已送出旗標，不是「有沒有紀錄」那一欄
        isSubmitted: r.submission_is_submitted,
        hasValidFeedback: !!r.has_feedback,
        isReturned: r.is_returned,
      }),
      /*
        **發還之後才帶批改結果。**

        畫面本來就有把關（StudentGrades 要 status === 'Published' 才顯示分數），
        但後端不論 is_returned 都會回傳 score 與 feedback_content ——
        少帶一份到元件手上，就少一個「哪天有人忘了判斷 status」的破口。
      */
      result: returned
        ? {
            totalScore: Number(r.score ?? 0),
            categoryScores: NO_CATEGORY_SCORES,
            feedback: feedbackTextOf(r.feedback_content),
            isAi: r.is_ai !== false,
            isPublished: true,
          }
        : undefined,
    });
  }

  return {
    courses: [...courses.values()],
    questions: [...questions.values()],
    assignments,
    submissions,
  };
}
