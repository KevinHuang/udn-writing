/**
 * 題目送回後端的 payload（api/questions.ts 的 toTaskPayload）。
 *
 * 這一支釘的是「漏欄位」這種不會有編譯錯誤、只會安靜失敗的 bug：
 * `refFolderId` 原本就漏了 —— 表單選了資料夾、state 也有值，就是沒送出去，
 * 題目一律落在根目錄；而且 UPDATE 會無條件寫 ref_folder_id，
 * 等於每次編輯都把題目洗回根目錄，連「移動至…」都失效。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { toTaskPayload } from "../api/questions";
import { QuestionType } from "../types";

describe("題目 payload", () => {
  test("有選資料夾就送 refFolderId（數字，後端的 ref_folder_id）", () => {
    const p = toTaskPayload({ title: "題目", content: "題說", folderId: "12" });
    assert.equal(p.refFolderId, 12);
  });

  test("沒選資料夾送 null —— 代表根目錄，不是「不要動它」", () => {
    assert.equal(toTaskPayload({ folderId: null }).refFolderId, null);
    assert.equal(toTaskPayload({}).refFolderId, null);
    // 空字串是表單「未選擇」的值，不能變成 NaN
    assert.equal(toTaskPayload({ folderId: "" }).refFolderId, null);
  });

  test("shared 依題庫別決定：共同題庫才是 true", () => {
    assert.equal(toTaskPayload({ type: QuestionType.SHARED }).shared, true);
    assert.equal(toTaskPayload({ type: QuestionType.PERSONAL }).shared, false);
    // 編輯時忘了帶 type 會被算成個人題目 —— 共同題目會因此掉到個人題庫
    assert.equal(toTaskPayload({}).shared, false);
  });

  test("其餘欄位照舊對應後端的名稱", () => {
    const p = toTaskPayload({
      title: "我的題目",
      content: "題說內容",
      teacherNotes: "給老師看的",
      gradeLevel: "記敘抒情",
      maxScore: 6,
      targetGrades: ["junior"],
    });
    assert.equal(p.title, "我的題目");
    assert.equal(p.description, "題說內容");
    assert.equal(p.note, "給老師看的");
    assert.equal(p.writingType, "記敘抒情");
    assert.equal(p.maxScore, 6);
    assert.deepEqual(p.level, ["國中"]);
  });
});
