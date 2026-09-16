import { GoogleGenAI, Type, ThinkingLevel, HarmCategory, HarmBlockThreshold } from '@google/genai';
import config from '../config';
import { OCR_SYSTEM_PROMPT } from './constants';

// 洗牌
const shuffleArray = (array: any[]) => {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
};

const SYSTEMPROMPT1 = `
📋 中文作文直寫 OCR 擷取指令
【角色定位】
你是一位具備極高精準度的中文 OCR 辨識高手，專長處理手寫稿件、直書文字（由上至下、由右至左）以及多頁面邏輯排序。

【核心任務】
請辨識我上傳的圖片文字，並嚴格遵守以下規則：

去除非作文內容：圖片上可能包含作文題目說明、引導語、原稿紙上的印刷文字、頁碼、學號、姓名、班級、座號、批改分數、教師評語等無關個人創作的表頭、頁邊或頁尾資訊。請「完全忽略並刪除」這些內容，只需要輸出學生實際創作的作文正文。

書寫邏輯：稿件為繁體中文直書，請務必按照「由上至下、由右至左」的順序擷取。

自動排序：若我上傳多張圖片且順序錯亂，請先閱讀全文，根據文意連貫性將其重新排列為正確的篇章順序後再輸出。

消除實體換行（重要）：同一個段落內的文字應為連續的自然閱讀句子，請勿受原稿物理換行影響而隨意截斷句子。只有在原稿出現明顯的新段落（縮排開頭）時，才保留換行。

段落精準還原（強化）：
針對 OCR 辨識出的段落進行優化，確保分段準確率。特別是在處理有縮排、手寫間隔，或是在圖片邊緣難以判讀的段落開頭時，應提升辨識的穩健性，以符合實際寫作的段落規範。

零修改原則（重要）：

不可自動糾錯：即便原稿有錯別字（如「得」與「地」誤用、簡繁混雜）、標點符號錯誤，必須原樣呈現。

不可過度美化：不可擅自增加形容詞、連接詞或修飾語句。

不可產生幻覺：若字跡模糊無法辨認，請以 [?] 代替，嚴禁自行通靈補字。

格式還原：

保留原稿的段落分段（縮格）。

保留原稿的空格與特殊符號（如破折號、引號）。

【輸出格式】
請直接輸出擷取後的全文，不要包含你的評論、分析或任何額外的解釋說明。
`;

const SYSTEMPROMPT2 = `
【身分與任務】
你是一個只能進行「逐字抄寫（OCR）」的機器，不具備文章潤飾、續寫或修正功能。你的唯一任務是將使用者上傳的圖片上的文字，100% 忠實地轉換為數位文字。

【極度重要警告：零幻覺要求】
1. 嚴格字字對應：圖片上有什麼字，就打什麼字。絕對不允許因為「語句不順」、「上下文邏輯需要」而自行補字、換字、或刪字。
2. 錯字原樣輸出：學生寫錯字，你就打錯字。不准自動糾錯。
3. 絕不自己發揮：到了文章中後段（如第四、五段），模型極易產生「自動補完」的幻覺。請務必克制語言模型的補字天性！絕不允許幫學生寫結語、加上圖片上不存在的任何句子或段落。
4. 看不清楚就用 [?]：遇到模糊、超出邊緣、被截斷的字，一律使用 [?] 代替。不准猜測！不准通靈！寧可滿篇 [?]，也不准出現圖片上沒有的字。

【排版與讀取順序】
1. 去除非正文：完全忽略並刪除圖片上的作文題目說明、引導語、原稿紙印刷文字、頁碼、學號、姓名、班級、座號、批改分數、教師評語等。只保留學生的手寫正文。
2. 直書讀取：繁體中文直書稿件，請依「由上至下、由右至左」順序讀取。
3. 消除實體換行：在同一個段落內，請將所有文字連成一線，絕對不要隨意換行。
4. 嚴格段落還原：只有當圖片上出現「明顯的段落開頭縮排」時，才可以使用一次換行（Enter）來開始新段落。不要因為句號或文章的起承轉合而自己發明分段。

【輸出格式】
請直接輸出擷取後的全文，不要包含任何開頭語（例如「好的」、「以下是」）、結語、評論、或說明。
`

/**
 * 讀試卷相關資料存取物件
 */
class GenAIHelper {

    private _client;
    constructor(
        private modelName: string = config.ocrModel
    ) {
        this.modelName = modelName;
        this._client = this.getAIClient();
    }

    getAIClient = () => {
        return new GoogleGenAI({
            // vertexai: true,
            // project: 'ischool-ai',
            // location: 'global',
        });
    };


    async OCR(base64Images: string[], mimeType: string) {

        const results: string[] = [];

        for (let index = 0; index < base64Images.length; index++) {
            const pageData = base64Images[index];
            const originalMimeType = mimeType;

            // Delay slightly between requests if there are multiple pages to avoid hitting burst rate limits
            if (index > 0) {
                await new Promise(resolve => setTimeout(resolve, 3000));
            }

            const result = await this.generateWithRetry(pageData, originalMimeType, index);
            if (result) {
                results.push(result);
            }
            // console.log({ ocr_result: result })
        }

        /** 再把辨識出來的幾頁文字，做一個排序，確認先後順序 */
        let finalOrder: number[] | null = null;
        let finalResults = [...results];

        // Auto-reorder if there are multiple pages
        if (results.length > 1) {
            try {
                const reorderPrompt = `這是一篇由多張照片辨識出的作文分頁文字，但上傳順序可能錯亂了。
請根據文章的上下文邏輯、語意連貫性，找出這些分頁正確的先後順序。

【要求】
1. 只能輸出一個 JSON 陣列，陣列內容為正確順序的索引值 (整數，從 0 開始)。
2. 絕對不可以改變任何原文。
3. 如果判斷原本的順序就是對的，就回傳原本的順序。

【分頁文字內容】：
${results.map((text, i) => `--- 第 ${i} 頁 ---\n${text}\n-------------------`).join('\n\n')}

請嚴格依照 JSON schema 輸出，例如 [1, 0, 2] 代表正確順序是第 1 頁 -> 第 0 頁 -> 第 2 頁。`;

                const reorderResponse = await this._client.models.generateContent({
                    model: this.modelName,
                    contents: { role: 'user', parts: [{ text: reorderPrompt }] },
                    config: {
                        temperature: 0.1,
                        responseMimeType: "application/json",
                        responseSchema: {
                            type: Type.ARRAY,
                            items: { type: Type.INTEGER },
                            description: "正確順序的索引值陣列，例如 [1, 0, 2]"
                        }
                    }
                });

                const reorderText = reorderResponse.text;
                if (reorderText) {
                    const orderIndices = JSON.parse(reorderText);
                    // Validate orderIndices
                    if (
                        Array.isArray(orderIndices) &&
                        orderIndices.length === results.length &&
                        [...orderIndices].sort().every((val, i) => val === i)
                    ) {
                        finalOrder = orderIndices;
                        finalResults = orderIndices.map(i => results[i]);
                        // console.log("Auto-reordered pages:", finalOrder);
                    } else {
                        console.warn("Invalid order indices returned from AI:", orderIndices);
                    }
                }
            } catch (e) {
                console.error("AI reordering failed, falling back to original order:", e);
            }
        }

        // Combine all transcriptions, simply joined
        return {
            text: finalResults.join(''),
            order: finalOrder
        };




        /*
        // Step 3: Main OCR Analysis
        const parts: any[] = [];

        // parts.push({ text: `【任務說明】請依序辨識以下 ${base64Images.length} 張手寫稿件。` });
        // parts.push({ text: `【重要】圖片上傳順序可能是錯亂的。請先尋找頁碼或根據文意連貫性，將其在腦中重組為正確的邏輯順序 (Page 1, Page 2...)，再進行辨識與合併輸出。` });

        parts.push({ text: `【任務說明】請依序辨識以下 ${base64Images.length} 張手寫稿件。` });
        parts.push({ text: `【極度警告：零幻覺要求】你的唯一任務是 OCR，絕對不要「讀懂」文章然後自己發揮。只能輸出圖片上「肉眼可見的字」。如果不確定，寧可寫錯字或使用 [?]，也「絕對不允許」加上任何圖片上不存在的詞彙、片語、或段落。絕對不允許擴寫、總結、或自行完結文章。若圖片上傳順序錯亂，請根據頁碼重新排列後輸出正文。` });


        base64Images.forEach((pageData, index) => {
            parts.push({ text: `【輸入圖片 - 索引編號 ${index + 1}】` });
            parts.push({
                inlineData: {
                    mimeType: "image/jpeg",
                    data: pageData,
                },
            });
        });

        const client = this.getAIClient();
        const response = await client.models.generateContent({
            model: this.modelName, // 'gemini-flash-latest',
            contents: [
                {
                    role: 'user',
                    parts: parts
                    // parts: [
                    //     { inlineData: { data: base64Image, mimeType } },
                    //     { text: '圖片內容是 手寫繁體中文作文，書寫方向為直式由上而下，從左到右書寫。作文內容都在格子裡。請將這張圖片中的手寫作文內容轉換為繁體中文文字。只需輸出文字內容，不要有任何額外的解釋或標籤。圖片中' }
                    // ]
                }
            ],
            config: {
                maxOutputTokens: 20000,
                temperature: 0.1,
                // thinkingConfig: {
                //     thinkingLevel: ThinkingLevel.MINIMAL,
                // },
                // safetySettings: [
                //     {
                //         category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, //'HARM_CATEGORY_HATE_SPEECH',
                //         threshold: HarmBlockThreshold.OFF,
                //     },
                //     {
                //         category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                //         threshold: HarmBlockThreshold.OFF,
                //     },
                //     {
                //         category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                //         threshold: HarmBlockThreshold.OFF,
                //     },
                //     {
                //         category: HarmCategory.HARM_CATEGORY_HARASSMENT,
                //         threshold: HarmBlockThreshold.OFF,
                //     }
                // ],
                // responseMimeType: 'application/json',
                systemInstruction: SYSTEMPROMPT2
            }
        });

        const result = response.text;
        return result;
        */
    }

    // Step 2: Process pages in parallel independently to avoid cross-page hallucination
    async generateWithRetry(pageData: string, originalMimeType: string, index: number, retries = 2) {
        const parts = [
            {
                text: `【極度警告：零幻覺與防漏字要求】這是第 ${index + 1} 頁的影像。請直接轉錄影像上「肉眼可見的字」。
【嚴禁自動續寫】：如果你發現文章沒寫完，請就停在那裡，絕對不准自己接下去寫結語！
【嚴禁重複當機】：絕對不允許無意義地連續輸出空白字元或是重複相同句型。
請依照 JSON Schema，進行 \`lines\` 逐行辨識（防漏字）。原稿有明顯「段落開頭縮排」的行，請在字串開頭加上兩個全形空白（　　）。無縮排的行請不要加空白。` },
            { text: `【跨頁接續指示】如果這頁的第一行是接續上一頁未完的段落（沒有縮排），字串開頭不要加任何空白。如果是全新段落，請務必加上兩個全形空白（　　）。` },
            { text: `【輸入圖片 - 第 ${index + 1} 頁】` },
            {
                inlineData: {
                    mimeType: originalMimeType === 'application/pdf' ? 'application/pdf' : 'image/jpeg',
                    data: pageData,
                },
            }
        ];

        for (let i = 0; i <= retries; i++) {
            try {
                const response = await this._client.models.generateContent({
                    model: this.modelName,
                    contents: { role: 'user', parts: parts },
                    config: {
                        systemInstruction: OCR_SYSTEM_PROMPT,
                        temperature: 0.2, // Increased to prevent repetition loops
                        maxOutputTokens: 8192, // Prevent hanging if a repetition loop does occur, but allow enough tokens for full OCR
                        responseMimeType: "application/json",
                        responseSchema: {
                            type: Type.OBJECT,
                            properties: {
                                lines: {
                                    type: Type.ARRAY,
                                    items: {
                                        type: Type.STRING
                                    },
                                    description: "影像中辨識出的文字行。請務必「逐行」擷取，圖片上的一直行文字就對應陣列中的一筆字串。這是防漏行機制。"
                                }
                            },
                            required: ["lines"]
                        }
                    },
                });

                if (!response.text) return "";

                let parsed;
                let text = response.text.replace(/```json/g, '').replace(/```/g, '').trim();

                // Sanitize: remove literal newlines and tabs which cause "Unterminated string in JSON"
                text = text.replace(/[\n\r\t]/g, '');

                try {
                    parsed = JSON.parse(text);
                } catch (e) {
                    // Fallback for truncated/unterminated JSON array
                    try {
                        let fixedText = text;
                        if (!fixedText.endsWith('}')) {
                            fixedText = fixedText.replace(/,$/, '');
                            if (!fixedText.endsWith('"') && !fixedText.endsWith(']')) {
                                fixedText += '"';
                            }
                            if (!fixedText.endsWith(']')) {
                                fixedText += ']';
                            }
                            fixedText += '}';
                        }
                        try {
                            parsed = JSON.parse(fixedText);
                            console.log("Successfully salvaged partial JSON (kept last line).");
                        } catch (e2) {
                            // Fallback: strip the broken last string entirely
                            const fallbackText = text.replace(/,[^,]*$/, '') + ']}';
                            parsed = JSON.parse(fallbackText);
                            console.log("Successfully salvaged partial JSON (dropped last string).");
                        }
                    } catch (e3) {
                        console.error("JSON parse error (could not salvage):", e, text);
                        return text;
                    }
                }

                if (parsed && parsed.lines && Array.isArray(parsed.lines)) {
                    let combined = "";
                    for (let j = 0; j < parsed.lines.length; j++) {
                        const line = parsed.lines[j];
                        if (!line) continue;

                        // If it starts with space (indentation), it's a new paragraph
                        if (line.startsWith("　") || line.startsWith(" ")) {
                            combined += "\n　　" + line.trim(); // Add newline and exactly two full-width spaces
                        } else {
                            // Otherwise, just append it to the current paragraph without newline
                            combined += line.trim();
                        }
                    }
                    return combined;
                }
                return JSON.stringify(parsed);
            } catch (error: any) {
                const isServerSideError = error.status === 500 || error.code === 500 || error.status === 503 || error.code === 503;
                const isRateLimit = error.status === 'RESOURCE_EXHAUSTED' || error.code === 429;
                const isPermissionDenied = error.status === 'PERMISSION_DENIED' || error.code === 403;

                if (isPermissionDenied) {
                    if (error.message?.includes('IP address restriction') || error.message?.includes('API_KEY_IP_ADDRESS_BLOCKED')) {
                        throw new Error("API Key 設定了 IP 限制，目前的網路環境無法使用此 Key，請使用無 IP 限制的 API Key，或至 Google Cloud Console 更改限制設定。");
                    }
                    throw new Error("Gemini API 權限不足 (Permission Denied)。請檢查您的 API 金鑰是否有效或具有相關權限。");
                }

                if (i < retries && (isServerSideError || isRateLimit)) {
                    const waitTime = isRateLimit ? 10000 * (i + 1) : 2000 * (i + 1);
                    console.warn(`Gemini API Attempt ${i + 1} failed for page ${index + 1} with ${error.code || error.status}. Retrying in ${waitTime}ms...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    continue;
                }

                if (isRateLimit) {
                    throw new Error("Gemini API 請求頻率過高或配額已耗盡 (Rate Limit/Quota Exceeded)。請稍後再試。");
                }
                throw error;
            }
        }
        throw new Error(`Failed to generate content for page ${index + 1} after retries.`);
    }




    async grading(gradingContext: any, content: string, word_count: number) {
        let systemInstructionText = gradingContext?.system_instruction ||
            `你是一位專業的國文閱卷教師。請根據以下的批改標準與題目說明，批改這份學生的中文作文。\n\n請輸出 JSON 格式包含 score, summary, suggestions, analysis。`;

        // console.log({ gradingContext, content, word_count })

        systemInstructionText = `
            ${systemInstructionText}
            【題目】${gradingContext?.title || ''}
            【題說】${gradingContext?.description || ''}
            ${gradingContext?.note ? `【教師提示】${gradingContext.note}` : ''}
        `;

        const promptText = `
            【學生作文內容】
            ${content}
            【作文字數】：${word_count || 0} 字
        `;

        // console.log({ promptText });

        const client = this.getAIClient();
        const response = await client.models.generateContent({
            model: this.modelName,
            contents: [
                {
                    role: 'user',
                    parts: [
                        { text: promptText }
                    ]
                }
            ],
            config: {
                maxOutputTokens: 6000,
                temperature: 0.3, // slightly lower temperature for more deterministic grading
                responseMimeType: 'application/json',
                responseJsonSchema: {
                    "$schema": "http://json-schema.org/draft-07/schema#",
                    "title": "ScoreRecord",
                    "description": "包含 0-6 級分限制的紀錄規格",
                    "type": "object",
                    "required": [
                        "raw_score",
                        "score",
                        // "sub_scores",
                        "response"
                    ],
                    "properties": {
                        "raw_score": {
                            "description": "原始分數",
                            "type": "integer",
                            "minimum": 0,
                            "maximum": 100
                        },
                        // "sub_scores": {
                        //     "description": "各項分數",
                        //     "type": "object",
                        //     "properties": {
                        //         "theme_and_content_score": {
                        //             "description": "立意取材分數：評估文章的主題思想是否明確、立意是否深刻或新穎，以及所選取的素材與例證是否切合題目、內容充實且具說服力。",
                        //             "type": "integer",
                        //             "minimum": 0,
                        //             "maximum": 100
                        //         },
                        //         "structure_and_organization_score": {
                        //             "description": "結構組織分數：評估文章的整體架構與段落安排是否合理，前後邏輯銜接是否順暢，以及起承轉合與文氣脈絡是否層次分明。",
                        //             "type": "integer",
                        //             "minimum": 0,
                        //             "maximum": 100
                        //         },
                        //         "diction_and_sentence_structure_score": {
                        //             "description": "遣詞造句分數：評估詞彙活用的準確度與豐富度、句型變化的多樣性與流暢度，以及整體修辭是否得宜、有無語病或贅詞。",
                        //             "type": "integer",
                        //             "minimum": 0,
                        //             "maximum": 100
                        //         },
                        //         "mechanics_and_punctuation_score": {
                        //             "description": "錯別字與標點分數：評估字詞書寫的正確性（有無錯別字、漏字或錯字），以及標點符號的使用是否符合規範且恰當。",
                        //             "type": "integer",
                        //             "minimum": 0,
                        //             "maximum": 100
                        //         }
                        //     }
                        // },
                        "score": {
                            "description": "級分，範圍為 0 到 6 之間的整數",
                            "type": "integer",
                            "minimum": 0,
                            "maximum": 6
                        },
                        "response": {
                            "type": "string"
                        }
                    },
                    "additionalProperties": false
                },
                thinkingConfig: {
                    thinkingLevel: ThinkingLevel.LOW,
                },
                systemInstruction: systemInstructionText,
                safetySettings: [
                    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.OFF },
                    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.OFF },
                    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.OFF },
                    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.OFF }
                ]
            }
        });

        let parsedResult;
        try {
            let jsonString = response.text || '{}';
            // Remove markdown code block formats if present
            jsonString = jsonString.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            parsedResult = JSON.parse(jsonString);
        } catch (e) {
            console.error('Failed to parse AI grading result', e);
            parsedResult = { score: 0, summary: "解析失敗", suggestions: "", analysis: {} };
        }

        const usageMetadata = response.usageMetadata;

        return {
            result: parsedResult,
            inputTokens: usageMetadata?.promptTokenCount || 0,
            outputTokens: usageMetadata?.candidatesTokenCount || 0
        };
    }


    async gradingSubscores(gradingContext: any, systemInstruction: string, content: string, word_count: number) {
        const systemInstructionText = `
            ${systemInstruction}
            【題目】${gradingContext?.title || ''}
            【題說】${gradingContext?.description || ''}
            ${gradingContext?.note ? `【教師提示】${gradingContext.note}` : ''}
        `;

        const promptText = `
            【學生作文內容】
            ${content}
            【作文字數】：${word_count || 0} 字
        `;

        // console.log({ promptText });

        const client = this.getAIClient();
        const response = await client.models.generateContent({
            model: this.modelName,
            contents: [
                {
                    role: 'user',
                    parts: [
                        { text: promptText }
                    ]
                }
            ],
            config: {
                maxOutputTokens: 1000,
                temperature: 0.3, // slightly lower temperature for more deterministic grading
                responseMimeType: 'application/json',
                responseJsonSchema: {
                    "$schema": "http://json-schema.org/draft-07/schema#",
                    "title": "ScoreRecord",
                    "description": "包含 0-6 級分限制的紀錄規格",
                    "type": "object",
                    "required": [
                        "theme_and_content_score",
                        "theme_and_content_score_summary",
                        "structure_and_organization_score",
                        "structure_and_organization_score_summary",
                        "diction_and_sentence_structure_score",
                        "diction_and_sentence_structure_score_summary",
                        "mechanics_and_punctuation_score",
                        "mechanics_and_punctuation_score_summary"
                    ],
                    "properties": {
                        "theme_and_content_score": {
                            "description": "立意取材分數。",
                            "type": "integer",
                            "minimum": 0,
                            "maximum": 6
                        },
                        "theme_and_content_score_summary": {
                            "description": "立意取材分數總結。",
                            "type": "string",
                        },
                        "structure_and_organization_score": {
                            "description": "結構組織分數。",
                            "type": "integer",
                            "minimum": 0,
                            "maximum": 6
                        },
                        "structure_and_organization_score_summary": {
                            "description": "結構組織分數總結。",
                            "type": "string",
                        },
                        "diction_and_sentence_structure_score": {
                            "description": "遣詞造句分數",
                            "type": "integer",
                            "minimum": 0,
                            "maximum": 6
                        },
                        "diction_and_sentence_structure_score_summary": {
                            "description": "遣詞造句分數總結",
                            "type": "string",
                        },
                        "mechanics_and_punctuation_score": {
                            "description": "錯別字與標點分數。",
                            "type": "integer",
                            "minimum": 0,
                            "maximum": 6
                        },
                        "mechanics_and_punctuation_score_summary": {
                            "description": "錯別字與標點分數總結",
                            "type": "string",
                        }
                    },
                    "additionalProperties": false
                },
                thinkingConfig: {
                    thinkingLevel: ThinkingLevel.LOW,
                },
                systemInstruction: systemInstructionText,
                safetySettings: [
                    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.OFF },
                    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.OFF },
                    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.OFF },
                    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.OFF }
                ]
            }
        });

        let parsedResult;
        try {
            let jsonString = response.text || '{}';
            // Remove markdown code block formats if present
            jsonString = jsonString.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            parsedResult = JSON.parse(jsonString);
        } catch (e) {
            console.error('Failed to parse AI grading result', e);
            parsedResult = { score: 0, summary: "解析失敗", suggestions: "", analysis: {} };
        }

        const usageMetadata = response.usageMetadata;

        return {
            result: parsedResult,
            inputTokens: usageMetadata?.promptTokenCount || 0,
            outputTokens: usageMetadata?.candidatesTokenCount || 0
        };
    }

    async createSummary(prompt: string) {

        const systemInstructionText = `
        以下每一段內容都有幾句話，請針對每一段內容的幾句話產生一句摘要結論。請使用正向鼓勵的語氣，並以 json 格式輸出。 `;


        const client = this.getAIClient();
        const response = await client.models.generateContent({
            model: this.modelName,
            contents: [
                {
                    role: 'user',
                    parts: [
                        { text: prompt }
                    ]
                }
            ],
            config: {
                maxOutputTokens: 1000,
                temperature: 0.3, // slightly lower temperature for more deterministic grading
                responseMimeType: 'application/json',
                responseJsonSchema: {
                    "$schema": "http://json-schema.org/draft-07/schema#",
                    "title": "ScoreRecord",
                    "description": "包含 0-6 級分限制的紀錄規格",
                    "type": "object",
                    "required": [
                        "theme_and_content_score_summary",
                        "structure_and_organization_score_summary",
                        "diction_and_sentence_structure_score_summary",
                        "mechanics_and_punctuation_score_summary"
                    ],
                    "properties": {

                        "theme_and_content_score_summary": {
                            "description": "立意取材分數總結。",
                            "type": "string",
                        },
                        "structure_and_organization_score_summary": {
                            "description": "結構組織分數總結。",
                            "type": "string",
                        },
                        "diction_and_sentence_structure_score_summary": {
                            "description": "遣詞造句分數總結",
                            "type": "string",
                        },
                        "mechanics_and_punctuation_score_summary": {
                            "description": "錯別字與標點分數總結",
                            "type": "string",
                        },
                        "final_summarys": {
                            "description": "整體評語總結",
                            "type": "string",
                        }
                    },
                    "additionalProperties": false
                },
                thinkingConfig: {
                    thinkingLevel: ThinkingLevel.LOW,
                },
                systemInstruction: systemInstructionText,
                safetySettings: [
                    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.OFF },
                    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.OFF },
                    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.OFF },
                    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.OFF }
                ]
            }
        });

        let parsedResult;
        try {
            let jsonString = response.text || '{}';
            // Remove markdown code block formats if present
            jsonString = jsonString.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            parsedResult = JSON.parse(jsonString);
        } catch (e) {
            console.error('Failed to parse AI grading result', e);
            parsedResult = { score: 0, summary: "解析失敗", suggestions: "", analysis: {} };
        }

        const usageMetadata = response.usageMetadata;

        return {
            theme_and_content_score_summary: parsedResult.theme_and_content_score_summary,
            structure_and_organization_score_summary: parsedResult.structure_and_organization_score_summary,
            diction_and_sentence_structure_score_summary: parsedResult.diction_and_sentence_structure_score_summary,
            mechanics_and_punctuation_score_summary: parsedResult.mechanics_and_punctuation_score_summary,
            final_summarys: parsedResult.final_summarys,
            inputTokens: usageMetadata?.promptTokenCount || 0,
            outputTokens: usageMetadata?.candidatesTokenCount || 0
        };

    }

}

export default GenAIHelper;
