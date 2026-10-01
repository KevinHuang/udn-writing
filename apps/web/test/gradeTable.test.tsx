/**
 * 成績管理表的每位學生統計與排序（lib/gradeTable.ts）。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { studentGradeStats, sortGradeRows, type GradeRow } from "../lib/gradeTable";
import { setMark } from "../lib/submissionMarks";
import type { Submission } from "../types";

const sub = (id: string, studentId: string, assignmentId: string, over: Partial<Submission> = {}): Submission => ({
  id, assignmentId, studentId, studentName: "王小明", content: "",
  submittedAt: "2026-09-01T00:00:00.000Z", status: "Published", ...over,
});
const graded = (score: number) => ({ result: { totalScore: score } } as Partial<Submission>);

describe("studentGradeStats", () => {
  const scope = new Set(["a1", "a2", "a3", "a4"]);

  test("草稿不算繳交、也不算進平均（以前表格把它當 0 級分）", () => {
    const s = studentGradeStats([
      sub("1", "u1", "a1", graded(6)),
      sub("2", "u1", "a2", { status: "Draft" }),
      sub("3", "u1", "a3", { status: "Unsubmitted" }),
    ], "u1", scope);
    assert.deepEqual(s, { submitted: 1, featured: 0, average: 6 });
  });

  test("待批改算繳交，但還沒有成績，不進平均", () => {
    const s = studentGradeStats([
      sub("1", "u1", "a1", { ...graded(5), status: "Graded" }),
      sub("2", "u1", "a2", graded(4)),
      sub("3", "u1", "a3", { status: "Pending" }),
    ], "u1", scope);
    assert.equal(s.submitted, 3);
    assert.equal(s.average, 4.5);
  });

  test("沒有任何成績時平均是 null，不是 0", () => {
    const s = studentGradeStats([sub("1", "u1", "a1", { status: "Pending" })], "u1", scope);
    assert.equal(s.average, null);
  });

  test("佳作數只算這位學生、這個範圍裡被蓋章的", () => {
    let marks = setMark({}, "1", "featured", true);
    marks = setMark(marks, "2", "preselect", true);    // 預選不算
    marks = setMark(marks, "9", "featured", true);     // 別人的
    marks = setMark(marks, "5", "featured", true);     // 範圍外的作業
    const s = studentGradeStats([
      sub("1", "u1", "a1", graded(6)),
      sub("2", "u1", "a2", graded(5)),
      sub("9", "u2", "a1", graded(6)),
      sub("5", "u1", "a9", graded(6)),
    ], "u1", scope, marks);
    assert.equal(s.featured, 1);
  });

  test("用 studentId 比對：同名的兩位學生分開算", () => {
    const all = [sub("1", "u1", "a1", graded(6)), sub("2", "u2", "a1", graded(2))];
    assert.equal(studentGradeStats(all, "u1", scope).average, 6);
    assert.equal(studentGradeStats(all, "u2", scope).average, 2);
  });
});

describe("sortGradeRows", () => {
  const row = (studentId: string, seatNo: number | undefined, average: number | null, featured = 0): GradeRow =>
    ({ studentId, seatNo, name: studentId, stats: { submitted: 0, featured, average } });
  const rows = [row("c", 3, 4), row("a", 1, null), row("b", 2, 6), row("d", 4, 4)];
  const ids = (r: GradeRow[]) => r.map((x) => x.studentId);

  test("平均高到低；同分依座號；沒有成績的排最後", () => {
    assert.deepEqual(ids(sortGradeRows(rows, "average", "desc")), ["b", "c", "d", "a"]);
  });

  test("平均低到高時，沒有成績的仍然排最後", () => {
    assert.deepEqual(ids(sortGradeRows(rows, "average", "asc")), ["c", "d", "b", "a"]);
  });

  test("回到座號順序；沒有座號的排最後；不改動原陣列", () => {
    const withNoSeat = [...rows, row("z", undefined, 5)];
    assert.deepEqual(ids(sortGradeRows(withNoSeat, "seat", "asc")), ["a", "b", "c", "d", "z"]);
    assert.deepEqual(ids(rows), ["c", "a", "b", "d"]);
  });

  test("依佳作數排序", () => {
    const r = [row("a", 1, 5, 0), row("b", 2, 5, 2), row("c", 3, 5, 1)];
    assert.deepEqual(ids(sortGradeRows(r, "featured", "desc")), ["b", "c", "a"]);
  });
});
