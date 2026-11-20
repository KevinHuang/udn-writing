/**
 * 原稿紅筆的純函式（lib/manuscript.ts）。
 *
 * 釘住：便條依直書閱讀順序編號（右邊的編號和原稿上的一樣）、格式提醒不佔編號、
 * 老師加的錯字落在卡片引用上時拿掉引用（密圈整張）、處理完一個待確認跳下一個、
 * 重新評分只在「3 個以上錯字或段首沒空兩格」這條變了才提醒、正確的字畫在行間。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyTeacherTypos, buildManuscriptNotes, correctLabelLayout, nextPendingNoteId, parseCards, parseManuscript,
  regradeReminder, splitCellKey, teacherTypoKeys, toCellBox,
  type ManuscriptCards, type ManuscriptTypoMark,
} from '../lib/manuscript';

const typo = (patch: Partial<ManuscriptTypoMark>): ManuscriptTypoMark => ({
  id: `typo|${patch.cellKey}`, cellKey: '第1頁:1:3', keys: [patch.cellKey ?? '第1頁:1:3'], wrong: '待', correct: '帶',
  reason: '', source: 'system', state: 'confirmed', corrected: false, decided: false, ...patch,
});

const CARDS: ManuscriptCards = {
  cards: [
    { type: '亮點', title: '比喻生動', comment: '有畫面。', quote: '雨聲像珍珠', quoteKeys: ['第1頁:2:5', '第1頁:2:6'] },
    { type: '密圈', title: '聲音', comment: '好聽。', quote: '叮咚', quoteKeys: ['第1頁:3:1', '第1頁:3:2'] },
    { type: '建議', title: '深化體悟', comment: '多寫改變。', quote: '', quoteKeys: [] },
  ],
  idioms: { items: ['再接再厲'], comment: '用得好。', spans: [{ item: '再接再厲', keys: ['第1頁:4:1'] }] },
};

describe('便條的編號與順序', () => {
  test('直書閱讀順序：先頁、再行（由右而左）、再格；格式提醒不編號；沒有位置的排最後', () => {
    const notes = buildManuscriptNotes(
      {
        typos: [typo({ cellKey: '第1頁:2:9', keys: ['第1頁:2:9'] }), typo({ cellKey: '第1頁:1:3', keys: ['第1頁:1:3'], state: 'pending' })],
        formats: [{ id: 'format|第1頁:1:1', cellKey: '第1頁:1:1', keys: ['第1頁:1:1'], type: '段首空兩格', why: '', state: 'active' }],
      },
      applyTeacherTypos(CARDS, new Set()),
      ['第1頁'],
    );
    assert.deepEqual(notes.map((n) => [n.kind, n.number]), [
      ['format', null], ['pending', 1], ['highlight', 2], ['typo', 3], ['circle', 4], ['idiom', 5], ['suggestion', null],
    ]);
  });

  test('處理完一個待確認，跳到下一個；到底從頭找；沒有了是 null', () => {
    const notes = buildManuscriptNotes({
      typos: [
        typo({ cellKey: '第1頁:1:1', keys: ['第1頁:1:1'], state: 'pending' }),
        typo({ cellKey: '第1頁:1:5', keys: ['第1頁:1:5'] }),
        typo({ cellKey: '第1頁:2:1', keys: ['第1頁:2:1'], state: 'pending' }),
      ],
      formats: [],
    }, null, ['第1頁']);
    assert.equal(nextPendingNoteId(notes, 'typo|第1頁:1:1'), 'typo|第1頁:2:1');
    assert.equal(nextPendingNoteId(notes, 'typo|第1頁:2:1'), 'typo|第1頁:1:1');
    assert.equal(nextPendingNoteId(notes.filter((n) => n.kind !== 'pending'), 'x'), null);
  });
});

describe('老師加的錯字落在卡片引用上', () => {
  test('亮點只拿掉引用、密圈整張不出、成語拿掉那一個；評語也提到時提醒', () => {
    const keys = teacherTypoKeys({
      typos: [
        typo({ cellKey: '第1頁:2:6', keys: ['第1頁:2:6'], source: 'teacher' }),
        typo({ cellKey: '第1頁:3:1', keys: ['第1頁:3:1'], source: 'teacher' }),
        typo({ cellKey: '第1頁:4:1', keys: ['第1頁:4:1'], source: 'teacher' }),
        typo({ cellKey: '第1頁:9:9', keys: ['第1頁:9:9'], source: 'teacher', state: 'vetoed' }),
      ],
    });
    assert.equal(keys.has('第1頁:9:9'), false, '否決的不算');
    const v = applyTeacherTypos(CARDS, keys, ['你寫的「雨聲像珍珠」很生動。']);
    assert.deepEqual(v.cards.map((c) => [c.type, c.quote]), [['亮點', ''], ['建議', '']]);
    assert.deepEqual(v.removals.map((r) => r.kind), ['quote', 'card', 'idiom']);
    assert.deepEqual(v.idioms, []);
    assert.equal(v.idiomComment, '');
    assert.deepEqual(v.mentions, ['雨聲像珍珠']);
  });

  test('沒有碰到就原樣', () => {
    const v = applyTeacherTypos(CARDS, new Set(['第1頁:8:8']));
    assert.equal(v.cards.length, 3);
    assert.equal(v.removals.length, 0);
  });
});

describe('重新評分的提醒', () => {
  const base = { confirmedTypoCount: 2, indentIssueCount: 0, overTypoLimit: false };
  test('跨過門檻兩個方向都提醒；沒變不提醒；舊的批改沒有基準不提醒', () => {
    assert.match(regradeReminder(base, { confirmedTypoCount: 3, indentIssueCount: 0, overTypoLimit: true }) ?? '', /調低/);
    assert.match(regradeReminder({ ...base, overTypoLimit: true }, base) ?? '', /調高/);
    assert.equal(regradeReminder(base, { ...base, confirmedTypoCount: 1 }), null);
    assert.equal(regradeReminder(null, base), null);
  });
});

describe('畫法', () => {
  test('正確的字畫在這一行和右邊那一行的正中間；學測稿紙壓在格線上', () => {
    const box = toCellBox({ key: '第1頁:2:1', rect: [3770, 400, 3870, 500] });
    const right = toCellBox({ key: '第1頁:1:1', rect: [3900, 400, 4000, 500] });
    assert.equal(correctLabelLayout(box, right, 'udn', '帶').x, 3885);
    assert.equal(correctLabelLayout(box, right, 'gsat', '帶').x, 3870);
    assert.equal(correctLabelLayout(box, right, 'udn', '帶').size, 80);
    assert.ok(correctLabelLayout(box, right, 'udn', '一二三').size < 80, '字多時縮小，總高度最多兩格');
  });

  test('格子鍵', () => {
    assert.deepEqual(splitCellKey('第2頁:13:7'), { prefix: '第2頁', col: 13, row: 7 });
  });
});

describe('讀後端的資料', () => {
  test('沒有逐格辨識結果 → null；格子位置不對的略過', () => {
    assert.equal(parseManuscript({ available: false }), null);
    const m = parseManuscript({
      available: true, locked: true, template: 'udn',
      pages: [{ page: 1, prefix: '第1頁', imageUrl: '/x', cells: [{ key: 'a', rect: [0, 0, 1, 1], text: '那' }, { key: 'b', rect: [0, 0], text: '年' }] }],
      typos: [{ id: 'typo|a', cellKey: 'a', keys: ['a'], wrong: '那', correct: '哪', state: 'weird' }],
      formats: [], current: { confirmedTypoCount: 1 },
    });
    assert.equal(m?.pages[0].cells.length, 1);
    assert.equal(m?.typos[0].state, 'confirmed');
    assert.equal(m?.locked, true);
  });

  test('舊的批改結果沒有格子位置：卡片照樣讀得到', () => {
    const c = parseCards({ cards: [{ type: '亮點', title: 't', comment: 'c', quote: 'q' }], idioms: { items: ['再接再厲'] } });
    assert.deepEqual(c?.cards[0].quoteKeys, []);
    assert.deepEqual(c?.idioms.spans, []);
  });
});
