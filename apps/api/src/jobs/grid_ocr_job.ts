/**
 * Cloud Run Job 的進入點：跑一批（或幾批）代繳交照片的稿紙逐格辨識。
 *
 *     node dist/jobs/grid_ocr_job.js        環境變數 BATCH_ID=<batch_proxy_submission.id>（可用逗號分隔多批）
 *
 * 映像檔和 API 是同一個（apps/api/Dockerfile），只是指令不同；部署方式見 docs/grid-ocr.md。
 * 由 API 的 lib/grid_ocr/dispatch.ts 觸發（GRID_OCR_DISPATCH=job）。
 *
 * 失敗都記在 handwriting_grid_result（runGridOcrBatch 不往外丟），所以這支一律正常結束 ——
 * Cloud Run Job 的自動重試不要開：AI 回應壞掉、稿紙缺角這種，重跑也一樣，由老師按「重新辨識」。
 */
import { runGridOcrBatch } from '../lib/grid_ocr/runner';
import { db } from '../dal/database';

async function main(): Promise<void> {
    const ids = (process.env.BATCH_ID || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!ids.length) {
        console.error('[grid-ocr-job] 沒有 BATCH_ID');
        process.exitCode = 1;
        return;
    }
    for (const id of ids) {
        const result = await runGridOcrBatch(id);
        console.log('[grid-ocr-job]', { batchId: id, result });
    }
}

main()
    .catch((e) => {
        console.error('[grid-ocr-job] crashed', e);
        process.exitCode = 1;
    })
    .finally(() => db.default.$pool.end());
