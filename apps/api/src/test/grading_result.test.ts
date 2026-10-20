/**
 * AI 批改結果的解析與四向度整理（lib/grading_result.ts）。純函式，不碰資料庫。
 *
 * 真的 AI 在測試環境不會被呼叫，所以「AI 回傳壞掉」只能在這裡驗：
 * 以前解析失敗會被存成一份有效的零級分。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    AiGradingResponseError, normalizeSubScores, parseGradingResponse, zeroSubScores,
    SUB_SCORE_DIMENSIONS, SUB_SCORE_RUBRIC, SUB_SCORE_INSTRUCTION, SUB_SCORES_JSON_SCHEMA,
} from '../lib/grading_result';

/** 一份四向度都給齊的 AI 回傳 */
const full = (over: Record<string, unknown> = {}) => ({
    theme_and_content_score: 4,
    theme_and_content_score_summary: '取材切題。',
    structure_and_organization_score: 5,
    structure_and_organization_score_summary: '脈絡分明。',
    diction_and_sentence_structure_score: 3,
    diction_and_sentence_structure_score_summary: '偶有冗詞贅句。',
    mechanics_and_punctuation_score: 4,
    mechanics_and_punctuation_score_summary: '標點大致正確。',
    ...over,
});

describe('normalizeSubScores', () => {
    test('四個分數都有 → 原樣存，評語去頭尾空白', () => {
        const s = normalizeSubScores(full({ theme_and_content_score_summary: '  取材切題。 ' }), 4);
        assert.deepEqual(s, full());
    });

    test('零級分：不管 AI 給了什麼，四向度全給 0、評語空白（沿用批次補分的做法）', () => {
        const s = normalizeSubScores(full(), 0);
        assert.deepEqual(s, zeroSubScores());
        for (const d of SUB_SCORE_DIMENSIONS) {
            assert.equal(s![`${d}_score`], 0);
            assert.equal(s![`${d}_score_summary`], '');
        }
    });

    test('零級分時 AI 沒給四向度也一樣是全 0，不是 null', () => {
        assert.deepEqual(normalizeSubScores(undefined, 0), zeroSubScores());
    });

    test('分數取整數並夾回 0-6', () => {
        const s = normalizeSubScores(full({ theme_and_content_score: 4.6, structure_and_organization_score: 9, diction_and_sentence_structure_score: -1 }), 4);
        assert.equal(s!.theme_and_content_score, 5);
        assert.equal(s!.structure_and_organization_score, 6);
        assert.equal(s!.diction_and_sentence_structure_score, 0);
    });

    test('缺任何一個分數 → null（整體級分照樣存，四向度之後由批次補分補上）', () => {
        const { mechanics_and_punctuation_score: _, ...missing } = full();
        assert.equal(normalizeSubScores(missing, 4), null);
        assert.equal(normalizeSubScores(full({ theme_and_content_score: null }), 4), null);
        assert.equal(normalizeSubScores(full({ theme_and_content_score: '好' }), 4), null);
        assert.equal(normalizeSubScores(undefined, 4), null);
    });

    test('評語不是字串就當空白，不讓整份四向度作廢', () => {
        const s = normalizeSubScores(full({ structure_and_organization_score_summary: 123 }), 4);
        assert.equal(s!.structure_and_organization_score_summary, '');
        assert.equal(s!.structure_and_organization_score, 5);
    });
});

describe('parseGradingResponse', () => {
    test('四向度從 content 拿出來，只存在 sub_scores 欄位', () => {
        const text = JSON.stringify({ raw_score: 80, score: 4, response: '### 評語', sub_scores: full() });
        const r = parseGradingResponse(text);
        assert.equal(r.score, 4);
        assert.deepEqual(r.content, { raw_score: 80, score: 4, response: '### 評語' });
        assert.equal('sub_scores' in r.content, false);
        assert.deepEqual(r.subScores, full());
    });

    test('包在 ```json 區塊裡也吃', () => {
        const r = parseGradingResponse('```json\n' + JSON.stringify({ score: 5, response: 'x', sub_scores: full() }) + '\n```');
        assert.equal(r.score, 5);
    });

    test('AI 沒給四向度 → subScores 是 null，但級分與評語照樣可以存', () => {
        const r = parseGradingResponse(JSON.stringify({ score: 3, response: 'x' }));
        assert.equal(r.score, 3);
        assert.equal(r.subScores, null);
    });

    /*
      以前這幾種情況會回傳 { score: 0, summary: "解析失敗" }，呼叫端照樣存檔 ——
      作品變成一份有效的零級分，自動蓋佳作的那一次判斷也被用掉。
    */
    test('不是 JSON（例如輸出被截斷）→ 丟出 AiGradingResponseError', () => {
        assert.throws(() => parseGradingResponse('{"score": 4, "response": "寫到一半'), AiGradingResponseError);
        assert.throws(() => parseGradingResponse(undefined), AiGradingResponseError);
        assert.throws(() => parseGradingResponse(''), AiGradingResponseError);
    });

    test('沒有合法的整體級分 → 丟出例外，不要當成零級分', () => {
        assert.throws(() => parseGradingResponse(JSON.stringify({ response: 'x' })), AiGradingResponseError);
        assert.throws(() => parseGradingResponse(JSON.stringify({ score: 7, response: 'x' })), AiGradingResponseError);
        assert.throws(() => parseGradingResponse(JSON.stringify({ score: 3.5, response: 'x' })), AiGradingResponseError);
        assert.throws(() => parseGradingResponse(JSON.stringify({ score: '4', response: 'x' })), AiGradingResponseError);
        assert.throws(() => parseGradingResponse(JSON.stringify([1, 2])), AiGradingResponseError);
    });

    test('零級分是合法的級分，不是失敗', () => {
        const r = parseGradingResponse(JSON.stringify({ score: 0, response: '離題', sub_scores: full() }));
        assert.equal(r.score, 0);
        assert.deepEqual(r.subScores, zeroSubScores());
    });
});

describe('提示詞與回傳格式', () => {
    test('附加到批改提示詞的只有四向度規準，不含會改變整體級分的段落', () => {
        assert.match(SUB_SCORE_INSTRUCTION, /核心評量規準/);
        assert.ok(SUB_SCORE_INSTRUCTION.includes(SUB_SCORE_RUBRIC));
        // 這兩段在管理員批次的提示詞裡，會影響整體級分的判定
        assert.doesNotMatch(SUB_SCORE_INSTRUCTION, /心態校準|審查極限|整體級分上限/);
    });

    test('回傳格式要求四個分數與四段評語，分數限 0-6 整數', () => {
        assert.equal(SUB_SCORES_JSON_SCHEMA.required.length, 8);
        for (const d of SUB_SCORE_DIMENSIONS) {
            const p = (SUB_SCORES_JSON_SCHEMA.properties as Record<string, any>)[`${d}_score`];
            assert.deepEqual([p.type, p.minimum, p.maximum], ['integer', 0, 6]);
        }
    });
});
