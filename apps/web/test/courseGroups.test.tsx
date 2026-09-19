/**
 * 課程依學校分組（lib/courseGroups.ts）。
 *
 * 課程管理、班級挑選視窗、批改入口三個畫面共用這一支。真實資料的校名
 * 大多不帶縣市前綴 —— 規則錯了，整個縣市不明的學校會被併成一組「待確認歸屬」，
 * 老師分不出是哪一間（實測 28 個班有 27 個被併在一起）。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { Course } from "../types";
import {
  groupCoursesBySchool,
  schoolLabel,
  showCitySeparately,
  UNASSIGNED_GROUP,
} from "../lib/courseGroups";

const course = (id: string, over: Partial<Course>): Course => ({
  id, code: "", name: `班級${id}`, semester: "114-2", studentCount: 0, ...over,
});

describe("groupCoursesBySchool", () => {
  test("校名不帶縣市也照學校分組，不要全部併成待確認歸屬", () => {
    const groups = groupCoursesBySchool([
      course("1", { schoolName: "石牌國中" }),
      course("2", { schoolName: "中山國中" }),
      course("3", { schoolName: "石牌國中" }),
    ]);
    assert.deepEqual(groups.map((g) => [g.label, g.courses.length]), [["石牌國中", 2], ["中山國中", 1]]);
  });

  test("只有連校名都沒有的才收進待確認歸屬", () => {
    const groups = groupCoursesBySchool([course("1", {}), course("2", { schoolName: "淡江中學" })]);
    assert.deepEqual(groups.map((g) => g.label), [UNASSIGNED_GROUP, "淡江中學"]);
  });

  test("校名已經以縣市開頭時不重複前綴", () => {
    const groups = groupCoursesBySchool([course("1", { city: "新北市", schoolName: "新北市二重國中" })]);
    assert.equal(groups[0].label, "新北市二重國中");
  });
});

describe("schoolLabel / showCitySeparately", () => {
  test("縣市不在校名裡才另外寫", () => {
    assert.equal(showCitySeparately("新北市", "淡江中學"), true);
    assert.equal(showCitySeparately("新北市", "新北市二重國中"), false);
    assert.equal(showCitySeparately(undefined, "石牌國中"), false);
  });

  test("顯示名可以指定分隔符號", () => {
    assert.equal(schoolLabel("新北市", "淡江中學", "・"), "新北市・淡江中學");
    assert.equal(schoolLabel(undefined, "石牌國中", "・"), "石牌國中");
  });
});
