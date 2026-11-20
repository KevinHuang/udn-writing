import type { AiUsage, GridAi } from './ai';
import { GridOcrError } from './errors';
import {
    fitsPrepareLimit,
    type AssembleResult,
    type CheckResult,
    type GridServiceClient,
    type PreparedPage,
    type ServiceFile,
    type SheetProblem,
} from './service_client';

/**
 * 稿紙逐格辨識的流程（不碰資料庫、不碰 GCS；寫入由 runner.ts 負責）。
 * 移植自 1Campus Write 的 functions/lib/gridOcrPipeline.js，流程與失敗分類照舊：
 *
 *   照片 → 服務 /prepare（找定位標記、拉正、切成一組組小圖）
 *        → 每組小圖送 AI（逐格照抄）→ 服務 /assemble（組回全文、格式問題、可信度）
 *        → AI 找錯別字（必要時注音補字）→ 服務 /typos（和錯字表合併、分出確定／待確認）
 */

/** 每頁約 5 組小圖：同時送 4 組 */
export const STRIP_CONCURRENCY = 4;
/** 老師一上傳就先問服務要不要重拍；服務剛被叫醒時會慢，超過就先放行（辨識前的 /prepare 還會再判斷一次） */
export const PRECHECK_TIMEOUT_MS = 20_000;

export const ORIGINAL_GSAT_MESSAGE =
    '這份是原版學測答案卷，系統讀它錯字很多，不收。請改用「我的稿紙」印的學測稿紙，或請學生自己打字繳交。';

/** /assemble 的 warnings 裡代表「這組 AI 回應解析不了」的訊息 */
const BAD_REPLY_WARNING = /回應格式不對|回應被截斷/;

export function sheetProblemMessage(problems?: SheetProblem[]): string {
    return (problems ?? []).map((p) => p?.message).filter(Boolean).join('；')
        || '稿紙需要重拍，請確認四個角的黑色小方塊都有拍進去';
}

/** 模型偶爾把 JSON 包在 Markdown 程式碼框裡（強制 schema 時很少見，留著保險） */
export function unwrapJsonReply(text: string): string {
    const trimmed = String(text ?? '').trim();
    const fenced = trimmed.match(/```[ \t]*(?:json)?[ \t]*\r?\n?([\s\S]*?)\r?\n?[ \t]*```/i);
    if (!fenced) return trimmed;
    const inner = fenced[1].trim();
    return inner.startsWith('{') || inner.startsWith('[') ? inner : trimmed;
}

/** 有上限的並行 map，結果依輸入順序 */
export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const i = next++;
            results[i] = await fn(items[i], i);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}

/**
 * 上傳時先檢查（服務 /check，幾秒、不用 AI）。
 *   kind='grid'      我們的稿紙、四角都讀得到 → 之後走逐格辨識
 *   kind='problem'   我們的稿紙但要重拍（缺角…）或原版學測答案卷 → message 給老師看，**不收**
 *   kind='other'     不是我們的稿紙 → 照舊走 ocr-job
 *   kind='unknown'   檢查不了（服務沒設定、太大、連不上、逾時）→ 不擋老師，照舊走 ocr-job
 */
export type PrecheckResult =
    | { kind: 'grid'; template: string | null }
    | { kind: 'problem'; message: string }
    | { kind: 'other' }
    | { kind: 'unknown' };

export async function precheckSheets(
    files: ServiceFile[],
    service: GridServiceClient,
    timeoutMs = PRECHECK_TIMEOUT_MS,
): Promise<PrecheckResult> {
    if (!service.configured || !fitsPrepareLimit(files)) return { kind: 'unknown' };
    let timer: NodeJS.Timeout | undefined;
    try {
        const checked = await Promise.race<CheckResult | 'timeout'>([
            service.check(files),
            new Promise((resolve) => { timer = setTimeout(() => resolve('timeout'), timeoutMs); }),
        ]);
        if (checked === 'timeout') {
            console.warn('[grid-ocr] precheck timed out', { timeoutMs });
            return { kind: 'unknown' };
        }
        if (!checked.ours) return checked.original_gsat ? { kind: 'problem', message: ORIGINAL_GSAT_MESSAGE } : { kind: 'other' };
        if (checked.ok === false) return { kind: 'problem', message: sheetProblemMessage(checked.problems) };
        return { kind: 'grid', template: checked.pages?.[0]?.template ?? null };
    } catch (e) {
        console.warn('[grid-ocr] precheck failed', { error: e instanceof Error ? e.message : String(e) });
        return { kind: 'unknown' };
    } finally {
        clearTimeout(timer);
    }
}

export interface GridOcrOutput {
    text: string;
    markedText: string | null;
    chars: number | null;
    paragraphs: number | null;
    completion: number | null;
    formatIssues: unknown[];
    typoMarks: unknown[];
    lostTypos: number;
    warnings: string[];
    /** 每頁：template、format、paper 與服務的逐格結果（ocr） */
    pages: Array<{ prefix: string; page: number; template: string | null; format: string | null; paper: string | null; ocr: unknown }>;
    /** 拉正的稿紙圖（base64 JPEG），依頁序 */
    warpedImages: Array<{ page: number; jpeg: string }>;
    promptVersion: number | null;
    usage: AiUsage;
    aiCalls: number;
    timing: Record<string, number | null>;
}

/**
 * 跑一批照片的逐格辨識。上傳時已經檢查過是我們的稿紙，所以這裡**認不得就是失敗**（不改用整張辨識）：
 * 整張辨識讀格子稿紙錯字很多，也不能用之後的簡易批改（1Campus Write 的教訓）。
 */
export async function runGridOcr(
    files: ServiceFile[],
    deps: { service: GridServiceClient; ai: GridAi; concurrency?: number },
): Promise<GridOcrOutput> {
    const { service, ai } = deps;
    const timing: Record<string, number | null> = {
        prepareMs: null, stripCount: 0, cellsAiMs: null, assembleMs: null, typosAiMs: null, typosMs: null, zhuyinAiMs: null,
    };
    let lapAt = Date.now();
    const lap = () => { const now = Date.now(); const ms = now - lapAt; lapAt = now; return ms; };

    if (!fitsPrepareLimit(files)) {
        throw new GridOcrError('REJECTED', '照片太大，超過稿紙辨識服務的上限，請刪掉幾張或重拍');
    }
    const prepared = await service.prepare(files);
    timing.prepareMs = lap();
    if (!prepared.ours) {
        if (prepared.original_gsat) throw new GridOcrError('ORIGINAL_GSAT', ORIGINAL_GSAT_MESSAGE);
        throw new GridOcrError('NOT_OUR_SHEET', '照片裡認不出「我的稿紙」印的稿紙，請確認四個角的黑色小方塊都有拍進去後重拍');
    }
    if (!prepared.ok) throw new GridOcrError('SHEET_PROBLEM', sheetProblemMessage(prepared.problems));

    const usages: AiUsage[] = [];
    const pages = (prepared.pages ?? []) as PreparedPage[];
    const strips = pages.flatMap((page, pageIndex) => (page.strips ?? []).map((strip) => ({ pageIndex, strip })));
    timing.stripCount = strips.length;

    const replies = await mapWithConcurrency(strips, deps.concurrency ?? STRIP_CONCURRENCY, async ({ pageIndex, strip }) => {
        const out = await ai.cells(strip);
        usages.push(out.usage);
        return { pageIndex, reply: { index: strip.index, text: unwrapJsonReply(out.text) } };
    });
    timing.cellsAiMs = lap();

    const assembled: AssembleResult = await service.assemble(pages.map((page, pageIndex) => ({
        meta: page.meta,
        warped_jpeg: page.warped_jpeg,
        replies: replies.filter((r) => r.pageIndex === pageIndex).map((r) => r.reply),
    })));
    timing.assembleMs = lap();

    // 服務解析不了某組回應時不報錯，只在 warnings 記「第 a～b 行：回應格式不對」，那幾行的字就不見了
    const bad = (assembled.warnings ?? []).filter((w) => BAD_REPLY_WARNING.test(w));
    if (bad.length) {
        throw new GridOcrError('BAD_REPLY', `有 ${bad.length} 組辨識結果讀不懂（${bad[0]}），請按「重新辨識」`, true);
    }
    if (!String(assembled.text ?? '').trim() || !assembled.typo_request?.prompt) {
        throw new GridOcrError('EMPTY', '稿紙上辨識不到文字，請確認照片是寫好的稿紙');
    }

    // 找錯別字：AI → 服務 /typos；服務要注音補字時再一次
    const typoOut = await ai.text('找錯別字', assembled.typo_request.prompt);
    usages.push(typoOut.usage);
    timing.typosAiMs = lap();
    const typoBody = { pages: assembled.pages, rule_marks: assembled.rule_marks, ai_reply: unwrapJsonReply(typoOut.text) };
    let typos = await service.typos(typoBody);
    timing.typosMs = lap();
    if (!typos.done && typos.zhuyin_request?.prompt) {
        const z = await ai.text('注音補字', typos.zhuyin_request.prompt);
        usages.push(z.usage);
        timing.zhuyinAiMs = lap();
        typos = await service.typos({ ...typoBody, zhuyin_reply: unwrapJsonReply(z.text) });
        timing.typosMs = (timing.typosMs ?? 0) + lap();
    }
    if (!typos.done) throw new GridOcrError('UNAVAILABLE', '稿紙辨識服務沒有回傳錯字清單，請稍後按「重新辨識」', true);

    const prepByPage = new Map(pages.map((p) => [p.page, p]));
    return {
        text: assembled.text,
        markedText: assembled.marked_text ?? null,
        chars: assembled.chars ?? null,
        paragraphs: assembled.paragraphs ?? null,
        completion: assembled.completion ?? null,
        formatIssues: assembled.format ?? [],
        typoMarks: typos.marks ?? [],
        lostTypos: typos.lost ?? 0,
        warnings: assembled.warnings ?? [],
        pages: (assembled.pages ?? []).map((p) => {
            const prep = prepByPage.get(p.page);
            return { prefix: p.prefix, page: p.page, template: prep?.template ?? null, format: prep?.format ?? null,
                paper: prep?.paper ?? null, ocr: p.ocr };
        }),
        warpedImages: pages.map((p) => ({ page: p.page, jpeg: p.warped_jpeg })),
        promptVersion: prepared.prompt_version ?? null,
        usage: {
            inputTokens: usages.reduce((s, u) => s + u.inputTokens, 0),
            outputTokens: usages.reduce((s, u) => s + u.outputTokens, 0),
        },
        aiCalls: usages.length,
        timing,
    };
}
