import { api } from './client';
import type { AiGradingResponse } from '@udn/shared';

/**
 * AI 功能。**全部在後端執行。**
 *
 * 這個檔案取代了原型的 `services/geminiService.ts` —— 那支直接在瀏覽器裡
 * `new GoogleGenAI({ apiKey })`，金鑰經由 vite 的 define 打進 bundle，
 * 任何人開開發者工具都拿得到。提示詞原封不動搬到了 `apps/api` 的 GenAIHelper，
 * 所以行為沒變，變的只是金鑰留在伺服器。
 *
 * 函式簽名刻意與原本那支一致，元件端只要改 import 路徑。
 *
 * 沒有設定 Vertex AI 憑證時，**後端**會走決定性的模擬批改（評語標明「示範模式」）。
 * 這件事以前發生在前端，現在整個在伺服器 —— 前端不再需要知道 AI 有沒有設定好。
 */

/**
 * 圖片 OCR，只取文字、不留檔。
 *
 * 繳交流程另有 `/service/gemini/ocr`，那支會把圖片存進 Cloud Storage
 * 並處理多頁排序；這支給「在編輯器裡插入辨識文字」用。
 */
export async function extractTextFromImage(base64Image: string, mimeType: string): Promise<string> {
  const { text } = await api.post<{ text: string }>('/service/gemini/ocr_text', {
    base64Image, mimeType,
  });
  return text;
}

/** 看圖寫作的出題參考：描述圖片內容、氛圍與可能的象徵意義。 */
export async function analyzeImageContent(base64Image: string, mimeType: string): Promise<string> {
  const { text } = await api.post<{ text: string }>('/service/gemini/analyze_image', {
    base64Image, mimeType,
  });
  return text;
}

/** 依題目與說明產生一份評分規準。 */
export async function generateGradingRubric(topic: string, description: string): Promise<string> {
  const { text } = await api.post<{ text: string }>('/service/gemini/rubric', {
    topic, description,
  });
  return text;
}

/**
 * 試批改：題庫頁讓教師貼一段文字，試跑某一題的評分效果。
 *
 * **不會寫進資料庫** —— 那段文字不屬於任何學生。真正的批改走
 * `gradeWithAi()`（api/submissions.ts），那支才會存版本與 token 用量。
 */
export async function gradeEssayWithAI(
  essayContent: string,
  topic: string,
  criteria: string = '',
  aiModel: string = '預設批改模型',
): Promise<AiGradingResponse> {
  return api.post<AiGradingResponse>('/service/gemini/grade', {
    content: essayContent, topic, criteria, aiModel,
  });
}
