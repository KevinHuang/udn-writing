/**
 * 型別的實際定義已經搬到 packages/shared，這裡只是再匯出。
 *
 * 保留這個檔案是為了讓所有元件的 `from './types'` / `from '../types'`
 * 不用改 —— 型別只有一份，在 @udn/shared。
 *
 * 新的程式碼請直接 `from '@udn/shared'`。
 */
export * from '@udn/shared';
