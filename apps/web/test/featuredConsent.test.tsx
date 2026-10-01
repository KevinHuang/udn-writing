/**
 * 學習概況的「佳作還沒決定」提醒（lib/featuredConsent.ts）。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { undecidedFeatured } from "../lib/featuredConsent";
import type { Assignment, Course, Submission } from "../types";

const course = (id: string, semester: string): Course =>
  ({ id, code: "", name: id, semester, studentCount: 0 });
const assignment = (id: string, courseId: string): Assignment =>
  ({ id, title: id, courseId, questionId: "q", config: {}, status: "Published", totalStudents: 0 });
const sub = (id: string, assignmentId: string, over: Partial<Submission>): Submission => ({
  id, assignmentId, studentId: "u", studentName: "我", content: "", submittedAt: "",
  status: "Published", ...over,
});

describe("undecidedFeatured", () => {
  const courses = [course("c1", "115-1"), course("c2", "114-2"), course("c3", "114-1")];
  const assignments = [assignment("a1", "c1"), assignment("a2", "c2"), assignment("a3", "c3")];

  test("只算已發還、是佳作、還沒決定的；最早的學期排第一", () => {
    const r = undecidedFeatured([
      sub("1", "a1", { isFeatured: true, publishConsent: null }),
      sub("2", "a2", { isFeatured: true }),                          // undefined 也算沒決定
      sub("3", "a3", { isFeatured: true, publishConsent: true }),    // 決定了
      sub("4", "a3", { isFeatured: true, publishConsent: false }),   // 決定了
      sub("5", "a3", { isFeatured: false }),                         // 不是佳作
      sub("6", "a3", { isFeatured: true, status: "Graded" }),        // 還沒發還
    ], assignments, courses);
    assert.equal(r.count, 2);
    assert.equal(r.firstSemester, "114-2");
  });

  test("全部決定完就是 0", () => {
    const r = undecidedFeatured([sub("1", "a1", { isFeatured: true, publishConsent: true })], assignments, courses);
    assert.deepEqual(r, { count: 0, firstSemester: undefined });
  });
});
