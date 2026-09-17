import { api } from './client';
import { assignmentStatusOf, type Assignment } from '@udn/shared';

interface RawAssignment {
  id: string;
  ref_course_id: string;
  ref_task_id: string;
  assigned_at: string | null;
  opened: boolean | null;
  opened_at: string | null;
  deadline: string | null;
  allow_late_submission: boolean | null;
  sort_order: number | null;
  task_title: string | null;
  total_students: string | number | null;
}

/**
 * 資料庫列 → 前端的 Assignment。
 *
 * 狀態不是資料庫欄位，是 `opened` + `opened_at` 推導出來的 ——
 * 推導規則在 `@udn/shared` 的 `assignmentStatusOf()`，前後端共用一份。
 */
function toAssignment(r: RawAssignment): Assignment {
  return {
    id: String(r.id),
    title: r.task_title ?? '',
    courseId: String(r.ref_course_id),
    questionId: String(r.ref_task_id),
    config: {
      // 空字串與 undefined 都代表「沒有截止日」（見 lib/assignments.ts 的
      // hasDeadline()）—— 這裡統一用 undefined，不要傳 null 進去
      deadline: r.deadline ?? undefined,
      allowLateSubmission: r.allow_late_submission ?? false,
    },
    status: assignmentStatusOf(r),
    totalStudents: Number(r.total_students ?? 0),
    createdAt: r.assigned_at ?? undefined,
    publishedAt: r.opened_at ?? undefined,
    // NULL 代表「沒排過」。前端的 orderedAssignments() 會把它排在最後
    order: r.sort_order ?? undefined,
  };
}

/** 某個班級的作業。伺服器端只回你教的班，別人的班會拿到空陣列。 */
export async function fetchAssignmentsByCourse(courseId: string): Promise<Assignment[]> {
  const rows = await api.get<RawAssignment[]>(`/service/instructor/courses/${courseId}/assignments`);
  return rows.map(toAssignment);
}

export async function createAssignment(
  courseId: string,
  input: { questionId: string; deadline?: string; allowLateSubmission?: boolean },
): Promise<Assignment> {
  const row = await api.post<RawAssignment>(`/service/instructor/courses/${courseId}/assignments`, {
    ref_task_id: input.questionId,
    deadline: input.deadline || null,
    allow_late_submission: input.allowLateSubmission ?? false,
  });
  return toAssignment(row);
}

/** 開關作業（Draft ⇄ Published）。收回時 `opened_at` 會保留，Closed 才分得出來 */
export async function setAssignmentOpened(id: string, opened: boolean): Promise<void> {
  await api.put(`/service/instructor/assignments/${id}/status`, { opened });
}

export async function updateAssignmentConfig(
  id: string, config: { deadline?: string; allowLateSubmission?: boolean },
): Promise<void> {
  await api.put(`/service/instructor/assignments/${id}/config`, {
    deadline: config.deadline || null,
    allow_late_submission: config.allowLateSubmission,
  });
}

/** 換題。只有作業已關閉時前端才讓按，後端不管這條規則（見 lib/assignments.ts） */
export async function swapAssignmentQuestion(id: string, questionId: string): Promise<void> {
  await api.put(`/service/instructor/assignments/${id}/task`, { ref_task_id: questionId });
}

/**
 * 重新排序。送整個班的作業 id 依序排好 ——
 * 拖拉的結果本來就是一份完整順序，逐筆搬移中途失敗會留下半套。
 */
export async function reorderAssignments(courseId: string, orderedIds: string[]): Promise<void> {
  await api.put(`/service/instructor/courses/${courseId}/assignments/order`, { orderedIds });
}

/**
 * 刪除作業。底下的繳交、批改結果、作品標記、請假註記由後端一併清掉
 * （資料庫幾乎沒有外鍵，那些連鎖是手寫的，見 AssignmentHelper.deleteById）。
 */
export async function deleteAssignment(id: string): Promise<void> {
  await api.del(`/service/instructor/assignments/${id}`);
}


/**
 * 這位教師所有班級的作業。
 *
 * 用 `/service/instructor/assignments` 而不是逐班查 —— 一位教師可能有
 * 四十幾個班，開一個畫面打四十幾個請求不划算。
 *
 * ⚠️ 那支 endpoint 的欄位名稱與單一班級的查詢**不一樣**（`assignment_id`
 *    而不是 `id`，而且多帶了課程與統計資訊）。差異吸收在這裡，
 *    外面拿到的都是同一個 Assignment。
 */
interface RawTeacherAssignment extends Omit<RawAssignment, 'id' | 'ref_course_id' | 'ref_task_id' | 'total_students'> {
  assignment_id: string;
  course_id: string;
  task_id: string;
  student_count: string | number | null;
  submission_count: string | number | null;
  graded_count: string | number | null;
}

export async function fetchAssignments(): Promise<Assignment[]> {
  const rows = await api.get<RawTeacherAssignment[]>('/service/instructor/assignments');
  return rows.map((r) =>
    toAssignment({
      ...r,
      id: r.assignment_id,
      ref_course_id: r.course_id,
      ref_task_id: r.task_id,
      total_students: r.student_count,
    }),
  );
}
