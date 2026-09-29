
import { JobsClient } from "@google-cloud/run";
import { fakeStartOcrJob, ocrJobFakeMode } from './simulated_ocr_job';

/**
 * Cloud Run Job `ocr-job` 的名稱。
 *
 * 以前 project id 直接寫死在程式裡；改讀環境變數，預設維持原值，
 * 測試環境／別的 GCP 專案才換得過去。
 */
const DEFAULT_OCR_JOB = 'projects/writing-classroom-672f8/locations/asia-east1/jobs/ocr-job';

export interface OcrJobStart {
    started: boolean;
    /** Cloud Run 回的 execution 名稱。線上出事時靠它去 Cloud Logging 找 */
    executionName?: string;
    error?: string;
}

class CloudRunJobsHelper {

    /**
     * 啟用 Cloud Run Job，處理 OCR 批次作業。
     * 可能兩種啟用時機：1. 教師批次代繳交 2. 每小時自動批次 OCR
     *
     * ⚠️ **這個 job 的原始碼不在這個 repo**，它怎麼讀 batch_proxy_submission、
     *    怎麼把文字寫回 submission，都只能從資料表上的痕跡推斷。
     *
     * 一次呼叫＝一位學生一個 execution（參數用環境變數帶進去）。
     *
     * **不往外丟錯。** 呼叫端是一次觸發一整班，某一位失敗（權限、配額）
     * 不該讓前面已經送出去的那幾位跟著變成「全部失敗」—— 回報給呼叫端逐位處理。
     */
    public static async startOCRJob(studentId: string, assignmentId: string, batchUUID?: string): Promise<OcrJobStart> {
        // 測試與本機（OCR_JOB_FAKE=1 / simulate）：不打 GCP，見 simulated_ocr_job.ts
        if (ocrJobFakeMode() !== 'off') {
            return { started: true, executionName: fakeStartOcrJob(studentId, assignmentId, batchUUID) };
        }

        const jobName = process.env.OCR_JOB_NAME || DEFAULT_OCR_JOB;
        const env_vars = [
            { name: "assignmentId", value: assignmentId },
            { name: "studentId", value: studentId },
            { name: "batchUUID", value: batchUUID },
        ];

        try {
            const client = new JobsClient();
            const [operation] = await client.runJob({
                name: jobName,
                overrides: {
                    containerOverrides: [{ env: env_vars }],
                },
            });
            /*
              以前這裡什麼都沒記 —— 權限不足或 job 不存在時前端完全看不出來，
              線上出事也無從追起。留下 execution 名稱、學生、批次，
              才能拿去 Cloud Logging 對。
            */
            const executionName = (operation?.metadata as { name?: string } | undefined)?.name
                ?? operation?.name ?? undefined;
            console.log('[ocr-job] started', { executionName, studentId, assignmentId, batchUUID });
            return { started: true, executionName };
        } catch (e) {
            const error = e instanceof Error ? e.message : String(e);
            console.error('[ocr-job] failed to start', { studentId, assignmentId, batchUUID, error });
            return { started: false, error };
        }
    }

}

export default CloudRunJobsHelper;
