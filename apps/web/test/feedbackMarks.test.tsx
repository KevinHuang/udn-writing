/**
 * 評語標色的共用定義（lib/feedbackMarks.ts）。
 *
 * 這裡釘的是**安全邊界**：學生端開了 rehype-raw 之後，markdown 裡的 HTML
 * 會真的被解析，能不能擋住惡意內容就看這份白名單。
 * 另一半是 Word 匯出用的剝標籤 —— 那支匯出是逐行塞純文字，漏掉就會印出標籤。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWED_MARK_CLASSES,
  FEEDBACK_SANITIZE_SCHEMA,
  HIGHLIGHT_COLORS,
  TEXT_COLORS,
  highlightClass,
  stripFeedbackMarks,
  textColorClass,
} from "../lib/feedbackMarks";

describe("標色的 class", () => {
  test("螢光筆四色、文字色三色，class 名稱固定", () => {
    assert.deepEqual(HIGHLIGHT_COLORS.map((c) => c.value), ["yellow", "green", "blue", "pink"]);
    assert.deepEqual(TEXT_COLORS.map((c) => c.value), ["red", "orange", "green"]);
    assert.equal(highlightClass("yellow"), "hl-yellow");
    assert.equal(textColorClass("red"), "tx-red");
  });

  test("白名單就是這七個，沒有別的", () => {
    assert.deepEqual(ALLOWED_MARK_CLASSES, [
      "hl-yellow", "hl-green", "hl-blue", "hl-pink",
      "tx-red", "tx-orange", "tx-green",
    ]);
  });
});

describe("過濾規則（學生端渲染）", () => {
  const schema = FEEDBACK_SANITIZE_SCHEMA;

  test("只多開 mark 與 span 兩個標籤", () => {
    assert.ok(schema.tagNames?.includes("mark"));
    assert.ok(schema.tagNames?.includes("span"));
    assert.ok(!schema.tagNames?.includes("script"));
    assert.ok(!schema.tagNames?.includes("iframe"));
  });

  test("這兩個標籤只放行白名單內的 class，不放行 style 或事件屬性", () => {
    for (const tag of ["mark", "span"] as const) {
      const attrs = schema.attributes?.[tag] as unknown[];
      assert.equal(attrs.length, 1, `${tag} 只該有 className 一條規則`);
      const [name, ...values] = attrs[0] as string[];
      assert.equal(name, "className");
      assert.deepEqual(values, ALLOWED_MARK_CLASSES);
      // 自己編的 class 不在清單裡，會被濾掉
      assert.ok(!values.includes("hl-evil"));
      assert.ok(!values.includes("style"));
      assert.ok(!values.includes("onclick"));
    }
  });
});

describe("剝掉標色（Word 匯出）", () => {
  test("標籤拿掉、文字留著", () => {
    assert.equal(
      stripFeedbackMarks('這句<mark class="hl-yellow">很好</mark>，但<span class="tx-red">有錯字</span>。'),
      "這句很好，但有錯字。",
    );
  });

  test("巢狀與大小寫都吃得下", () => {
    assert.equal(
      stripFeedbackMarks('<MARK class="hl-blue">外<SPAN class="tx-green">內</SPAN></MARK>'),
      "外內",
    );
  });

  test("沒有標色時原樣回傳，空字串也不會爆", () => {
    assert.equal(stripFeedbackMarks("## 標題\n- 條列"), "## 標題\n- 條列");
    assert.equal(stripFeedbackMarks(""), "");
  });
});
