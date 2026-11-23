/**
 * 稿紙上的批改區（lib/gradingZone.ts）。
 *
 * 釘住：級分對到哪一個等第（0 級分、沒有資料不打勾）、錯字訂正只放確定的錯字且最多六行、
 * 評語欄只取第一個小標題之前的總評、直寫由右而左且標點不放行首、放不下先縮字再截斷並提醒。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BLANK_GRADING_SHEETS, layoutVerticalText, parseBlankGradingPage, parseGradingZone, sheetComment, sheetGradingHints,
  sheetLevelIndex, sheetLevels, sheetTypoColumns,
  type GradingZone, type ZoneRect,
} from '../lib/gradingZone';
import { BLANK_PAGE_PREFIX, parseManuscript, readingOrder } from '../lib/manuscript';

// 10 px/mm 的聯合報國中稿紙第二頁（後端 grading_zone.ts 算出來的樣子）
const rect = (x0: number, y0: number, x1: number, y1: number): ZoneRect => [x0 * 10, y0 * 10, x1 * 10, y1 * 10];
const ZONE: GradingZone = {
  typoColumns: [82.9, 69.9, 56.9, 43.9, 30.9, 17.9].map((left) =>
    [0, 1, 2, 3, 4, 5].map((r) => rect(left, 38.5 + r * 10, left + 10, 48.5 + r * 10))),
  levelCells: [[66.9, 79.9], [53.9, 66.9], [40.9, 53.9], [17.9, 40.9]].map(([l, r]) =>
    [0, 1, 2, 3].map((i) => rect(l, 118.5 + i * 10, r, 128.5 + i * 10))),
  commentBox: rect(17.9, 158.5, 95.9, 258.5),
};
const UNIT = 100;

describe('寫作能力分析', () => {
  test('6 極佳、5 佳、4 尚可、3 以下待加強；0 級分和沒有資料不打勾', () => {
    assert.deepEqual([6, 5, 4, 3, 2, 1].map(sheetLevelIndex), [0, 1, 2, 3, 3, 3]);
    assert.deepEqual([0, undefined, null, Number.NaN].map(sheetLevelIndex), [null, null, null, null]);
  });

  test('四向度照稿紙由右而左的順序：立意取材、結構組織、遣詞造句、錯別字格式與標點', () => {
    // grammar 這個鍵對到的是「錯別字、格式與標點符號」（lib/categoryScores.ts）
    assert.deepEqual(sheetLevels({ content: 5, structure: 4, vocabulary: 6, grammar: 3 }), [1, 2, 0, 3]);
    assert.deepEqual(sheetLevels(undefined), [null, null, null, null]);
    assert.deepEqual(sheetLevels({ content: 0, structure: 0, vocabulary: 0, grammar: 0 }), [null, null, null, null]);
  });
});

describe('錯字訂正', () => {
  const order = readingOrder(['第1頁', '第2頁']);
  const mark = (cellKey: string, correct: string, state: 'confirmed' | 'pending' | 'vetoed' = 'confirmed') => ({ cellKey, correct, state });

  test('只放確定的錯字，依直書的閱讀順序，同一個字只寫一次', () => {
    const typos = sheetTypoColumns([
      mark('第2頁:1:1', '績'), mark('第1頁:3:2', '再'), mark('第1頁:1:9', '已'),
      mark('第1頁:2:1', '練', 'pending'), mark('第1頁:2:2', '啟', 'vetoed'), mark('第1頁:5:5', '再'), mark('第1頁:6:1', ''),
    ], order, ZONE);
    assert.deepEqual(typos, { columns: [['已'], ['再'], ['績']], total: 3 });
    assert.deepEqual(sheetGradingHints(typos, { shown: 0, total: 0 }), []);
  });

  test('超過六個放不下：取前六個，提醒老師還有幾個；正確的字是一個詞時一格一個字往下排', () => {
    const typos = sheetTypoColumns(
      ['一', '二', '三', '四', '五', '六', '七', '再接再厲'].map((c, i) => mark(`第1頁:${i + 1}:1`, c)), order, ZONE);
    assert.equal(typos.columns.length, 6);
    assert.equal(typos.total, 8);
    assert.match(sheetGradingHints(typos, { shown: 0, total: 0 })[0], /只放得下 6 個字，另外 2 個/);
    assert.deepEqual(sheetTypoColumns([mark('第1頁:1:1', '再接再厲')], order, ZONE).columns, [['再', '接', '再', '厲']]);
  });
});

describe('老師評語', () => {
  test('只取第一個小標題之前的總評，拿掉 Markdown 記號與換行', () => {
    const feedback = '你把午後寫得**很有畫面**。\n結尾可以再多寫一點。\n\n### 文章亮點\n- **比喻生動**：「雨聲像珍珠」有畫面。';
    assert.equal(sheetComment(feedback), '你把午後寫得很有畫面。結尾可以再多寫一點。');
    assert.equal(sheetComment(''), '');
    assert.equal(sheetComment(null), '');
  });

  test('一開頭就是小標題的評語沒有總評可以取：整份都放', () => {
    assert.equal(sheetComment('## 總評\n- 立意清楚\n1. 結尾太短'), '總評立意清楚結尾太短');
  });

  test('直寫由右而左：第一行靠右，一個字一個字往下，都在框裡', () => {
    const layout = layoutVerticalText('你把陪阿公修腳踏車的午後寫得很有畫面。', ZONE.commentBox, UNIT);
    const [x0, y0, x1, y1] = ZONE.commentBox;
    assert.equal(layout.size, 50);
    assert.equal(layout.shown, layout.total);
    assert.ok(layout.glyphs[0].x > layout.glyphs[layout.glyphs.length - 1].x);
    assert.equal(layout.glyphs[0].x, layout.glyphs[1].x);
    assert.ok(layout.glyphs[1].y > layout.glyphs[0].y);
    for (const g of layout.glyphs) {
      assert.ok(g.x - layout.size / 2 >= x0 && g.x + layout.size / 2 <= x1, `x 超出評語欄：${g.ch}`);
      assert.ok(g.y - layout.size / 2 >= y0 && g.y + layout.size / 2 <= y1, `y 超出評語欄：${g.ch}`);
    }
  });

  test('標點不放行首（掛在上一行最下面）；引號轉 90 度，逗號句號不轉；半形換全形', () => {
    // 這個字級一行 17 個字：第 18 個字是逗號，要留在第一行
    const layout = layoutVerticalText(`${'一'.repeat(17)}，「好」A1`, ZONE.commentBox, UNIT);
    const firstColumn = layout.glyphs.filter((g) => g.x === layout.glyphs[0].x);
    assert.equal(firstColumn.length, 18);
    assert.equal(firstColumn[17].ch, '，');
    assert.equal(firstColumn[17].rotate, false);
    assert.ok(firstColumn[17].y + layout.size / 2 <= ZONE.commentBox[3]);
    assert.deepEqual(layout.glyphs.slice(18).map((g) => [g.ch, g.rotate]), [['「', true], ['好', false], ['」', true], ['Ａ', false], ['１', false]]);
  });

  test('總評的長度（150 字）用最大的字放得下；長一點先縮字；再長才截斷並提醒', () => {
    assert.equal(layoutVerticalText('字'.repeat(150), ZONE.commentBox, UNIT).size, 50);
    const smaller = layoutVerticalText('字'.repeat(300), ZONE.commentBox, UNIT);
    assert.ok(smaller.size < 50);
    assert.equal(smaller.shown, 300);
    const cut = layoutVerticalText('字'.repeat(900), ZONE.commentBox, UNIT);
    assert.equal(cut.size, 32);
    assert.ok(cut.shown < 900);
    assert.equal(cut.glyphs[cut.glyphs.length - 1].ch, '…');
    assert.equal(cut.glyphs.length, cut.shown + 1);
    assert.match(sheetGradingHints({ columns: [], total: 0 }, cut)[0], new RegExp(`只放得下前 ${cut.shown} 個字`));
  });

  test('沒有評語、框壞掉都不畫', () => {
    assert.deepEqual(layoutVerticalText('', ZONE.commentBox, UNIT).glyphs, []);
    assert.deepEqual(layoutVerticalText('好', [0, 0, 10, 10], UNIT).glyphs, []);
  });
});

describe('後端給的位置', () => {
  test('形狀對才收；別的稿紙、別的頁是 null', () => {
    assert.deepEqual(parseGradingZone(ZONE), ZONE);
    assert.equal(parseGradingZone(null), null);
    assert.equal(parseGradingZone({ ...ZONE, commentBox: [0, 0, 1] }), null);
    assert.equal(parseGradingZone({ ...ZONE, levelCells: ZONE.levelCells.slice(0, 3) }), null);
    assert.equal(parseGradingZone({ ...ZONE, typoColumns: [] }), null);
  });

  test('原稿資料：每一頁各自帶批改區', () => {
    const data = parseManuscript({
      available: true,
      pages: [
        { page: 1, prefix: '第1頁', imageUrl: '/1', cells: [] },
        { page: 2, prefix: '第2頁', imageUrl: '/2', cells: [], gradingZone: ZONE },
      ],
    });
    assert.deepEqual(data?.pages.map((p) => Boolean(p.gradingZone)), [false, true]);
    assert.deepEqual(data?.pages.map((p) => p.blank), [false, false]);
  });
});

describe('只寫一頁：補一頁空白稿紙放批改區', () => {
  const blankGradingZone = { pxPerMm: 8, zone: ZONE };
  const onePage = { available: true, template: 'udn', pages: [{ page: 1, prefix: '第1頁', imageUrl: '/1', cells: [] }] };

  test('沒有任何一頁有批改區 → 最後補一頁空白稿紙，沒有格子', () => {
    const data = parseManuscript({ ...onePage, blankGradingZone });
    assert.deepEqual(data?.pages.map((p) => [p.prefix, p.blank, Boolean(p.gradingZone), p.cells.length]), [
      ['第1頁', false, false, 0],
      [BLANK_PAGE_PREFIX, true, true, 0],
    ]);
    assert.equal(data?.pages[1].imageUrl, BLANK_GRADING_SHEETS.udn.url);
  });

  test('已經有一頁畫得上、別的稿紙、後端沒給、解析度和底圖不一樣：都不補', () => {
    const twoPages = { ...onePage, pages: [...onePage.pages, { page: 2, prefix: '第2頁', imageUrl: '/2', cells: [], gradingZone: ZONE }] };
    assert.equal(parseManuscript({ ...twoPages, blankGradingZone })?.pages.length, 2);
    assert.equal(parseManuscript({ ...onePage, template: 'cap', blankGradingZone })?.pages.length, 1);
    assert.equal(parseManuscript(onePage)?.pages.length, 1);
    assert.equal(parseManuscript({ ...onePage, blankGradingZone: { pxPerMm: 10, zone: ZONE } })?.pages.length, 1);
    assert.equal(parseBlankGradingPage('udn', { pxPerMm: 8, zone: { ...ZONE, commentBox: [0] } }), null);
  });

  test('底圖真的在，而且是整張紙、解析度和程式寫的一樣（位置才不會歪）', () => {
    for (const [template, sheet] of Object.entries(BLANK_GRADING_SHEETS)) {
      const file = resolve(import.meta.dirname, '..', 'public', sheet.url.replace(/^\//, ''));
      assert.ok(existsSync(file), `缺 ${template} 的底圖：${file}`);
      const png = readFileSync(file);
      assert.equal(png.subarray(1, 4).toString('latin1'), 'PNG');
      // PNG 的 IHDR：第 16、20 個位元組開始各 4 個位元組是寬、高
      const [width, height] = [png.readUInt32BE(16), png.readUInt32BE(20)];
      assert.ok(Math.abs(width - sheet.paperMm[0] * sheet.pxPerMm) <= 1, `${template} 的底圖寬 ${width}`);
      assert.ok(Math.abs(height - sheet.paperMm[1] * sheet.pxPerMm) <= 1, `${template} 的底圖高 ${height}`);
    }
  });
});
