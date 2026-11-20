import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

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
 * 本機假儲存的資料夾（系統暫存區底下）。存真的檔案，逐格辨識才讀得回照片、
 * 本機的原稿縮圖也不再是破圖。重開機或清暫存就沒了 —— 只給開發與測試用。
 */
export const FAKE_STORAGE_DIR = path.join(os.tmpdir(), 'udn-writing-fake-storage');

function fakePath(objectPath: string): string | null {
    if (!objectPath || objectPath.startsWith('/') || objectPath.split('/').includes('..')) return null;
    return path.join(FAKE_STORAGE_DIR, ...objectPath.split('/'));
}

/**
 * 回一個跟真的一樣形狀的檔名（`<prefix><uuid>.<ext>`），檔案存在本機暫存區。
 * 形狀要一樣 —— 下游（前端補路徑、ocr-job）靠的就是這個格式。
 */
export function fakeUpload(folder: string, fileNamePrefix: string, extension: string, data: Buffer): string {
    const fileName = `${fileNamePrefix}${crypto.randomUUID()}.${extension}`;
    storageCalls.push({ folder, fileName, bytes: data.length });
    const p = fakePath(`${folder}/${fileName}`);
    if (p) {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, data);
    }
    return fileName;
}

/** 讀回 fakeUpload 存的檔案；沒有就回 null */
export function fakeRead(objectPath: string): Buffer | null {
    const p = fakePath(objectPath);
    if (!p || !fs.existsSync(p)) return null;
    return fs.readFileSync(p);
}
