/**
 * 學期下拉要列哪些（lib/semester.ts 的 selectableSemesters）。
 *
 * 後端的 semesters 表預先建到好幾年後，還有重複列；
 * 選單只列到目前學期為止，而且同一個學期只出現一次。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { selectableSemesters, compareSemester, toSemester } from "../lib/semester";

const s = (v: string) => {
  const [y, t] = v.split("-").map(Number);
  return toSemester(y, t);
};
const values = (list: ReturnType<typeof s>[]) => list.map((x) => x.value);

describe("selectableSemesters", () => {
  // 後端給的樣子：新的在前，含未來學期與一筆重複的 118-2
  const fromApi = ["119-1", "118-2", "118-2", "117-1", "116-2", "115-2", "115-1", "114-2", "114-1"].map(s);

  test("只列到目前學期為止，未來的學期不列", () => {
    assert.deepEqual(values(selectableSemesters(fromApi, s("115-1"))), ["115-1", "114-2", "114-1"]);
  });

  test("同一個學年度的第 2 學期在第 1 學期之後", () => {
    assert.deepEqual(values(selectableSemesters(fromApi, s("115-2"))), ["115-2", "115-1", "114-2", "114-1"]);
    assert.ok(compareSemester(s("115-2"), s("116-1")) < 0);
  });

  test("重複的學期只留一個", () => {
    const got = values(selectableSemesters(fromApi, s("119-1")));
    assert.equal(got.filter((v) => v === "118-2").length, 1);
  });

  test("順序一律新的在前，不依賴後端給的順序", () => {
    const shuffled = ["114-1", "115-1", "114-2"].map(s);
    assert.deepEqual(values(selectableSemesters(shuffled, s("115-1"))), ["115-1", "114-2", "114-1"]);
  });

  test("後端沒給目前學期時不過濾，選單不會是空的", () => {
    assert.equal(selectableSemesters(fromApi, null).length, 8);
  });
});
