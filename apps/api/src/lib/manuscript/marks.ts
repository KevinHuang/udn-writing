import { dedupeMarks, rebuildParagraphs, type FormatIssue, type GridPage, type TypoMark } from '../simple_grading/essay';

/**
 * 原稿紅筆（docs/manuscript.md）：把辨識服務的錯字標記、格式問題（handwriting_grid_result）
 * 和老師在原稿上的決定（manuscript_mark_decision）合起來。
 *
 * 原稿畫面、簡易批改送給 AI 的錯字清單、重新評分的提醒，都用這裡算出的**同一份**「確定的錯別字」：
 * 系統有把握、老師沒有否決的錯字，加上老師確認的、老師加的。待確認的不算分、不送 AI，學生也看不到。
 *
 * 搬自 1Campus Write 的 functions/lib/manuscriptMarks.js。純函式，不碰資料庫與網路。
 */

export const TARGETS = { TYPO: 'typo', FORMAT: 'format' } as const;
export type Target = typeof TARGETS[keyof typeof TARGETS];
export const DECISIONS = { CONFIRM: 'confirm', VETO: 'veto', ADD: 'add' } as const;
export type Decision = typeof DECISIONS[keyof typeof DECISIONS];
/** 老師在原稿上能按的動作（POST .../manuscript/decisions 的 action） */
export const ACTIONS = {
    CONFIRM: 'confirm', // 是錯字（待確認）
    VETO: 'veto', // 不是錯字／不是格式問題
    CORRECT: 'correct', // 改正確的字
    ADD: 'add', // 點字加錯字
    UNDO: 'undo', // 復原（拿掉老師對系統標記的決定）
    DELETE: 'delete', // 刪掉老師加的錯字
} as const;
export type Action = typeof ACTIONS[keyof typeof ACTIONS];

export type TypoState = 'confirmed' | 'pending' | 'vetoed';
export type FormatState = 'active' | 'vetoed';

const INDENT_ISSUE = '段首空兩格';
/** 「錯字 3 個以上或段首沒空兩格」：重新評分提醒看的門檻（見 regradeReminder） */
export const TYPO_LIMIT = 3;
const CONTEXT_WIDTH = 6;
export const MAX_CORRECT_CHARS = 4;
export const MAX_NOTE_CHARS = 200;

export interface DecisionRow {
    target: Target;
    cellKey: string;
    decision: Decision;
    correct?: string | null;
    note?: string | null;
}

export interface MergedTypo {
    /** `typo|<第一格>`：畫面與便條用的穩定 id */
    id: string | null;
    cellKey: string | null;
    keys: string[];
    wrong: string;
    correct: string;
    reason: string;
    type: string;
    context: string[];
    source: 'system' | 'teacher';
    /** 系統標的是確定（typo）還是待確認（check）；老師加的是 null */
    systemKind: 'typo' | 'check' | null;
    state: TypoState;
    /** 老師改過正確的字 */
    corrected: boolean;
    /** 老師對這個標記做過決定（可以「復原」） */
    decided: boolean;
}

export interface MergedFormat {
    id: string | null;
    cellKey: string | null;
    keys: string[];
    type: string;
    text: string;
    why: string;
    state: FormatState;
}

export interface MergedMarks {
    typos: MergedTypo[];
    formats: MergedFormat[];
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const firstKey = (mark: { keys?: unknown }) =>
    Array.isArray(mark?.keys) && typeof mark.keys[0] === 'string' ? (mark.keys[0] as string) : null;
const decisionId = (target: string, key: string) => `${target}|${key}`;
const cellKeyOf = (prefix: string, cell: { col?: number; row?: number }) => `${prefix}:${cell.col}:${cell.row}`;

/** 每一格的字（空白格是空字串），鍵是 `第N頁:行:格` */
export function cellTexts(pages: GridPage[] | null | undefined): Map<string, string> {
    const texts = new Map<string, string>();
    (Array.isArray(pages) ? pages : []).forEach((page, order) => {
        const prefix = page?.prefix || `第${page?.page ?? order + 1}頁`;
        for (const cell of Array.isArray(page?.ocr?.cells) ? page.ocr!.cells! : []) {
            if (!Number.isFinite(Number(cell?.col)) || !Number.isFinite(Number(cell?.row))) continue;
            texts.set(cellKeyOf(prefix, cell), cell.status !== 'blank' && typeof cell.text === 'string' ? cell.text : '');
        }
    });
    return texts;
}

/** 老師加的錯字的前後文，格式同辨識服務的 context：[前面幾個字, 這一格的字, 後面幾個字] */
function contextOfKey(paras: ReturnType<typeof rebuildParagraphs>, key: string): string[] {
    for (const para of paras) {
        const start = para.findIndex((item) => item.key === key);
        if (start < 0) continue;
        let end = start;
        while (end + 1 < para.length && para[end + 1].key === key) end += 1;
        const join = (items: typeof para) => items.map((item) => item.ch).join('');
        return [
            join(para.slice(Math.max(0, start - CONTEXT_WIDTH), start)),
            join(para.slice(start, end + 1)),
            join(para.slice(end + 1, end + 1 + CONTEXT_WIDTH)),
        ];
    }
    return [];
}

function systemTypo(mark: TypoMark & { reason?: string; type?: string }, decision: DecisionRow | undefined): MergedTypo {
    const corrected = Boolean(decision && decision.decision !== DECISIONS.VETO && text(decision.correct));
    let state: TypoState = mark.kind === 'typo' ? 'confirmed' : 'pending';
    if (decision?.decision === DECISIONS.VETO) state = 'vetoed';
    else if (decision) state = 'confirmed';
    const key = firstKey(mark);
    return {
        id: key ? decisionId(TARGETS.TYPO, key) : null,
        cellKey: key,
        keys: Array.isArray(mark.keys) ? mark.keys : [],
        wrong: text(mark.wrong),
        correct: corrected ? text(decision!.correct) : text(mark.correct),
        // 改正確的字時，系統原本的說明對不上了，只留老師自己寫的
        reason: corrected ? text(decision!.note) : text(mark.reason),
        type: text(mark.type),
        context: Array.isArray(mark.context) ? mark.context : [],
        source: 'system',
        systemKind: mark.kind === 'typo' ? 'typo' : 'check',
        state,
        corrected,
        decided: Boolean(decision),
    };
}

/**
 * 系統標記＋老師的決定 → 原稿上的錯字與格式提醒。
 * 重複的錯字標記只留一個（dedupeMarks）；決定用標記的第一格對上。
 * 被拿掉的標記原本有的決定就用不到了，照樣留在資料表裡。
 */
export function mergeManuscriptMarks(
    grid: { pages?: GridPage[] | null; typoMarks?: TypoMark[] | null; formatIssues?: FormatIssue[] | null },
    decisions: DecisionRow[] = [],
): MergedMarks {
    const byId = new Map(decisions.map((d) => [decisionId(d.target, d.cellKey), d]));
    const used = new Set<string>();
    const typos = dedupeMarks(Array.isArray(grid?.typoMarks) ? grid.typoMarks : []).map((mark) => {
        const key = firstKey(mark);
        const decision = key ? byId.get(decisionId(TARGETS.TYPO, key)) : undefined;
        if (decision) used.add(decisionId(TARGETS.TYPO, key!));
        return systemTypo(mark, decision);
    });

    // 老師加的錯字：落在系統標記上的不算（寫入時就擋），一格一個
    const covered = new Set(typos.flatMap((m) => m.keys));
    const adds = [...byId.values()].filter((d) =>
        d.target === TARGETS.TYPO && d.decision === DECISIONS.ADD
        && !used.has(decisionId(TARGETS.TYPO, d.cellKey)) && !covered.has(d.cellKey));
    if (adds.length > 0) {
        const texts = cellTexts(grid?.pages);
        const paras = rebuildParagraphs(grid?.pages);
        for (const d of adds) {
            typos.push({
                id: decisionId(TARGETS.TYPO, d.cellKey),
                cellKey: d.cellKey,
                keys: [d.cellKey],
                wrong: texts.get(d.cellKey) || '',
                correct: text(d.correct),
                reason: text(d.note),
                type: '老師加的',
                context: contextOfKey(paras, d.cellKey),
                source: 'teacher',
                systemKind: null,
                state: 'confirmed',
                corrected: false,
                decided: true,
            });
        }
    }

    const formats = (Array.isArray(grid?.formatIssues) ? grid.formatIssues : []).map((issue) => {
        const key = firstKey(issue);
        const decision = key ? byId.get(decisionId(TARGETS.FORMAT, key)) : undefined;
        const raw = issue as FormatIssue & { why?: string };
        return {
            id: key ? decisionId(TARGETS.FORMAT, key) : null,
            cellKey: key,
            keys: Array.isArray(issue.keys) ? issue.keys : [],
            type: text(issue.type),
            text: text(issue.text),
            why: text(raw.why),
            state: (decision?.decision === DECISIONS.VETO ? 'vetoed' : 'active') as FormatState,
        };
    });

    return { typos, formats };
}

export const confirmedTypos = (m: MergedMarks) => m.typos.filter((t) => t.state === 'confirmed');
export const activeFormatIssues = (m: MergedMarks) => m.formats.filter((f) => f.state === 'active');
/** 卡片引用、成語要避開的錯字：含待確認、老師加的；被否決的不算 */
export const flaggedTypos = (m: MergedMarks) => m.typos.filter((t) => t.state !== 'vetoed');

export interface MarkBaseline {
    confirmedTypoCount: number;
    indentIssueCount: number;
    /** 錯字 3 個以上或段首沒空兩格 */
    overTypoLimit: boolean;
}

/** 重新評分要比較的狀態：批改當下存進 simple_grading_result.detail.baseline，原稿畫面再用目前的狀態比 */
export function markBaseline(m: MergedMarks): MarkBaseline {
    const confirmedTypoCount = confirmedTypos(m).length;
    const indentIssueCount = activeFormatIssues(m).filter((f) => f.type === INDENT_ISSUE).length;
    return { confirmedTypoCount, indentIssueCount, overTypoLimit: confirmedTypoCount >= TYPO_LIMIT || indentIssueCount > 0 };
}

export class ManuscriptDecisionError extends Error {
    constructor(public status: 400 | 409, message: string) {
        super(message);
        this.name = 'ManuscriptDecisionError';
    }
}
const badRequest = (msg: string) => new ManuscriptDecisionError(400, msg);
const conflict = (msg: string) => new ManuscriptDecisionError(409, msg);

function parseCorrect(v: unknown): string {
    const correct = text(v);
    if (!correct) throw badRequest('請填正確的字');
    if ([...correct].length > MAX_CORRECT_CHARS) throw badRequest(`正確的字最多 ${MAX_CORRECT_CHARS} 個字`);
    return correct;
}

function parseNote(v: unknown): string | null {
    if (v != null && typeof v !== 'string') throw badRequest('說明格式不正確');
    const note = text(v);
    if ([...note].length > MAX_NOTE_CHARS) throw badRequest(`說明最多 ${MAX_NOTE_CHARS} 字`);
    return note || null;
}

export type DecisionPlan =
    | { op: 'upsert'; decision: Decision; correct: string | null; note: string | null }
    | { op: 'delete' };

/**
 * 老師按的一個動作 → 要寫入或刪掉的決定。
 * 標記已經變了（例如另一個分頁先按了）時 409，畫面重新整理就好。
 */
export function planDecision(
    merged: MergedMarks,
    input: { target?: unknown; cellKey?: unknown; action?: unknown; correct?: unknown; note?: unknown },
    cellText = '',
): DecisionPlan {
    const target = input?.target;
    const key = typeof input?.cellKey === 'string' ? input.cellKey : '';
    const action = input?.action;
    if (target !== TARGETS.TYPO && target !== TARGETS.FORMAT) throw badRequest('不認得的標記種類');
    if (!key || key.length > 64) throw badRequest('格子位置不正確');
    if (!Object.values(ACTIONS).includes(action as Action)) throw badRequest('不認得的動作');

    if (target === TARGETS.FORMAT) {
        const issue = merged.formats.find((f) => f.cellKey === key);
        if (!issue) throw conflict('找不到這個格式提醒，請重新整理');
        if (action === ACTIONS.VETO) return { op: 'upsert', decision: DECISIONS.VETO, correct: null, note: null };
        if (action === ACTIONS.UNDO) return { op: 'delete' };
        throw badRequest('格式提醒只能按「不是格式問題」或「復原」');
    }

    const mark = merged.typos.find((t) => t.cellKey === key);
    if (action === ACTIONS.ADD) {
        if (merged.typos.some((t) => t.keys.includes(key))) throw conflict('這一格已經有錯字標記了，請重新整理');
        if (!text(cellText)) throw badRequest('這一格沒有字，不能加錯字');
        return { op: 'upsert', decision: DECISIONS.ADD, correct: parseCorrect(input.correct), note: parseNote(input.note) };
    }
    if (!mark) throw conflict('找不到這個錯字標記，請重新整理');

    if (mark.source === 'teacher') {
        if (action === ACTIONS.CORRECT) {
            return { op: 'upsert', decision: DECISIONS.ADD, correct: parseCorrect(input.correct), note: parseNote(input.note) };
        }
        if (action === ACTIONS.DELETE) return { op: 'delete' };
        throw badRequest('老師加的錯字只能改正確的字或刪掉');
    }

    switch (action) {
        case ACTIONS.CONFIRM:
            if (mark.state !== 'pending') throw conflict('這個錯字已經不是待確認了，請重新整理');
            return { op: 'upsert', decision: DECISIONS.CONFIRM, correct: null, note: null };
        case ACTIONS.VETO:
            if (mark.state === 'vetoed') throw conflict('這個錯字已經否決了，請重新整理');
            return { op: 'upsert', decision: DECISIONS.VETO, correct: null, note: null };
        case ACTIONS.CORRECT:
            if (mark.state === 'vetoed') throw conflict('已經否決的錯字要先復原，才能改正確的字');
            return { op: 'upsert', decision: DECISIONS.CONFIRM, correct: parseCorrect(input.correct), note: parseNote(input.note) };
        case ACTIONS.UNDO:
            if (!mark.decided) throw conflict('這個錯字沒有可以復原的決定，請重新整理');
            return { op: 'delete' };
        default:
            throw badRequest('系統標的錯字不能刪掉，可以按「不是錯字」');
    }
}
