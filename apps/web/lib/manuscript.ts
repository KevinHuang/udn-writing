/**
 * 原稿紅筆（docs/manuscript.md）在批改頁用到的純函式：
 * 紅筆便條的閱讀順序與編號、老師加的錯字碰到卡片引用時拿掉什麼、重新評分的提醒、標記畫在原稿上的位置。
 *
 * 搬自 1Campus Write 的 hosting/utils/manuscript.ts。聯合報這邊沒有學測知性／情意的分版，
 * 卡片也已經併進評語（老師在評語欄改），所以拿掉了卡片改寫、學測專用的提醒。
 */

import { parseBlankGradingPage, parseGradingZone, type GradingZone } from './gradingZone';

// ---------- 資料（GET /instructor/grading/:id/manuscript） ----------

export interface ManuscriptCell {
  key: string;
  /** 拉正的稿紙圖上的 [左, 上, 右, 下] 像素 */
  rect: [number, number, number, number];
  text: string;
  status: string;
}

export interface ManuscriptPage {
  page: number;
  prefix: string;
  imageUrl: string | null;
  cells: ManuscriptCell[];
  /** 稿紙上的批改區（聯合報國中稿紙的第二頁才有），見 lib/gradingZone.ts */
  gradingZone: GradingZone | null;
  /** 不是學生的照片：學生只寫了一頁，補一頁空白稿紙的第二頁來放批改區（沒有格子、不能點字） */
  blank: boolean;
}

/** 補上的空白稿紙那一頁的前綴：沒有格子，不會出現在格子鍵裡 */
export const BLANK_PAGE_PREFIX = '批改區';

export type TypoState = 'confirmed' | 'pending' | 'vetoed';

export interface ManuscriptTypoMark {
  id: string;
  cellKey: string;
  keys: string[];
  wrong: string;
  correct: string;
  reason: string;
  source: 'system' | 'teacher';
  state: TypoState;
  corrected: boolean;
  decided: boolean;
}

export interface ManuscriptFormatMark {
  id: string;
  cellKey: string;
  keys: string[];
  type: string;
  why: string;
  state: 'active' | 'vetoed';
}

export interface MarkBaseline {
  confirmedTypoCount: number;
  indentIssueCount: number;
  overTypoLimit: boolean;
}

export interface ManuscriptMarks {
  typos: ManuscriptTypoMark[];
  formats: ManuscriptFormatMark[];
  current: MarkBaseline;
}

export interface ManuscriptData extends ManuscriptMarks {
  locked: boolean;
  /** 稿紙版型（udn、ucup、cap、gsat）：學測稿紙沒有行間，紅筆畫在格子右側裡面 */
  template: string | null;
  pages: ManuscriptPage[];
}

/** 簡易批改存下的卡片（simple_grading_result.detail.cards） */
export interface ManuscriptCard {
  type: '亮點' | '密圈' | '建議';
  title: string;
  comment: string;
  quote: string;
  quoteKeys: string[];
}

export interface ManuscriptCards {
  cards: ManuscriptCard[];
  idioms: { items: string[]; comment: string; spans: { item: string; keys: string[] }[] };
}

export interface ManuscriptDecisionInput {
  target: 'typo' | 'format';
  cellKey: string;
  action: 'confirm' | 'veto' | 'correct' | 'add' | 'undo' | 'delete';
  correct?: string;
  note?: string;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const isRect = (v: unknown): v is [number, number, number, number] =>
  Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

export function parseMarks(raw: unknown): ManuscriptMarks {
  const r = (raw ?? {}) as Record<string, unknown>;
  const c = (r.current ?? {}) as Record<string, unknown>;
  return {
    typos: (Array.isArray(r.typos) ? r.typos : [])
      .filter((t) => t && typeof t.id === 'string' && typeof t.cellKey === 'string')
      .map((t) => ({
        id: t.id, cellKey: t.cellKey, keys: strings(t.keys), wrong: str(t.wrong), correct: str(t.correct),
        reason: str(t.reason), source: t.source === 'teacher' ? 'teacher' : 'system',
        state: t.state === 'pending' || t.state === 'vetoed' ? t.state : 'confirmed',
        corrected: t.corrected === true, decided: t.decided === true,
      })),
    formats: (Array.isArray(r.formats) ? r.formats : [])
      .filter((f) => f && typeof f.id === 'string' && typeof f.cellKey === 'string')
      .map((f) => ({
        id: f.id, cellKey: f.cellKey, keys: strings(f.keys), type: str(f.type), why: str(f.why),
        state: f.state === 'vetoed' ? 'vetoed' : 'active',
      })),
    current: {
      confirmedTypoCount: typeof c.confirmedTypoCount === 'number' ? c.confirmedTypoCount : 0,
      indentIssueCount: typeof c.indentIssueCount === 'number' ? c.indentIssueCount : 0,
      overTypoLimit: c.overTypoLimit === true,
    },
  };
}

/** 後端的回傳 → 畫面用的形狀；沒有逐格辨識結果回 null（批改頁照舊） */
export function parseManuscript(raw: unknown): ManuscriptData | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (r.available !== true || !Array.isArray(r.pages)) return null;
  const template = typeof r.template === 'string' ? r.template : null;
  const pages: ManuscriptPage[] = r.pages.map((p: Record<string, unknown>, i: number) => ({
    page: typeof p.page === 'number' ? p.page : i + 1,
    prefix: str(p.prefix) || `第${i + 1}頁`,
    imageUrl: typeof p.imageUrl === 'string' ? p.imageUrl : null,
    cells: (Array.isArray(p.cells) ? p.cells : [])
      .filter((c: Record<string, unknown>) => typeof c?.key === 'string' && isRect(c.rect))
      .map((c: Record<string, unknown>) => ({ key: c.key as string, rect: c.rect as ManuscriptCell['rect'], text: str(c.text), status: str(c.status) })),
    gradingZone: parseGradingZone(p.gradingZone),
    blank: false,
  }));
  // 沒有任何一頁有批改區（學生只寫了一頁、沒有拍第二頁）：補一頁空白稿紙的第二頁，批改區畫在那上面
  const blank = pages.some((p) => p.gradingZone) ? null : parseBlankGradingPage(template, r.blankGradingZone);
  if (blank) {
    pages.push({ page: pages.length + 1, prefix: BLANK_PAGE_PREFIX, imageUrl: blank.imageUrl, cells: [], gradingZone: blank.zone, blank: true });
  }
  return { ...parseMarks(raw), locked: r.locked === true, template, pages };
}

/** simple_grading_result.detail → 卡片與成語（舊的批改結果沒有格子位置：不畫線、不編號） */
export function parseCards(detail: unknown): ManuscriptCards | null {
  if (!detail || typeof detail !== 'object') return null;
  const d = detail as Record<string, unknown>;
  const idioms = (d.idioms ?? {}) as Record<string, unknown>;
  return {
    cards: (Array.isArray(d.cards) ? d.cards : [])
      .filter((c) => c && ['亮點', '密圈', '建議'].includes(c.type))
      .map((c) => ({ type: c.type, title: str(c.title), comment: str(c.comment), quote: str(c.quote), quoteKeys: strings(c.quoteKeys) })),
    idioms: {
      items: strings(idioms.items),
      comment: str(idioms.comment),
      spans: (Array.isArray(idioms.spans) ? idioms.spans : [])
        .filter((s) => s && typeof s.item === 'string')
        .map((s) => ({ item: s.item, keys: strings(s.keys) })),
    },
  };
}

// ---------- 格子與閱讀順序 ----------

/** 格子鍵 `第N頁:行:格` → 頁的前綴、行（1 是最右邊那一行）、格（1 是最上面） */
export const splitCellKey = (key: string): { prefix: string; col: number; row: number } => {
  const parts = key.split(':');
  const row = Number(parts.pop());
  const col = Number(parts.pop());
  return { prefix: parts.join(':'), col, row };
};

/** 直書的閱讀順序：先頁、再行（由右而左）、再格（由上而下） */
export const readingOrder = (pagePrefixes: string[]) => (a: string, b: string): number => {
  const pa = splitCellKey(a);
  const pb = splitCellKey(b);
  const page = (prefix: string) => {
    const at = pagePrefixes.indexOf(prefix);
    return at < 0 ? Number.MAX_SAFE_INTEGER : at;
  };
  return page(pa.prefix) - page(pb.prefix) || pa.col - pb.col || pa.row - pb.row;
};

// ---------- 老師加的錯字碰到卡片引用：自動拿掉 ----------

export interface CardRemoval {
  /** card：整張不顯示（密圈）；quote：只拿掉引用；idiom：拿掉那個成語 */
  kind: 'card' | 'quote' | 'idiom';
  label: string;
  quote: string;
}

export type IndexedCard = ManuscriptCard & { index: number };

export interface VisibleCards {
  cards: IndexedCard[];
  idioms: { item: string; keys: string[] }[];
  idiomComment: string;
  removals: CardRemoval[];
  /** 拿掉的引用也出現在評語裡：只提醒老師自己看，不自動改字 */
  mentions: string[];
}

const touches = (keys: string[] | undefined, flagged: Set<string>) => (keys ?? []).some((k) => flagged.has(k));

/**
 * 顯示用的卡片＝存下的卡片＋目前老師加的錯字：資料不刪，錯字刪掉就恢復。
 * 通常是辨識把學生寫錯的字讀成了正確的字，系統以為這句沒問題就給了卡片；老師在原稿上看到，自己加了錯字。
 * 密圈一定要有引用，整張先拿掉；亮點、建議只拿掉引用；成語只拿掉那一個。
 */
export function applyTeacherTypos(source: ManuscriptCards, teacherKeys: Set<string>, feedbackTexts: string[] = []): VisibleCards {
  const removals: CardRemoval[] = [];
  const cards: IndexedCard[] = [];
  source.cards.forEach((c, index) => {
    const card = { ...c, index };
    if (!card.quote || !touches(card.quoteKeys, teacherKeys)) cards.push(card);
    else if (card.type === '密圈') removals.push({ kind: 'card', label: `密圈「${card.title}」`, quote: card.quote });
    else {
      removals.push({ kind: 'quote', label: `${card.type}「${card.title}」的引用`, quote: card.quote });
      cards.push({ ...card, quote: '', quoteKeys: [] });
    }
  });
  const spans = source.idioms.spans.length > 0
    ? source.idioms.spans
    : source.idioms.items.map((item) => ({ item, keys: [] as string[] }));
  const idioms = spans.filter((span) => {
    if (!touches(span.keys, teacherKeys)) return true;
    removals.push({ kind: 'idiom', label: `成語「${span.item}」`, quote: span.item });
    return false;
  });
  const mentions = removals
    .map((r) => r.quote)
    .filter((q) => [...q].length >= 2 && feedbackTexts.some((t) => t.includes(q)));
  return { cards, idioms, idiomComment: idioms.length > 0 ? source.idioms.comment : '', removals, mentions };
}

// ---------- 紅筆便條 ----------

export type NoteKind =
  | 'typo' | 'teacherTypo' | 'pending' | 'vetoedTypo'
  | 'format' | 'vetoedFormat'
  | 'highlight' | 'circle' | 'suggestion' | 'idiom';

export interface ManuscriptNote {
  id: string;
  /** 和原稿上的編號一樣；沒有位置的（不引用原文的建議）、格式提醒是 null */
  number: number | null;
  kind: NoteKind;
  keys: string[];
  /** 編號畫在這一格（閱讀順序的第一格） */
  anchorKey: string | null;
  typo?: ManuscriptTypoMark;
  format?: ManuscriptFormatMark;
  card?: IndexedCard;
  idiom?: { item: string; comment: string };
}

/**
 * 紅筆的顏色：畫在稿紙（米白的紙）上，不跟著深色模式翻 —— 紙是照片，不會變黑。
 * 錯字紅、待確認紫、否決灰、格式藍、卡片綠／橘。便條上的編號圓點用同一個顏色，一眼對得起來。
 */
export const NOTE_COLORS: Record<NoteKind, string> = {
  typo: '#dc2626',
  teacherTypo: '#dc2626',
  pending: '#7c3aed',
  vetoedTypo: '#9ca3af',
  format: '#2563eb',
  vetoedFormat: '#9ca3af',
  highlight: '#16a34a',
  circle: '#16a34a',
  suggestion: '#d97706',
  idiom: '#0d9488',
};

const CARD_KINDS: Record<ManuscriptCard['type'], NoteKind> = { 亮點: 'highlight', 密圈: 'circle', 建議: 'suggestion' };
// 同一格有好幾個便條時的先後：錯字、格式在前，卡片在後
const KIND_ORDER: NoteKind[] = ['typo', 'teacherTypo', 'pending', 'vetoedTypo', 'format', 'vetoedFormat', 'highlight', 'circle', 'suggestion', 'idiom'];

const typoKind = (t: ManuscriptTypoMark): NoteKind =>
  t.state === 'vetoed' ? 'vetoedTypo' : t.state === 'pending' ? 'pending' : t.source === 'teacher' ? 'teacherTypo' : 'typo';

/**
 * 原稿上的紅筆便條：錯字、格式提醒、有引用位置的卡片與成語，依閱讀順序編號（右邊的便條和原稿上的編號一樣）。
 * 格式提醒照樣框出位置但不編號，編號留給錯字和卡片；沒有位置的卡片沒有編號，排在最後。
 */
export function buildManuscriptNotes(
  marks: Pick<ManuscriptMarks, 'typos' | 'formats'>,
  visible: VisibleCards | null,
  pagePrefixes: string[],
): ManuscriptNote[] {
  const order = readingOrder(pagePrefixes);
  const anchorOf = (keys: string[]) => (keys.length > 0 ? [...keys].sort(order)[0] : null);
  const positioned: ManuscriptNote[] = [];
  const unpositioned: ManuscriptNote[] = [];
  const place = (note: Omit<ManuscriptNote, 'number' | 'anchorKey'>) => {
    const anchorKey = anchorOf(note.keys);
    (anchorKey ? positioned : unpositioned).push({ ...note, anchorKey, number: null });
  };
  marks.typos.forEach((typo) => place({ id: typo.id, kind: typoKind(typo), keys: typo.keys, typo }));
  marks.formats.forEach((format) =>
    place({ id: format.id, kind: format.state === 'vetoed' ? 'vetoedFormat' : 'format', keys: format.keys, format }));
  visible?.cards.forEach((card) =>
    place({ id: `card:${card.index}`, kind: CARD_KINDS[card.type], keys: card.quote ? card.quoteKeys : [], card }));
  visible?.idioms.forEach((idiom, i) =>
    place({ id: `idiom:${idiom.item}`, kind: 'idiom', keys: idiom.keys, idiom: { item: idiom.item, comment: i === 0 ? visible.idiomComment : '' } }));

  positioned.sort((a, b) =>
    order(a.anchorKey as string, b.anchorKey as string) || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  let n = 0;
  const numbered = positioned.map((note) => (note.format ? note : { ...note, number: ++n }));
  return [...numbered, ...unpositioned];
}

/** 老師處理完一個待確認後，自動跳到下一個待確認（依閱讀順序，到底再從頭找）；沒有了回傳 null */
export function nextPendingNoteId(notes: ManuscriptNote[], afterId: string | null): string | null {
  const pending = notes.filter((n) => n.kind === 'pending');
  if (pending.length === 0) return null;
  const at = notes.findIndex((n) => n.id === afterId);
  return (pending.find((n) => notes.indexOf(n) > at) ?? pending[0]).id;
}

export const countPendingTypos = (marks: Pick<ManuscriptMarks, 'typos'> | null): number =>
  marks ? marks.typos.filter((t) => t.state === 'pending').length : 0;

/** 老師加的錯字所在的格子（比對卡片引用用） */
export const teacherTypoKeys = (marks: Pick<ManuscriptMarks, 'typos'> | null): Set<string> =>
  new Set((marks?.typos ?? []).filter((t) => t.source === 'teacher' && t.state !== 'vetoed').flatMap((t) => t.keys));

// ---------- 重新評分的提醒 ----------

/**
 * 和批改當下比，要不要提醒「重新評分」：看「錯字 3 個以上或段首沒空兩格」這條有沒有變 ——
 * 變成符合、或不再符合都提醒（老師否決了讀錯的字，學生不該帶著被冤枉的分數）。
 * 聯合報的批改規範把錯別字與格式放在第四向度，4 級分的描述就是「有一些錯別字及格式（如段首未縮排兩格）」，
 * 3 個是 1Campus 會考版定下的門檻，先沿用。舊的批改結果沒有基準，不提醒。
 */
export function regradeReminder(baseline: MarkBaseline | null | undefined, current: MarkBaseline | null | undefined): string | null {
  if (!baseline || !current || baseline.overTypoLimit === current.overTypoLimit) return null;
  return current.overTypoLimit
    ? '改了錯字或格式之後，這篇現在有 3 個以上錯字或段首沒空兩格，分數可能要調低。'
    : '改了錯字或格式之後，這篇不再有 3 個以上錯字或段首沒空兩格的問題，分數可能可以調高。';
}

export function parseBaseline(raw: unknown): MarkBaseline | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  if (typeof b.confirmedTypoCount !== 'number') return null;
  return {
    confirmedTypoCount: b.confirmedTypoCount,
    indentIssueCount: typeof b.indentIssueCount === 'number' ? b.indentIssueCount : 0,
    overTypoLimit: b.overTypoLimit === true,
  };
}

// ---------- 標記畫在原稿上的位置 ----------

export interface CellBox {
  key: string;
  x0: number; y0: number; x1: number; y1: number;
  w: number; h: number; cx: number; cy: number;
}

export const toCellBox = (cell: Pick<ManuscriptCell, 'key' | 'rect'>): CellBox => {
  const [x0, y0, x1, y1] = cell.rect;
  return { key: cell.key, x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
};

/** 右邊那一行同一格的鍵（直書由右而左：右邊是前一行）；第 1 行沒有，回傳 null */
export const rightNeighborKey = (key: string): string | null => {
  const { prefix, col, row } = splitCellKey(key);
  return col > 1 ? `${prefix}:${col - 1}:${row}` : null;
};

/** 錯字旁正確的字的大小：格子寬的幾成（1Campus 使用者看過示意後定的八成） */
export const CORRECT_CHAR_SCALE = 0.8;
/**
 * 正確的字用全字庫正楷體：學生照著紅字訂正，字形一定要是台灣標準寫法（1Campus 用過悠哉字體，
 * 「啟」被畫成「啓」才改的）。字型檔在 public/fonts/tw-kai/，第一次打開原稿才載入。
 */
export const CORRECT_CHAR_FONT = { family: "'TW-Kai', 'BiauKai', 'DFKai-SB', serif", weight: 400 } as const;
/** 楷書筆畫細，正確的字另外描一圈同色的邊讓字粗一點：邊寬佔字大小的比例 */
export const CORRECT_CHAR_BOLD_RATIO = 0.02;
// 找不到右邊那一行時（第 1 行），用聯合報國中稿紙的行間比例算行間的中間（格寬 10mm、行距 13mm）
const GAP_RATIO = 0.3;
// 正確的字不只一個時往上下排，總高度最多兩格，超過就縮小
const CORRECT_MAX_CELLS = 2;

/** 學測稿紙沒有行間：紅筆畫在格子右側裡面；其他稿紙（聯合報國中、聯合盃、會考）畫在行間 */
const noGap = (template: string | null) => template === 'gsat';

/**
 * 錯字旁正確的字畫在哪裡、多大（直寫，一個字一個字往下排，對齊錯字的中間）：
 * 有行間的稿紙畫在行間的正中間；學測稿紙壓在錯字格右邊的格線上。字比行間寬，畫的時候加白邊。
 */
export function correctLabelLayout(box: CellBox, right: CellBox | undefined, template: string | null, text: string) {
  const count = Math.max(1, [...text].length);
  const size = Math.min(box.w * CORRECT_CHAR_SCALE, (box.h * CORRECT_MAX_CELLS) / count);
  let x = box.x1;
  if (!noGap(template)) x = right && right.x0 > box.x1 ? (box.x1 + right.x0) / 2 : box.x1 + (box.w * GAP_RATIO) / 2;
  return { x, y: box.cy - (size * count) / 2, size };
}

/** 寫在字旁邊的位置（密圈、波浪線、移上行／空兩格） */
export const sideX = (box: Pick<CellBox, 'x1' | 'w'>, template: string | null, inset = 0.22): number =>
  noGap(template) ? box.x1 - box.w * 0.14 : box.x1 + box.w * inset;

/** 一段引用依行切開（同一行、格子連續的算一段），跨行、跨頁時分開畫；不在這一頁的格子略過 */
export function columnRuns(keys: string[], boxes: Map<string, CellBox>): CellBox[][] {
  const runs: CellBox[][] = [];
  const sorted = keys
    .filter((k) => boxes.has(k))
    .map((k) => ({ key: k, ...splitCellKey(k) }))
    .sort((a, b) => a.col - b.col || a.row - b.row);
  for (const item of sorted) {
    const last = runs[runs.length - 1];
    const prev = last?.[last.length - 1];
    const p = prev ? splitCellKey(prev.key) : null;
    const box = boxes.get(item.key) as CellBox;
    if (p && p.prefix === item.prefix && p.col === item.col && item.row === p.row + 1) last.push(box);
    else runs.push([box]);
  }
  return runs;
}

/** 右側的紅色波浪線（寫得好的句子）：從這一段第一格的上緣畫到最後一格的下緣 */
export function wavyPath(run: CellBox[], x: number, amplitude: number): string {
  const top = run[0].y0 + run[0].h * 0.1;
  const bottom = run[run.length - 1].y1 - run[run.length - 1].h * 0.1;
  const step = Math.max(run[0].h / 3, 1);
  let path = `M ${x.toFixed(1)} ${top.toFixed(1)}`;
  let side = 1;
  for (let y = top; y < bottom; y += step) {
    const next = Math.min(y + step, bottom);
    path += ` Q ${(x + amplitude * side).toFixed(1)} ${((y + next) / 2).toFixed(1)} ${x.toFixed(1)} ${next.toFixed(1)}`;
    side = -side;
  }
  return path;
}

/** 放大倍率：預設 100% 是整張拉正的稿紙；放大後在框裡按住拖曳移動 */
export const ZOOM_LEVELS = [1, 1.5, 2, 3];
