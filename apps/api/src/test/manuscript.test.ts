/**
 * 原稿紅筆（docs/manuscript.md）：老師在原稿上確認、否決、新增錯字。
 *
 * 釘住的是不會當掉、只會安靜出錯的事：
 *   - 「確定的錯別字」只有一份：原稿畫面、送 AI 的清單、重新評分的基準都用它；待確認的不算；
 *   - 老師加的、確認的錯字，卡片引用要避開（同一個詞不能又紅圈又稱讚）；
 *   - 發還之後鎖住：學生看過的紅筆不能偷偷改；
 *   - 別班老師讀不到、改不到。
 */
import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  resetDb, rawDb, seedUser, seedSchool, seedCourse, seedInstructor, seedLearner, seedTask, seedAssignment,
  seedSubmission, startFakeIdp, startServer, login, req, type TestServer,
} from './helpers';
import { rebuildParagraphs, renderMarkedText, type GridCell, type GridPage, type TypoMark } from '../lib/simple_grading/essay';
import {
  confirmedTypos, ManuscriptDecisionError, markBaseline, mergeManuscriptMarks, planDecision, type DecisionRow,
} from '../lib/manuscript/marks';
import { toManuscriptPages } from '../lib/manuscript/payload';

const ROWS = 22;
type Ch = { ch: string; status: string };
const P = (s: string, doubt: string[] = []) => [...s].map((ch) => ({ ch, status: doubt.includes(ch) ? 'doubt' : 'agree' }));

function layout(paras: Ch[][]): GridPage[] {
  const cells: Array<GridCell & { rect: number[] }> = [];
  let col = 0;
  for (const para of paras) {
    const seq: Array<Ch | null> = [null, null, ...para];
    seq.forEach((item, i) => {
      if (i % ROWS === 0) col += 1;
      const row = (i % ROWS) + 1;
      // 和真的辨識結果一樣：直書由右而左，第 1 行在最右邊；10 px/mm、格子 10mm、行距 13mm
      const x1 = 4000 - (col - 1) * 130;
      cells.push({ col, row, text: item?.ch ?? '', status: item ? item.status : 'blank', rect: [x1 - 100, 400 + (row - 1) * 100, x1, 500 + (row - 1) * 100] });
    });
  }
  return [{ prefix: '第1頁', page: 1, ocr: { cells } }];
}

const PARA1 = P('那年暑假，我到花蓮的外婆家住了一個星期。每天清晨，外婆都會待我到市場買菜，她總是笑著和每個攤販打招呼。', ['攤']);
const PARA2 = P('有一天傍晚突然下起大雨，我們躲在騎樓下等雨停。雨聲像一串斷了線的珍珠，敲在鐵皮屋頂上叮叮咚咚。');
const PARA3 = P('那時我才發現，原來外婆也曾經是一個想家的孩子，我們要再接再厲地把這份溫暖傳下去。');
const PAGES = layout([PARA1, PARA2, PARA3]);
const MARKED = renderMarkedText(rebuildParagraphs(PAGES));
const keyOf = (ch: string, nth = 0) => {
  const c = PAGES[0].ocr!.cells!.filter((x) => x.text === ch)[nth];
  return `第1頁:${c.col}:${c.row}`;
};
const TYPO: TypoMark = { keys: [keyOf('待')], wrong: '待', correct: '帶', kind: 'typo', source: 'rule', context: ['外婆都會', '待', '我到市場'] };
const PENDING: TypoMark = { keys: [keyOf('鐵')], wrong: '鐵', correct: '鉄', kind: 'check', source: 'ai-text', context: ['敲在', '鐵', '皮屋頂'] };
const INDENT = { type: '段首空兩格', keys: [keyOf('那', 1)], text: '那', why: '每一段開頭要空兩格。' };
const GRID = { pages: PAGES, typoMarks: [TYPO, PENDING], formatIssues: [INDENT] };

describe('合併系統標記與老師的決定', () => {
  test('沒有決定：系統有把握的算確定、沒把握的是待確認', () => {
    const m = mergeManuscriptMarks(GRID);
    assert.deepEqual(m.typos.map((t) => [t.wrong, t.state]), [['待', 'confirmed'], ['鐵', 'pending']]);
    assert.deepEqual(markBaseline(m), { confirmedTypoCount: 1, indentIssueCount: 1, overTypoLimit: true });
  });

  test('確認待確認、否決系統的、老師加一個、否決格式提醒', () => {
    const decisions: DecisionRow[] = [
      { target: 'typo', cellKey: keyOf('鐵'), decision: 'confirm' },
      { target: 'typo', cellKey: keyOf('待'), decision: 'veto' },
      { target: 'typo', cellKey: keyOf('想'), decision: 'add', correct: '響', note: null },
      { target: 'format', cellKey: keyOf('那', 1), decision: 'veto' },
    ];
    const m = mergeManuscriptMarks(GRID, decisions);
    assert.deepEqual(m.typos.map((t) => [t.wrong, t.state, t.source]), [
      ['待', 'vetoed', 'system'], ['鐵', 'confirmed', 'system'], ['想', 'confirmed', 'teacher'],
    ]);
    assert.deepEqual(confirmedTypos(m).map((t) => t.wrong), ['鐵', '想']);
    assert.equal(m.formats[0].state, 'vetoed');
    assert.deepEqual(markBaseline(m), { confirmedTypoCount: 2, indentIssueCount: 0, overTypoLimit: false });
    assert.equal(m.typos[2].context[1], '想', '老師加的錯字也要有前後文（送 AI 的清單要寫出是哪個詞）');
  });

  test('改正確的字：系統的說明對不上了，換成老師寫的', () => {
    const m = mergeManuscriptMarks(
      { ...GRID, typoMarks: [{ ...TYPO, reason: '系統的說明' } as TypoMark] },
      [{ target: 'typo', cellKey: keyOf('待'), decision: 'confirm', correct: '戴', note: null }]);
    assert.deepEqual([m.typos[0].correct, m.typos[0].reason, m.typos[0].corrected], ['戴', '', true]);
  });
});

describe('老師的動作 → 要存什麼', () => {
  const merged = mergeManuscriptMarks(GRID);
  const plan = (input: Record<string, unknown>, cellText = '') => planDecision(merged, input, cellText);

  test('是錯字、不是錯字、改正確的字、復原', () => {
    assert.deepEqual(plan({ target: 'typo', cellKey: keyOf('鐵'), action: 'confirm' }),
      { op: 'upsert', decision: 'confirm', correct: null, note: null });
    assert.deepEqual(plan({ target: 'typo', cellKey: keyOf('待'), action: 'veto' }),
      { op: 'upsert', decision: 'veto', correct: null, note: null });
    assert.deepEqual(plan({ target: 'typo', cellKey: keyOf('待'), action: 'correct', correct: '戴', note: '戴帽子' }),
      { op: 'upsert', decision: 'confirm', correct: '戴', note: '戴帽子' });
    const decided = mergeManuscriptMarks(GRID, [{ target: 'typo', cellKey: keyOf('待'), decision: 'veto' }]);
    assert.deepEqual(planDecision(decided, { target: 'typo', cellKey: keyOf('待'), action: 'undo' }), { op: 'delete' });
  });

  test('擋下說不通的動作', () => {
    const rejects = (input: Record<string, unknown>, status: number, cellText = '') =>
      assert.throws(() => plan(input, cellText), (e: unknown) => e instanceof ManuscriptDecisionError && e.status === status);
    rejects({ target: 'typo', cellKey: keyOf('待'), action: 'confirm' }, 409); // 已經是確定的
    rejects({ target: 'typo', cellKey: keyOf('待'), action: 'add', correct: '帶' }, 409, '待'); // 已經有標記
    rejects({ target: 'typo', cellKey: keyOf('想'), action: 'add', correct: '' }, 400, '想'); // 沒填正確的字
    rejects({ target: 'typo', cellKey: keyOf('想'), action: 'add', correct: '一二三四五' }, 400, '想');
    rejects({ target: 'typo', cellKey: '第1頁:9:9', action: 'add', correct: '帶' }, 400, ''); // 空格子
    rejects({ target: 'typo', cellKey: keyOf('待'), action: 'delete' }, 400); // 系統的不能刪
    rejects({ target: 'format', cellKey: keyOf('那', 1), action: 'confirm' }, 400);
    rejects({ target: 'typo', cellKey: keyOf('待'), action: 'undo' }, 409); // 沒有決定可以復原
  });

  test('原稿頁面：只給有字的格子，圖經 API 轉送', () => {
    const pages = toManuscriptPages({ pages: PAGES, pageImageFiles: ['grid_1_p1_x.jpg'] }, '55');
    assert.equal(pages[0].imageUrl, '/service/instructor/grading/55/manuscript/pages/0');
    assert.equal(pages[0].cells.length, PARA1.length + PARA2.length + PARA3.length);
    assert.equal(pages[0].cells[0].key, '第1頁:1:3');
    assert.equal(pages[0].cells[0].rect.length, 4);
  });
});

// ── 路由 ──

const ACCOUNT = 'manuscript@test.edu.tw';
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

const CONTENT = [PARA1, PARA2, PARA3].map((p) => `　　${p.map((c) => c.ch).join('')}`).join('\n');

async function gridEssay() {
  const me = await seedUser(ACCOUNT, '我');
  const student = await seedUser('s1@test.edu.tw', '學生甲');
  const school = await seedSchool('甲中學', 'a.edu.tw');
  const course = await seedCourse(school, '我的班');
  await seedInstructor(course, me.id);
  await seedLearner(course, student.id, 1);
  const assignment = await seedAssignment(course, await seedTask(me.id, '那年暑假'), me.id);
  const submission = await seedSubmission(assignment, student.id, CONTENT);
  const batch = await rawDb.one<{ id: string }>(
    `INSERT INTO batch_proxy_submission (ref_user_id, ref_assignment_id, submitter_id, img_files, batch_uuid)
     VALUES ($1, $2, $3, '["p1.jpg"]', 'u-1') RETURNING id::text`, [student.id, assignment, me.id]);
  const grid = await rawDb.one<{ id: string }>(
    `INSERT INTO handwriting_grid_result
       (ref_batch_id, ref_assignment_id, ref_user_id, status, sheet_template, marked_text, chars, paragraphs,
        completion, pages, typo_marks, format_issues, page_image_files, finished_at)
     VALUES ($1, $2, $3, 'done', 'udn', $4, $5, 3, 0.97, $6::jsonb, $7::jsonb, $8::jsonb, '["grid_1_p1_x.jpg"]', now())
     RETURNING id::text`,
    [batch.id, assignment, student.id, MARKED, PARA1.length + PARA2.length + PARA3.length,
      JSON.stringify(PAGES), JSON.stringify(GRID.typoMarks), JSON.stringify(GRID.formatIssues)]);
  return { submission, grid: grid.id, me, course };
}

const post = (cookie: string, p: string, body: unknown = {}) =>
  req(srv, p, cookie, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const decide = (cookie: string, id: string, body: Record<string, unknown>) =>
  post(cookie, `/service/instructor/grading/${id}/manuscript/decisions`, body);
type Marks = { typos: Array<{ wrong: string; state: string; source: string }>; current: { confirmedTypoCount: number } };

describe('原稿紅筆：路由', () => {
  test('讀原稿：頁、格子、標記、目前的錯字狀態', async () => {
    const { submission } = await gridEssay();
    const cookie = await login(srv);
    const res = await req(srv, `/service/instructor/grading/${submission}/manuscript`, cookie);
    assert.equal(res.status, 200);
    const body = await res.json() as { available: boolean; locked: boolean; template: string; pages: unknown[] } & Marks;
    assert.deepEqual([body.available, body.locked, body.template, body.pages.length], [true, false, 'udn', 1]);
    assert.deepEqual(body.typos.map((t) => t.state), ['confirmed', 'pending']);
    assert.equal(body.current.confirmedTypoCount, 1);

    const img = await req(srv, `/service/instructor/grading/${submission}/manuscript/pages/0`, cookie);
    assert.equal(img.status, 200);
    assert.match(img.headers.get('cache-control') ?? '', /private/);
    assert.equal((await req(srv, `/service/instructor/grading/${submission}/manuscript/pages/5`, cookie)).status, 404);
  });

  test('每按一下就存；確定的錯別字跟著變，簡易批改送的也是這一份', async () => {
    const { submission } = await gridEssay();
    const cookie = await login(srv);
    let res = await decide(cookie, submission, { target: 'typo', cellKey: keyOf('鐵'), action: 'confirm' });
    assert.equal(res.status, 200);
    res = await decide(cookie, submission, { target: 'typo', cellKey: keyOf('想'), action: 'add', correct: '響' });
    const marks = await res.json() as Marks;
    assert.equal(marks.current.confirmedTypoCount, 3);

    const info = await (await req(srv, `/service/instructor/grading/${submission}/simple`, cookie)).json() as {
      sheet: { confirmedTypos: number; pendingTypos: number };
    };
    assert.deepEqual([info.sheet.confirmedTypos, info.sheet.pendingTypos], [3, 0]);

    assert.equal((await post(cookie, `/service/instructor/grading/${submission}`)).status, 200);
    const row = await rawDb.one(`SELECT detail FROM simple_grading_result WHERE ref_submission_id = $1`, [submission]);
    assert.deepEqual(row.detail.baseline, { confirmedTypoCount: 3, indentIssueCount: 1, overTypoLimit: true },
      '批改當下的基準：之後比對要不要提醒重新評分');
  });

  test('重置批改不會清掉老師的決定（決定跟著辨識結果，不跟著批改）', async () => {
    const { submission } = await gridEssay();
    const cookie = await login(srv);
    await decide(cookie, submission, { target: 'typo', cellKey: keyOf('待'), action: 'veto' });
    await post(cookie, `/service/instructor/grading/${submission}`);
    await post(cookie, `/service/instructor/grading/reset/${submission}`);
    const body = await (await req(srv, `/service/instructor/grading/${submission}/manuscript`, cookie)).json() as Marks;
    assert.equal(body.typos[0].state, 'vetoed');
  });

  test('發還之後鎖住；不能重新評分', async () => {
    const { submission } = await gridEssay();
    const cookie = await login(srv);
    await post(cookie, `/service/instructor/grading/${submission}`);
    await post(cookie, '/service/instructor/submission_feedback/return', { submissionIds: [submission] });
    const body = await (await req(srv, `/service/instructor/grading/${submission}/manuscript`, cookie)).json() as { locked: boolean };
    assert.equal(body.locked, true);
    const res = await decide(cookie, submission, { target: 'typo', cellKey: keyOf('待'), action: 'veto' });
    assert.equal(res.status, 409);
    assert.equal(((await res.json()) as { code: string }).code, 'MANUSCRIPT_LOCKED');
    assert.equal((await post(cookie, `/service/instructor/grading/${submission}/regrade`)).status, 409);
  });

  test('重新評分：還沒用簡易批改批過不行；批過之後用目前的錯字再跑一次，存成新的一版', async () => {
    const { submission } = await gridEssay();
    const cookie = await login(srv);
    let res = await post(cookie, `/service/instructor/grading/${submission}/regrade`);
    assert.equal(res.status, 409);
    await post(cookie, `/service/instructor/grading/${submission}`);
    await decide(cookie, submission, { target: 'typo', cellKey: keyOf('待'), action: 'veto' });
    await decide(cookie, submission, { target: 'format', cellKey: keyOf('那', 1), action: 'veto' });
    res = await post(cookie, `/service/instructor/grading/${submission}/regrade`);
    assert.equal(res.status, 200);
    const versions = await rawDb.one<{ n: number }>(
      `SELECT count(*)::int n FROM submission_feedback WHERE ref_submission_id = $1`, [submission]);
    assert.equal(versions.n, 2);
    const row = await rawDb.one(`SELECT detail FROM simple_grading_result WHERE ref_submission_id = $1`, [submission]);
    assert.deepEqual(row.detail.baseline, { confirmedTypoCount: 0, indentIssueCount: 0, overTypoLimit: false });
  });

  test('不合理的動作回 400／409，畫面拿得到原因', async () => {
    const { submission } = await gridEssay();
    const cookie = await login(srv);
    const res = await decide(cookie, submission, { target: 'typo', cellKey: keyOf('待'), action: 'delete' });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /不是錯字/);
  });

  test('別班老師讀不到、改不到', async () => {
    const { submission, me, course } = await gridEssay();
    const other = await seedCourse(await seedSchool('乙中學', 'b.edu.tw'), '別班');
    await seedInstructor(other, me.id);
    await rawDb.none(`DELETE FROM uc_instructor WHERE ref_course_id = $1`, [course]);
    const cookie = await login(srv);
    assert.equal((await req(srv, `/service/instructor/grading/${submission}/manuscript`, cookie)).status, 404);
    assert.equal((await req(srv, `/service/instructor/grading/${submission}/manuscript/pages/0`, cookie)).status, 404);
    assert.equal((await decide(cookie, submission, { target: 'typo', cellKey: keyOf('待'), action: 'veto' })).status, 404);
  });
});
