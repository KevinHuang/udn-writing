/**
 * 使用者上傳的圖片（base64）檢查。
 *
 * 原本寫在 routes/geminiService.ts 裡、直接對 ctx 回錯誤；代繳交的上傳端點
 * 也要同一套規則，所以抽成不碰 ctx 的純函式，兩邊各自決定怎麼回錯誤。
 *
 * ⚠️ 代繳交的上傳端點以前**完全沒有檢查**：任何字串都當成 JPEG
 *    （寫死 `data:image/jpeg;base64,`）存進 GCS，大小也不管。
 */

/** 單張圖片 base64 的上限。約 8 MB 的原始資料 */
export const MAX_IMAGE_BASE64 = 11 * 1024 * 1024;

/**
 * 一位學生一次最多幾張。
 *
 * 一次請求的 body 上限是 20MB（app.ts 的 bodyParser）；前端先把每張壓到
 * 長邊 3000px（約 1–1.5MB），八張約 12MB，留得出餘裕。
 * 作文稿紙實際上一兩張，八張已經很寬鬆。
 */
export const MAX_IMAGES_PER_REQUEST = 8;

/** 允許存進 GCS 的格式（與 StorageHelper 的 regex 一致） */
const STORABLE = /^image\/(png|jpeg|jpg|webp|gif)$/;

export interface ImageInput {
    base64Image: string;
    mimeType: string;
}

export type ImageCheck =
    | { ok: true; image: ImageInput }
    | { ok: false; status: 400 | 413; message: string };

/** 檢查一組 { base64Image, mimeType } */
export function checkImage(source: Partial<ImageInput> | undefined): ImageCheck {
    const { base64Image, mimeType } = source ?? {};
    if (!base64Image || !mimeType) {
        return { ok: false, status: 400, message: 'Missing base64Image or mimeType.' };
    }
    if (!/^image\//.test(mimeType)) {
        return { ok: false, status: 400, message: 'mimeType must be an image type.' };
    }
    if (base64Image.length > MAX_IMAGE_BASE64) {
        return { ok: false, status: 413, message: 'Image too large.' };
    }
    return { ok: true, image: { base64Image, mimeType } };
}

/**
 * 代繳交上傳的一整份照片。
 *
 * 相容舊的形狀 `images: string[]`（當成 JPEG）—— 這支端點以前只收裸字串。
 * 另外只收得進 GCS 存得了的格式；HEIC 之類的前端要先轉（lib/proxy/image.ts 會轉成 JPEG）。
 */
export function checkImageList(
    raw: unknown,
): { ok: true; images: ImageInput[] } | { ok: false; status: 400 | 413; message: string } {
    if (!Array.isArray(raw) || raw.length === 0) {
        return { ok: false, status: 400, message: 'images 至少要有一張。' };
    }
    if (raw.length > MAX_IMAGES_PER_REQUEST) {
        return { ok: false, status: 400, message: `一次最多 ${MAX_IMAGES_PER_REQUEST} 張。` };
    }
    const images: ImageInput[] = [];
    for (const item of raw) {
        const source = typeof item === 'string'
            ? { base64Image: item, mimeType: 'image/jpeg' }
            : (item as Partial<ImageInput>);
        const checked = checkImage(source);
        if (!checked.ok) return checked;
        if (!STORABLE.test(checked.image.mimeType)) {
            return { ok: false, status: 400, message: `不支援的圖片格式：${checked.image.mimeType}` };
        }
        images.push(checked.image);
    }
    return { ok: true, images };
}
