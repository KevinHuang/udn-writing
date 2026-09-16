/**
 * 把檔案讀成 base64。
 *
 * 這段 FileReader 的樣板原本在 StudentEssayEditor 與 QuestionBank 各寫一次，
 * 代繳交會是第三次 —— 依 CLAUDE.md 的規則收在這裡。
 *
 * 兩種用途分開兩支函式，不要用旗標切換：
 *   - Gemini 的 inlineData 只吃**不含前綴**的純 base64
 *   - <img src> 要的是**完整 data URL**
 * 傳錯一種不會報錯，只會安靜地壞掉（圖片顯示不出來，或 OCR 回空字串）。
 */

/** 完整 data URL，例：`data:image/png;base64,iVBORw0...`。給 <img src> 用 */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('檔案讀取失敗'));
    reader.readAsDataURL(file);
  });
}

/** 去掉 `data:...;base64,` 前綴的純 base64。給 Gemini 的 inlineData 用 */
export async function fileToBase64(file: File): Promise<string> {
  const dataUrl = await fileToDataUrl(file);
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}
