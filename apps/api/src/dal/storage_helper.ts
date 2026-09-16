import { Storage } from '@google-cloud/storage';
import crypto from 'crypto';

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
}

export default StorageHelper;
