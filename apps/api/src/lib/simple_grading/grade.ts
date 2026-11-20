import GenAIHelper from '../../dal/genai_helper';
import { AiGradingResponseError } from '../grading_result';
import { buildSimpleGradingInput, MARK, UNREADABLE, type StoredGridResult } from './essay';
import {
    buildSimpleGradingPrompt, buildSimpleGradingSystem, SIMPLE_GRADING_PROMPT_VERSION, type GradingContextLike,
} from './prompt';
import {
    buildSimpleGradingOutcome, buildSystemZeroOutcome, findSimpleGradingProblems, type SimpleGradingOutcome,
} from './result';

/**
 * 簡易批改一篇：組資料 →（不足 100 字就不送）→ AI → 檢查 →（不合格重批一次）→ 逐格檢查引用。
 * AI 從外面給（真的 Gemini 在 GenAIHelper.simpleGrading；沒有憑證時用 createSimulatedSimpleGradingAi）。
 */

export interface SimpleGradingAi {
    model: string;
    generate(system: string, prompt: string): Promise<{ text: string; inputTokens: number; outputTokens: number }>;
}

export interface SimpleGradingRun {
    outcome: SimpleGradingOutcome;
    model: string | null;
    inputTokens: number;
    outputTokens: number;
    aiCalls: number;
}

function parseReply(text: string): unknown {
    try {
        return JSON.parse(String(text || '').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
    } catch {
        return null;
    }
}

export async function gradeSimple(params: {
    grid: StoredGridResult;
    context: GradingContextLike;
    ai: SimpleGradingAi;
}): Promise<SimpleGradingRun> {
    const { grid, context, ai } = params;
    const input = buildSimpleGradingInput(grid);
    if (input.systemZero) {
        return {
            outcome: buildSystemZeroOutcome(input.systemZero.reason, input.systemZero.feedback, SIMPLE_GRADING_PROMPT_VERSION),
            model: null, inputTokens: 0, outputTokens: 0, aiCalls: 0,
        };
    }

    const system = buildSimpleGradingSystem(context);
    const prompt = buildSimpleGradingPrompt(input.essaySection);
    let inputTokens = 0;
    let outputTokens = 0;
    let retryProblems: string[] = [];
    for (let attempt = 1; attempt <= 2; attempt += 1) {
        const reply = await ai.generate(system, prompt);
        inputTokens += reply.inputTokens;
        outputTokens += reply.outputTokens;
        const details = parseReply(reply.text);
        const problems = findSimpleGradingProblems(details);
        if (problems.length === 0) {
            const outcome = buildSimpleGradingOutcome({
                details: details as Record<string, unknown>,
                index: input.index,
                // 引用、成語要避開所有錯字標記，包括待確認的（不只送 AI 的那份確定的錯別字）
                typoMarks: Array.isArray(grid.typoMarks) ? grid.typoMarks : [],
                promptVersion: SIMPLE_GRADING_PROMPT_VERSION,
                retryProblems,
            });
            return { outcome, model: ai.model, inputTokens, outputTokens, aiCalls: attempt };
        }
        console.warn('[simple-grading] 批改結果不符合規則', { attempt, problems });
        retryProblems = problems;
    }
    throw new AiGradingResponseError(`簡易批改的結果重批一次仍不符合規則：${retryProblems.join('；')}`);
}

/** 真的 Gemini（批改用的模型 GRADING_MODEL）。GenAIHelper 建立時才碰憑證，所以用到才建 */
export function geminiSimpleGradingAi(model: string): SimpleGradingAi {
    const helper = new GenAIHelper(model);
    return { model, generate: (system, prompt) => helper.simpleGrading(system, prompt) };
}

// ── 模擬 AI（本機沒有 Vertex 憑證時；測流程用，不是測批改品質） ──

const SIM_NOTICE = '【示範模式：以下為模擬的簡易批改結果，非 AI 實際評閱】';

/** 在辨識全文裡找第一段沒有〔?〕□ 的連續文字，當作亮點的引用 —— 讓逐格檢查真的有東西可以檢查 */
function firstTrustedRun(prompt: string, min = 4, max = 12): string {
    const body = prompt.split('【辨識全文】')[1]?.split('【系統統計】')[0] ?? '';
    for (const raw of body.split('\n').slice(1)) {
        const line = raw.replace(/^\d+　/, '');
        for (const piece of line.split(MARK)) {
            // 〔?〕前面那個字不可信，要一起丟掉
            const safe = [...piece.slice(0, -1)].filter((ch) => ch !== UNREADABLE).join('');
            const run = safe.split(/[，。！？、；：「」]/).find((s) => [...s].length >= min);
            if (run) return [...run].slice(0, max).join('');
        }
    }
    return '';
}

export function createSimulatedSimpleGradingAi(): SimpleGradingAi {
    return {
        model: '示範模式（未設定 AI）',
        async generate(_system, prompt) {
            const chars = Number(/字數：(\d+)/.exec(prompt)?.[1] ?? 0);
            const typos = Number(/【確定的錯別字】共 (\d+) 個/.exec(prompt)?.[1] ?? 0);
            const score = Math.max(1, Math.min(6, Math.floor(chars / 120) - (typos >= 3 ? 1 : 0)));
            const quote = firstTrustedRun(prompt);
            const subScores = {
                theme_and_content_score: score, theme_and_content_score_summary: '取材貼近生活（示範）',
                structure_and_organization_score: score, structure_and_organization_score_summary: '段落安排清楚（示範）',
                diction_and_sentence_structure_score: score, diction_and_sentence_structure_score_summary: '文句大致通順（示範）',
                mechanics_and_punctuation_score: Math.max(1, score - (typos >= 3 ? 1 : 0)),
                mechanics_and_punctuation_score_summary: '留意錯字與段首空格（示範）',
            };
            const reply = {
                score_basis: `${SIM_NOTICE}依字數 ${chars}、確定的錯別字 ${typos} 個推算的示範級分。`,
                score,
                zero_reason: '',
                sub_scores: subScores,
                cards: [
                    ...(quote ? [{ type: '亮點', quote, title: '描寫具體', comment: '這裡寫得具體，讀者看得到畫面（示範）。' }] : []),
                    { type: '建議', quote: '', title: '深化體悟', comment: '結尾可以多寫一點這件事帶給你的改變（示範）。' },
                ],
                idioms: { items: [], comment: '' },
                response: `${SIM_NOTICE}\n\n這篇文章有清楚的主題，敘述也有自己的觀察。下次可以把事件帶給你的改變寫得更深入，讓讀者感受到你的成長。如果把結尾帶回開頭的場景，你會怎麼寫？`,
                teacher_alert: { needed: false, reason: '', paragraph: 0 },
            };
            return { text: JSON.stringify(reply), inputTokens: 0, outputTokens: 0 };
        },
    };
}
