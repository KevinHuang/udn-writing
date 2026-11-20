/**
 * 簡易批改送給 AI 的「學生作文」那一段：從稿紙逐格辨識的結果（handwriting_grid_result）組出資料模板，
 * 也提供「每個字在哪一格、可不可信」的索引，讓 AI 回來的引用與成語可以逐格檢查（result.ts）。
 *
 * 搬自 1Campus Write 的 functions/lib/simpleGradingEssay.js（會考那一版；設計見 docs/simple-grading.md）。
 * 學測知性題／情意題的題目行、小題分界沒有搬：聯合報這邊的評分規準跟著題目走（system_instruction），不分版本。
 *
 * 純函式，不碰資料庫與網路。
 */

/** 辨識服務在辨識沒把握的格子後面加的記號（services/handwriting-ocr gaozhi/service/core.py） */
export const MARK = '〔?〕';
/** 有字跡卻看不出來的字 */
export const UNREADABLE = '□';
/** 不足 100 字不送 AI，直接建議 0 級分（會考的 0 級分條件之一；聯合報規準也是會考六級分） */
export const MIN_CHARS = 100;

export interface GridCell {
    col?: number;
    row?: number;
    text?: string;
    status?: string;
}

export interface GridPage {
    prefix?: string;
    page?: number;
    ocr?: { cells?: GridCell[] } | null;
}

/** 辨識服務的錯字標記（gaozhi/grading/typos.py）。keys 是格子：`第N頁:行:格` */
export interface TypoMark {
    keys?: string[];
    wrong?: string;
    correct?: string;
    kind?: string;
    source?: string;
    context?: string[];
}

export interface FormatIssue {
    type?: string;
    keys?: string[];
    text?: string;
    context?: string[];
}

export interface StoredGridResult {
    markedText: string | null;
    chars: number | null;
    paragraphs: number | null;
    pages: GridPage[] | null;
    typoMarks: TypoMark[] | null;
    formatIssues: FormatIssue[] | null;
}

interface CharItem {
    ch: string;
    key: string | null;
    trusted: boolean;
    status?: string;
}

export interface EssayIndex {
    /** 格子重建出來的全文和存下的 marked_text 一致（精確模式）；否則退回只看〔?〕記號 */
    exact: boolean;
    paras: CharItem[][];
    /** marked_text 的每一行（每段一行，有〔?〕記號） */
    lines: string[];
    /** 每段的純文字（沒有記號） */
    texts: string[];
    keyToParagraph: Map<string, number>;
}

const cellKey = (prefix: string, cell: GridCell) => `${prefix}:${cell.col}:${cell.row}`;

/**
 * 依辨識服務 text_cells（gaozhi/grading/typos.py）的規則重建「每個字在哪一格」：
 * 同一行依格子順序；一行開頭空兩格以上、或前一行整行空白，就是新的一段；段落可以跨頁。
 */
export function rebuildParagraphs(pages: GridPage[] | null | undefined): CharItem[][] {
    const paras: CharItem[][] = [];
    let current: CharItem[] | null = null;
    for (const page of Array.isArray(pages) ? pages : []) {
        const prefix = page?.prefix || `第${page?.page ?? paras.length + 1}頁`;
        const byCol = new Map<number, Map<number, { text: string; key: string; status?: string }>>();
        for (const cell of Array.isArray(page?.ocr?.cells) ? page.ocr!.cells! : []) {
            const col = Number(cell?.col);
            const row = Number(cell?.row);
            if (!Number.isFinite(col) || !Number.isFinite(row)) continue;
            const text = cell.status !== 'blank' && typeof cell.text === 'string' ? cell.text : '';
            if (!byCol.has(col)) byCol.set(col, new Map());
            byCol.get(col)!.set(row, { text, key: cellKey(prefix, cell), status: cell.status });
        }
        for (const col of [...byCol.keys()].sort((a, b) => a - b)) {
            const rows = byCol.get(col)!;
            const seq = [...rows.keys()].sort((a, b) => a - b).map((row) => rows.get(row)!);
            const firstFilled = seq.findIndex((item) => item.text);
            if (firstFilled < 0) {
                if (current) paras.push(current);
                current = null;
                continue;
            }
            const chars = seq
                .filter((item) => item.text)
                .flatMap((item) => [...item.text].map((ch) => ({
                    ch,
                    key: item.key,
                    trusted: item.status === 'agree' && ch !== UNREADABLE,
                    status: item.status,
                })));
            if (current === null || firstFilled >= 2) {
                if (current) paras.push(current);
                current = chars;
            } else {
                current = current.concat(chars);
            }
        }
    }
    if (current) paras.push(current);
    return paras;
}

/** 依辨識服務 marked_text 的規則畫出全文（每段一行，非「可信」格子的最後一個字後面加〔?〕） */
export function renderMarkedText(paras: CharItem[][]): string {
    return paras
        .map((para) => para
            .map((item, i) => {
                const lastOfCell = i + 1 === para.length || para[i + 1].key !== item.key;
                return item.ch + (lastOfCell && item.status !== 'agree' ? MARK : '');
            })
            .join(''))
        .join('\n');
}

/** 退回模式：只有 marked_text 時，〔?〕前面那個字算不可信，不知道格子位置 */
function parseMarkedText(markedText: string): CharItem[][] {
    return markedText.split('\n').map((line) => {
        const chars: CharItem[] = [];
        let i = 0;
        while (i < line.length) {
            if (line.startsWith(MARK, i)) {
                if (chars.length > 0) chars[chars.length - 1].trusted = false;
                i += MARK.length;
                continue;
            }
            const ch = String.fromCodePoint(line.codePointAt(i)!);
            chars.push({ ch, key: null, trusted: ch !== UNREADABLE });
            i += ch.length;
        }
        return chars;
    });
}

/**
 * 全文索引：每段的字、每個字在哪一格、可不可信。
 * 重建結果和存下的 marked_text 一致時是精確模式，否則（例如辨識服務改版）退回只看〔?〕記號。
 */
export function buildEssayIndex(grid: Pick<StoredGridResult, 'markedText' | 'pages'>): EssayIndex {
    const markedText = typeof grid?.markedText === 'string' ? grid.markedText.replace(/\r\n/g, '\n') : '';
    if (!markedText.trim()) return { exact: false, paras: [], lines: [], texts: [], keyToParagraph: new Map() };
    const rebuilt = rebuildParagraphs(grid.pages);
    const exact = rebuilt.length > 0 && renderMarkedText(rebuilt) === markedText;
    const paras = exact ? rebuilt : parseMarkedText(markedText);
    const keyToParagraph = new Map<string, number>();
    if (exact) paras.forEach((para, i) => para.forEach((item) => item.key && keyToParagraph.set(item.key, i)));
    return {
        exact,
        paras,
        lines: markedText.split('\n'),
        texts: paras.map((para) => para.map((item) => item.ch).join('')),
        keyToParagraph,
    };
}

const contextOf = (mark: { context?: unknown }) =>
    Array.isArray(mark?.context) ? mark.context.filter((p): p is string => typeof p === 'string').join('') : '';

/** 錯字或格式問題在第幾段（0 起算）；找不到時 null。精確模式看格子，退回模式用前後文找 */
export function paragraphOfMark(index: EssayIndex, mark: TypoMark | FormatIssue): number | null {
    if (index.exact) {
        for (const key of Array.isArray(mark?.keys) ? mark.keys : []) {
            if (index.keyToParagraph.has(key)) return index.keyToParagraph.get(key)!;
        }
        return null;
    }
    const context = contextOf(mark);
    if (!context) return null;
    const found = index.texts.findIndex((t) => t.includes(context));
    return found >= 0 ? found : null;
}

/** 身上有錯字標記（含待確認）的字：精確模式是格子集合，退回模式是「段:位置」集合 */
export function flaggedPositions(index: EssayIndex, typoMarks: TypoMark[] | null | undefined): Set<string> {
    const flagged = new Set<string>();
    for (const mark of Array.isArray(typoMarks) ? typoMarks : []) {
        if (index.exact) {
            for (const key of Array.isArray(mark?.keys) ? mark.keys : []) flagged.add(key);
            continue;
        }
        const before = Array.isArray(mark?.context) && typeof mark.context[0] === 'string' ? mark.context[0] : '';
        const wrong = typeof mark?.wrong === 'string' ? mark.wrong : '';
        const context = contextOf(mark);
        if (!context || !wrong) continue;
        index.texts.forEach((t, paragraph) => {
            for (let at = t.indexOf(context); at >= 0; at = t.indexOf(context, at + 1)) {
                const start = [...t.slice(0, at + before.length)].length;
                for (let k = 0; k < [...wrong].length; k += 1) flagged.add(`${paragraph}:${start + k}`);
            }
        });
    }
    return flagged;
}

export type SpanResult =
    | { ok: true; paragraph: number; keys: string[] }
    | { ok: false; reason: 'notFound' | 'untrusted' | 'typo' };

/**
 * 找一段逐字相同、每一格都辨識可信、而且沒有錯字標記的原文。
 * keys 是這段原文每個字所在的格子（精確模式才有），第三階段在原稿上畫線用。
 */
export function findTrustedSpan(index: EssayIndex, quote: string, flagged: Set<string> | null = null): SpanResult {
    const target = typeof quote === 'string' ? quote : '';
    if (!target || target.includes('\n')) return { ok: false, reason: 'notFound' };
    let reason: 'notFound' | 'untrusted' | 'typo' = 'notFound';
    for (let paragraph = 0; paragraph < index.texts.length; paragraph += 1) {
        const t = index.texts[paragraph];
        for (let at = t.indexOf(target); at >= 0; at = t.indexOf(target, at + 1)) {
            const start = [...t.slice(0, at)].length;
            const span = index.paras[paragraph].slice(start, start + [...target].length);
            if (!span.every((item) => item.trusted)) {
                reason = 'untrusted';
                continue;
            }
            const hasTypo = flagged
                && span.some((item, k) => flagged.has(index.exact ? item.key! : `${paragraph}:${start + k}`));
            if (hasTypo) {
                if (reason === 'notFound') reason = 'typo';
                continue;
            }
            return { ok: true, paragraph, keys: index.exact ? [...new Set(span.map((item) => item.key!))] : [] };
        }
    }
    return { ok: false, reason };
}

// ── 確定的錯別字 ──

// 錯字標記的來源（辨識服務 gaozhi/grading/typos.py）：程式比對（錯字表 rule、成語比對 dict）位置一定對；
// AI 讀全文找的有時會標到隔壁的字。
const RULE_SOURCES = new Set(['rule', 'dict', 'dict2']);
const AI_SOURCES = new Set(['ai-text']);
/** 「同一個詞」：兩個標記前後相差不超過 3 個字（四字成語的頭尾） */
const SAME_WORD_REACH = 3;

const keysOf = (mark: TypoMark) => (Array.isArray(mark?.keys) ? mark.keys.filter((k) => typeof k === 'string') : []);
const trimmed = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

function parseCellKey(key: string) {
    const m = /^(.*):(\d+):(\d+)$/.exec(key);
    return m ? { prefix: m[1], col: Number(m[2]), row: Number(m[3]) } : null;
}

const nearOnSameLine = (a: TypoMark, b: TypoMark) => keysOf(a).some((keyA) => {
    const at = parseCellKey(keyA);
    return at !== null && keysOf(b).some((keyB) => {
        const other = parseCellKey(keyB);
        return other !== null && other.prefix === at.prefix && other.col === at.col
            && Math.abs(other.row - at.row) <= SAME_WORD_REACH;
    });
});

function contextWindow(mark: TypoMark) {
    const parts = Array.isArray(mark?.context) ? mark.context : [];
    if (parts.length !== 3 || !parts.every((p) => typeof p === 'string') || !parts[1]) return null;
    return { chars: [...parts.join('')], at: [...parts[0]].length };
}

/** 從前後文看，兩個標記是不是同一段裡相差不超過 3 個字（詞跨行、跨頁也看得出來） */
function nearInContext(a: TypoMark, b: TypoMark): boolean {
    const wa = contextWindow(a);
    const wb = contextWindow(b);
    if (!wa || !wb) return false;
    for (let shift = -SAME_WORD_REACH; shift <= SAME_WORD_REACH; shift += 1) {
        if (shift === 0) continue;
        const offset = wa.at + shift - wb.at;
        const from = Math.max(0, -offset);
        const to = Math.min(wb.chars.length, wa.chars.length - offset);
        const inside = (p: number) => p >= from && p < to;
        if (!inside(wb.at) || !inside(wa.at - offset)) continue;
        let same = true;
        for (let p = from; p < to && same; p += 1) same = wb.chars[p] === wa.chars[p + offset];
        if (same) return true;
    }
    return false;
}

/** AI 標的錯字是不是錯字表已經標過的同一個錯（建議同一個字、標到隔壁的字、同一個詞） */
const repeatsRuleMark = (aiMark: TypoMark, ruleMark: TypoMark) => {
    const correct = trimmed(ruleMark?.correct);
    return correct !== '' && correct === trimmed(aiMark?.correct)
        && trimmed(ruleMark?.wrong) !== trimmed(aiMark?.wrong)
        && (nearOnSameLine(ruleMark, aiMark) || nearInContext(ruleMark, aiMark));
};

/**
 * 重複的錯字標記只算一個 —— 重複會讓錯字數變多，誤觸「錯字過多」的級分上限：
 * 1. 同一格被程式比對和 AI 各標一次，留有正確字的那個。
 * 2. 錯字表和 AI 對同一個詞建議同一個字、卻標在不同格，以錯字表為準。
 */
export function dedupeMarks(marks: TypoMark[]): TypoMark[] {
    const kept: TypoMark[] = [];
    for (const mark of marks) {
        const keys = keysOf(mark);
        const at = keys.length > 0 ? kept.findIndex((o) => keysOf(o).some((k) => keys.includes(k))) : -1;
        if (at < 0) kept.push(mark);
        else if (!kept[at].correct && mark.correct) kept[at] = mark;
    }
    const ruleMarks = kept.filter((m) => RULE_SOURCES.has(m?.source ?? ''));
    return kept.filter((m) => !AI_SOURCES.has(m?.source ?? '') || !ruleMarks.some((r) => repeatsRuleMark(m, r)));
}

/**
 * 確定的錯別字：系統有把握的（kind = typo），重複的只算一個。
 * 「待確認」（kind = check）不送 AI、不算分 —— 那幾格辨識不可信，或判斷沒把握。
 * 老師在原稿上確認、否決錯字是第三階段的事；現在只有系統有把握的。
 */
export const systemConfirmedTypos = (typoMarks: TypoMark[] | null | undefined) =>
    dedupeMarks(Array.isArray(typoMarks) ? typoMarks : []).filter((m) => m?.kind === 'typo');

function describeTypos(index: EssayIndex, marks: TypoMark[]): string[] {
    return marks.map((mark, order) => {
        const paragraph = paragraphOfMark(index, mark);
        const where = paragraph === null ? '' : `第 ${paragraph + 1} 段`;
        const context = contextOf(mark) || (typeof mark?.wrong === 'string' ? mark.wrong : '');
        const correct = typeof mark?.correct === 'string' && mark.correct ? mark.correct : '（系統沒有建議的字）';
        const wrong = typeof mark?.wrong === 'string' ? mark.wrong : '';
        return `${order + 1}. ${where}「${context}」：${wrong} → ${correct}`;
    });
}

/** 格式檢查兩行（服務的 type：段首空兩格、標點在行首） */
function describeFormat(index: EssayIndex, formatIssues: FormatIssue[] | null | undefined): string[] {
    const issues = Array.isArray(formatIssues) ? formatIssues : [];
    const describe = (type: string, withParagraphs: (list: string) => string) => {
        const matched = issues.filter((i) => i?.type === type);
        if (matched.length === 0) return '無';
        const numbers = [...new Set(matched
            .map((i) => paragraphOfMark(index, i))
            .filter((p): p is number => p !== null)
            .map((p) => p + 1))].sort((a, b) => a - b);
        return numbers.length > 0 ? `${matched.length} 處（${withParagraphs(numbers.join('、'))}）` : `${matched.length} 處`;
    };
    return [
        `段首沒有空兩格：${describe('段首空兩格', (list) => `第 ${list} 段`)}`,
        `標點寫在一行的第一格：${describe('標點在行首', (list) => `第 ${list} 段`)}`,
    ];
}

export const SYSTEM_ZERO_FEEDBACK = '這次寫的字數還太少，還沒辦法評分。下次試著把想法完整寫下來，至少寫到一百字以上，讓讀的人更了解你想說的話。';

export interface SimpleGradingInput {
    index: EssayIndex;
    /** 不足 100 字：不送 AI，直接建議 0 級分 */
    systemZero: null | { reason: string; feedback: string };
    /** 送給 AI 的「學生作文」那一段 */
    essaySection: string;
    wordCount: number;
    paragraphCount: number;
    /** 確定的錯別字（送 AI 的那一份；也是之後學生會看到紅圈的那一份） */
    confirmedTypos: TypoMark[];
}

export function buildSimpleGradingInput(grid: StoredGridResult): SimpleGradingInput {
    const index = buildEssayIndex(grid);
    const wordCount = Number.isInteger(grid?.chars) ? grid.chars! : index.paras.reduce((n, p) => n + p.length, 0);
    const paragraphCount = Number.isInteger(grid?.paragraphs) ? grid.paragraphs! : index.paras.length;
    const confirmedTypos = systemConfirmedTypos(grid?.typoMarks);
    if (wordCount < MIN_CHARS) {
        return {
            index, wordCount, paragraphCount, confirmedTypos,
            systemZero: { reason: `全文只有 ${wordCount} 字，不足 ${MIN_CHARS} 字`, feedback: SYSTEM_ZERO_FEEDBACK },
            essaySection: '',
        };
    }
    const typos = describeTypos(index, confirmedTypos);
    const essaySection = [
        '【辨識全文】（每段一行，行首的數字是段落編號；字後面的〔?〕表示這個字辨識不確定；□ 表示看不出來的字）',
        ...index.lines.map((line, i) => `${i + 1}　${line}`),
        '',
        '【系統統計】',
        `字數：${wordCount}；段落數：${paragraphCount}`,
        '',
        `【確定的錯別字】共 ${typos.length} 個`,
        ...(typos.length > 0 ? typos : ['無']),
        '',
        '【格式檢查】',
        ...describeFormat(index, grid?.formatIssues),
    ].join('\n');
    return { index, wordCount, paragraphCount, confirmedTypos, systemZero: null, essaySection };
}

/**
 * 比對用：去掉空白（含全形空格、換行）與〔?〕記號。
 * 判斷「老師有沒有改過辨識出來的文字」—— 校對改過就不是辨識原文了，改用一般批改。
 */
export const normalizeForCompare = (text: string | null | undefined) =>
    String(text ?? '').split(MARK).join('').replace(/[\s　]/g, '');
