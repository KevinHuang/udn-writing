import { api } from './client';
import { CATEGORY_LABELS, type FinalReport } from '@udn/shared';

/**
 * `final_report` 的資料庫列。四個面向在資料庫裡是**八個平鋪的欄位**
 * （分數與摘要各四個），名字又長又容易打錯 —— 對應只寫在這裡一處，
 * 元件拿到的是 `dimensions` 陣列，直接 map 就能畫。
 */
interface RawFinalReport {
  id: string;
  ref_user_id: string;
  student_name: string | null;
  seat_no: number | null;
  avg_score: number | string | null;
  theme_and_content_score: string | null;
  structure_and_organization_score: string | null;
  diction_and_sentence_structure_score: string | null;
  mechanics_and_punctuation_score: string | null;
  theme_and_content_score_summary: string | null;
  structure_and_organization_score_summary: string | null;
  diction_and_sentence_structure_score_summary: string | null;
  mechanics_and_punctuation_score_summary: string | null;
  final_summarys: string | null;
  article_count: number | null;
  hightest_score_title: string | null;
  hightest_score_remark: string | null;
  model_name: string | null;
  created_at: string | null;
}

/**
 * 資料庫的面向欄位 → 前端的四個面向。
 *
 * 左邊那兩個長名稱是資料庫欄位的前綴，右邊是 `CATEGORY_LABELS` 的鍵。
 * **順序就是畫面上的順序**，與會考四項評分要素一致。
 *
 * 注意 `grammar` 對到的是 `mechanics_and_punctuation`（錯別字、格式與標點），
 * 不是文法 —— 這個鍵名是原型留下來的，語意早就漂了，所以在這裡對清楚。
 */
const DIMENSIONS = [
  ['theme_and_content', 'content'],
  ['structure_and_organization', 'structure'],
  ['diction_and_sentence_structure', 'vocabulary'],
  ['mechanics_and_punctuation', 'grammar'],
] as const;

/** numeric(4,1) 經過 pg 回來是字串，double precision 是數字。兩種都要吃 */
const num = (v: number | string | null): number => (v == null ? 0 : Number(v));

/**
 * 同上，但**分不出「0 分」與「沒有資料」的欄位要用這一支**。
 *
 * 四向度的平均在多數批改上是空的（sub_scores 由另一支批次工作寫入）。
 * 回 0 會變成「這位學生立意取材 0 分」——沒有資料就要說沒有資料。
 * 舊資料還可能是 NaN（後端 calculateAvgScore 的 bug，已修），一併擋掉。
 */
const numOrNull = (v: number | string | null): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function toFinalReport(r: RawFinalReport): FinalReport {
  return {
    id: String(r.id),
    studentId: String(r.ref_user_id),
    studentName: r.student_name ?? '',
    seatNo: r.seat_no ?? undefined,
    avgScore: num(r.avg_score),
    dimensions: DIMENSIONS.map(([col, key]) => ({
      key,
      label: CATEGORY_LABELS[key] ?? key,
      score: numOrNull(r[`${col}_score`]),
      summary: r[`${col}_score_summary`] ?? '',
    })),
    finalSummary: r.final_summarys ?? '',
    articleCount: r.article_count ?? 0,
    // 標題與評語要嘛一起有、要嘛都沒有（calculate 是一起寫的）
    best: r.hightest_score_title
      ? { title: r.hightest_score_title, remark: r.hightest_score_remark ?? '' }
      : undefined,
    modelName: r.model_name ?? '',
    createdAt: r.created_at ?? '',
  };
}

/**
 * 這堂課每位學生的期末總結。
 *
 * 後端已經照座號排好，也已經擋掉不是自己任教的班（回空陣列）——
 * 前端不再自己過濾或排序。
 */
export async function fetchFinalReports(courseId: string): Promise<FinalReport[]> {
  const rows = await api.get<RawFinalReport[]>(
    `/service/instructor/courses/${courseId}/finalReports`,
  );
  return rows.map(toFinalReport);
}

/** 產生期末總結的結果。generated = 這次新產生的，skipped = 沒有可總結的作品 */
export interface GenerateResult { generated: number; skipped: number }

/**
 * 為這堂課還沒有總結的學生產生期末總結。
 *
 * **只處理還沒有的**，所以重複按是安全的：已經產生過的不會重算，
 * 也不會重複燒 AI 的錢。要重算某位學生得先把那一筆刪掉（目前沒有這個功能）。
 */
export async function generateFinalReports(courseId: string): Promise<GenerateResult> {
  return api.post<GenerateResult>(`/service/instructor/courses/${courseId}/finalReports`);
}
