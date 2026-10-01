/**
 * 成果集（多班、多校的作文文集）—— 挑作品與排版。
 *
 * 從數位作品集原型的 A4 列印引擎移植過來，兩個地方刻意改掉：
 *
 * 1. **頁碼是排出來的，不是估出來的。**
 *    原型用「每頁約 650 字」估頁數，文字頁高度卻是自動撐開的 ——
 *    長文章實際印成兩頁、目錄只算一頁，之後每一篇的頁碼全部錯一頁。
 *    這裡改成「稿紙」式排版：每一行的字數固定、每一行的高度固定（mm），
 *    所以一頁放幾行是確定的，目錄的頁碼就是實際的頁碼。
 *    代價是評語會變成純文字（markdown 的標題、粗體拿掉），見 commentPlainLines()。
 *
 * 2. **一篇可以有好幾張原稿。** 原型只有一個 imageUrl；這裡的
 *    `submission.pic_files` 是陣列，每一張各佔一頁。
 *
 * 這一支只有純函式，畫面在 components/anthology/，才測得到。
 */

import type { Assignment, Course, Submission } from '../types';
import { hasMark, type MarkKind, type SubmissionMarks } from './submissionMarks';
import { schoolLabel } from './courseGroups';
import { semesterLabel } from './semester';
import { isSubmitted } from './gradeTable';

// ─────────────────────────────────────────────
// 挑作品
// ─────────────────────────────────────────────

/** 作品來源。與原型的 sourceType 一一對應 */
export type AnthologySource = 'all' | MarkKind | 'by_title';

export const SOURCE_LABELS: Record<AnthologySource, string> = {
  all: '全部已繳交作品',
  featured: '佳作',
  preselect: '預選',
  by_title: '依題目挑選',
};


/** 作業的題目。當作分組鍵，所以前後空白要去掉 */
export const titleOf = (a: Assignment) => (a.title ?? '').trim();

export interface PickParams {
  /** 勾選的班級 */
  courses: Course[];
  assignments: Assignment[];
  submissions: Submission[];
  marks: SubmissionMarks;
  source: AnthologySource;
  /** source 是 by_title 時才有用 */
  titles: ReadonlySet<string>;
}

export interface Picked {
  submission: Submission;
  assignment: Assignment;
  course: Course;
}

/**
 * 挑出要收進成果集的作品，並排好順序：
 * 題目（依筆畫）→ 學校 → 班級 → 座號。
 *
 * 摘要（沒有全文）與完整資料都能丟進來 —— 挑選只看狀態、標記與作業，
 * 所以畫面上「預計收錄幾篇」可以在載入全文之前就算出來。
 */
export function pickSubmissions(p: PickParams): Picked[] {
  const courseById = new Map(p.courses.map((c) => [c.id, c]));
  const asgById = new Map(
    p.assignments.filter((a) => courseById.has(a.courseId)).map((a) => [a.id, a]),
  );

  const picked: Picked[] = [];
  for (const s of p.submissions) {
    const assignment = asgById.get(s.assignmentId);
    if (!assignment || !isSubmitted(s)) continue;
    if (p.source === 'featured' || p.source === 'preselect') {
      if (!hasMark(p.marks, s.id, p.source)) continue;
    } else if (p.source === 'by_title') {
      if (!p.titles.has(titleOf(assignment))) continue;
    }
    picked.push({ submission: s, assignment, course: courseById.get(assignment.courseId)! });
  }

  const zh = (a: string, b: string) => a.localeCompare(b, 'zh-Hant');
  return picked.sort(
    (a, b) =>
      zh(titleOf(a.assignment), titleOf(b.assignment)) ||
      zh(a.course.schoolName ?? '', b.course.schoolName ?? '') ||
      zh(a.course.className ?? a.course.name, b.course.className ?? b.course.name) ||
      (a.submission.seatNo ?? Infinity) - (b.submission.seatNo ?? Infinity) ||
      zh(a.submission.studentName, b.submission.studentName),
  );
}

/** 勾選的班級裡有哪些題目（依題目挑選的選項），依筆畫排 */
export function titlesOf(courses: Course[], assignments: Assignment[]): string[] {
  const ids = new Set(courses.map((c) => c.id));
  const titles = new Set(
    assignments.filter((a) => ids.has(a.courseId)).map(titleOf).filter(Boolean),
  );
  return [...titles].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
}

/**
 * 學生自己的作品集：挑出**已發還**的作品，依學期由舊到新、同學期依繳交時間。
 *
 * 由舊到新是刻意的 —— 這是一本成長歷程，翻下去要看得到進步。
 * 只收已發還的：沒發還的後端本來就不給分數與評語，收進來會是半篇。
 */
export function pickMyWorks(
  submissions: Submission[],
  assignments: Assignment[],
  courses: Course[],
): Picked[] {
  const asgById = new Map(assignments.map((a) => [a.id, a]));
  const courseById = new Map(courses.map((c) => [c.id, c]));
  const picked: Picked[] = [];
  for (const s of submissions) {
    if (s.status !== 'Published') continue;
    const assignment = asgById.get(s.assignmentId);
    const course = assignment && courseById.get(assignment.courseId);
    if (!assignment || !course) continue;
    picked.push({ submission: s, assignment, course });
  }
  return picked.sort(
    (a, b) =>
      a.course.semester.localeCompare(b.course.semester, undefined, { numeric: true }) ||
      (a.submission.submittedAt || '').localeCompare(b.submission.submittedAt || '') ||
      titleOf(a.assignment).localeCompare(titleOf(b.assignment), 'zh-Hant'),
  );
}

// ─────────────────────────────────────────────
// 排版
// ─────────────────────────────────────────────

/**
 * 版面尺寸，單位 mm。畫面與排版共用這一份 ——
 * 元件用這些數字設高度，這裡用同樣的數字算一頁放得下幾行。
 * **改任何一個數字，兩邊會一起變**，不要在元件裡另外寫死。
 */
export const SHEET = {
  width: 210,
  height: 297,
  padX: 20,
  padTop: 18,
  padBottom: 16,

  /** 作文本文。38 字 × 4.25mm = 161.5mm，比版心 170mm 留 2 字的餘裕（見 wrapLine） */
  essayFont: 4.25,
  essayPerLine: 38,
  essayLine: 9,

  /** 評語。字小一號、行距也小 */
  commentFont: 3.4,
  commentPerLine: 44,
  commentLine: 6,

  /** 每篇第一頁的題頭（題目、學生、學期） */
  workHeader: 36,
  /** 續頁的小題頭 */
  runningHeader: 10,
  /** 評語區的標題列（「老師評語」與級分）與上方間距 */
  commentGap: 6,
  commentHead: 14,

  /** 目錄 */
  tocHeader: 30,
  tocRow: 8.5,
} as const;

/** 版心高度 */
export const BODY_HEIGHT = SHEET.height - SHEET.padTop - SHEET.padBottom;
/** 目錄一頁幾列。多扣一列當餘裕 */
export const TOC_ROWS_PER_PAGE = Math.floor((BODY_HEIGHT - SHEET.tocHeader) / SHEET.tocRow) - 1;

/**
 * 一個字佔幾格（以全形字為 1）。
 *
 * 半形英數實際約 0.5 格，這裡算 0.6 —— 寧可少排一點，
 * 也不要讓一行超出版心。
 */
const unitOf = (ch: string) => (/[\x20-\x7E]/.test(ch) ? 0.6 : 1);

/** 行首不該出現的標點。遇到時掛在上一行尾（行尾有 2 字的餘裕） */
const NO_LINE_START = new Set('，。、；：？！）」』》〉】,.;:?!)…—'.split(''));

/**
 * 一段文字切成一行一行。
 *
 * 英文單字不從中間切（整個字一起換行），超過一整行的長字才硬切。
 * 行首標點掛到上一行尾 —— 版心右側留了 2 字的空間，就是給這個用的。
 */
export function wrapLine(text: string, perLine: number): string[] {
  // 半形英數連在一起的算一個 token，其餘一個字一個 token
  const tokens = text.match(/[\x21-\x7E]+|[\s\S]/gu) ?? [];
  const lines: string[] = [];
  let line = '';
  let used = 0;

  const push = () => {
    lines.push(line.replace(/\s+$/u, ''));
    line = '';
    used = 0;
  };

  for (const tok of tokens) {
    const w = Array.from(tok).reduce((n, ch) => n + unitOf(ch), 0);

    if (!line && lines.length > 0) {
      // 續行的行首：空白不要；連續第二個行首標點（「。」」）也掛回上一行
      if (/^\s+$/u.test(tok)) continue;
      if (tok.length === 1 && NO_LINE_START.has(tok)) {
        lines[lines.length - 1] += tok;
        continue;
      }
    }

    if (used + w <= perLine) {
      line += tok;
      used += w;
      continue;
    }
    // 行首標點：掛在這一行尾，不換行
    if (tok.length === 1 && NO_LINE_START.has(tok) && line) {
      line += tok;
      push();
      continue;
    }
    // 放不下的長 token：一個字一個字塞
    if (w > perLine) {
      for (const ch of Array.from(tok)) {
        const cw = unitOf(ch);
        if (used + cw > perLine) push();
        line += ch;
        used += cw;
      }
      continue;
    }
    if (line) push();
    // 換行之後，行首的空白不要
    if (/^\s+$/u.test(tok)) continue;
    line = tok;
    used = w;
  }
  if (line || lines.length === 0) push();
  return lines;
}

/** 首行縮排兩格。用全形空白，寬度才是確定的 */
const INDENT = '　　';

/**
 * 作文本文 → 稿紙的行。每一段首行縮排兩格、段與段之間不空行。
 * 空白段落（連續換行）略過 —— 學生打字常常多按幾次 Enter。
 */
export function essayLines(content: string, perLine = SHEET.essayPerLine): string[] {
  return (content ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean)
    .flatMap((p) => wrapLine(INDENT + p, perLine));
}

export interface CommentLine {
  text: string;
  /** markdown 的標題。印粗一點 */
  heading?: boolean;
}

/**
 * 評語（markdown）→ 純文字的行。
 *
 * 評語是 AI 產生、老師可以改的一整份 markdown 報告（標題、條列、粗體、
 * 螢光筆標籤）。要算得出高度就不能交給 markdown 排版，所以轉成純文字：
 * 標題保留成粗體的一行、條列換成「・」、其餘語法拿掉。
 */
export function commentPlainLines(markdown: string, perLine = SHEET.commentPerLine): CommentLine[] {
  const out: CommentLine[] = [];
  let lastBlank = true;

  for (const raw of (markdown ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    let line = raw.replace(/<[^>]+>/g, '');           // 螢光筆、文字色等行內 HTML
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) continue;   // 分隔線
    if (/^\s*\|?\s*:?-{2,}/.test(line)) continue;     // 表格的分隔列

    let heading = false;
    const h = /^\s*#{1,6}\s+(.*)$/.exec(line);
    if (h) { line = h[1]; heading = true; }

    line = line
      .replace(/^\s*>\s?/, '')                        // 引言
      .replace(/^\s*[-*+]\s+\[( |x|X)\]\s+/, (_m, c) => (c === ' ' ? '□ ' : '■ '))
      .replace(/^\s*[-*+]\s+/, '・')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')           // 圖片
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')        // 連結留文字
      .replace(/(\*\*|__)(.*?)\1/g, '$2')
      .replace(/(\*|_)(\S.*?)\1/g, '$2')
      .replace(/~~(.*?)~~/g, '$1')
      .replace(/`([^`]*)`/g, '$1')
      // markdown 的跳脫字元（CommonMark：任何 ASCII 標點都能跳脫）。
      // AI 的報告會寫「\--- 📈 改進建議 ---」「\=\= 段落解析 \=\=」，不拿掉會印出反斜線
      .replace(/\\([!-/:-@[-`{-~])/g, '$1');

    // 表格列：儲存格之間用全形空白隔開
    if (/^\s*\|.*\|\s*$/.test(line)) {
      line = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()).join('　');
    }

    line = line.trim();
    if (!line) {
      // 連續的空行只留一行，開頭與結尾的空行不要
      if (!lastBlank) out.push({ text: '' });
      lastBlank = true;
      continue;
    }
    lastBlank = false;
    for (const text of wrapLine(line, perLine)) out.push({ text, heading });
  }
  while (out.length && !out[out.length - 1].text) out.pop();
  return out;
}

/** 一篇作品排版所需的全部資料。從 Submission／Assignment／Course 組出來 */
export interface AnthologyEntry {
  id: string;
  title: string;
  studentName: string;
  seatNo?: number;
  schoolName: string;
  className: string;
  semester: string;
  submittedAt: string;
  content: string;
  /** markdown。沒有批改就是空字串 */
  feedback: string;
  /** 級分。沒有批改就是 undefined */
  score?: number;
  /** 原稿的網址（已經接好前綴），一張一頁 */
  images: string[];
  /**
   * 目錄的分組標題。同一組的作品要排在一起（呼叫端負責排序）。
   *   老師的成果集（一個班很多人）：題目
   *   學生的作品集（一個人很多篇）：學期
   */
  group: string;
  /** 目錄每一列的文字。老師版是「班級 座號 姓名」，學生版是題目 */
  tocLabel: string;
  /** 老師蓋了佳作章。學生端只有發還之後才會是 true（後端擋） */
  featured?: boolean;
}

export interface AnthologyOptions {
  includeCover: boolean;
  includeToc: boolean;
  showText: boolean;
  showComment: boolean;
  showScore: boolean;
  showImages: boolean;
  /** 在佳作的題頭印一顆「佳作」印章 */
  showFeatured: boolean;
}

export type TextBlock =
  | { type: 'workHeader' }
  | { type: 'runningHeader' }
  | { type: 'essayLine'; text: string }
  | { type: 'commentHead' }
  | { type: 'commentLine'; text: string; heading?: boolean };

export type TocRow =
  | { type: 'group'; title: string }
  | { type: 'entry'; entryIndex: number; pageNo: number };

export type BookPage =
  | { kind: 'cover'; pageNo: number }
  | { kind: 'toc'; pageNo: number; rows: TocRow[]; index: number; total: number }
  | { kind: 'text'; pageNo: number; entryIndex: number; blocks: TextBlock[]; part: number; parts: number }
  | { kind: 'image'; pageNo: number; entryIndex: number; url: string; index: number; total: number };

/** 高度（mm） */
const heightOf = (b: TextBlock): number => {
  switch (b.type) {
    case 'workHeader': return SHEET.workHeader;
    case 'runningHeader': return SHEET.runningHeader;
    case 'essayLine': return SHEET.essayLine;
    case 'commentHead': return SHEET.commentGap + SHEET.commentHead;
    case 'commentLine': return SHEET.commentLine;
  }
};

/**
 * 一篇作品的文字頁：一頁一頁塞，塞不下就換頁（續頁有小題頭）。
 *
 * 評語的標題列至少要跟著兩行評語，不然標題孤零零留在頁尾、
 * 評語全在下一頁。沒有要印的東西就回傳空陣列。
 */
export function layoutWorkText(entry: AnthologyEntry, opts: AnthologyOptions): TextBlock[][] {
  const essay = opts.showText ? essayLines(entry.content) : [];
  const comment = opts.showComment ? commentPlainLines(entry.feedback) : [];
  const showScore = opts.showScore && entry.score !== undefined;
  const hasCommentArea = comment.length > 0 || showScore;
  if (essay.length === 0 && !hasCommentArea) return [];

  const pages: TextBlock[][] = [];
  let page: TextBlock[] = [{ type: 'workHeader' }];
  let used: number = SHEET.workHeader;

  const fits = (h: number) => used + h <= BODY_HEIGHT;
  const newPage = () => {
    pages.push(page);
    page = [{ type: 'runningHeader' }];
    used = SHEET.runningHeader;
  };
  const add = (b: TextBlock) => {
    if (!fits(heightOf(b))) newPage();
    page.push(b);
    used += heightOf(b);
  };

  for (const text of essay) add({ type: 'essayLine', text });

  if (hasCommentArea) {
    const head: TextBlock = { type: 'commentHead' };
    const keepWith = Math.min(2, comment.length) * SHEET.commentLine;
    if (!fits(heightOf(head) + keepWith)) newPage();
    page.push(head);
    used += heightOf(head);
    for (const c of comment) add({ type: 'commentLine', text: c.text, heading: c.heading });
  }

  pages.push(page);
  return pages;
}

/**
 * 整本書：封面 → 目錄 → 每一篇（文字頁、原稿頁）。頁碼從封面算起。
 *
 * 目錄要先知道自己佔幾頁，內文的頁碼才算得出來 —— 目錄的列數只跟
 * 篇數與題目數有關，跟頁碼無關，所以先算列數、再排內文、最後把頁碼填回目錄。
 * 什麼都沒得印的作品（例如只勾原稿、這篇又沒有原稿）整篇略過，目錄也不列。
 */
export function buildBook(entries: AnthologyEntry[], opts: AnthologyOptions): BookPage[] {
  const works = entries
    .map((entry, entryIndex) => ({
      entryIndex,
      entry,
      text: layoutWorkText(entry, opts),
      images: opts.showImages ? entry.images : [],
    }))
    .filter((w) => w.text.length > 0 || w.images.length > 0);

  // ── 目錄的列（先不填頁碼），並處理「題目列落在頁尾」 ──
  const rows: Array<{ type: 'group'; title: string } | { type: 'entry'; workIndex: number }> = [];
  let lastGroup: string | null = null;
  works.forEach((w, workIndex) => {
    if (w.entry.group !== lastGroup) {
      // 題目列不要是一頁的最後一列，那樣它底下的第一篇會跑到下一頁
      if (rows.length % TOC_ROWS_PER_PAGE === TOC_ROWS_PER_PAGE - 1) {
        rows.push({ type: 'group', title: '' });
      }
      rows.push({ type: 'group', title: w.entry.group });
      lastGroup = w.entry.group;
    }
    rows.push({ type: 'entry', workIndex });
  });
  const tocPageCount = opts.includeToc && works.length > 0
    ? Math.ceil(rows.length / TOC_ROWS_PER_PAGE)
    : 0;

  // ── 內文的頁碼 ──
  const pages: BookPage[] = [];
  let pageNo = 1;
  if (opts.includeCover) pages.push({ kind: 'cover', pageNo: pageNo++ });
  const tocStart = pageNo;
  pageNo += tocPageCount;

  const startOf: number[] = [];
  const body: BookPage[] = [];
  works.forEach((w) => {
    startOf.push(pageNo);
    w.text.forEach((blocks, part) => {
      body.push({
        kind: 'text', pageNo: pageNo++, entryIndex: w.entryIndex,
        blocks, part, parts: w.text.length,
      });
    });
    w.images.forEach((url, index) => {
      body.push({
        kind: 'image', pageNo: pageNo++, entryIndex: w.entryIndex,
        url, index, total: w.images.length,
      });
    });
  });

  // ── 把頁碼填回目錄，切成一頁一頁 ──
  if (tocPageCount > 0) {
    const filled: TocRow[] = rows.map((r) =>
      r.type === 'group'
        ? r
        : { type: 'entry', entryIndex: works[r.workIndex].entryIndex, pageNo: startOf[r.workIndex] },
    );
    for (let i = 0; i < tocPageCount; i++) {
      pages.push({
        kind: 'toc',
        pageNo: tocStart + i,
        rows: filled.slice(i * TOC_ROWS_PER_PAGE, (i + 1) * TOC_ROWS_PER_PAGE),
        index: i,
        total: tocPageCount,
      });
    }
  }

  return [...pages, ...body];
}

/** 目錄與頁首用的「班級 座號 姓名」 */
export function studentLine(e: AnthologyEntry): string {
  const seat = e.seatNo != null ? `${e.seatNo}號` : '';
  return [e.className, seat, e.studentName].filter(Boolean).join(' ');
}

/**
 * 一篇挑出來的作品 → 排版用的 AnthologyEntry。老師的成果集與學生的作品集共用。
 *
 *   class    一個班很多人：目錄依**題目**分組，每列是「班級 座號 姓名」
 *   personal 一個人很多篇：目錄依**學期**分組，每列是題目
 *
 * `full` 是含全文的那一份（老師端要另外載，學生端本來就有）。
 * 圖片網址的前綴由呼叫端給（api/ai.ts 的 imageUrlOf），lib 不碰 api。
 */
export function toEntry(
  p: Picked,
  full: Submission,
  opts: { layout: 'class' | 'personal'; featured: boolean; imageUrl: (path: string) => string },
): AnthologyEntry {
  const base = {
    id: full.id,
    title: titleOf(p.assignment),
    studentName: full.studentName,
    seatNo: full.seatNo,
    schoolName: schoolNameOf(p.course),
    className: p.course.className ?? p.course.name,
    semester: semesterLabel(p.course.semester),
    submittedAt: full.submittedAt,
    content: full.content,
    feedback: full.result?.feedback ?? '',
    score: full.result?.totalScore,
    images: (full.picFiles ?? []).map(opts.imageUrl),
    featured: opts.featured,
  };
  return opts.layout === 'class'
    ? { ...base, group: base.title, tocLabel: studentLine(base as AnthologyEntry) }
    : { ...base, group: base.semester, tocLabel: base.title };
}

/** 學校顯示名，規則與課程卡片一致（見 lib/courseGroups.ts） */
export function schoolNameOf(c: Course): string {
  return c.schoolName ? schoolLabel(c.city, c.schoolName) : '';
}
