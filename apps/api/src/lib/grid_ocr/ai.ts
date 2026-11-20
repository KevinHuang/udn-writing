import { GoogleGenAI, ThinkingLevel, PartMediaResolutionLevel, createPartFromBase64, type Part } from '@google/genai';
import { GridOcrError } from './errors';
import type { GridServiceClient, PreparedStrip, PromptPreset, PromptsResult } from './service_client';

/**
 * 逐格辨識的 AI 呼叫（直接打 Gemini）。
 *
 * 1Campus Write 經 gpt.1campus.net 的 preset 呼叫，那邊不能強制 JSON 格式，只好在文字後面附回傳格式、
 * 再拆 Markdown 程式碼框。這裡直接用 @google/genai：**系統指令與 JSON Schema 一律向辨識服務的 GET /prompts 拿**
 * （不在這邊抄一份 —— 服務改了提示詞，這邊自動跟上），用 responseJsonSchema 強制格式。
 * 送法照服務原型的 SdkCaller（services/handwriting-ocr/gaozhi/ocr/engines/gemini.py）：
 *   每行一張小圖，前面一段「第 N 行：」，說明文字放最後；小圖用高解析（mediaResolution HIGH）。
 */

export type TextPreset = '找錯別字' | '注音補字';

export interface AiUsage {
    inputTokens: number;
    outputTokens: number;
}

export interface AiReply {
    /** 回傳的 JSON 文字（是不是合法由辨識服務判斷） */
    text: string;
    usage: AiUsage;
}

export interface GridAi {
    /** 逐格辨識：一組小圖（幾行稿紙） */
    cells(strip: PreparedStrip): Promise<AiReply>;
    /** 找錯別字／注音補字：純文字 */
    text(preset: TextPreset, prompt: string): Promise<AiReply>;
    /** 記在結果上的模型名稱 */
    model: string;
}

/** 逐格辨識用的模型。服務建議 gemini-3.8-flash；這邊的 OCR_MODEL（整張辨識用 pro）不適用 */
const DEFAULT_MODEL = 'gemini-3.8-flash';
const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;

const THINKING: Record<string, ThinkingLevel> = {
    minimal: ThinkingLevel.MINIMAL,
    low: ThinkingLevel.LOW,
    medium: ThinkingLevel.MEDIUM,
    high: ThinkingLevel.HIGH,
};

let promptsCache: { at: number; value: PromptsResult } | null = null;
const PROMPTS_TTL_MS = 10 * 60 * 1000;

async function loadPrompts(service: GridServiceClient): Promise<PromptsResult> {
    if (promptsCache && Date.now() - promptsCache.at < PROMPTS_TTL_MS) return promptsCache.value;
    const value = await service.prompts();
    if (!value?.['稿紙逐格辨識']?.system || !value['找錯別字']?.system || !value['注音補字']?.system) {
        throw new GridOcrError('UNAVAILABLE', '稿紙辨識服務沒有回傳提示詞', true);
    }
    promptsCache = { at: Date.now(), value };
    return value;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 從 @google/genai 的錯誤取出 HTTP 狀態碼（沒有就是網路問題） */
function statusOf(e: unknown): number | null {
    const s = (e as { status?: unknown; code?: unknown })?.status ?? (e as { code?: unknown })?.code;
    return typeof s === 'number' ? s : null;
}

export function createGeminiGridAi(service: GridServiceClient, opts: { client?: GoogleGenAI; model?: string } = {}): GridAi {
    const client = opts.client ?? new GoogleGenAI({});
    const model = opts.model ?? process.env.GRID_OCR_MODEL ?? DEFAULT_MODEL;

    const call = async (preset: PromptPreset, parts: Part[], what: string): Promise<AiReply> => {
        let maxOutputTokens = preset.settings.max_output_tokens ?? 16384;
        let lastError = '';
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            try {
                const res = await client.models.generateContent({
                    model,
                    contents: [{ role: 'user', parts }],
                    config: {
                        systemInstruction: preset.system,
                        responseMimeType: 'application/json',
                        responseJsonSchema: preset.schema,
                        thinkingConfig: { thinkingLevel: THINKING[preset.settings.thinking_level ?? 'low'] ?? ThinkingLevel.LOW },
                        maxOutputTokens,
                        temperature: 0,
                    },
                });
                const finish = res.candidates?.[0]?.finishReason;
                if (finish === 'MAX_TOKENS') {
                    // 截斷是隨機的（含思考用量），不代表內容太長：加倍再送一次
                    lastError = '回應被截斷';
                    maxOutputTokens *= 2;
                    continue;
                }
                const u = res.usageMetadata;
                return {
                    text: res.text ?? '',
                    usage: {
                        inputTokens: u?.promptTokenCount ?? 0,
                        outputTokens: (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0),
                    },
                };
            } catch (e) {
                const status = statusOf(e);
                lastError = status ? `狀態碼 ${status}` : (e instanceof Error ? e.message : String(e));
                // 4xx（金鑰、權限、請求格式）重送也一樣
                if (status !== null && !RETRY_STATUSES.has(status)) break;
                if (attempt < MAX_ATTEMPTS) await sleep(status === 429 ? 5000 * attempt : 1000 * attempt);
            }
        }
        console.error(`[grid-ocr] ${what} failed`, { model, lastError });
        throw new GridOcrError('UNAVAILABLE', `${what}暫時無法完成（${lastError}），請稍後按「重新辨識」`, true);
    };

    return {
        model,
        async cells(strip) {
            const prompts = await loadPrompts(service);
            const parts: Part[] = [];
            for (const img of strip.images) {
                parts.push({ text: `第 ${img.col} 行：` });
                parts.push(createPartFromBase64(img.png, 'image/png', PartMediaResolutionLevel.MEDIA_RESOLUTION_HIGH));
            }
            parts.push({ text: strip.prompt });
            return call(prompts['稿紙逐格辨識'], parts, '稿紙逐格辨識');
        },
        async text(preset, prompt) {
            const prompts = await loadPrompts(service);
            return call(prompts[preset], [{ text: prompt }], preset);
        },
    };
}

/** 測試用：清掉 /prompts 的快取 */
export function resetPromptsCache(): void {
    promptsCache = null;
}
