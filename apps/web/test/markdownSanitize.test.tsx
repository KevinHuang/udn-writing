/**
 * 學生端渲染評語的過濾（components/Markdown.tsx）。
 *
 * 這一支測的是**安全邊界**，不是排版：為了讓老師標的螢光筆與文字色
 * 學生也看得到，Markdown 元件開了 rehype-raw —— markdown 裡的 HTML 會
 * 真的被解析。擋住惡意內容的只剩 rehype-sanitize 的白名單那一層，
 * 所以這裡把「什麼該過、什麼該擋」全部釘死。
 *
 * 評語的來源是 AI 產生 + 老師編輯，中間還夾著學生作文，等於使用者輸入。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "../components/Markdown";

const render = (md: string) =>
  renderToStaticMarkup(React.createElement(Markdown, { children: md }));

describe("評語渲染：該過的", () => {
  test("螢光筆與文字色的標籤會保留（學生看得到老師的標記）", () => {
    const html = render('這句<mark class="hl-yellow">很好</mark>，但<span class="tx-red">有錯字</span>。');
    assert.match(html, /<mark class="hl-yellow">很好<\/mark>/);
    assert.match(html, /<span class="tx-red">有錯字<\/span>/);
  });

  test("markdown 本身照常渲染", () => {
    const html = render("## 標題\n\n- 條列\n\n**粗體**");
    assert.match(html, /<h2>標題<\/h2>/);
    assert.match(html, /<li>條列<\/li>/);
    assert.match(html, /<strong>粗體<\/strong>/);
  });

  test("表格與待辦清單（老師的工具列做得出來，學生要看得到）", () => {
    const table = render("| 向度 | 評語 |\n| --- | --- |\n| 結構 | 完整 |");
    assert.match(table, /<table>/);
    assert.match(table, /<td>結構<\/td>/);
    const task = render("- [x] 已完成\n- [ ] 待改進");
    assert.match(task, /type="checkbox"/);
  });
});

describe("評語渲染：該擋的", () => {
  test("script 整個不見", () => {
    const html = render('<script>alert(1)</script>正文');
    assert.ok(!html.includes("<script"));
    assert.ok(!html.includes("alert(1)"));
    assert.match(html, /正文/);
  });

  test("自己編的 class 會被拿掉，文字留著", () => {
    const html = render('<mark class="hl-evil">文字</mark>');
    assert.ok(!html.includes("hl-evil"));
    assert.match(html, /文字/);
  });

  test("行內 style 不放行（否則等於開了任意 CSS）", () => {
    const html = render('<span style="color:red">文字</span>');
    assert.ok(!html.includes("style="));
    assert.match(html, /文字/);
  });

  test("事件屬性與 img 的 onerror 不放行", () => {
    const html = render('<img src="x" onerror="alert(1)">');
    assert.ok(!html.includes("onerror"));
    assert.ok(!html.includes("alert(1)"));
  });

  test("javascript: 連結不放行", () => {
    const html = render('<a href="javascript:alert(1)">連結</a>');
    assert.ok(!html.includes("javascript:"));
  });

  test("iframe 不放行", () => {
    const html = render('<iframe src="https://example.com"></iframe>');
    assert.ok(!html.includes("<iframe"));
  });
});
