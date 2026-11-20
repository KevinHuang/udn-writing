/**
 * 稿紙逐格辨識的錯誤分類（docs/grid-ocr.md「失敗怎麼處理」）。
 *
 * 分類決定兩件事：要不要重試、要不要改用整張辨識。教訓都來自 1Campus Write：
 *   - 稿紙有問題（缺角、格子對不準、重複頁）→ 重試也一樣，直接請老師重拍；
 *   - 認得出是我們的稿紙之後才失敗（AI 回應壞掉、辨識不到字）→ **不改用整張辨識**：
 *     整張辨識讀格子稿紙錯字很多，也不能用之後的簡易批改；請老師重新辨識；
 *   - 服務或 AI 一時連不上 → 可以重試。
 */
export type GridOcrErrorCode =
    | 'SHEET_PROBLEM'      // 稿紙要老師處理：缺角、格子對不準、重複頁…（訊息直接給老師看）
    | 'ORIGINAL_GSAT'      // 原版學測答案卷：不收
    | 'NOT_OUR_SHEET'      // 上傳時認得、辨識時卻認不得（照片被換掉之類）
    | 'BAD_REPLY'          // AI 回應解析不了
    | 'EMPTY'              // 稿紙上辨識不到字
    | 'REJECTED'           // 服務說照片或資料有問題（400／413／415／422）
    | 'UNAVAILABLE'        // 服務或 AI 暫時無法使用（可重試）
    | 'INTERNAL';          // 其他（程式錯誤）

export class GridOcrError extends Error {
    constructor(
        public readonly code: GridOcrErrorCode,
        /** 給老師看的一句話 */
        message: string,
        /** 重試有沒有可能成功 */
        public readonly retryable = false,
    ) {
        super(message);
        this.name = 'GridOcrError';
    }
}

/** 任何錯誤 → GridOcrError（程式錯誤不把內部訊息給老師看） */
export function asGridOcrError(e: unknown): GridOcrError {
    if (e instanceof GridOcrError) return e;
    console.error('[grid-ocr] unexpected error', e);
    return new GridOcrError('INTERNAL', '辨識時發生錯誤，請稍後再按「重新辨識」', true);
}
