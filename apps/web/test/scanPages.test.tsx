/**
 * 連拍多張稿紙的計算與文案（lib/scan/pages.ts）。
 *
 * 這一支釘的全是「不會當掉、只會安靜給出錯結果」的東西：
 * 中間那張沒辨識出文字時多出來的空行（Markdown 裡是作文中間破一個洞）、
 * 原稿該覆蓋還是接續（錯了老師會看到兩套原稿）、
 * 還有張數上限的差一格（按了「再拍下一張」才發現滿了）。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  summarizeBatchOcr,
  batchOcrMessages,
  mergePicFiles,
  pagesButtonLabel,
  canAddMore,
  trayFull,
  limitHint,
  type PageOcrOutcome,
} from '../lib/scan/pages';
import { SCAN_CONFIG } from '../lib/scan/config';

const page = (index: number, text: string, files: string[] = [], failed = false): PageOcrOutcome => ({
  index,
  text,
  files,
  ...(failed ? { failed: true } : {}),
});

describe('summarizeBatchOcr', () => {
  test('依拍攝順序串接，不重排', () => {
    const s = summarizeBatchOcr([page(1, '第一段'), page(2, '第二段'), page(3, '第三段')]);
    assert.equal(s.text, '第一段\n\n第二段\n\n第三段');
    assert.equal(s.successCount, 3);
    assert.equal(s.total, 3);
  });

  test('中間那張沒辨識出文字時，不能留下多餘的空行', () => {
    const s = summarizeBatchOcr([page(1, 'A'), page(2, ''), page(3, 'C')]);
    assert.equal(s.text, 'A\n\nC');
    assert.deepEqual(s.emptyPages, [2]);
    assert.equal(s.successCount, 2);
  });

  test('只有空白字元的一張也算沒讀到', () => {
    const s = summarizeBatchOcr([page(1, 'A'), page(2, '   \n  ')]);
    assert.equal(s.text, 'A');
    assert.deepEqual(s.emptyPages, [2]);
  });

  test('請求失敗歸 failedPages，不歸 emptyPages —— 兩者要分開講', () => {
    const s = summarizeBatchOcr([page(1, 'A'), page(2, '', [], true), page(3, '')]);
    assert.deepEqual(s.failedPages, [2]);
    assert.deepEqual(s.emptyPages, [3]);
  });

  test('辨識不到文字但原稿有存到，檔案照收', () => {
    const s = summarizeBatchOcr([page(1, '', ['img/a.jpg']), page(2, 'B', ['img/b.jpg'])]);
    assert.deepEqual(s.files, ['img/a.jpg', 'img/b.jpg']);
    assert.equal(s.text, 'B');
  });

  test('全部都沒讀到', () => {
    const s = summarizeBatchOcr([page(1, ''), page(2, '')]);
    assert.equal(s.text, '');
    assert.equal(s.successCount, 0);
  });

  test('空陣列不會炸，也不會產生假的數字', () => {
    const s = summarizeBatchOcr([]);
    assert.equal(s.total, 0);
    assert.equal(s.text, '');
    assert.deepEqual(s.files, []);
  });
});

describe('batchOcrMessages', () => {
  const summary = (o: PageOcrOutcome[]) => summarizeBatchOcr(o);

  test('全部順利就不要說話', () => {
    const s = summary([page(1, 'A'), page(2, 'B')]);
    assert.deepEqual(batchOcrMessages(s, 'alert'), []);
    assert.deepEqual(batchOcrMessages(s, 'list'), []);
  });

  test('只有一張時說「這一張」，不要說「第 1 張」', () => {
    const s = summary([page(1, '')]);
    assert.match(batchOcrMessages(s, 'alert')[0], /這一張/);
    assert.doesNotMatch(batchOcrMessages(s, 'alert')[0], /第 1 張/);
  });

  test('多張部分失敗：alert 講得出是哪幾張，用頓號', () => {
    const s = summary([page(1, 'A'), page(2, ''), page(3, 'C'), page(4, '')]);
    const msg = batchOcrMessages(s, 'alert')[0];
    assert.match(msg, /第 2、4 張/);
    assert.match(msg, /其餘/);
  });

  test('全軍覆沒的用語跟部分失敗不一樣', () => {
    const s = summary([page(1, ''), page(2, ''), page(3, '')]);
    const msg = batchOcrMessages(s, 'alert')[0];
    assert.match(msg, /這 3 張都沒有辨識出文字/);
  });

  test('整批都是請求失敗（斷網、後端掛了）要說稍後再試，不是叫人重掃', () => {
    const s = summary([page(1, '', [], true), page(2, '', [], true)]);
    const msg = batchOcrMessages(s, 'alert')[0];
    assert.match(msg, /稍後再試/);
    assert.doesNotMatch(msg, /沒有辨識出文字/);
  });

  test('老師端一行一條：沒讀到與失敗分開，全軍覆沒再補一句', () => {
    const s = summary([page(1, ''), page(2, '', [], true)]);
    const lines = batchOcrMessages(s, 'list');
    assert.equal(lines.length, 3);
    assert.match(lines[0], /辨識不到文字/);
    assert.match(lines[1], /辨識失敗/);
    assert.match(lines[2], /都沒有辨識出文字/);
  });

  test('沒有任何一張時不要說話', () => {
    assert.deepEqual(batchOcrMessages(summary([]), 'alert'), []);
  });
});

describe('mergePicFiles', () => {
  test('這次第一次掃描：整份覆蓋（不然老師會看到兩套原稿）', () => {
    assert.deepEqual(mergePicFiles(['舊1', '舊2'], ['新1'], true), ['新1']);
  });

  test('同一次的第二批：接在後面', () => {
    assert.deepEqual(mergePicFiles(['舊1'], ['新1', '新2'], false), ['舊1', '新1', '新2']);
  });

  test('這一批一張都沒存到就不要動既有的 —— 連覆蓋都不要', () => {
    const prev = ['舊1'];
    assert.equal(mergePicFiles(prev, [], false), prev, '同一個 reference，不要多觸發一次 render');
    assert.deepEqual(mergePicFiles(prev, [], true), []);
  });
});

describe('pagesButtonLabel', () => {
  test('一張與多張的說法不同', () => {
    assert.equal(pagesButtonLabel(1), '使用這一張');
    assert.equal(pagesButtonLabel(2), '使用這 2 張');
    assert.equal(pagesButtonLabel(8), '使用這 8 張');
  });

  test('0 張（理論上按不到）不要顯示「使用這 0 張」', () => {
    assert.equal(pagesButtonLabel(0), '使用這一張');
  });
});

describe('canAddMore / limitHint', () => {
  const max = SCAN_CONFIG.maxScanPages;

  test('托盤裡的張數要 +1（畫面上還有一張沒收）再跟上限比', () => {
    assert.equal(canAddMore(0), true);
    assert.equal(canAddMore(max - 3), true);
    // 托盤 7 張 + 畫面上這張 = 8 = 上限 → 不能再拍了
    assert.equal(canAddMore(max - 1), false);
    assert.equal(canAddMore(max), false);
  });

  test('到上限才給提示', () => {
    assert.equal(limitHint(max - 2), '');
    assert.match(limitHint(max - 1), new RegExp(`${max} 張`));
  });

  test('首頁入口用 trayFull —— 托盤 7 張時還要讓人拍第 8 張', () => {
    // 從首頁拍的那張會變成「畫面上這張」，托盤張數不變，所以門檻比 canAddMore 高一格
    assert.equal(trayFull(max - 1), false, '托盤 7 張時第 8 張還是合法的');
    assert.equal(canAddMore(max - 1), false, '但結果頁的「再拍下一張」要停下來');
    assert.equal(trayFull(max), true);
  });
});
