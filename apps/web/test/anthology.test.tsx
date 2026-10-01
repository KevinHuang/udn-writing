/**
 * 成果集的挑選與排版（lib/anthology.ts）。
 *
 * 排版的承諾是「目錄上的頁碼就是實際的頁碼」—— 原型用字數估頁，
 * 長文章一多，後面每一篇的頁碼都錯。這裡釘住的就是那些會讓頁碼跑掉的規則。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  BODY_HEIGHT, SHEET, TOC_ROWS_PER_PAGE,
  buildBook, commentPlainLines, essayLines, layoutWorkText, pickMyWorks, pickSubmissions, titlesOf,
  toEntry, wrapLine,
  type AnthologyEntry, type AnthologyOptions, type BookPage, type TextBlock,
} from "../lib/anthology";
import { setMark } from "../lib/submissionMarks";
import type { Assignment, Course, Submission, SubmissionStatus } from "../types";

// ── 測試資料 ─────────────────────────────────────

const course = (id: string, schoolName: string, className: string): Course => ({
  id, code: "", name: `${schoolName} ${className}`, semester: "115-1", studentCount: 30,
  schoolName, className,
});

const assignment = (id: string, courseId: string, title: string): Assignment => ({
  id, title, courseId, questionId: "q", config: {}, status: "Published", totalStudents: 30,
});

const sub = (
  id: string, assignmentId: string, status: SubmissionStatus, seatNo?: number, name = `學生${id}`,
): Submission => ({
  id, assignmentId, studentId: `u${id}`, studentName: name, seatNo,
  content: "", submittedAt: "", status,
});

const entry = (over: Partial<AnthologyEntry> = {}): AnthologyEntry => ({
  id: "e1", title: "題目", studentName: "王小明", seatNo: 1, schoolName: "測試國中",
  className: "國三1班", semester: "115-1", submittedAt: "", content: "", feedback: "",
  images: [], tocLabel: "國三1班 1號 王小明",
  // 老師版的成果集依題目分組；測試沒特別指定時跟著 title
  group: over.group ?? over.title ?? "題目",
  ...over,
});

const ALL_ON: AnthologyOptions = {
  includeCover: true, includeToc: true, showText: true,
  showComment: true, showScore: true, showImages: true, showFeatured: true,
};

const heightOf = (b: TextBlock) =>
  b.type === "workHeader" ? SHEET.workHeader
  : b.type === "runningHeader" ? SHEET.runningHeader
  : b.type === "essayLine" ? SHEET.essayLine
  : b.type === "commentHead" ? SHEET.commentGap + SHEET.commentHead
  : SHEET.commentLine;

const width = (s: string) => Array.from(s).reduce((n, ch) => n + (/[\x20-\x7E]/.test(ch) ? 0.6 : 1), 0);

// ── 挑選 ─────────────────────────────────────────

describe("pickSubmissions", () => {
  const c1 = course("c1", "乙校", "國三2班");
  const c2 = course("c2", "甲校", "國三1班");
  const assignments = [
    assignment("a1", "c1", "我的夢想"),
    assignment("a2", "c2", "我的夢想"),
    assignment("a3", "c2", "  一次難忘的旅行 "),
    assignment("a9", "c9", "沒勾的班"),
  ];
  const submissions = [
    sub("1", "a1", "Graded", 3),
    sub("2", "a1", "Pending", 1),
    sub("3", "a1", "Draft", 2),
    sub("4", "a1", "Unsubmitted", 4),
    sub("5", "a2", "Published", 7),
    sub("6", "a3", "Published", 1),
    sub("7", "a9", "Published", 1),
  ];
  const base = { courses: [c1, c2], assignments, submissions, marks: {}, titles: new Set<string>() };

  test("全部：只收交出來的作品（待批改也算），草稿與未繳交不收；沒勾的班不收", () => {
    const ids = pickSubmissions({ ...base, source: "all" }).map((p) => p.submission.id);
    assert.deepEqual(ids.sort(), ["1", "2", "5", "6"]);
  });

  test("排序：題目 → 學校 → 班級 → 座號", () => {
    const ids = pickSubmissions({ ...base, source: "all" }).map((p) => p.submission.id);
    // zh-Hant 依筆畫：「一」比「我」少、「乙」（1 畫）比「甲」（5 畫）少；同班依座號
    assert.deepEqual(ids, ["6", "2", "1", "5"]);
  });

  test("佳作／預選：只收蓋了那一種章的", () => {
    const marks = setMark(setMark({}, "1", "featured", true), "5", "preselect", true);
    assert.deepEqual(
      pickSubmissions({ ...base, marks, source: "featured" }).map((p) => p.submission.id), ["1"],
    );
    assert.deepEqual(
      pickSubmissions({ ...base, marks, source: "preselect" }).map((p) => p.submission.id), ["5"],
    );
  });

  test("依題目：題目前後的空白不影響比對", () => {
    const picked = pickSubmissions({ ...base, source: "by_title", titles: new Set(["一次難忘的旅行"]) });
    assert.deepEqual(picked.map((p) => p.submission.id), ["6"]);
  });

  test("titlesOf 只列勾選班級的題目，去重並排序", () => {
    assert.deepEqual(titlesOf([c1, c2], assignments), ["一次難忘的旅行", "我的夢想"]);
  });
});

// ── 斷行 ─────────────────────────────────────────

describe("wrapLine", () => {
  test("每一行都不超過設定的格數（標點懸掛最多多 2 格）", () => {
    const text = "那天，陽光像打翻的蜂蜜罐，黏稠而金黃地灑在操場上。".repeat(20);
    for (const line of wrapLine(text, 38)) assert.ok(width(line) <= 40, line);
  });

  test("行首不會出現逗號、句號", () => {
    // 38 個字剛好一行，第 39 個是逗號 —— 要掛在第一行尾
    const text = "字".repeat(38) + "，後面還有字。」";
    const lines = wrapLine(text, 38);
    for (const line of lines.slice(1)) assert.ok(!/^[，。」]/.test(line), line);
    assert.ok(lines[0].endsWith("，"));
  });

  test("英文單字不從中間切開", () => {
    const lines = wrapLine("I like reading science fiction and mystery novels very much", 12);
    for (const line of lines) {
      for (const w of line.split(" ")) assert.ok("I like reading science fiction and mystery novels very much".includes(w));
    }
    assert.ok(lines.every((l) => !l.startsWith(" ")));
  });

  test("字全部都在，沒有被斷行吃掉", () => {
    const text = "我們一起走過春夏秋冬，Hello World！這是 2026 年的事。".repeat(5);
    assert.equal(wrapLine(text, 20).join("").replace(/\s/g, ""), text.replace(/\s/g, ""));
  });
});

describe("essayLines", () => {
  test("每段首行縮排兩格，空段落略過", () => {
    const lines = essayLines("第一段。\n\n\n第二段。\r\n");
    assert.deepEqual(lines, ["　　第一段。", "　　第二段。"]);
  });
});

describe("commentPlainLines", () => {
  test("拿掉 markdown 語法與螢光筆標籤，標題保留成粗體行", () => {
    const md = [
      "### 📝 寫作評量",
      "",
      "**【綜合評分】** 本文<mark class=\"hl-yellow\">結構完整</mark>。",
      "- 優點：*用詞精準*",
      "---",
      "| 項目 | 分數 |",
      "|---|---|",
      "| 立意 | 5 |",
    ].join("\n");
    const lines = commentPlainLines(md, 44);
    assert.deepEqual(lines, [
      { text: "📝 寫作評量", heading: true },
      { text: "" },
      { text: "【綜合評分】 本文結構完整。", heading: false },
      { text: "・優點：用詞精準", heading: false },
      { text: "項目　分數", heading: false },
      { text: "立意　5", heading: false },
    ]);
  });

  test("markdown 的跳脫字元不會印出反斜線", () => {
    // 實際 AI 報告裡的寫法
    assert.deepEqual(commentPlainLines("\\--- 📈 改進建議 ---\n\\=\\= 段落解析 \\=\\=\n1\\. 第一點"), [
      { text: "--- 📈 改進建議 ---", heading: false },
      { text: "== 段落解析 ==", heading: false },
      { text: "1. 第一點", heading: false },
    ]);
  });

  test("空評語就是沒有行", () => {
    assert.deepEqual(commentPlainLines(""), []);
  });
});

// ── 分頁 ─────────────────────────────────────────

describe("layoutWorkText", () => {
  test("每一頁的內容高度都不超過版心", () => {
    const e = entry({
      content: "這是一段很長的作文內容，".repeat(400),
      feedback: "老師的評語。".repeat(200),
      score: 5,
    });
    const pages = layoutWorkText(e, ALL_ON);
    assert.ok(pages.length > 2);
    for (const p of pages) {
      const h = p.reduce((n, b) => n + heightOf(b), 0);
      assert.ok(h <= BODY_HEIGHT, `一頁 ${h}mm，超過版心 ${BODY_HEIGHT}mm`);
    }
  });

  test("第一頁有題頭，續頁有小題頭", () => {
    const pages = layoutWorkText(entry({ content: "字".repeat(3000) }), ALL_ON);
    assert.equal(pages[0][0].type, "workHeader");
    for (const p of pages.slice(1)) assert.equal(p[0].type, "runningHeader");
  });

  test("評語標題不會孤零零留在頁尾", () => {
    // 找一個剛好把第一頁塞到只剩標題空間的長度
    for (let n = 1; n < 40; n++) {
      const pages = layoutWorkText(
        entry({ content: "字".repeat(38 * n - 2), feedback: "評語一。\n評語二。\n評語三。", score: 4 }),
        ALL_ON,
      );
      for (const p of pages) {
        const last = p[p.length - 1];
        assert.notEqual(last.type, "commentHead", `n=${n}`);
      }
    }
  });

  test("什麼都不印的作品是零頁", () => {
    const e = entry({ content: "有內容", feedback: "有評語", score: 5 });
    assert.deepEqual(
      layoutWorkText(e, { ...ALL_ON, showText: false, showComment: false, showScore: false }), [],
    );
  });

  test("沒有批改就不畫評語區", () => {
    const pages = layoutWorkText(entry({ content: "內容" }), ALL_ON);
    assert.ok(pages.flat().every((b) => b.type !== "commentHead"));
  });
});

describe("buildBook", () => {
  const kinds = (pages: BookPage[]) => pages.map((p) => p.kind);

  test("封面 → 目錄 → 內文；頁碼從封面算起、連續不跳號", () => {
    const pages = buildBook([
      entry({ id: "a", title: "甲", content: "字".repeat(2000), images: ["x.jpg", "y.jpg"] }),
      entry({ id: "b", title: "乙", content: "短文" }),
    ], ALL_ON);
    assert.equal(pages[0].kind, "cover");
    assert.equal(pages[1].kind, "toc");
    assert.deepEqual(pages.map((p) => p.pageNo), pages.map((_, i) => i + 1));
  });

  test("目錄上的頁碼就是那一篇第一頁的實際頁碼", () => {
    const entries = Array.from({ length: 40 }, (_, i) =>
      entry({
        id: String(i), title: `題目${i % 3}`,
        content: "字".repeat(100 + i * 97), images: i % 4 === 0 ? ["p.jpg"] : [],
        feedback: i % 2 ? "評語" : "", score: i % 2 ? 4 : undefined,
      }),
    );
    const pages = buildBook(entries, ALL_ON);
    const firstPageOf = new Map<number, number>();
    for (const p of pages) {
      if ((p.kind === "text" || p.kind === "image") && !firstPageOf.has(p.entryIndex)) {
        firstPageOf.set(p.entryIndex, p.pageNo);
      }
    }
    const tocRows = pages.flatMap((p) => (p.kind === "toc" ? p.rows : []));
    const tocEntries = tocRows.filter((r) => r.type === "entry");
    assert.equal(tocEntries.length, 40);
    for (const r of tocEntries) {
      if (r.type === "entry") assert.equal(r.pageNo, firstPageOf.get(r.entryIndex));
    }
  });

  test("目錄每頁不超過設定的列數，題目列不會落在頁尾", () => {
    const entries = Array.from({ length: 80 }, (_, i) =>
      entry({ id: String(i), title: `題目${Math.floor(i / 5)}`, content: "字" }),
    );
    const tocs = buildBook(entries, ALL_ON).filter((p) => p.kind === "toc");
    assert.ok(tocs.length > 1);
    for (const t of tocs) {
      if (t.kind !== "toc") continue;
      assert.ok(t.rows.length <= TOC_ROWS_PER_PAGE);
      const last = t.rows[t.rows.length - 1];
      if (t.index < t.total - 1) assert.notEqual(last.type === "group" && last.title !== "", true);
    }
  });

  test("不要封面與目錄時，內文從第 1 頁開始", () => {
    const pages = buildBook([entry({ content: "內容" })], { ...ALL_ON, includeCover: false, includeToc: false });
    assert.deepEqual(kinds(pages), ["text"]);
    assert.equal(pages[0].pageNo, 1);
  });

  test("只印原稿時，沒有原稿的作品整篇略過、目錄也不列", () => {
    const opts = { ...ALL_ON, showText: false, showComment: false, showScore: false };
    const pages = buildBook([
      entry({ id: "a", content: "有字沒圖" }),
      entry({ id: "b", content: "有圖", images: ["b1.jpg"] }),
    ], opts);
    assert.deepEqual(kinds(pages), ["cover", "toc", "image"]);
    const rows = pages.flatMap((p) => (p.kind === "toc" ? p.rows : []));
    assert.equal(rows.filter((r) => r.type === "entry").length, 1);
  });

  test("一篇好幾張原稿，一張一頁", () => {
    const pages = buildBook([entry({ content: "字", images: ["1.jpg", "2.jpg", "3.jpg"] })],
      { ...ALL_ON, includeCover: false, includeToc: false });
    assert.deepEqual(kinds(pages), ["text", "image", "image", "image"]);
  });

  test("不勾原稿就不出原稿頁", () => {
    const pages = buildBook([entry({ content: "字", images: ["1.jpg"] })],
      { ...ALL_ON, includeCover: false, includeToc: false, showImages: false });
    assert.deepEqual(kinds(pages), ["text"]);
  });

  test("沒有作品時不出目錄", () => {
    assert.deepEqual(kinds(buildBook([], ALL_ON)), ["cover"]);
  });
});

// ── 學生自己的作品集 ─────────────────────────────

describe("pickMyWorks／toEntry（personal）", () => {
  const c1 = { ...course("c1", "測試國中", "國二1班"), semester: "114-2" };
  const c2 = { ...course("c2", "測試國中", "國三1班"), semester: "115-1" };
  const assignments = [
    assignment("a1", "c1", "春天"), assignment("a2", "c1", "夏天"), assignment("a3", "c2", "秋天"),
  ];
  const at = (s: Submission, submittedAt: string) => ({ ...s, submittedAt });

  test("只收已發還的；依學期由舊到新、同學期依繳交時間", () => {
    const subs = [
      at(sub("3", "a3", "Published"), "2026-09-10"),
      at(sub("2", "a2", "Published"), "2026-05-01"),
      at(sub("1", "a1", "Published"), "2026-03-01"),
      at(sub("9", "a1", "Graded"), "2026-03-02"),      // 批改了但沒發還
      at(sub("8", "a2", "Pending"), "2026-05-02"),
    ];
    const ids = pickMyWorks(subs, assignments, [c1, c2]).map((p) => p.submission.id);
    assert.deepEqual(ids, ["1", "2", "3"]);
  });

  test("personal 版：目錄依學期分組、每列是題目", () => {
    const [p] = pickMyWorks([at(sub("1", "a1", "Published"), "2026-03-01")], assignments, [c1]);
    const e = toEntry(p, p.submission, { layout: "personal", featured: true, imageUrl: (x) => `U/${x}` });
    assert.equal(e.group, "114學年度 第2學期");
    assert.equal(e.tocLabel, "春天");
    assert.equal(e.featured, true);
  });

  test("class 版：目錄依題目分組、每列是班級座號姓名；圖片接上前綴", () => {
    const [p] = pickMyWorks(
      [{ ...at(sub("1", "a1", "Published", 7, "王小明"), "2026-03-01"), picFiles: ["a.jpg"] }],
      assignments, [c1],
    );
    const e = toEntry(p, p.submission, { layout: "class", featured: false, imageUrl: (x) => `U/${x}` });
    assert.equal(e.group, "春天");
    assert.equal(e.tocLabel, "國二1班 7號 王小明");
    assert.deepEqual(e.images, ["U/a.jpg"]);
  });

  test("學期分組的目錄：同學期的作品排在同一組底下", () => {
    const works = pickMyWorks([
      at(sub("1", "a1", "Published"), "2026-03-01"),
      at(sub("2", "a2", "Published"), "2026-05-01"),
      at(sub("3", "a3", "Published"), "2026-09-10"),
    ], assignments, [c1, c2]).map((p) =>
      toEntry(p, { ...p.submission, content: "內容" }, { layout: "personal", featured: false, imageUrl: (x) => x }),
    );
    const toc = buildBook(works, ALL_ON).flatMap((pg) => (pg.kind === "toc" ? pg.rows : []));
    assert.deepEqual(
      toc.map((r) => (r.type === "group" ? `#${r.title}` : works[r.entryIndex].tocLabel)),
      ["#114學年度 第2學期", "春天", "夏天", "#115學年度 第1學期", "秋天"],
    );
  });
});
