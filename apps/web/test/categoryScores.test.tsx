/**
 * 四向度的讀取與平均（lib/categoryScores.ts）—— 成績管理的雷達圖。
 *
 * 以前前端一律把四向度填成 0，雷達圖永遠是 0；沒有資料與零級分分不出來。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { averageCategoryScores, categoryScoresOf, CATEGORY_DIMENSIONS } from "../lib/categoryScores";
import type { GradingResult } from "../types";

const row = (over: Record<string, unknown> = {}) => ({
  theme_and_content_score: 4,
  structure_and_organization_score: 5,
  diction_and_sentence_structure_score: 3,
  mechanics_and_punctuation_score: 6,
  ...over,
});

const result = (c?: GradingResult["categoryScores"]): GradingResult => ({
  totalScore: 4, categoryScores: c, feedback: "", isAi: true, isPublished: false,
});

describe("categoryScoresOf", () => {
  test("資料庫欄位對到前端的鍵（mechanics_and_punctuation 是 grammar）", () => {
    assert.deepEqual(categoryScoresOf(row()), { content: 4, structure: 5, vocabulary: 3, grammar: 6 });
  });

  test("字串數字也吃（保險：jsonb 的值不一定是數字）", () => {
    assert.deepEqual(categoryScoresOf(row({ theme_and_content_score: "4" }))?.content, 4);
  });

  test("零級分的四向度是真的 0，要保留", () => {
    const zero = Object.fromEntries(CATEGORY_DIMENSIONS.map(([col]) => [`${col}_score`, 0]));
    assert.deepEqual(categoryScoresOf(zero), { content: 0, structure: 0, vocabulary: 0, grammar: 0 });
  });

  test("沒有四向度（舊批改還沒補）→ undefined，不是 0", () => {
    const none = Object.fromEntries(CATEGORY_DIMENSIONS.map(([col]) => [`${col}_score`, null]));
    assert.equal(categoryScoresOf(none), undefined);
    assert.equal(categoryScoresOf({}), undefined);
  });

  test("缺一個、不是數字、超出 0-6 → 整份當沒有資料，寧可不畫也不要畫錯", () => {
    assert.equal(categoryScoresOf(row({ mechanics_and_punctuation_score: null })), undefined);
    assert.equal(categoryScoresOf(row({ structure_and_organization_score: "好" })), undefined);
    assert.equal(categoryScoresOf(row({ structure_and_organization_score: 7 })), undefined);
    assert.equal(categoryScoresOf(row({ structure_and_organization_score: -1 })), undefined);
  });
});

describe("averageCategoryScores", () => {
  test("沒有四向度的作品不算進平均（以前當 0，把雷達圖拉成 0）", () => {
    const s = averageCategoryScores([
      result({ content: 4, structure: 4, vocabulary: 4, grammar: 4 }),
      result({ content: 6, structure: 5, vocabulary: 3, grammar: 2 }),
      result(undefined),
      undefined,
    ]);
    assert.equal(s.count, 2);
    assert.deepEqual(s.averages, { content: 5, structure: 4.5, vocabulary: 3.5, grammar: 3 });
  });

  test("零級分的 0 是真的分數，要算進去", () => {
    const s = averageCategoryScores([
      result({ content: 0, structure: 0, vocabulary: 0, grammar: 0 }),
      result({ content: 5, structure: 5, vocabulary: 5, grammar: 5 }),
    ]);
    assert.equal(s.count, 2);
    assert.equal(s.averages?.content, 2.5);
  });

  test("取到小數一位", () => {
    const s = averageCategoryScores([
      result({ content: 4, structure: 4, vocabulary: 4, grammar: 4 }),
      result({ content: 4, structure: 4, vocabulary: 4, grammar: 4 }),
      result({ content: 5, structure: 4, vocabulary: 4, grammar: 4 }),
    ]);
    assert.equal(s.averages?.content, 4.3);
  });

  test("全部都沒有四向度 → averages 是 null（畫面顯示「還沒有四向度分數」）", () => {
    assert.deepEqual(averageCategoryScores([result(undefined)]), { averages: null, count: 0 });
    assert.deepEqual(averageCategoryScores([]), { averages: null, count: 0 });
  });
});
