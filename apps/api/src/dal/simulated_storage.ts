import crypto from 'crypto';

/**
 * 不打 GCS 的上傳（測試與本機開發用）。
 *
 * 為什麼需要：`StorageHelper` 直接 `new Storage()` 打 Google Cloud Storage，
 * 而本機與 CI 沒有 GCP 憑證 —— 不包這一層的話，代繳交的「上傳」那條路
 * 在測試裡一行都跑不到，只能上線才知道對不對。
 *
 * ⚠️ **要明確開啟**（`STORAGE_FAKE=1`），而且正式環境一律無效。
 *    反過來做（沒設定就自動走 fake）的話，正式環境只要少一個環境變數，
 *    老師上傳的照片就會安靜地消失 —— 畫面上一切正常，原稿卻從來沒存進去。
 */
export function isStorageFake(): boolean {
    if (process.env.NODE_ENV === 'production') return false;
    const v = (process.env.STORAGE_FAKE || '').toLowerCase();
    return v === '1' || v === 'true';
}

/** 測試用：看得到「到底上傳了什麼」—— 用來斷言「擋下來的請求沒有先上傳」 */
export const storageCalls: Array<{ folder: string; fileName: string; bytes: number }> = [];

export function resetStorageCalls(): void {
    storageCalls.length = 0;
}

/**
 * 回一個跟真的一樣形狀的檔名（`<prefix><uuid>.<ext>`），但不存任何東西。
 * 形狀要一樣 —— 下游（前端補路徑、ocr-job）靠的就是這個格式。
 */
export function fakeUpload(folder: string, fileNamePrefix: string, extension: string, bytes: number): string {
    const fileName = `${fileNamePrefix}${crypto.randomUUID()}.${extension}`;
    storageCalls.push({ folder, fileName, bytes });
    return fileName;
}
