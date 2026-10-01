import { Storage } from '@google-cloud/storage';
import crypto from 'crypto';
import { fakeUpload, isStorageFake } from './simulated_storage';

class StorageHelper {
    private static storage = new Storage();
    private static bucketName = 'writing-classroom';
    private static folderPath = 'img';

    /**
     * 若傳入的是 base64 字串，則將其解析並上傳至 GCS，回傳產生的純檔名
     * 若不是有效的 base64 字串，則原封不動回傳
     * @param picString 可能為 base64 的字串，也可能只是檔名或空字串
     */
    public static async uploadImageIfBase64(picString?: string, folder?: string, fileNamePrefix?: string): Promise<string> {
        if (!picString) return '';

        // 偵測是否為 base64 圖片 (格式: data:image/png;base64,iVBORw...)
        const base64Regex = /^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/;
        const match = picString.match(base64Regex);

        if (!match) {
            // 如果不是 base64 圖片，直接回傳原字串 (可能是之前上傳過的檔名)
            return picString;
        }

        const extension = match[1] === 'jpeg' ? 'jpg' : match[1];
        const base64Data = match[2];

        // 測試與本機（STORAGE_FAKE=1）：不打 GCS，回一個形狀一樣的檔名（見 simulated_storage.ts）
        if (isStorageFake()) {
            return fakeUpload(folder || this.folderPath, fileNamePrefix || '', extension,
                Math.floor(base64Data.length * 3 / 4));
        }

        // 產生唯一檔名
        const fileName = `${fileNamePrefix || ''}${crypto.randomUUID()}.${extension}`;
        const destination = `${folder || this.folderPath}/${fileName}`;

        try {
            // Buffer.from 將 base64 轉回二進位
            const fileBuffer = Buffer.from(base64Data, 'base64');
            const bucket = this.storage.bucket(this.bucketName);
            const file = bucket.file(destination);

            await file.save(fileBuffer, {
                metadata: {
                    contentType: `image/${match[1]}`,
                },
                // 若 bucket 為 Public，這行能確保直接公開讀取 (可選)
                // public: true, 
            });

            // console.log(`Successfully uploaded image to GCS: ${destination}`);
            return fileName;
        } catch (error) {
            console.error('Failed to upload image to GCS:', error);
            // 上傳失敗時，為避免影響後續操作，可以拋錯或回傳原字串
            throw new Error('Image upload failed');
        }
    }

    /**
     * 讀一張圖（數位作品集的原稿轉送用，routes/portfolio.ts）。
     *
     * 用這個服務自己的 GCS 權限讀，不靠 bucket 公開 —— 之後 bucket 改成不公開，
     * 轉送照樣能用，而作品集那邊從頭到尾拿不到原始網址。
     *
     * 找不到檔案回傳 null。路徑只接受 bucket 裡的相對路徑（不能有 `..`、不能以 / 開頭），
     * 雖然路徑來自資料庫，還是擋一下。
     *
     * 測試與本機（STORAGE_FAKE=1）：不打 GCS，回一張 1×1 的 PNG。
     */
    public static async openImage(path: string): Promise<{ body: NodeJS.ReadableStream | Buffer; contentType: string } | null> {
        if (!path || path.startsWith('/') || path.split('/').includes('..')) return null;
        const ext = (path.split('.').pop() ?? '').toLowerCase();
        const contentType =
            ext === 'png' ? 'image/png'
            : ext === 'webp' ? 'image/webp'
            : ext === 'gif' ? 'image/gif'
            : 'image/jpeg';

        if (isStorageFake()) {
            return { body: FAKE_PNG, contentType: 'image/png' };
        }

        const file = this.storage.bucket(this.bucketName).file(path);
        const [exists] = await file.exists();
        if (!exists) return null;
        return { body: file.createReadStream(), contentType };
    }
}

/** STORAGE_FAKE 時回傳的 1×1 透明 PNG */
const FAKE_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64',
);

export default StorageHelper;
