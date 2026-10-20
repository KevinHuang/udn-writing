/**
 * AI 批改結果：整體級分＋四向度。
 *
 * 四向度（立意取材／結構組織／遣詞造句／錯別字格式與標點）存在
 * `submission_feedback.sub_scores`（jsonb），八個平鋪的鍵：
 * `<向度>_score`（0-6 整數）與 `<向度>_score_summary`（50 字內的評語）。
 * 這個形狀是管理員的批次補分（`/admin/grading_subscores`）先定下來的，
 * 期末總結（FinalReportHelper.calculate）也照這個讀，所以不要改鍵名。
 *
 * 以前四向度**只有**那支批次會寫：批改時不產生，要等系統管理員手動補，
 * 而且老師每存一次評語，新版本的四向度又是空的。現在 AI 批改時同一次呼叫
 * 一併產生，老師存檔則沿用上一版（見 InstructorHelper.saveFeedback）。
 */

/** 四個向度在 sub_scores 裡的鍵名前綴。順序就是會考官方公布的順序 */
export const SUB_SCORE_DIMENSIONS = [
    'theme_and_content',
    'structure_and_organization',
    'diction_and_sentence_structure',
    'mechanics_and_punctuation',
] as const;

export type SubScoreDimension = typeof SUB_SCORE_DIMENSIONS[number];

/** `submission_feedback.sub_scores` 的形狀 */
export type SubScores = {
    [K in SubScoreDimension as `${K}_score`]: number;
} & {
    [K in SubScoreDimension as `${K}_score_summary`]: string;
};

/**
 * 四向度的評分規準。
 *
 * 原文來自管理員批次補分的「嚴格校準版」提示詞（routes/admin.ts），
 * 那支與 AI 批改**共用這一段**，改這裡兩邊一起變。
 *
 * ⚠️ 只有「核心評量規準」這一段。那份提示詞另外還有「心態校準（從嚴認定）」
 *    與「審查極限（整體級分上限）」，它們會改變**整體級分**的判定，
 *    不能附加到批改提示詞後面 —— 整體級分的標準由各題的批改規範決定。
 */
export const SUB_SCORE_RUBRIC = `## 核心評量規準（標準參照與嚴格扣分線）

### 1. 立意取材
  **6 級分**：適切統整、運用材料，能進一步闡述說明以凸顯主旨，具深刻的思想高度。
  **5 級分**：適當統整、運用材料，並能闡述說明主旨，論述清晰。
  **4 級分**：能統整、運用材料，尚能闡述說明主旨。（若流於平鋪直敘、缺乏深刻反思，上限即為 4 級分）
  **3 級分**：嘗試依據題目取材，但不甚適當，或發展不夠充分、內容流於空洞重複。
  **2 級分**：取材不足，發展有限，或大量引述、抄錄題幹引導內容。
  **1 級分**：僅能解釋題目；或材料過於簡略，無法加以發展。

### 2. 結構組織
  **6 級分**：文章結構完整，段落分明，脈絡極其分明，內容前後連貫。
  **5 級分**：文章結構完整，但偶有轉折不夠流暢之處。
  **4 級分**：文章結構大致完整，但偶有不連貫、轉折不清之處。
  **3 級分**：文章結構鬆散；或前後不連貫；或各段字數極度不均。
  **2-1 級分**：結構不完整；或僅有單一段落。

### 3. 遣詞造句（嚴格審查項）
  **6 級分**：能精確使用語詞，並有效運用各種句型使文句流暢，具文采。
  **5 級分**：能正確使用語詞，並運用各種句型使文句通順。（若出現成語嚴重誤用、或文句帶有強烈網路/流行語，直接取消 5 級分資格）
  **4 級分**：能正確使用語詞，表達尚清楚，但偶有冗詞贅句，且句型缺乏變化。
  **3 級分**：用字遣詞不太恰當，出現語法錯誤；或文句高度口語化、句子破碎、大量重複相同詞彙。
  **2-1 級分**：遣詞造句常有錯誤，文句支離破碎，難以理解。

### 4. 錯別字、格式與標點符號
  **6-5 級分**：幾乎沒有或極少錯別字，格式、標點符號運用正確，不影響文意。
  **4 級分**：有一些錯別字及格式（如段首未縮排兩格）、標點錯誤。
  **3 級分**：錯別字或標點錯誤已造成理解上的困難。`;

/**
 * 附加在 AI 批改提示詞（各題的 system_instruction）後面的四向度說明。
 *
 * 各題的批改規範管的是 response 那一份 markdown 的排版；四向度走 JSON 的
 * sub_scores 欄位，兩者分開，所以這裡要明講「不要動 response 的格式」。
 */
export const SUB_SCORE_INSTRUCTION = `
【四向度評分】
除了整體級分與評語之外，請另外依下列規準，在 sub_scores 欄位給出四個向度各自的級分（0-6 整數）與評語總結。
- 四向度是閱卷時的參考面向，不是整體級分的拆解：不要拿它們回推整體級分，整體級分仍依上面的批改規範判定。
- 每個向度的評語總結嚴格限制在 50 個字以內（包含中文字元、標點符號與空格），使用臺灣中文寫作學術用語（如「冗詞贅句」、「脈絡分明」、「首尾呼應」、「亮點金句」），語氣客觀嚴謹。
- 這四段只寫進 sub_scores，不要因此改變 response 的內容與排版格式。

${SUB_SCORE_RUBRIC}
`;

const LABELS: Record<SubScoreDimension, string> = {
    theme_and_content: '立意取材',
    structure_and_organization: '結構組織',
    diction_and_sentence_structure: '遣詞造句',
    mechanics_and_punctuation: '錯別字、格式與標點符號',
};

/** AI 批改回傳格式裡的 sub_scores（JSON Schema，給 Gemini 的 responseJsonSchema） */
export const SUB_SCORES_JSON_SCHEMA = {
    description: '四向度的級分與評語總結，依【四向度評分】的規準判定',
    type: 'object',
    required: SUB_SCORE_DIMENSIONS.flatMap((d) => [`${d}_score`, `${d}_score_summary`]),
    properties: Object.fromEntries(SUB_SCORE_DIMENSIONS.flatMap((d) => [
        [`${d}_score`, { description: `${LABELS[d]}級分，0 到 6 之間的整數`, type: 'integer', minimum: 0, maximum: 6 }],
        [`${d}_score_summary`, { description: `${LABELS[d]}評語總結，50 字以內`, type: 'string' }],
    ])),
    additionalProperties: false,
};

/** 零級分作品的四向度：全給 0、評語空白（沿用批次補分的做法） */
export function zeroSubScores(): SubScores {
    return Object.fromEntries(SUB_SCORE_DIMENSIONS.flatMap((d) => [
        [`${d}_score`, 0],
        [`${d}_score_summary`, ''],
    ])) as SubScores;
}

/**
 * 把 AI 給的四向度整理成可以存的形狀。
 *
 * - 整體級分是 0（零級分）→ 不管 AI 給了什麼，一律 zeroSubScores()
 * - 四個分數都是數字 → 四捨五入、夾回 0-6；評語不是字串就當空白
 * - **任何一個分數缺了或不是數字 → 回 null**，這一版就不存四向度。
 *   不要因此讓整篇批改失敗：整體級分與評語照樣存，
 *   管理員的批次補分之後還會補上（它只處理 sub_scores 是空的）。
 */
export function normalizeSubScores(raw: unknown, score: number): SubScores | null {
    if (score <= 0) return zeroSubScores();
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const out: Record<string, number | string> = {};
    for (const d of SUB_SCORE_DIMENSIONS) {
        const n = Number(r[`${d}_score`]);
        if (r[`${d}_score`] === null || r[`${d}_score`] === '' || !Number.isFinite(n)) return null;
        out[`${d}_score`] = Math.min(6, Math.max(0, Math.round(n)));
        const summary = r[`${d}_score_summary`];
        out[`${d}_score_summary`] = typeof summary === 'string' ? summary.trim() : '';
    }
    return out as SubScores;
}

/** AI 回傳的批改結果解析不了，或沒有合法的整體級分。這一篇**不能存檔** */
export class AiGradingResponseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AiGradingResponseError';
    }
}

/**
 * 解析 AI 批改的回傳文字。
 *
 * 回傳 `content`（要存進 submission_feedback.content 的那一份，**不含** sub_scores ——
 * 四向度只存在 sub_scores 欄位，不要一份資料兩個來源）、整體級分與四向度。
 *
 * ⚠️ 以前解析失敗時回傳 `{ score: 0, summary: "解析失敗" }`，呼叫端照樣存檔：
 *    那一篇就變成一份**有效的零級分**，狀態是已批改、評語印出一串 JSON，
 *    自動蓋佳作「每篇只判斷一次」的機會也被用掉了。現在一律丟出例外，不存檔。
 */
export function parseGradingResponse(text: string | undefined): {
    content: Record<string, unknown>;
    score: number;
    subScores: SubScores | null;
} {
    let parsed: unknown;
    try {
        const json = (text || '').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        parsed = JSON.parse(json);
    } catch {
        throw new AiGradingResponseError('AI 回傳的批改結果不是合法的 JSON');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new AiGradingResponseError('AI 回傳的批改結果不是物件');
    }
    const { sub_scores, ...content } = parsed as Record<string, unknown>;
    const score = content.score;
    if (typeof score !== 'number' || !Number.isInteger(score) || score < 0 || score > 6) {
        throw new AiGradingResponseError('AI 回傳的整體級分不是 0-6 的整數');
    }
    return { content, score, subScores: normalizeSubScores(sub_scores, score) };
}
