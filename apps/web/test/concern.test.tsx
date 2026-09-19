/**
 * 關心名單的三份名單（lib/concern.ts 的 concernListsForCourse）。
 *
 * 畫面上「低分」旁的說明文字是照這些規則寫的，規則一改，
 * 老師看到的說明就會跟名單對不起來，所以在這裡釘住。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  concernListsForCourse,
  LOW_SCORE_THRESHOLD,
  CONCERN_LIST_SIZE,
  type StudentStat,
} from "../lib/concern";

const stat = (
  studentId: string,
  over: Partial<StudentStat> = {},
): StudentStat => ({
  studentId,
  name: `學生${studentId}`,
  avgScore: 0,
  gradedCount: 1,
  missingCount: 0,
  submissionCount: 3,
  totalAssignments: 3,
  ...over,
});

/** 五位平均 5 級分的學生，把「表現優異」的名額佔滿 */
const fiveHigh = () =>
  ["h1", "h2", "h3", "h4", "h5"].map((id) => stat(id, { avgScore: 5 }));

const lowIds = (stats: StudentStat[]) =>
  concernListsForCourse(stats).lowScoreStudents.map((s) => s.studentId);

describe("低分名單", () => {
  test("門檻是未達 3 級分：2.9 列入，3.0 不列入", () => {
    assert.equal(LOW_SCORE_THRESHOLD, 3);
    const ids = lowIds([
      ...fiveHigh(),
      stat("a", { avgScore: 2.9 }),
      stat("b", { avgScore: 3 }),
    ]);
    assert.deepEqual(ids, ["a"]);
  });

  test("還沒有批改成績的學生不列入（avgScore 的 0 不是 0 級分）", () => {
    const noGrade = stat("n", { avgScore: 0, gradedCount: 0 });
    const lists = concernListsForCourse([...fiveHigh(), noGrade]);
    assert.deepEqual(lists.lowScoreStudents, []);
    // 也不該擠進表現優異
    assert.ok(!lists.topStudents.some((s) => s.studentId === "n"));
  });

  test("真的拿到 0 級分的學生要列入", () => {
    assert.deepEqual(lowIds([...fiveHigh(), stat("z", { avgScore: 0 })]), ["z"]);
  });

  test("已在表現優異名單上的學生，平均再低也不列入（全班都低於 3 級分的小班）", () => {
    const stats = [
      stat("a", { avgScore: 2.8 }),
      stat("b", { avgScore: 2.5 }),
      stat("c", { avgScore: 2 }),
    ];
    const lists = concernListsForCourse(stats);
    assert.equal(lists.topStudents.length, 3);
    assert.deepEqual(lists.lowScoreStudents, []);
  });

  test("已在缺交名單上的學生不重複列入", () => {
    const ids = lowIds([
      ...fiveHigh(),
      stat("m", { avgScore: 1, missingCount: 2 }),
      stat("l", { avgScore: 2 }),
    ]);
    assert.deepEqual(ids, ["l"]);
  });

  test("排除比的是 studentId，同名的另一位學生不會被誤排除", () => {
    const ids = lowIds([
      ...fiveHigh(),
      stat("m1", { name: "王小明", avgScore: 1, missingCount: 1 }),
      stat("m2", { name: "王小明", avgScore: 2 }),
    ]);
    assert.deepEqual(ids, ["m2"]);
  });

  test("最多列 5 位，平均最低的排前面", () => {
    assert.equal(CONCERN_LIST_SIZE, 5);
    const lows = [2.5, 0.5, 2, 1, 1.5, 2.8, 0].map((avg, i) =>
      stat(`l${i}`, { avgScore: avg }),
    );
    const got = concernListsForCourse([...fiveHigh(), ...lows]).lowScoreStudents;
    assert.deepEqual(
      got.map((s) => s.avgScore),
      [0, 0.5, 1, 1.5, 2],
    );
  });
});
