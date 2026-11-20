import { JobsClient } from '@google-cloud/run';
import { runGridOcrBatch } from './runner';

/**
 * 把排好隊的逐格辨識交給背景工作跑。
 *
 * 為什麼不能直接在 API 裡跑：API 是 Cloud Run service（--timeout=300、預設 CPU 只在處理請求時配發），
 * 回應送出後還在跑的工作會被節流到幾乎停住；一份作文要 30～90 秒、一班幾十份。
 *
 * 三種方式（GRID_OCR_DISPATCH）：
 *   job      正式：觸發 Cloud Run Job（GRID_OCR_JOB_NAME），一批一個 execution，env BATCH_ID。
 *            和現在的 ocr-job 同一個做法；映像檔就是這個 API 的，指令改成 node dist/jobs/grid_ocr_job.js（docs/grid-ocr.md）。
 *   inline   本機開發：在這個程序裡排隊跑（一次 2 份），不等它跑完就回應。正式環境不要用（見上）。
 *   record   測試：只記錄被叫了誰，不跑。
 * 沒設定時：production 用 job，其他用 inline。
 */
export type GridDispatchMode = 'job' | 'inline' | 'record';

export function gridDispatchMode(): GridDispatchMode {
    const v = (process.env.GRID_OCR_DISPATCH || '').toLowerCase();
    if (v === 'job' || v === 'inline' || v === 'record') return v;
    return process.env.NODE_ENV === 'production' ? 'job' : 'inline';
}

const DEFAULT_JOB = 'projects/writing-classroom-672f8/locations/asia-east1/jobs/grid-ocr-job';
const INLINE_CONCURRENCY = 2;

export const gridDispatchCalls: string[] = [];
export function resetGridDispatchCalls(): void {
    gridDispatchCalls.length = 0;
}

const inlineQueue: string[] = [];
let inlineRunning = 0;
function pumpInline(): void {
    while (inlineRunning < INLINE_CONCURRENCY && inlineQueue.length) {
        const batchId = inlineQueue.shift()!;
        inlineRunning++;
        void runGridOcrBatch(batchId)
            .catch((e) => console.error('[grid-ocr:inline] crashed', { batchId, e }))
            .finally(() => { inlineRunning--; pumpInline(); });
    }
}

export interface GridDispatchResult {
    batchId: string;
    started: boolean;
    error?: string;
}

/** 逐批送出；一批失敗不影響其他批（回報給呼叫端逐位處理） */
export async function dispatchGridOcr(batchIds: string[]): Promise<GridDispatchResult[]> {
    const mode = gridDispatchMode();
    if (mode === 'record') {
        gridDispatchCalls.push(...batchIds);
        return batchIds.map((batchId) => ({ batchId, started: true }));
    }
    if (mode === 'inline') {
        inlineQueue.push(...batchIds);
        pumpInline();
        return batchIds.map((batchId) => ({ batchId, started: true }));
    }
    const name = process.env.GRID_OCR_JOB_NAME || DEFAULT_JOB;
    const client = new JobsClient();
    const results: GridDispatchResult[] = [];
    for (const batchId of batchIds) {
        try {
            const [operation] = await client.runJob({
                name,
                overrides: { containerOverrides: [{ env: [{ name: 'BATCH_ID', value: batchId }] }] },
            });
            const executionName = (operation?.metadata as { name?: string } | undefined)?.name ?? operation?.name;
            console.log('[grid-ocr] job started', { batchId, executionName });
            results.push({ batchId, started: true });
        } catch (e) {
            const error = e instanceof Error ? e.message : String(e);
            console.error('[grid-ocr] job failed to start', { batchId, error });
            results.push({ batchId, started: false, error });
        }
    }
    return results;
}
