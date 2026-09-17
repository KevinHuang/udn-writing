import { api } from './client';
import { feedbackTextOf } from '../lib/feedbackText';
import { countWords } from '../lib/wordCount';
import { submissionStatusOf, type Submission, type GradingResult } from '@udn/shared';

/**
 * 繳交紀錄分**兩層**載入：
 *
 *   摘要 `GET /service/instructor/submissions`
 *     所有班級，**不含作文全文**。實測最忙的教師有 2,091 筆、
 *     內容合計 2.8 MB，每次開畫面都拉一次不可行；去掉之後約 300 KB。
 *     統計、狀態徽章、作品標記都夠用。
 *
 *   完整 `GET /service/instructor/assignments/:id/submissions`
 *     某一份作業，**含作文全文與評語**。批改頁需要。
 *
 * 兩邊回傳的欄位不完全一樣，差異吸收在這個檔案 —— 外面拿到的都是 Submission。
 */

interface RawSubmissionBase {
  assignment_id?: string;
  user_id: string;
  student_name: string | null;
  seat_no: number | null;
  submission_id: string | null;
  is_submitted: boolean | null;
  submited_time: string | null;
  feedback_id: string | null;
  score: number | null;
  is_returned: boolean | null;
  is_ai: boolean | null;
}

interface RawSummaryRow extends RawSubmissionBase {
  assignment_id: string;
  course_id: string;
}

interface RawDetailRow extends RawSubmissionBase {
  content: string | null;
  /** jsonb。pg 多半給陣列，舊資料也可能是 JSON 字串 —— 交給 picFilesOf() */
  pic_files: unknown;
  /**
   * ⚠️ 這一欄**不一定是字串**。摘要端點給 JSON 字串，詳細端點的
   *    `ai_analysis` 經過 jsonb 轉換，pg 直接回物件。宣告成 string 正是
   *    先前沒發現這件事的原因之一 —— 交給 feedbackTextOf() 兩種都吃。
   */
  ai_analysis: unknown;
}

/**
 * `submission.pic_files` → 路徑陣列。
 *
 * 那一欄是 jsonb，pg 多半直接給陣列；舊資料裡也有存成 JSON 字串的，
 * 兩種都要吃。認不得就當作沒有原稿，不要讓畫面掛掉。
 */
function picFilesOf(raw: unknown): string[] {
  if (!raw) return [];
  let arr: unknown = raw;
  if (typeof raw === 'string') {
    try { arr = JSON.parse(raw); } catch { return []; }
  }
  return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
}

/** 空的四項分數。資料庫的 sub_scores 多半是 null，而畫面上這一區是關著的 */
const NO_CATEGORY_SCORES = { content: 0, structure: 0, grammar: 0, vocabulary: 0 };


function resultOf(r: RawSubmissionBase, feedbackText: string): GradingResult | undefined {
  if (!r.feedback_id) return undefined;
  return {
    totalScore: Number(r.score ?? 0),
    categoryScores: NO_CATEGORY_SCORES,
    feedback: feedbackText,
    // 一份繳交任何時刻只有一筆有效批改，is_ai 標示那一版是誰寫的
    isAi: r.is_ai !== false,
    isPublished: !!r.is_returned,
  };
}

function toSubmission(
  r: RawSubmissionBase,
  assignmentId: string,
  opts: { content?: string; feedbackText?: string; picFiles?: string[] } = {},
): Submission {
  return {
    /**
     * 未繳交的人沒有 submission 資料列，但名冊上有他 ——
     * 合成一個穩定的假 id，前端的清單、勾選、排序才有東西可以當 key。
     * 形狀沿用原型的 `unsub-` 前綴（見 lib/gradingQueue.ts）。
     */
    id: r.submission_id != null ? String(r.submission_id) : `unsub-${assignmentId}-${r.user_id}`,
    assignmentId,
    studentId: String(r.user_id),
    studentName: r.student_name ?? '',
    seatNo: r.seat_no ?? undefined,
    picFiles: opts.picFiles,
    content: opts.content ?? '',
    submittedAt: r.submited_time ?? '',
    status: submissionStatusOf({
      submissionId: r.submission_id,
      isSubmitted: r.is_submitted,
      hasValidFeedback: !!r.feedback_id,
      isReturned: r.is_returned,
    }),
    result: resultOf(r, opts.feedbackText ?? ''),
  };
}

/** 所有班級的繳交摘要（不含作文全文）。 */
export async function fetchSubmissionSummary(): Promise<Submission[]> {
  const rows = await api.get<RawSummaryRow[]>('/service/instructor/submissions');
  return rows.map((r) => toSubmission(r, String(r.assignment_id)));
}

/** 某一份作業的完整繳交（含作文與評語）。批改頁用。 */
export async function fetchSubmissionsByAssignment(assignmentId: string): Promise<Submission[]> {
  const rows = await api.get<RawDetailRow[]>(
    `/service/instructor/assignments/${assignmentId}/submissions`,
  );
  return rows.map((r) =>
    toSubmission(r, assignmentId, {
      content: r.content ?? '',
      feedbackText: feedbackTextOf(r.ai_analysis),
      picFiles: picFilesOf(r.pic_files),
    }),
  );
}

// ─────────────────────────────────────────────
// 批改
// ─────────────────────────────────────────────

/**
 * 存批改結果。
 *
 * 後端會把這份繳交既有的批改全部設為失效，再寫一筆新的、`is_ai = false`
 * 的版本 —— 教師修改是產生新版本，不是覆蓋欄位。
 */
export async function saveGrading(submissionId: string, result: GradingResult): Promise<void> {
  await api.post(`/service/instructor/submissions/${submissionId}/feedback`, {
    score: result.totalScore,
    // 後端存的是 JSON，response 那一欄才是評語本文
    analysis_content: { score: result.totalScore, response: result.feedback },
  });
}

/** 重置批改：把有效的那一筆設為失效，狀態退回待批改。作文留著。 */
export async function resetGrading(submissionId: string): Promise<void> {
  await api.post(`/service/instructor/grading/reset/${submissionId}`);
}

/** 發還。可以一次多份 —— 後端只會動到呼叫者教的班。 */
export async function returnFeedback(submissionIds: string[]): Promise<void> {
  await api.post('/service/instructor/submission_feedback/return', { submissionIds });
}

/** 用 AI 批改某一份作品。後端會寫入一筆 `is_ai = true` 的版本。 */
export async function gradeWithAi(submissionId: string): Promise<void> {
  await api.post(`/service/instructor/grading/${submissionId}`);
}

// ─────────────────────────────────────────────
// 繳交
// ─────────────────────────────────────────────

/** 清除繳交：整筆刪掉，那位學生回到未繳交、可以重新交。 */
export async function clearSubmission(submissionId: string): Promise<void> {
  await api.del(`/service/instructor/submissions/${submissionId}`);
}

/** 教師代學生繳交。 */
export async function proxySubmit(
  assignmentId: string, studentId: string, content: string, files: string[] = [],
): Promise<void> {
  await api.post('/service/instructor/submissions/proxy', {
    assignment_id: assignmentId,
    user_id: studentId,
    content,
    word_count: content.length,
    files,
  });
}

/** 學生自己繳交。 */
/**
 * 學生繳交，或存成草稿（`isSubmitted: false`）。
 *
 * 同一份作業只會有一列，後端是 upsert，所以存草稿與送出走同一支。
 * 草稿不會寫入 submited_time —— 那一欄的意思是「什麼時候送出的」。
 */
export async function submitEssay(
  assignmentId: string,
  content: string,
  opts: { isSubmitted?: boolean; wordCount?: number; picFiles?: string[] } = {},
): Promise<void> {
  await api.post('/service/student/submit', {
    assignment_id: assignmentId,
    content,
    // 手寫原稿在 GCS 的相對路徑。以前這裡寫死 []，所以新繳交一張原稿都沒留
    pic_files: opts.picFiles ?? [],
    // 字數由畫面算好帶進來（lib/wordCount.ts）。這裡以前是 content.length，
    // 把空白與換行也算進去，跟畫面顯示的數字對不起來
    word_count: opts.wordCount ?? countWords(content),
    is_submitted: opts.isSubmitted !== false,
  });
}

// ─────────────────────────────────────────────
// 作品標記與請假註記
// ─────────────────────────────────────────────

import type { SubmissionMarks, MarkKind } from '../lib/submissionMarks';
import type { LeaveMarks } from '../lib/leave';
import { leaveKey } from '../lib/leave';

/** 作品標記。回傳的形狀直接對上前端的巢狀 Record。 */
export async function fetchMarks(): Promise<SubmissionMarks> {
  const rows = await api.get<Array<{ ref_submission_id: string; kind: string; marked_at: string }>>(
    '/service/instructor/marks',
  );
  const out: SubmissionMarks = {};
  for (const r of rows) {
    const id = String(r.ref_submission_id);
    (out[id] ??= {})[r.kind as MarkKind] = { markedAt: r.marked_at };
  }
  return out;
}

export async function setMark(submissionId: string, kind: MarkKind, marked: boolean): Promise<void> {
  await api.put(`/service/instructor/submissions/${submissionId}/marks/${kind}`, { marked });
}

/** 請假註記。鍵是「作業::學生」，與 lib/leave.ts 的 leaveKey() 一致。 */
export async function fetchLeaves(): Promise<LeaveMarks> {
  const rows = await api.get<Array<{ ref_assignment_id: string; ref_user_id: string }>>(
    '/service/instructor/leaves',
  );
  const out: LeaveMarks = {};
  for (const r of rows) out[leaveKey(String(r.ref_assignment_id), String(r.ref_user_id))] = true;
  return out;
}

export async function setLeave(
  assignmentId: string, studentId: string, onLeave: boolean,
): Promise<void> {
  await api.put(`/service/instructor/assignments/${assignmentId}/leaves/${studentId}`, { onLeave });
}
