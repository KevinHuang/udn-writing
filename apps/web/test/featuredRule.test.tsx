/**
 * 自動蓋佳作的標準 —— 畫面這一側（lib/featuredRule.ts）。
 *
 * 畫面上「這份作業用哪個標準」要跟後端（FeaturedRuleHelper）的判斷一致，
 * 否則老師看到寫「5 級分以上」，實際卻沒蓋。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  applyAssignmentRule, effectiveRule, levelText, modeOf, ruleText,
  type AssignmentRules, type MyFeaturedRule,
} from "../lib/featuredRule";

const ON5: MyFeaturedRule = { enabled: true, minScore: 5 };
const OFF: MyFeaturedRule = { enabled: false, minScore: 5 };

describe("effectiveRule", () => {
  test("作業沒調整 → 用自己的；自己沒開就是不自動蓋", () => {
    assert.deepEqual(effectiveRule("a1", {}, ON5), { minScore: 5, source: "mine" });
    assert.deepEqual(effectiveRule("a1", {}, OFF), { minScore: null, source: "mine" });
  });

  test("作業調整過 → 以作業的為準，自己開不開都一樣", () => {
    const rules: AssignmentRules = { a1: 6, a2: null };
    assert.deepEqual(effectiveRule("a1", rules, OFF), { minScore: 6, source: "assignment" });
    assert.deepEqual(effectiveRule("a2", rules, ON5), { minScore: null, source: "assignment" });
  });
});

describe("modeOf／applyAssignmentRule", () => {
  test("沒有鍵是沿用、null 是不自動蓋、數字是自訂", () => {
    const rules: AssignmentRules = { a1: 6, a2: null };
    assert.equal(modeOf("a0", rules), "inherit");
    assert.equal(modeOf("a1", rules), "custom");
    assert.equal(modeOf("a2", rules), "off");
  });

  test("改回沿用是把鍵整個拿掉，不是留一個 undefined", () => {
    const next = applyAssignmentRule({ a1: 6 }, "a1", "inherit", null);
    assert.deepEqual(next, {});
    assert.equal(modeOf("a1", next), "inherit");
  });

  test("不自動蓋存成 null；自訂存數字；不動到原物件", () => {
    const before: AssignmentRules = { a9: 3 };
    const off = applyAssignmentRule(before, "a1", "off", 4);
    assert.deepEqual(off, { a9: 3, a1: null });
    assert.deepEqual(applyAssignmentRule(off, "a1", "custom", 4), { a9: 3, a1: 4 });
    assert.deepEqual(before, { a9: 3 });
  });
});

describe("文字", () => {
  test("6 級分不寫「以上」", () => {
    assert.equal(levelText(6), "6 級分");
    assert.equal(levelText(5), "5 級分以上");
  });

  test("ruleText", () => {
    assert.equal(ruleText({ minScore: null, source: "mine" }), "不自動蓋");
    assert.equal(ruleText({ minScore: 4, source: "assignment" }), "4 級分以上自動蓋佳作");
  });
});
