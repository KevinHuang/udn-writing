import type { GradingResult } from '@udn/shared';
import { CATEGORY_DIMENSIONS } from './categoryScores';
import type { ManuscriptTypoMark } from './manuscript';

/**
 * 稿紙上的批改區（docs/manuscript.md「稿紙上的批改區」）：聯合報國中寫作稿紙第二頁左側印的
 * 錯字訂正、寫作能力分析、老師評語，把批改內容直接填進去。
 *
 * 位置由後端算（apps/api/src/lib/manuscript/grading_zone.ts）；這裡決定「填什麼、怎麼排」：
 * 用畫面上當下的批改結果組，老師改評語、確認錯字，稿紙上馬上跟著變。
 * 純函式，畫在 components/ManuscriptViewer.tsx。
 */

export type ZoneRect = [number, number, number, number];

export interface GradingZone {
  /** 錯字訂正：六行（由右而左），每行六格（由上而下） */
  typoColumns: ZoneRect[][];
  /** 寫作能力分析：四向度（CATEGORY_DIMENSIONS 的順序）各自的四格，由上而下是極佳、佳、尚可、待加強 */
  levelCells: ZoneRect[][];
  commentBox: ZoneRect;
}

const isRect = (v: unknown): v is ZoneRect =>
  Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
const isRectGrid = (v: unknown, columns: number): v is ZoneRect[][] =>
  Array.isArray(v) && v.length === columns && v.every((col) => Array.isArray(col) && col.length > 0 && col.every(isRect));

/** 後端沒給、或形狀不對就是 null：原稿照舊，只是不畫批改區 */
export function parseGradingZone(raw: unknown): GradingZone | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!isRectGrid(r.typoColumns, 6) || !isRectGrid(r.levelCells, CATEGORY_DIMENSIONS.length) || !isRect(r.commentBox)) return null;
  if (r.levelCells.some((col) => col.length !== SHEET_LEVELS.length)) return null;
  return { typoColumns: r.typoColumns, levelCells: r.levelCells, commentBox: r.commentBox };
}

/**
 * 沒有第二頁照片時（學生只寫了一頁），用來放批改區的空白稿紙第二頁：整張紙、A3 原尺寸。
 * 底圖由 services/handwriting-ocr/tools/build_static_sheets.py 產生，放在 public/sheets/；
 * pxPerMm 是那張圖每 mm 幾個像素，要和後端算位置用的一樣（apps/api/src/lib/manuscript/grading_zone.ts 的
 * BLANK_SHEET_PX_PER_MM）。test/gradingZone.test.tsx 會量圖的寬度。
 */
export const BLANK_GRADING_SHEETS: Record<string, { url: string; pxPerMm: number; paperMm: [number, number] }> = {
  udn: { url: '/sheets/udn_A3_p2_grading.png', pxPerMm: 8, paperMm: [420, 297] },
};

export interface BlankGradingPage {
  imageUrl: string;
  zone: GradingZone;
}

/**
 * 後端給的「空白稿紙上的批改區位置」→ 要補的那一頁。
 * 這種稿紙沒有底圖、或後端用的解析度和手上這張底圖不一樣（兩邊只改了一邊），都是 null：畫了會歪，寧可不畫。
 */
export function parseBlankGradingPage(template: string | null, raw: unknown): BlankGradingPage | null {
  const sheet = template ? BLANK_GRADING_SHEETS[template] : undefined;
  if (!sheet || !raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.pxPerMm !== sheet.pxPerMm) return null;
  const zone = parseGradingZone(r.zone);
  return zone ? { imageUrl: sheet.url, zone } : null;
}

// ---------- 寫作能力分析 ----------

/** 稿紙上印的四個等第，由上而下 */
export const SHEET_LEVELS = ['極佳', '佳', '尚可', '待加強'] as const;

/**
 * 級分 → 勾在第幾格（使用者決定，2026-11-23）：6 級分極佳、5 級分佳、4 級分尚可、3 級分以下待加強。
 * 照會考各級分的定位（6 優秀、5 一般水準之上、4 已達一般水準、3 以下未達）。
 * 0 級分（偏題、字數不足）和沒有資料都不打勾：那不是「待加強」，是這次沒辦法評。
 */
export function sheetLevelIndex(score: number | null | undefined): number | null {
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 1) return null;
  if (score >= 6) return 0;
  if (score >= 5) return 1;
  if (score >= 4) return 2;
  return 3;
}

/** 四向度各自勾第幾格（CATEGORY_DIMENSIONS 的順序）；舊的批改沒有四向度，整排不打勾 */
export const sheetLevels = (scores: GradingResult['categoryScores'] | null | undefined): Array<number | null> =>
  CATEGORY_DIMENSIONS.map(([, key]) => sheetLevelIndex(scores?.[key]));

// ---------- 錯字訂正 ----------

export interface SheetTypos {
  /** 每行要寫的字（由上而下），依直書的閱讀順序，最多六行 */
  columns: string[][];
  /** 確定的錯字（不重複）一共幾個；比 columns 多就是稿紙放不下 */
  total: number;
}

/**
 * 錯字訂正欄：每行最上面寫正確的字，下面的格子留給學生練習。
 * 只放確定的錯字（待確認、否決的不放），同一個正確的字只寫一次；超過六個放不下，照閱讀順序取前六個。
 */
export function sheetTypoColumns(
  typos: Pick<ManuscriptTypoMark, 'cellKey' | 'correct' | 'state'>[],
  order: (a: string, b: string) => number,
  zone: Pick<GradingZone, 'typoColumns'>,
): SheetTypos {
  const seen = new Set<string>();
  const corrects = typos
    .filter((t) => t.state === 'confirmed' && t.correct.trim())
    .sort((a, b) => order(a.cellKey, b.cellKey))
    .map((t) => t.correct.trim())
    .filter((c) => (seen.has(c) ? false : (seen.add(c), true)));
  return {
    columns: corrects.slice(0, zone.typoColumns.length).map((c, i) => [...c].slice(0, zone.typoColumns[i].length)),
    total: corrects.length,
  };
}

// ---------- 老師評語 ----------

const HEADING = /^\s*#{1,6}\s+/;

/**
 * 評語欄放的文字：評語裡第一個小標題之前的那一段（簡易批改的總評，100～150 字）。
 * 後面的亮點、建議卡片放不進評語欄；老師在評語欄改了總評，這裡跟著變。
 * 一開頭就是小標題的評語（校對過、照一般批改的）沒有總評可以取：整份都放，放不下由排版截斷並提醒。
 */
export function sheetComment(feedback: string | null | undefined): string {
  const lines = (feedback ?? '').split(/\r?\n/);
  const firstHeading = lines.findIndex((l) => HEADING.test(l));
  const lead = firstHeading < 0 ? lines : lines.slice(0, firstHeading);
  return (lead.some((l) => l.trim()) ? lead : lines)
    .map((l) => l
      .replace(HEADING, '')
      .replace(/^\s*(?:[-*+>]|\d+[.、])\s+/, '')
      .replace(/\*\*|__|`/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .trim())
    .join('')
    .replace(/\s+/g, '');
}

export interface VerticalGlyph {
  ch: string;
  /** 字的正中間 */
  x: number;
  y: number;
  /** 直寫時要轉 90 度的符號（引號、括號、破折號、刪節號） */
  rotate: boolean;
}

export interface VerticalLayout {
  /** 字的大小（像素） */
  size: number;
  glyphs: VerticalGlyph[];
  /** 放進去幾個字、原本幾個字；shown < total 就是放不下、後面截掉了 */
  shown: number;
  total: number;
}

// 字的大小（佔一格 10mm 的幾成）：先用最大的，放不下就縮，最小 3.2mm，再放不下才截斷
const COMMENT_SIZES = [0.5, 0.45, 0.4, 0.36, 0.32];
// 字距、行距（字的大小的幾倍），和框邊的留白（一格的幾成）
const CHAR_STEP = 1.06;
const COLUMN_PITCH = 1.6;
const BOX_PADDING = 0.4;
// 不放在行首的標點：掛在上一行的最下面（留白夠放一個）
const NO_LINE_START = new Set('，。、；：？！」』）》〉…—');
/*
  全字庫正楷體的標點照台灣的標準放在字框正中間，直寫時逗號、句號直接用就對；
  引號、括號、破折號、刪節號要轉 90 度。不用字型裡的直排替換：網頁用的字型檔沒有留那些字
  （services/handwriting-ocr/tools/build_tw_kai_web.py 拿掉了排版功能）。
*/
const ROTATE_IN_VERTICAL = new Set('「」『』（）《》〈〉【】〔〕—…─～');

/** 半形英數與符號換成全形：直寫時一個字佔一格，而且全形的字楷書字型裡才有 */
const toFullWidth = (ch: string) => {
  const code = ch.codePointAt(0) as number;
  return code >= 0x21 && code <= 0x7e ? String.fromCodePoint(code + 0xfee0) : ch;
};

/** 依每行最多幾個字切成一行一行；下一個字是不能放行首的標點時，多掛一個在這一行的最下面 */
function breakColumns(chars: string[], perColumn: number): string[][] {
  const columns: string[][] = [];
  for (let i = 0; i < chars.length;) {
    let end = Math.min(i + perColumn, chars.length);
    if (end < chars.length && NO_LINE_START.has(chars[end])) end += 1;
    columns.push(chars.slice(i, end));
    i = end;
  }
  return columns;
}

/**
 * 評語在評語欄裡怎麼排：直寫、由右而左。unit 是稿紙一格（10mm）在圖上的像素。
 * 字的大小自動挑放得下的最大那一級；最小的字還放不下就截斷，最後一個字換成刪節號。
 */
export function layoutVerticalText(text: string, box: ZoneRect, unit: number): VerticalLayout {
  const chars = [...text].filter((ch) => ch.trim()).map(toFullWidth);
  const [x0, y0, x1, y1] = box;
  const pad = unit * BOX_PADDING;
  const height = y1 - y0 - pad * 2;
  const width = x1 - x0 - pad * 2;
  const empty: VerticalLayout = { size: unit * COMMENT_SIZES[0], glyphs: [], shown: 0, total: chars.length };
  if (chars.length === 0 || !(unit > 0) || height <= 0 || width <= 0) return empty;

  let size = 0;
  let columns: string[][] = [];
  let capacity = 0;
  for (const ratio of COMMENT_SIZES) {
    size = unit * ratio;
    const perColumn = Math.max(1, Math.floor(height / (size * CHAR_STEP)));
    capacity = Math.max(1, Math.floor((width - size) / (size * COLUMN_PITCH)) + 1);
    columns = breakColumns(chars, perColumn);
    if (columns.length <= capacity) break;
  }
  const truncated = columns.length > capacity;
  if (truncated) {
    columns = columns.slice(0, capacity);
    const last = columns[columns.length - 1];
    last[last.length - 1] = '…';
  }
  const glyphs = columns.flatMap((column, ci) => column.map((ch, k) => ({
    ch,
    x: x1 - pad - size / 2 - ci * size * COLUMN_PITCH,
    y: y0 + pad + (k + 0.5) * size * CHAR_STEP,
    rotate: ROTATE_IN_VERTICAL.has(ch),
  })));
  // 截斷時最後一個是刪節號，不算放進去的字
  return { size, glyphs, shown: truncated ? glyphs.length - 1 : glyphs.length, total: chars.length };
}

// ---------- 整個批改區 ----------

/** 畫面上當下的批改內容（components/GradingEditor.tsx 組，ManuscriptViewer 畫） */
export interface SheetGrading {
  /** 目前的錯字標記（哪些要放、放幾個，由 sheetTypoColumns 決定） */
  typos: Pick<ManuscriptTypoMark, 'cellKey' | 'correct' | 'state'>[];
  /** 四向度各自勾第幾格 */
  levels: Array<number | null>;
  comment: string;
}

/** 稿紙放不下時給老師的提醒（畫在那一頁下面）；都放得下回空陣列 */
export function sheetGradingHints(typos: SheetTypos, comment: Pick<VerticalLayout, 'shown' | 'total'>): string[] {
  const hints: string[] = [];
  if (typos.total > typos.columns.length) {
    hints.push(`錯字訂正欄只放得下 ${typos.columns.length} 個字，另外 ${typos.total - typos.columns.length} 個沒有列在稿紙上。`);
  }
  if (comment.shown < comment.total) {
    hints.push(`評語比稿紙的評語欄長，稿紙上只放得下前 ${comment.shown} 個字。`);
  }
  return hints;
}
