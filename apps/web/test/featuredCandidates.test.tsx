/**
 * 「依級分蓋佳作」挑哪些作品（lib/submissionMarks.ts 的 featuredCandidates）。
 *
 * 這支的規則就是對老師的承諾：只蓋不取消、只挑批改完成的。
 * 規則一鬆，老師按一下就可能蓋到還沒批改的作品，或是覺得系統動了他的章。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { featuredCandidates, setMark, type SubmissionMarks } from "../lib/submissionMarks";
import type { Submission, SubmissionStatus } from "../types";

const sub = (id: string, status: SubmissionStatus, score?: number): Submission => ({
  id,
  assignmentId: "a1",
  studentId: `u${id}`,
  studentName: `學生${id}`,
  content: "",
  submittedAt: "",
  status,
  result: score === undefined ? undefined : {
    totalScore: score,
    categoryScores: { content: 0, structure: 0, grammar: 0, vocabulary: 0 },
    feedback: "",
    isAi: true,
    isPublished: status === "Published",
  },
});

const ids = (subs: Submission[]) => subs.map((s) => s.id);

describe("featuredCandidates", () => {
  test("達到門檻（含等於）的已批改與已發還都列入", () => {
    const subs = [sub("1", "Graded", 5), sub("2", "Published", 6), sub("3", "Graded", 4)];
    assert.deepEqual(ids(featuredCandidates(subs, {}, 5)), ["1", "2"]);
  });

  test("尚未批改、未繳交、草稿一律不列入 —— 那些不能蓋章", () => {
    const subs = [
      sub("1", "Pending"),
      sub("2", "Unsubmitted"),
      sub("3", "Draft"),
      sub("4", "Graded", 6),
    ];
    assert.deepEqual(ids(featuredCandidates(subs, {}, 1)), ["4"]);
  });

  test("已經是佳作的不重複列入", () => {
    const subs = [sub("1", "Graded", 6), sub("2", "Graded", 6)];
    const marks: SubmissionMarks = setMark({}, "1", "featured", true);
    assert.deepEqual(ids(featuredCandidates(subs, marks, 5)), ["2"]);
  });

  test("只蓋了預選的照樣是候選 —— 兩種章互不影響", () => {
    const subs = [sub("1", "Graded", 6)];
    const marks: SubmissionMarks = setMark({}, "1", "preselect", true);
    assert.deepEqual(ids(featuredCandidates(subs, marks, 5)), ["1"]);
  });

  test("低於門檻的佳作不會出現在任何地方 —— 系統不替老師取消", () => {
    // 回傳的只有「要新蓋的」，沒有「要取消的」這條路
    const subs = [sub("1", "Graded", 2)];
    const marks: SubmissionMarks = setMark({}, "1", "featured", true);
    assert.deepEqual(featuredCandidates(subs, marks, 5), []);
  });

  test("維持名冊原本的順序", () => {
    const subs = [sub("9", "Graded", 6), sub("2", "Graded", 5), sub("5", "Published", 6)];
    assert.deepEqual(ids(featuredCandidates(subs, {}, 5)), ["9", "2", "5"]);
  });
});
