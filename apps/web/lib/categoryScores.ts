import type { GradingResult } from '@udn/shared';

/**
 * 四向度：資料庫欄位 ↔ 前端的鍵。
 *
 * 資料庫（`submission_feedback.sub_scores`、`final_report`）用的是又長又容易打錯的
 * 英文前綴，前端用 `CATEGORY_LABELS` 的四個鍵。對照只寫在這裡一處 ——
 * 繳交摘要（api/submissions.ts）與期末總結（api/finalReports.ts）都讀這一份。
 *
 * **順序就是畫面上的順序**，與會考四項評分要素一致。
 *
 * 注意 `grammar` 對到的是 `mechanics_and_punctuation`（錯別字、格式與標點），
 * 不是文法 —— 這個鍵名是原型留下來的，語意早就漂了，所以在這裡對清楚。
 */
export const CATEGORY_DIMENSIONS = [
  ['theme_and_content', 'content'],
  ['structure_and_organization', 'structure'],
  ['diction_and_sentence_structure', 'vocabulary'],
  ['mechanics_and_punctuation', 'grammar'],
] as const;

export type CategoryKey = typeof CATEGORY_DIMENSIONS[number][1];
export type CategoryScores = NonNullable<GradingResult['categoryScores']>;

/**
 * 後端那一列的四個分數欄位（`<前綴>_score`）→ categoryScores。
 *
 * **四個都要是 0-6 的數字才算有資料**，缺任何一個就回 undefined（沒有資料）。
 * 四向度是同一次產生的（AI 批改或管理員的批次補分），不會只有一半；
 * 真的缺了，代表那一筆有問題，寧可不畫也不要畫錯。
 * 後端用 jsonb 的 `->` 取值，pg 多半給數字；保險起見字串也吃。
 */
export function categoryScoresOf(row: Record<string, unknown>): CategoryScores | undefined {
  const out: Partial<Record<CategoryKey, number>> = {};
  for (const [col, key] of CATEGORY_DIMENSIONS) {
    const raw = row[`${col}_score`];
    if (raw == null || raw === '') return undefined;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 6) return undefined;
    out[key] = n;
  }
  return out as CategoryScores;
}

export interface CategoryAverages {
  /** 四向度各自的平均，取到小數一位。沒有任何一篇有四向度時是 null */
  averages: Record<CategoryKey, number> | null;
  /** 有四向度、納入平均的篇數 */
  count: number;
}

/**
 * 一群批改結果的四向度平均（成績管理的雷達圖）。
 *
 * **沒有四向度的作品不算進來** —— 以前沒有資料的一律當 0，
 * 雷達圖整張被拉成 0。零級分的作品四向度本來就是 0，那是真的 0，要算。
 */
export function averageCategoryScores(results: (GradingResult | undefined)[]): CategoryAverages {
  const withScores = results
    .map((r) => r?.categoryScores)
    .filter((c): c is CategoryScores => c !== undefined);
  if (withScores.length === 0) return { averages: null, count: 0 };

  const averages = {} as Record<CategoryKey, number>;
  for (const [, key] of CATEGORY_DIMENSIONS) {
    const sum = withScores.reduce((acc, c) => acc + c[key], 0);
    averages[key] = Math.round((sum / withScores.length) * 10) / 10;
  }
  return { averages, count: withScores.length };
}
