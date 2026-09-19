/**
 * 作業的階段與收件規則（lib/assignments.ts）。
 *
 * **收不收件只看截止日** —— 老師端的徽章、篩選、換題，學生端的作業清單、
 * 待辦、寫作頁唯讀、通知，全部都問這幾支函式。規則錯一條，兩端會一起錯，
 * 而且畫面看起來都很合理，所以在這裡釘住。
 *
 * 後端 /student/submit 與換題 API 擋的是同一條規則（SQL 版），
 * 那一邊由 apps/api 的 submission.test.ts、assignment.test.ts 蓋著。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { Assignment } from "../types";
import {
  assignmentPhase,
  canStudentSubmit,
  isLateSubmission,
  canSwapQuestion,
  swapBlockedReason,
  endNow,
  openAssignment,
  toggleVisibility,
} from "../lib/assignments";

const NOW = new Date("2026-09-18T12:00:00+08:00");
const PAST = "2026-09-17T12:00:00+08:00";
const FUTURE = "2026-09-19T12:00:00+08:00";

const make = (over: Partial<Assignment> & { deadline?: string; allowLate?: boolean } = {}): Assignment => ({
  id: "a1",
  title: "那次失敗之後",
  courseId: "c1",
  questionId: "q1",
  status: over.status ?? "Published",
  totalStudents: 0,
  config: { deadline: over.deadline, allowLateSubmission: over.allowLate ?? false },
});

describe("assignmentPhase：未開放／收件中／已截止", () => {
  test("Draft 一律是未開放，不管截止日", () => {
    assert.equal(assignmentPhase(make({ status: "Draft", deadline: FUTURE }), NOW), "draft");
    assert.equal(assignmentPhase(make({ status: "Draft", deadline: PAST }), NOW), "draft");
  });

  test("已開放、沒有截止日 → 收件中（不限期）", () => {
    assert.equal(assignmentPhase(make(), NOW), "open");
  });

  test("已開放、截止日還沒到 → 收件中；過了 → 已截止", () => {
    assert.equal(assignmentPhase(make({ deadline: FUTURE }), NOW), "open");
    assert.equal(assignmentPhase(make({ deadline: PAST }), NOW), "ended");
  });

  test("API 回來的截止日是帶時區的 ISO 字串，照樣算得對", () => {
    // 2026-09-18 03:59 UTC ＝ 台灣 11:59，比 NOW（台灣 12:00）早一分鐘
    assert.equal(assignmentPhase(make({ deadline: "2026-09-18T03:59:00.000Z" }), NOW), "ended");
    assert.equal(assignmentPhase(make({ deadline: "2026-09-18T04:01:00.000Z" }), NOW), "open");
  });
});

describe("canStudentSubmit：學生能不能交（含存草稿）", () => {
  test("未開放 → 不能", () => {
    assert.equal(canStudentSubmit(make({ status: "Draft" }), NOW), false);
  });

  test("收件中 → 能", () => {
    assert.equal(canStudentSubmit(make(), NOW), true);
    assert.equal(canStudentSubmit(make({ deadline: FUTURE }), NOW), true);
  });

  test("已截止：不收遲交 → 不能；允許遲交 → 能", () => {
    assert.equal(canStudentSubmit(make({ deadline: PAST }), NOW), false);
    assert.equal(canStudentSubmit(make({ deadline: PAST, allowLate: true }), NOW), true);
  });
});

describe("isLateSubmission：遲交用算的，不存", () => {
  const a = make({ deadline: PAST, allowLate: true });

  test("截止之後才交 → 遲交；之前交 → 不是", () => {
    assert.equal(isLateSubmission({ submittedAt: "2026-09-17T13:00:00+08:00" }, a), true);
    assert.equal(isLateSubmission({ submittedAt: "2026-09-17T11:00:00+08:00" }, a), false);
  });

  test("沒有截止日、或還沒送出（submittedAt 空字串）→ 永遠不是遲交", () => {
    assert.equal(isLateSubmission({ submittedAt: "2026-09-17T13:00:00+08:00" }, make()), false);
    assert.equal(isLateSubmission({ submittedAt: "" }, a), false);
  });
});

describe("canSwapQuestion：只在確定沒人正在寫時可以換題", () => {
  test("未開放 → 可以", () => {
    assert.equal(canSwapQuestion(make({ status: "Draft" }), NOW), true);
  });

  test("已截止且不收遲交 → 可以", () => {
    assert.equal(canSwapQuestion(make({ deadline: PAST }), NOW), true);
  });

  test("收件中 → 不行，原因要叫老師先立即截止或改回未開放", () => {
    const a = make({ deadline: FUTURE });
    assert.equal(canSwapQuestion(a, NOW), false);
    assert.match(swapBlockedReason(a, NOW), /立即截止/);
  });

  test("已截止但允許遲交 → 不行，原因要叫老師先取消允許遲交", () => {
    const a = make({ deadline: PAST, allowLate: true });
    assert.equal(canSwapQuestion(a, NOW), false);
    assert.match(swapBlockedReason(a, NOW), /允許遲交/);
  });
});

describe("狀態變更", () => {
  test("立即截止之後，這一分鐘內就已經是已截止（不會按了看不到變化）", () => {
    const ended = endNow(make({ deadline: FUTURE }), NOW);
    assert.equal(assignmentPhase(ended, NOW), "ended");
  });

  test("立即截止保留原本的允許遲交設定", () => {
    const ended = endNow(make({ deadline: FUTURE, allowLate: true }), NOW);
    assert.equal(ended.config.allowLateSubmission, true);
  });

  test("開放時記下第一次開放時間，收回再開不會覆蓋", () => {
    const first = openAssignment(make({ status: "Draft" }));
    assert.ok(first.publishedAt);
    const reopened = toggleVisibility(toggleVisibility(first));
    assert.equal(reopened.status, "Published");
    assert.equal(reopened.publishedAt, first.publishedAt);
  });
});
