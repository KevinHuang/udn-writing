/**
 * 重置批改的範圍與文案（lib/resetGrading.ts）。
 *
 * 釘兩件事：
 *   1. **數字與動作是同一支算的。** 清單那顆「重置批改 (N)」以前只數
 *      `status === 'Graded'`，而執行時連 `Published` 一起重置 ——
 *      勾 2 份已批改 ＋ 3 份已發還，按鈕寫 (2) 卻動 5 份。
 *   2. **已發還一定要被說出來。** 重置會把學生已經看到的成績收回，
 *      而老師多半只是想改原稿上的紅筆（那該用「收回發還」）。
 *      文案漏了這一句，就是一次沒辦法復原的誤按。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { canResetGrading, resetConfirmText, resetTargets } from "../lib/resetGrading";
import type { Submission } from "../types";

const sub = (id: string, over: Partial<Submission> = {}): Submission => ({
  id,
  assignmentId: "a1",
  studentId: `u${id}`,
  studentName: "王小明",
  content: "作文",
  submittedAt: "2026-11-01T00:00:00.000Z",
  status: "Graded",
  ...over,
});

describe("canResetGrading", () => {
  test("批改完成的兩種狀態都可以重置", () => {
    assert.equal(canResetGrading("Graded"), true);
    assert.equal(canResetGrading("Published"), true);
  });

  test("還沒批改的不行 —— 沒有東西可以退回", () => {
    assert.equal(canResetGrading("Pending"), false);
    assert.equal(canResetGrading("Draft"), false);
    assert.equal(canResetGrading("Unsubmitted"), false);
  });
});

describe("resetTargets", () => {
  const rows = [
    sub("1", { status: "Graded" }),
    sub("2", { status: "Published" }),
    sub("3", { status: "Pending" }),
    sub("4", { status: "Unsubmitted" }),
  ];

  test("已發還的要算進去 —— 按鈕的數字和實際會動的份數必須一樣", () => {
    assert.equal(resetTargets(rows, ["1", "2"]).length, 2);
  });

  test("只勾已發還時不是 0（以前按鈕停用，那條路走不到）", () => {
    assert.equal(resetTargets(rows, ["2"]).length, 1);
  });

  test("勾到還沒批改的會被濾掉", () => {
    assert.deepEqual(resetTargets(rows, ["1", "3", "4"]).map((s) => s.id), ["1"]);
  });

  test("沒勾選就沒有目標 —— 不該有「沒選就全部重置」", () => {
    assert.equal(resetTargets(rows, []).length, 0);
  });
});

describe("resetConfirmText", () => {
  test("單筆帶學生姓名", () => {
    const { title, message } = resetConfirmText([sub("1", { studentName: "李小美" })]);
    assert.equal(title, "重置批改");
    assert.match(message, /李小美/);
    assert.match(message, /退回「待批改」/);
  });

  test("多筆帶份數", () => {
    const { title, message } = resetConfirmText([sub("1"), sub("2")]);
    assert.match(title, /2 份/);
    assert.match(message, /這 2 份/);
  });

  test("有已發還的就說成績會被收回，並指出「收回發還」那條路", () => {
    const message = resetConfirmText([sub("1"), sub("2", { status: "Published" })]).message;
    assert.match(message, /其中 1 份已經發還/);
    assert.match(message, /收回發還/);
  });

  test("沒有已發還的就不要嚇老師", () => {
    const message = resetConfirmText([sub("1"), sub("2")]).message;
    assert.equal(/收回/.test(message), false);
  });

  test("簡易批改的評分依據會被刪掉，這件事每次都要講", () => {
    for (const targets of [[sub("1")], [sub("1"), sub("2", { status: "Published" })]]) {
      assert.match(resetConfirmText(targets).message, /評分依據/);
    }
  });
});
