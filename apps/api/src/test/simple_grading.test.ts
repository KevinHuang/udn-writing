/**
 * 簡易批改（docs/simple-grading.md）：稿紙代繳交、經逐格辨識、學生沒有校稿的作文。
 *
 * 釘住的是不會當掉、只會安靜出錯的事：
 *   - 帶〔?〕的字、被標成錯字的字，不能被引用成「寫得好的句子」（學生會看到自己沒寫的字被稱讚／同一個詞又紅圈又稱讚）；
 *   - 只給老師看的評分依據、請老師留意，不能跑進學生讀的那一欄（submission_feedback.content）；
 *   - 老師校對改過文字的作文，改回一般批改（格子對不上了）；
 *   - 不足 100 字不花錢送 AI；AI 回傳不合規則重批一次，兩次都不行就不存。
 */
import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  resetDb, rawDb, seedUser, seedSchool, seedCourse, seedInstructor, seedLearner, seedTask, seedAssignment,
  seedSubmission, startFakeIdp, startServer, login, req, type TestServer,
} from './helpers';
import {
  buildEssayIndex, buildSimpleGradingInput, findTrustedSpan, MARK, normalizeForCompare, rebuildParagraphs,
  renderMarkedText, type GridCell, type GridPage, type StoredGridResult, type TypoMark,
} from '../lib/simple_grading/essay';
import { gradeSimple, type SimpleGradingAi } from '../lib/simple_grading/grade';
import { composeStudentResponse } from '../lib/simple_grading/result';
import { summarizeGrid } from '../lib/simple_grading/summary';
import { AiGradingResponseError, SUB_SCORE_INSTRUCTION, SUB_SCORE_RUBRIC } from '../lib/grading_result';
import { buildSimpleGradingSystem } from '../lib/simple_grading/prompt';

// ── 假的稿紙：照辨識服務的規則排進格子（每段開頭空兩格、一行 ROWS 格） ──

const ROWS = 22;
type Ch = { ch: string; status?: string };
const P = (s: string, doubt: string[] = []) =>
  [...s].map((ch) => ({ ch, status: doubt.includes(ch) ? 'doubt' : 'agree' }));

function layout(paras: Ch[][]): GridPage[] {
  const cells: GridCell[] = [];
  let col = 0;
  for (const para of paras) {
    const seq: Array<Ch | null> = [null, null, ...para];
    for (let i = 0; i < seq.length; i += 1) {
      if (i % ROWS === 0) col += 1;
      const item = seq[i];
      cells.push({ col, row: (i % ROWS) + 1, text: item?.ch ?? '', status: item ? item.status : 'blank' });
    }
  }
  return [{ prefix: '第1頁', page: 1, ocr: { cells } }];
}

const PARA1 = P('那年暑假，我到花蓮的外婆家住了一個星期。每天清晨，外婆都會待我到市場買菜，她總是笑著和每個攤販打招呼。', ['攤']);
const PARA2 = P('有一天傍晚突然下起大雨，我們躲在騎樓下等雨停。雨聲像一串斷了線的珍珠，敲在鐵皮屋頂上叮叮咚咚。');
const PARA3 = P('那時我才發現，原來外婆也曾經是一個想家的孩子，我們要再接再厲地把這份溫暖傳下去。');
const PAGES = layout([PARA1, PARA2, PARA3]);
const MARKED = renderMarkedText(rebuildParagraphs(PAGES));

/** 「待」在第 1 段第幾格 */
function keyOf(pages: GridPage[], ch: string): string {
  const cell = pages[0].ocr!.cells!.find((c) => c.text === ch)!;
  return `第1頁:${cell.col}:${cell.row}`;
}
const TYPO_DAI: TypoMark = { keys: [keyOf(PAGES, '待')], wrong: '待', correct: '帶', kind: 'typo', source: 'rule', context: ['外婆都會', '待', '我到市場'] };
const PENDING: TypoMark = { keys: [keyOf(PAGES, '鐵')], wrong: '鐵', correct: '鉄', kind: 'check', source: 'ai-text', context: ['敲在', '鐵', '皮屋頂'] };

const GRID: StoredGridResult = {
  markedText: MARKED,
  chars: [...PARA1, ...PARA2, ...PARA3].length,
  paragraphs: 3,
  pages: PAGES,
  typoMarks: [TYPO_DAI, PENDING],
  formatIssues: [{ type: '標點在行首', keys: [keyOf(PAGES, '我')] }],
};
const ESSAY_CONTENT = [PARA1, PARA2, PARA3].map((p) => `　　${p.map((c) => c.ch).join('')}`).join('\n');

const reply = (patch: Record<string, unknown> = {}) => JSON.stringify({
  score_basis: '取材具體，結構完整；錯字 1 個未觸發降級。',
  score: 5,
  zero_reason: '',
  sub_scores: {
    theme_and_content_score: 5, theme_and_content_score_summary: '取材具體',
    structure_and_organization_score: 5, structure_and_organization_score_summary: '結構完整',
    diction_and_sentence_structure_score: 5, diction_and_sentence_structure_score_summary: '比喻生動',
    mechanics_and_punctuation_score: 4, mechanics_and_punctuation_score_summary: '留意小錯字',
  },
  cards: [
    { type: '亮點', quote: '雨聲像一串斷了線的珍珠', title: '比喻生動', comment: '把雨聲寫得有畫面。' },
    { type: '亮點', quote: '她總是笑著和每個攤販打招呼', title: '人物鮮明', comment: '外婆的個性一下就出來了。' },
    { type: '密圈', quote: '攤販', title: '用詞精準', comment: '詞語精準。' },
    { type: '密圈', quote: '叮叮咚咚', title: '聲音摹寫', comment: '用聲音帶出雨勢。' },
    { type: '建議', quote: '外婆都會待我到市場買菜', title: '補足細節', comment: '市場那段可以多寫一些。' },
    { type: '建議', quote: '', title: '深化體悟', comment: '結尾寫寫外婆想家帶給你的改變。' },
  ],
  idioms: { items: ['再接再厲', '一絲不掛'], comment: '用得很到位。' },
  response: '這篇文章以外婆為主角，情感真摯。下次把體悟寫得更深。如果把結尾帶回那場雨，你會怎麼寫？',
  teacher_alert: { needed: true, reason: '第 3 段提到想家，建議關心', paragraph: 3 },
  ...patch,
});

function fakeAi(replies: string[]): SimpleGradingAi & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    model: 'fake-model',
    calls,
    async generate(system, prompt) {
      calls.push([system, prompt]);
      return { text: replies[Math.min(calls.length - 1, replies.length - 1)], inputTokens: 100, outputTokens: 50 };
    },
  };
}

const CONTEXT = { system_instruction: '【聯合報作文批改規範】會考六級分', title: '那年暑假', description: '寫一段回憶', note: null };

describe('組給 AI 的資料', () => {
  /*
    使用者指定（2026-11-23）：為了稿紙上的批改區補的規則只能用在原稿批改（簡易批改的提示詞）。
    其他作文走一般批改，那邊的提示詞與回饋要維持原樣 —— 共用的四向度規準也不能為了稿紙去改。
  */
  test('稿紙專用的規則只在簡易批改的提示詞裡；一般批改的提示詞與共用的四向度規準沒有', () => {
    const rule = '5、6 級分這樣分';
    assert.ok(buildSimpleGradingSystem({ title: '那年暑假' }).includes(rule));
    assert.ok(!SUB_SCORE_INSTRUCTION.includes(rule));
    assert.ok(!SUB_SCORE_RUBRIC.includes(rule));
  });

  test('格子重建和存下的全文一致 → 精確模式；不確定的字後面有〔?〕', () => {
    const index = buildEssayIndex(GRID);
    assert.equal(index.exact, true);
    assert.equal(index.texts.length, 3);
    assert.ok(MARKED.includes(`攤${MARK}販`));
  });

  test('資料模板：段落編號、統計、確定的錯別字（待確認的不列）、格式檢查', () => {
    const input = buildSimpleGradingInput(GRID);
    assert.equal(input.systemZero, null);
    const s = input.essaySection;
    assert.match(s, /^【辨識全文】/);
    assert.match(s, /\n1　那年暑假/);
    assert.match(s, /\n3　那時我才發現/);
    assert.match(s, new RegExp(`字數：${GRID.chars}；段落數：3`));
    assert.match(s, /【確定的錯別字】共 1 個\n1\. 第 1 段「外婆都會待我到市場」：待 → 帶/);
    assert.doesNotMatch(s, /鉄/, '待確認的錯字不送 AI');
    assert.match(s, /標點寫在一行的第一格：1 處（第 1 段）/);
    assert.match(s, /段首沒有空兩格：無/);
  });

  test('不足 100 字 → 建議 0 級分，不送 AI', async () => {
    const short = P('今天天氣很好。');
    const pages = layout([short]);
    const grid = { ...GRID, markedText: renderMarkedText(rebuildParagraphs(pages)), chars: short.length, paragraphs: 1, pages, typoMarks: [] };
    const ai = fakeAi([reply()]);
    const run = await gradeSimple({ grid, context: CONTEXT, ai });
    assert.equal(ai.calls.length, 0);
    assert.equal(run.outcome.score, 0);
    assert.equal(run.outcome.detail.systemZero, true);
    assert.match(run.outcome.detail.zeroReason, /不足 100 字/);
  });

  test('辨識服務改版、格子對不上時，退回只看〔?〕記號', () => {
    const index = buildEssayIndex({ markedText: MARKED, pages: null });
    assert.equal(index.exact, false);
    assert.deepEqual(findTrustedSpan(index, '每個攤販'), { ok: false, reason: 'untrusted' });
    assert.equal(findTrustedSpan(index, '雨聲像一串斷了線的珍珠').ok, true);
  });

  test('比對老師有沒有改過文字：不管段首空格與〔?〕記號', () => {
    assert.equal(normalizeForCompare(ESSAY_CONTENT), normalizeForCompare(MARKED));
    assert.notEqual(normalizeForCompare(ESSAY_CONTENT.replace('待我', '帶我')), normalizeForCompare(MARKED));
  });
});

describe('讀回 AI 的結果', () => {
  test('提示詞：先放題目的批改規範，再接簡易批改的規則', async () => {
    const ai = fakeAi([reply()]);
    await gradeSimple({ grid: GRID, context: CONTEXT, ai });
    const [system, prompt] = ai.calls[0];
    assert.ok(system.startsWith('【聯合報作文批改規範】'), '評分規準沿用題目的');
    assert.ok(system.indexOf('【題目】那年暑假') < system.indexOf('簡易批改'));
    assert.match(system, /學生沒有校稿/);
    assert.match(prompt, /^【學生作文】\n【辨識全文】/);
  });

  test('引用逐格檢查：可信的留下；有〔?〕、有錯字標記的拿掉引用；密圈沒有引用整張不出', async () => {
    const run = await gradeSimple({ grid: GRID, context: CONTEXT, ai: fakeAi([reply()]) });
    const cards = run.outcome.detail.cards;
    const byTitle = (t: string) => cards.find((c) => c.title === t);
    assert.equal(byTitle('比喻生動')?.quote, '雨聲像一串斷了線的珍珠');
    assert.equal(byTitle('比喻生動')?.quoteKeys.length, 11, '每個字都知道在哪一格（第三階段畫線用）');
    assert.equal(byTitle('人物鮮明')?.quote, '', '「攤」辨識不確定');
    assert.equal(byTitle('用詞精準'), undefined, '密圈一定要有引用');
    assert.equal(byTitle('聲音摹寫')?.quote, '叮叮咚咚');
    assert.equal(byTitle('補足細節')?.quote, '', '「待」是確定的錯字：不能又紅圈又引用');
    const checks = run.outcome.detail.checks.join('\n');
    assert.match(checks, /人物鮮明」的引用裡有辨識不確定的字/);
    assert.match(checks, /補足細節」的引用身上有錯字標記/);
  });

  test('待確認的錯字也要避開（同一個詞不能又被懷疑寫錯、又被稱讚）', async () => {
    const r = reply({ cards: [{ type: '亮點', quote: '敲在鐵皮屋頂上叮叮咚咚', title: '聲音', comment: '好聽。' }] });
    const run = await gradeSimple({ grid: GRID, context: CONTEXT, ai: fakeAi([r]) });
    assert.equal(run.outcome.detail.cards[0].quote, '');
  });

  test('成語：逐字對得上、每格可信才列', async () => {
    const run = await gradeSimple({ grid: GRID, context: CONTEXT, ai: fakeAi([reply()]) });
    assert.deepEqual(run.outcome.detail.idioms.items, ['再接再厲']);
    assert.match(run.outcome.response, /### 成語運用\n你用了「再接再厲」，用得很到位。/);
  });

  test('學生看得到的評語：總評＋亮點、精彩詞語、再上層樓；沒有評分依據與請老師留意', async () => {
    const run = await gradeSimple({ grid: GRID, context: CONTEXT, ai: fakeAi([reply()]) });
    const r = run.outcome.response;
    assert.ok(r.startsWith('這篇文章以外婆為主角'));
    assert.match(r, /### 文章亮點\n- \*\*比喻生動\*\*：「雨聲像一串斷了線的珍珠」把雨聲寫得有畫面。/);
    assert.match(r, /### 精彩詞語/);
    assert.match(r, /### 再上層樓\n- \*\*補足細節\*\*：市場那段可以多寫一些。/);
    assert.doesNotMatch(r, /取材具體，結構完整|建議關心|〔\?〕/);
    assert.equal(run.outcome.detail.teacherAlert.needed, true);
    assert.equal(run.outcome.detail.teacherAlert.paragraph, 3);
  });

  test('不合規則 → 重批一次；第二次通過就用第二次的', async () => {
    const ai = fakeAi([reply({ score: 7 }), reply()]);
    const run = await gradeSimple({ grid: GRID, context: CONTEXT, ai });
    assert.equal(ai.calls.length, 2);
    assert.equal(run.aiCalls, 2);
    assert.equal(run.inputTokens, 200, '兩次的用量都要算');
    assert.equal(run.outcome.score, 5);
    assert.match(run.outcome.detail.checks[0], /已自動重批一次/);
  });

  test('兩次都不合規則 → 不存（丟 AiGradingResponseError，路由回 502）', async () => {
    const ai = fakeAi(['不是 JSON', reply({ response: '' })]);
    await assert.rejects(gradeSimple({ grid: GRID, context: CONTEXT, ai }), AiGradingResponseError);
  });

  test('0 級分：不出卡片', async () => {
    const run = await gradeSimple({ grid: GRID, context: CONTEXT, ai: fakeAi([reply({ score: 0, zero_reason: '偏題' })]) });
    assert.deepEqual(run.outcome.detail.cards, []);
    assert.equal(run.outcome.detail.zeroReason, '偏題');
    assert.equal(run.outcome.response, '這篇文章以外婆為主角，情感真摯。下次把體悟寫得更深。如果把結尾帶回那場雨，你會怎麼寫？');
  });

  test('評語組合：沒有卡片時只有總評', () => {
    assert.equal(composeStudentResponse('總評。', [], { items: [], comment: '', spans: [] }), '總評。');
  });

  test('辨識摘要：確定／待確認的錯字、格式問題、完成度', () => {
    const s = summarizeGrid({ ...GRID, sheetTemplate: 'udn', completion: 0.8 });
    assert.deepEqual(
      [s.confirmedTypos, s.pendingTypos, s.punctuationIssues, s.indentIssues, s.lowCompletion],
      [1, 1, 1, 0, true]);
  });
});

// ── 路由：POST /grading/:id 依作文本身決定走不走簡易批改 ──

const ACCOUNT = 'simple@test.edu.tw';
let srv: TestServer;
let idp: { close: () => Promise<void> };

before(async () => {
  idp = await startFakeIdp({ mail: ACCOUNT });
  srv = await startServer();
});
after(async () => {
  await srv.close(); await idp.close(); await rawDb.$pool.end();
});
beforeEach(async () => {
  await resetDb();
});

async function gridEssay(content = ESSAY_CONTENT) {
  const me = await seedUser(ACCOUNT, '我');
  const student = await seedUser('s1@test.edu.tw', '學生甲');
  const school = await seedSchool('甲中學', 'a.edu.tw');
  const course = await seedCourse(school, '我的班');
  await seedInstructor(course, me.id);
  await seedLearner(course, student.id, 1);
  const task = await seedTask(me.id, '那年暑假');
  const assignment = await seedAssignment(course, task, me.id);
  const submission = await seedSubmission(assignment, student.id, content);
  const batch = await rawDb.one<{ id: string }>(
    `INSERT INTO batch_proxy_submission (ref_user_id, ref_assignment_id, submitter_id, img_files, batch_uuid)
     VALUES ($1, $2, $3, '["p1.jpg"]', 'u-1') RETURNING id::text`, [student.id, assignment, me.id]);
  const grid = await rawDb.one<{ id: string }>(
    `INSERT INTO handwriting_grid_result
       (ref_batch_id, ref_assignment_id, ref_user_id, status, sheet_template, marked_text, chars, paragraphs,
        completion, pages, typo_marks, format_issues, finished_at)
     VALUES ($1, $2, $3, 'done', 'udn', $4, $5, 3, 0.97, $6::jsonb, $7::jsonb, $8::jsonb, now()) RETURNING id::text`,
    [batch.id, assignment, student.id, MARKED, GRID.chars,
      JSON.stringify(PAGES), JSON.stringify(GRID.typoMarks), JSON.stringify(GRID.formatIssues)]);
  return { submission, grid: grid.id, me, course };
}

const grade = (cookie: string, id: string) => req(srv, `/service/instructor/grading/${id}`, cookie, { method: 'POST' });
const info = async (cookie: string, id: string) =>
  (await (await req(srv, `/service/instructor/grading/${id}/simple`, cookie)).json()) as {
    eligible: boolean; reason: string | null;
    sheet: { completion: number; confirmedTypos: number; pendingTypos: number } | null;
    detail: { scoreBasis: string; cards: unknown[] } | null;
  };
const feedbackContent = async (submission: string) =>
  JSON.parse((await rawDb.one<{ content: string }>(
    `SELECT content FROM submission_feedback WHERE ref_submission_id = $1 AND is_valid = true`, [submission])).content);

describe('簡易批改：批改路由', () => {
  test('稿紙代繳交、文字沒改過 → 簡易批改；只給老師看的另存，學生讀的那欄沒有', async () => {
    const { submission, grid } = await gridEssay();
    const cookie = await login(srv);
    assert.equal((await info(cookie, submission)).eligible, true);

    const res = await grade(cookie, submission);
    assert.equal(res.status, 200);
    const body = await res.json() as { simple_grading?: boolean };
    assert.equal(body.simple_grading, true);

    const content = await feedbackContent(submission);
    assert.deepEqual(Object.keys(content).sort(), ['response', 'score'], '學生端讀這一欄：只能有級分與評語');
    assert.match(content.response, /示範模式/);

    const row = await rawDb.one(`SELECT * FROM simple_grading_result WHERE ref_submission_id = $1`, [submission]);
    assert.equal(row.ref_grid_result_id, grid);
    assert.match(row.detail.scoreBasis, /示範模式/);

    const i = await info(cookie, submission);
    assert.equal(i.sheet?.confirmedTypos, 1);
    assert.equal(i.sheet?.pendingTypos, 1);
    assert.ok(i.detail?.scoreBasis);
  });

  test('模擬批改的亮點引用也經過逐格檢查（沒有挑到帶〔?〕的字）', async () => {
    const { submission } = await gridEssay();
    const cookie = await login(srv);
    await grade(cookie, submission);
    const row = await rawDb.one(`SELECT detail FROM simple_grading_result WHERE ref_submission_id = $1`, [submission]);
    const highlight = row.detail.cards.find((c: { type: string }) => c.type === '亮點');
    assert.ok(highlight?.quote, '模擬 AI 要挑得到可信的句子');
    assert.ok(highlight.quoteKeys.length > 0);
  });

  test('老師校對改過文字 → 一般批改，不寫簡易批改的細節', async () => {
    const { submission } = await gridEssay(ESSAY_CONTENT.replace('待我', '帶我'));
    const cookie = await login(srv);
    const i = await info(cookie, submission);
    assert.equal(i.eligible, false);
    assert.equal(i.reason, 'edited');
    const res = await grade(cookie, submission);
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { simple_grading?: boolean }).simple_grading, undefined);
    assert.equal((await rawDb.oneOrNone(`SELECT 1 FROM simple_grading_result WHERE ref_submission_id = $1`, [submission])), null);
  });

  test('沒有逐格辨識的作文（學生自己交的）→ 照舊', async () => {
    const me = await seedUser(ACCOUNT, '我');
    const student = await seedUser('s1@test.edu.tw', '學生甲');
    const school = await seedSchool('甲中學', 'a.edu.tw');
    const course = await seedCourse(school, '我的班');
    await seedInstructor(course, me.id);
    await seedLearner(course, student.id, 1);
    const assignment = await seedAssignment(course, await seedTask(me.id), me.id);
    const submission = await seedSubmission(assignment, student.id, ESSAY_CONTENT);
    const cookie = await login(srv);
    assert.deepEqual(
      [(await info(cookie, submission)).eligible, (await info(cookie, submission)).reason],
      [false, 'no_grid']);
  });

  test('重置批改 → 刪掉只給老師看的細節', async () => {
    const { submission } = await gridEssay();
    const cookie = await login(srv);
    await grade(cookie, submission);
    const res = await req(srv, `/service/instructor/grading/reset/${submission}`, cookie, { method: 'POST' });
    assert.equal(res.status, 200);
    assert.equal((await info(cookie, submission)).detail, null);
  });

  test('別班老師看不到簡易批改的資訊', async () => {
    const { submission, me, course } = await gridEssay();
    // 我改成只教另一班：還是老師，但這篇作文不在我的範圍
    const other = await seedCourse(await seedSchool('乙中學', 'b.edu.tw'), '別班');
    await seedInstructor(other, me.id);
    await rawDb.none(`DELETE FROM uc_instructor WHERE ref_course_id = $1`, [course]);
    const cookie = await login(srv);
    const res = await req(srv, `/service/instructor/grading/${submission}/simple`, cookie);
    assert.equal(res.status, 404);
  });
});
