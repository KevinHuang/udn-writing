import { api } from './client';
import { QuestionType, type Question, type TargetGrade, type QuestionSource } from '@udn/shared';

interface RawTask {
  id: string;
  title: string | null;
  description: string | null;
  note: string | null;
  pic1: string | null;
  pic_position: string | null;
  level: string[] | null;
  source: string[] | null;
  shared: boolean | null;
  ref_org_id: string | null;
  ref_instruction_id: string | null;
  // ── migration 002 補的五個 ──
  is_archived: boolean | null;
  writing_type: string | null;
  max_score: number | null;
  preferred_ai_model: string | null;
  pic1_description: string | null;
  ref_folder_id: string | null;
}

/**
 * 適用階段。資料庫存的是中文（`國小` / `國中` / `高中`），
 * 前端型別是英文代碼 —— 對照收在這裡，不要在畫面裡各自 if。
 *
 * ⚠️ 前端的 TargetGrade 沒有「高中」以外的第四種，而資料庫就這三種，
 *    所以是一對一。若之後資料庫多出別的值，這裡會安靜地丟掉它 ——
 *    下面的 filter(Boolean) 就是那個「安靜」。
 */
const LEVEL_TO_GRADE: Record<string, TargetGrade> = {
  國小: 'elementary',
  國中: 'junior',
  高中: 'senior',
};
const GRADE_TO_LEVEL: Record<TargetGrade, string> = {
  elementary: '國小',
  junior: '國中',
  senior: '高中',
};

/**
 * 題目來源。
 *
 * 資料庫實際只出現三種（聯合報／聯合盃／會考歷屆）。前端型別另外還有
 * `original`（自建）與 `textbook`（教科書）—— 那兩個是原型自己加的，
 * 資料庫裡沒有對應值，所以只會在前端新建的題目上出現。
 */
const SOURCE_TO_CODE: Record<string, QuestionSource> = {
  會考歷屆: 'exam_archive',
  聯合報: 'udn',
  聯合盃: 'udn_cup',
};
const CODE_TO_SOURCE: Partial<Record<QuestionSource, string>> = {
  exam_archive: '會考歷屆',
  udn: '聯合報',
  udn_cup: '聯合盃',
};

function toQuestion(r: RawTask): Question {
  return {
    id: String(r.id),
    title: r.title ?? '',
    // 資料庫的 description 就是原型的「題說」
    content: r.description ?? '',
    type: r.shared ? QuestionType.SHARED : QuestionType.PERSONAL,
    folderId: r.ref_folder_id != null ? String(r.ref_folder_id) : null,
    /**
     * 前端叫 gradeLevel，但它裝的是**寫作類型**不是學段 ——
     * 資料庫那一欄因此叫 writing_type（見 migration 002 的說明）。
     * 學段是另一回事，在下面的 targetGrades。
     */
    gradeLevel: r.writing_type ?? '',
    isArchived: r.is_archived ?? false,
    maxScore: r.max_score ?? undefined,
    preferredAiModel: r.preferred_ai_model ?? undefined,
    aiImageDescription: r.pic1_description ?? undefined,
    teacherNotes: r.note ?? undefined,
    imageUrl: r.pic1 || undefined,
    imagePosition: r.pic_position === 'before' ? 'before' : 'after',
    targetGrades: (r.level ?? []).map((v) => LEVEL_TO_GRADE[v]).filter(Boolean),
    sources: (r.source ?? []).map((v) => SOURCE_TO_CODE[v]).filter(Boolean),
    /**
     * ⚠️ 原型的 gradingCriteria 是「每題自己一段評分規準」，
     *    資料庫是 task.ref_instruction_id **指向一張共用的 system_instruction 表**
     *    （48 個題目共用 2 筆）。兩者不是同一個東西 ——
     *    這裡先不對應，避免把共用的提示詞誤植成某一題專屬的。
     *    見 artifacts/api-gap.md。
     */
    gradingCriteria: undefined,
  };
}

/** 送回後端時的形狀。只送後端真的收的欄位。 */
function toTaskPayload(q: Partial<Question>) {
  return {
    title: q.title,
    description: q.content,
    note: q.teacherNotes ?? '',
    pic1: q.imageUrl ?? '',
    pic_position: q.imagePosition ?? 'after',
    level: (q.targetGrades ?? []).map((g) => GRADE_TO_LEVEL[g]),
    source: (q.sources ?? []).map((s) => CODE_TO_SOURCE[s]).filter(Boolean),
    shared: q.type === QuestionType.SHARED,
    writingType: q.gradeLevel || null,
    maxScore: q.maxScore ?? null,
    preferredAiModel: q.preferredAiModel ?? null,
    pic1Description: q.aiImageDescription ?? null,
  };
}

export async function fetchQuestions(): Promise<Question[]> {
  const rows = await api.get<RawTask[]>('/service/instructor/tasks');
  return rows.map(toQuestion);
}

export async function createQuestion(q: Partial<Question>): Promise<void> {
  await api.post('/service/instructor/tasks', toTaskPayload(q));
}

export async function updateQuestion(id: string, q: Partial<Question>): Promise<void> {
  await api.put(`/service/instructor/tasks/${id}`, toTaskPayload(q));
}

export async function deleteQuestion(id: string): Promise<void> {
  await api.del(`/service/instructor/tasks/${id}`);
}

/**
 * 封存／取消封存。
 *
 * 獨立一支而不是走 updateQuestion()：封存是清單上的一個開關，
 * 呼叫端手上沒有題目的其他欄位，整包寫回會蓋掉別人同時改的東西。
 */
export async function setQuestionArchived(id: string, archived: boolean): Promise<void> {
  await api.put(`/service/instructor/tasks/${id}/archived`, { archived });
}
