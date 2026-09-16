
import { JobsClient } from "@google-cloud/run";

class CloudRunJobsHelper {

    /** 啟用 Cloud Run Job，處理 OCR 批次作業 
     * 可能兩種啟用時機：1. 教師批次代繳交 2. 每小時自動批次 OCR
    */
    public static async startOCRJob(studentId: string, assignmentId: string, batchUUID?: string): Promise<any> {
        const client = new JobsClient();
        const jobName = 'projects/writing-classroom-672f8/locations/asia-east1/jobs/ocr-job';

        const env_vars = [
            {
                name: "assignmentId",
                value: assignmentId,
            },
            {
                name: "studentId",
                value: studentId,
            },
            {
                name: "batchUUID",
                value: batchUUID,
            },
        ];
        // console.log({ env_vars });

        const [operation] = await client.runJob({
            name: jobName,
            overrides: {
                containerOverrides: [
                    {
                        env: env_vars,
                    },
                ],
            },
        });
        return operation;
    }

}

export default CloudRunJobsHelper;