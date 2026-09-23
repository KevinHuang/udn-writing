/**
 * 批改頁左右比例的計算（lib/useSplitPane.ts）。
 *
 * 比例存在 localStorage，老師拖過一次下次就該是那個比例。
 * 這裡釘住的是「存進去的值壞掉時不要把版面弄爛」——
 * 超出範圍、不是數字、根本沒存過，都要回到安全的比例。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { clampPct, parsePct, MIN_PCT, MAX_PCT } from "../lib/useSplitPane";

describe("左右比例", () => {
  test("限制在 30%～75% 之間，兩邊都還放得下內容", () => {
    assert.equal(MIN_PCT, 30);
    assert.equal(MAX_PCT, 75);
    assert.equal(clampPct(10), 30);
    assert.equal(clampPct(90), 75);
    assert.equal(clampPct(55), 55);
  });

  test("小數四捨五入 —— 拖曳算出來的是浮點數", () => {
    assert.equal(clampPct(55.4), 55);
    assert.equal(clampPct(55.6), 56);
  });

  test("沒存過就用預設值", () => {
    assert.equal(parsePct(null, 60), 60);
  });

  test("存的值壞掉（不是數字）也用預設值，不要變成 NaN%", () => {
    assert.equal(parsePct("abc", 60), 60);
    assert.equal(parsePct("", 60), 60);
  });

  test("存的值超出範圍時拉回範圍內", () => {
    assert.equal(parsePct("5", 60), 30);
    assert.equal(parsePct("200", 60), 75);
  });
});
