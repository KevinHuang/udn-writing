import GridOcrHelper from '../../dal/grid_ocr_helper';
import StorageHelper from '../../dal/storage_helper';
import { createGeminiGridAi, type GridAi } from './ai';
import { asGridOcrError, GridOcrError } from './errors';
import { runGridOcr } from './pipeline';
import { createGridServiceClient, type GridServiceClient, type ServiceFile } from './service_client';
import { createSimulatedGridAi, gridAiFakeMode } from './simulated_ai';

/**
 * 跑一批代繳交照片的逐格辨識：領取 → 讀照片 → 辨識 → 存拉正的稿紙圖 → 寫結果。
 * 背景工作（dispatch.ts）的進入點；本機、Cloud Run Job、之後若改 Cloud Tasks 都呼叫這一支。
 *
 * 失敗一律記在 handwriting_grid_result（老師在名冊上看得到原因），**不往外丟**：
 * 背景工作沒有人接得住例外，丟出去只會在日誌裡留一行。
 */

export interface GridRunDeps {
    service?: GridServiceClient;
    ai?: GridAi;
}

export function defaultGridDeps(): Required<GridRunDeps> {
    const service = createGridServiceClient();
    return { service, ai: gridAiFakeMode() ? createSimulatedGridAi() : createGeminiGridAi(service) };
}

async function readPhotos(assignmentId: string, files: string[]): Promise<ServiceFile[]> {
    return Promise.all(files.map(async (f, i) => {
        const path = f.includes('/') ? f : `submit/assign_${assignmentId}/${f}`;
        const data = await StorageHelper.readFile(path);
        if (!data) throw new GridOcrError('REJECTED', `找不到第 ${i + 1} 張照片，請重新上傳`);
        return { name: `第${i + 1}張`, data: data.toString('base64') };
    }));
}

export type GridRunResult = 'done' | 'failed' | 'superseded' | 'not_claimed';

export async function runGridOcrBatch(batchId: string, deps: GridRunDeps = {}): Promise<GridRunResult> {
    const claimed = await GridOcrHelper.claim(batchId);
    if (!claimed) return 'not_claimed';
    // 沒給的才建預設的（建 Gemini 的 client 要憑證；測試給了模擬的 AI 就不該去碰它）
    const service = deps.service ?? createGridServiceClient();
    const ai = deps.ai ?? (gridAiFakeMode() ? createSimulatedGridAi() : createGeminiGridAi(service));
    const startedAt = Date.now();
    try {
        const files = await readPhotos(claimed.assignmentId, claimed.imgFiles);
        const out = await runGridOcr(files, { service, ai });

        // 拉正的稿紙圖：和照片放同一個資料夾，之後原稿紅筆畫在它上面
        const folder = `submit/assign_${claimed.assignmentId}`;
        const pageImageFiles: string[] = [];
        for (const img of out.warpedImages) {
            pageImageFiles.push(await StorageHelper.uploadBuffer(
                Buffer.from(img.jpeg, 'base64'), folder, `grid_${claimed.batchId}_p${img.page}_`, 'jpg', 'image/jpeg'));
        }

        const saved = await GridOcrHelper.saveDone(claimed, out, pageImageFiles, ai.model);
        // 不記作文內容，只記花了多久、幾次 AI
        console.log('[grid-ocr] done', { batchId, saved, ms: Date.now() - startedAt, aiCalls: out.aiCalls, timing: out.timing });
        return saved === 'saved' ? 'done' : 'superseded';
    } catch (e) {
        const err = asGridOcrError(e);
        console.warn('[grid-ocr] failed', { batchId, code: err.code, ms: Date.now() - startedAt });
        await GridOcrHelper.saveFailed(batchId, err.code, err.message);
        return 'failed';
    }
}
