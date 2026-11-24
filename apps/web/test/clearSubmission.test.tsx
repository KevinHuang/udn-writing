/**
 * 清除繳交的確認文案（lib/clearSubmission.ts）。
 *
 * 釘的是一句承諾：**不要再一律跟老師說「學生可以重新繳交」**。
 * 作業已截止又不收遲交時，後端 /student/submit 會把學生擋在 409 ——
 * 老師照著文案叫他重交，他交不了，而老師不會知道要先改截止設定。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { clearSubmissionText, resubmitNote } from "../lib/clearSubmission";
import type { Assignment } from "../types";

const NOW = new Date("2026-11-24T12:00:00+08:00");
const PAST = "2026-11-23T12:00:00+08:00";
const FUTURE = "2026-11-30T12:00:00+08:00";

const make = (over: Partial<Assignment> & { deadline?: string; allowLate?: boolean } = {}): Assignment => ({
  id: "a1",
  title: "那次失敗之後",
  courseId: "c1",
  questionId: "q1",
  status: over.status ?? "Published",
  totalStudents: 0,
  config: { deadline: over.deadline, allowLateSubmission: over.allowLate ?? false },
});

describe("resubmitNote", () => {
  test("收件中：學生可以自己重交", () => {
    assert.match(resubmitNote(make({ deadline: FUTURE }), NOW)!, /可以自己重新繳交/);
    assert.match(resubmitNote(make(), NOW)!, /可以自己重新繳交/, "沒有截止日也是收件中");
  });

  test("已截止又不收遲交：說清楚他交不了，而且老師要先做什麼", () => {
    const note = resubmitNote(make({ deadline: PAST }), NOW)!;
    assert.match(note, /不能自己重新繳交/);
    assert.match(note, /截止日/);
  });

  test("已截止但允許遲交：還是交得進去", () => {
    assert.match(resubmitNote(make({ deadline: PAST, allowLate: true }), NOW)!, /可以自己重新繳交/);
  });

  test("未開放：要先把作業開放，不是改截止日", () => {
    const note = resubmitNote(make({ status: "Draft" }), NOW)!;
    assert.match(note, /未開放/);
    assert.match(note, /開放/);
  });

  test("查不到作業就不要猜 —— 那一句整個不出現", () => {
    assert.equal(resubmitNote(undefined, NOW), null);
  });
});

describe("clearSubmissionText", () => {
  test("帶學生姓名，講明刪掉什麼、回到什麼狀態", () => {
    const { title, message } = clearSubmissionText("王宥人", make({ deadline: FUTURE }), NOW);
    assert.equal(title, "清除繳交內容");
    assert.match(message, /王宥人/);
    assert.match(message, /未繳交/);
    assert.match(message, /無法復原/);
  });

  test("已截止的作業：訊息裡不會出現「可以自己重新繳交」", () => {
    const { message } = clearSubmissionText("王宥人", make({ deadline: PAST }), NOW);
    assert.equal(/可以自己重新繳交/.test(message), false);
    assert.match(message, /不能自己重新繳交/);
  });

  test("沒有作業資料時，只少掉那一句，其餘照舊", () => {
    const { message } = clearSubmissionText("王宥人", undefined, NOW);
    assert.match(message, /未繳交/);
    assert.match(message, /無法復原/);
    assert.equal(/重新繳交/.test(message), false);
  });
});
