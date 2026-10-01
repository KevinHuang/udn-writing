/**
 * 成績管理「學習歷程」視窗的作品清單（lib/studentHistory.ts）。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { studentHistory } from "../lib/studentHistory";
import type { Submission } from "../types";

const sub = (id: string, studentId: string, over: Partial<Submission> = {}): Submission => ({
  id, assignmentId: "a1", studentId, studentName: "王小明", content: "",
  submittedAt: "2026-09-01T00:00:00.000Z", status: "Published", ...over,
});

describe("studentHistory", () => {
  test("同班兩位同名學生，各自只看到自己的作品", () => {
    const all = [sub("1", "u1"), sub("2", "u2"), sub("3", "u1", { assignmentId: "a2" })];
    assert.deepEqual(studentHistory(all, "u1").map((s) => s.id).sort(), ["1", "3"]);
    assert.deepEqual(studentHistory(all, "u2").map((s) => s.id), ["2"]);
  });

  test("只收已批改與已發還，新的在前", () => {
    const r = studentHistory([
      sub("old", "u1", { submittedAt: "2026-03-01T00:00:00.000Z", status: "Graded" }),
      sub("new", "u1", { submittedAt: "2026-09-20T00:00:00.000Z" }),
      sub("pending", "u1", { status: "Pending" }),
      sub("missing", "u1", { status: "Unsubmitted" }),
    ], "u1");
    assert.deepEqual(r.map((s) => s.id), ["new", "old"]);
  });
});
