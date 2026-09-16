import { GoogleGenAI, Type, Schema } from "@google/genai";
import { AiGradingResponse } from "../types";
import { simulateGrading, simulatedDelayMs } from "./simulatedGrading";

/**
 * Gemini 用的模型名稱。原本四個 API 呼叫各自寫死同一個字串，
 * 換模型要改四個地方。
 */
const GEMINI_MODEL = "gemini-3.1-pro-preview";

/** 沒有設定金鑰時，各處共用同一段可讀的訊息 */
const MISSING_KEY_MESSAGE =
  "尚未設定 Gemini API 金鑰，AI 功能無法使用。請在專案根目錄建立 .env.local 並填入 GEMINI_API_KEY，然後重新啟動開發伺服器。";

/**
 * AI 功能是否可用。UI 可以先問過再決定要不要顯示 AI 按鈕。
 */
export const isAiConfigured = (): boolean => Boolean(process.env.GEMINI_API_KEY);

/**
 * 延遲建立 client。
 *
 * 原本是在模組載入時就 `new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })`，
 * 而沒有 .env.local 時這個值是 undefined —— SDK 會直接丟
 * "An API Key must be set when running in a browser"，
 * 在 React 掛載之前就中斷，整個原型變成一片白畫面、沒有任何線索。
 * 改成用到才建立，沒有金鑰時只有 AI 功能失效，其餘畫面照常運作。
 */
let client: GoogleGenAI | null = null;

const getClient = (): GoogleGenAI => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(MISSING_KEY_MESSAGE);
  }
  if (!client) {
    client = new GoogleGenAI({ apiKey });
  }
  return client;
};

const gradingSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    totalScore: {
      type: Type.NUMBER,
      description:
        "整體級分，整數 0-6。這是綜觀全文後的整體評定，不是四項要素的平均。0 保留給詩歌體、完全離題、只抄題目或空白卷。",
    },
    categoryScores: {
      type: Type.OBJECT,
      description: "會考寫作測驗四項評分要素各自的表現，同樣以 0-6 整數表示",
      properties: {
        content: { type: Type.NUMBER, description: "立意取材：能否依題目與主旨選取適當材料並深入闡述（0-6）" },
        structure: { type: Type.NUMBER, description: "結構組織：段落安排、脈絡是否分明連貫（0-6）" },
        vocabulary: { type: Type.NUMBER, description: "遣詞造句：用字是否精確、語句是否流暢（0-6）" },
        grammar: { type: Type.NUMBER, description: "錯別字、格式與標點符號：書寫正確性（0-6）" }
      },
      required: ["content", "structure", "vocabulary", "grammar"]
    },
    feedback: {
      type: Type.STRING,
      description:
        "給國中學生看的整體評語，繁體中文，150-250 字。先肯定具體做得好的地方，再指出最關鍵的一個問題。語氣要像導師，不要像評分機器。",
    },
    suggestions: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description:
        "三則具體可執行的修改建議，繁體中文。每則都要指出文章中的實際位置或句子，不要寫「多讀多寫」這種空話。",
    }
  },
  required: ["totalScore", "categoryScores", "feedback", "suggestions"]
};

/**
 * 會考寫作測驗的評分規準，直接寫進提示詞。
 * 級分描述與 lib/scoring.ts 的 LEVEL_SPECS 同源，改動時兩邊要一起改。
 */
const RUBRIC = `
六級分：立意取材能依題目及主旨選取適當材料，並能進一步闡述說明以凸顯主旨；結構完整、脈絡分明、前後連貫；遣詞用字精確、語句流暢；沒有錯別字，格式與標點符號正確。
五級分：能選取適當材料但闡述不夠深入；結構完整但偶有轉折不順；用字大致精確、語句通順；少有錯別字，格式與標點大致正確。
四級分：尚能選取材料但不能進一步說明；結構大致完整但偶有不連貫、轉折不清；用字大致正確但語句偶有不通順；有一些錯別字，格式與標點運用尚可。
三級分：材料與主旨關聯不夠緊密；結構鬆散、前後不連貫；用字語句常有錯誤；錯別字較多，格式與標點運用不佳。
二級分：材料與主旨關聯性低；結構不完整、組織鬆散；用字語句錯誤多且影響文意；錯別字極多。
一級分：僅重複題目文字或全文語焉不詳；沒有明顯結構；用字語句嚴重錯誤。
零級分：使用詩歌體、完全離題、只抄寫題目，或為空白卷。
`.trim();

export const gradeEssayWithAI = async (
  essayContent: string,
  topic: string,
  criteria: string = "",
  aiModel: string = "預設批改模型"
): Promise<AiGradingResponse> => {
  /*
    沒有金鑰就走模擬批改。

    這一段刻意放在 service 層而不是各個畫面：批改頁與批次批改
    都呼叫這支函式，擋在這裡兩邊自動都能跑，日後接上真的金鑰
    也不必回去改任何一個畫面。模擬結果的評語會標明是示範模式。
  */
  if (!isAiConfigured()) {
    await new Promise((r) => setTimeout(r, simulatedDelayMs(essayContent)));
    return simulateGrading(essayContent, topic);
  }

  try {
    // 提示詞用繁體中文寫，因為評分規準本身就是中文的官方文件，
    // 翻成英文再讓模型翻回來只會失真。
    const prompt = `
你是一位資深的國中國文教師，長期擔任國中教育會考寫作測驗的閱卷委員。
請依照會考寫作測驗的評分規準，批改以下這篇國中學生的作文。

【批改模型設定】${aiModel}

【作文題目】
${topic}

【評分規準（六級分制）】
${RUBRIC}
${criteria ? `
【本題的額外評分重點】
${criteria}` : ""}

【學生作品】
${essayContent}

【批改要求】
1. totalScore 是**整體級分**，綜觀全文後給一個 0-6 的整數。
   這不是四項要素的平均 —— 會考的級分是整體評定，
   一篇結構稍弱但立意深刻的文章，仍然可能拿到五級分。
2. categoryScores 是四項評分要素各自的表現，同樣用 0-6 整數，
   供教師與學生了解強弱項，不要拿來回推 totalScore。
3. 評語與建議請針對**國中階段**的程度書寫：
   - 用學生看得懂的話，不要用文學評論術語
   - 指出具體的句子或段落，不要泛泛而談
   - 先肯定做得好的地方，再談要改的地方
4. 遇到下列情形一律給零級分：使用詩歌體、完全離題、只抄寫題目、空白卷。
5. 全部以繁體中文作答。
`.trim();

    const response = await getClient().models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: gradingSchema,
        temperature: 0.3, // Lower temperature for more consistent grading
      },
    });

    const text = response.text;
    if (!text) {
        throw new Error("No response from AI");
    }
    
    return JSON.parse(text) as AiGradingResponse;

  } catch (error) {
    console.error("Error grading essay:", error);
    // Return a fallback or rethrow depending on needs. 
    // For this UI, we throw so the UI can show an error state.
    throw error;
  }
};

/**
 * Analyzes an image to provide a description suitable for essay writing prompts.
 * @param base64Image The base64 string of the image (without the data:image/... prefix)
 * @param mimeType The mime type of the image (e.g., image/png)
 */
export const analyzeImageContent = async (base64Image: string, mimeType: string): Promise<string> => {
  try {
    const response = await getClient().models.generateContent({
      model: GEMINI_MODEL,
      contents: {
        parts: [
          {
            inlineData: {
              data: base64Image,
              mimeType: mimeType
            }
          },
          {
            text: "請以作文老師的角度，詳細描述這張圖片的內容、氛圍以及可能的象徵意義，作為「看圖寫作」的出題參考。請使用繁體中文回答，約 100 字左右。"
          }
        ]
      }
    });

    return response.text || "無法分析圖片內容";
  } catch (error) {
    console.error("Error analyzing image:", error);
    throw new Error("AI 圖片分析失敗", { cause: error });
  }
};

/**
 * Generates a grading rubric based on the essay topic and description.
 * @param topic The essay topic
 * @param description The essay description/prompt
 */
export const generateGradingRubric = async (topic: string, description: string): Promise<string> => {
  try {
    const prompt = `
      請為以下作文題目與說明，設計一份詳細的「評分規準 (Grading Rubric)」。
      
      題目：${topic}
      說明：${description}
      
      請包含以下內容：
      1. 評分面向（例如：立意取材、結構組織、遣詞造句、錯別字與標點符號等）。
      2. 每個面向的具體評分標準（例如：A級、B級、C級的表現）。
      3. 配分建議（若有）。
      
      請使用繁體中文，並以條列式或清晰的文字格式呈現，方便老師直接複製使用或修改。
      語氣請專業且具建設性。
    `;

    const response = await getClient().models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        temperature: 0.7,
      },
    });

    return response.text || "無法產生評分規準";
  } catch (error) {
    console.error("Error generating rubric:", error);
    throw new Error("AI 產生評分規準失敗", { cause: error });
  }
};

/**
 * Extracts text from an image (OCR) using Gemini.
 * @param base64Image The base64 string of the image
 * @param mimeType The mime type of the image
 */
export const extractTextFromImage = async (base64Image: string, mimeType: string): Promise<string> => {
  try {
    const response = await getClient().models.generateContent({
      model: GEMINI_MODEL,
      contents: {
        parts: [
          {
            inlineData: {
              data: base64Image,
              mimeType: mimeType
            }
          },
          {
            text: "請將這張圖片中的手寫或印刷文字提取出來。只需返回提取出的文字內容，不要包含任何額外的解釋或描述。如果有多段文字，請保持其段落結構。請使用繁體中文。"
          }
        ]
      }
    });

    return response.text || "";
  } catch (error) {
    console.error("Error extracting text from image:", error);
    throw new Error("OCR 文字提取失敗", { cause: error });
  }
};
