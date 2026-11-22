import type { GridAi, TextPreset } from './ai';
import type { PreparedStrip } from './service_client';

/**
 * 不打 Gemini 的逐格辨識 AI（測試與本機開發用，GRID_OCR_AI_FAKE=simulate）。
 *
 * 本機沒有 Gemini 的憑證，測試也不該打真的 AI（慢、要錢、每次不一樣）。
 * 照辨識服務在提示文字裡附的「電腦判斷有字的格子」回答：那些格子各回一個示範字。
 * 所以整條流程（切格 → 回應 → 組回全文 → 找錯字 → 存檔）都是真的，只有「讀出什麼字」是假的。
 * 全文開頭的字固定是 SIMULATED_GRID_TEXT 的字，任何人看到就知道不是真的辨識結果。
 *
 * ⚠️ 要明確開啟，正式環境一律無效（見 gridAiFakeMode）。
 */
export const SIMULATED_GRID_TEXT = '示範模式模擬辨識';

export function gridAiFakeMode(): boolean {
    if (process.env.NODE_ENV === 'production') return false;
    const v = (process.env.GRID_OCR_AI_FAKE || '').toLowerCase();
    return v === 'simulate' || v === '1' || v === 'true';
}

/** 「第 3 行 1–5、8 格；第 4 行 2 格」→ { 3: [1,2,3,4,5,8], 4: [2] } */
export function parseInkHints(prompt: string): Map<number, number[]> {
    const out = new Map<number, number[]>();
    const hints = prompt.split(/電腦判斷有字的格子[^：:]*[：:]/)[1] ?? '';
    for (const m of hints.matchAll(/第\s*(\d+)\s*行\s*([\d–\-、,\s]+?)\s*格/g)) {
        const rows: number[] = [];
        for (const part of m[2].split(/[、,]/)) {
            const [a, b] = part.split(/[–-]/).map((x) => parseInt(x.trim(), 10));
            if (Number.isNaN(a)) continue;
            for (let r = a; r <= (Number.isNaN(b) || b === undefined ? a : b); r++) rows.push(r);
        }
        out.set(parseInt(m[1], 10), rows);
    }
    return out;
}

export function createSimulatedGridAi(): GridAi {
    let n = 0;
    const nextChar = () => SIMULATED_GRID_TEXT[n++ % SIMULATED_GRID_TEXT.length];
    return {
        model: 'simulated',
        async cells(strip: PreparedStrip) {
            const hints = parseInkHints(strip.prompt);
            const columns = strip.images.map((img) => ({
                col: img.col,
                cells: (hints.get(img.col) ?? []).map((row) => ({ row, text: nextChar() })),
            }));
            return { text: JSON.stringify({ columns, margin: [] }), usage: { inputTokens: 0, outputTokens: 0 } };
        },
        async text(preset: TextPreset) {
            const body = preset === '找錯別字' ? { errors: [] } : { answers: [] };
            return { text: JSON.stringify(body), usage: { inputTokens: 0, outputTokens: 0 } };
        },
    };
}
