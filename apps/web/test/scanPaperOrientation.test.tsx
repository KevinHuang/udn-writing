/**
 * 拍照畫面記住的稿紙方向（lib/scan/paperOrientation.ts）。
 *
 * 只是對齊框的形狀，所以重點是「壞掉時安靜地用預設的橫式」：
 * 沒存過、存了奇怪的值、無痕模式讀寫都丟錯，拍照都不能因此壞掉。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PAPER_ORIENTATION,
  PAPER_ORIENTATION_KEY,
  readPaperOrientation,
  savePaperOrientation,
} from '../lib/scan/paperOrientation';

const memory = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    map: m,
  };
};

const broken = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

describe('稿紙方向的記憶', () => {
  test('預設是橫式（聯合報、會考、學測的稿紙都是橫的）', () => {
    assert.equal(DEFAULT_PAPER_ORIENTATION, 'landscape');
    assert.equal(readPaperOrientation(memory()), 'landscape');
  });

  test('存了直式，下次讀到直式', () => {
    const s = memory();
    savePaperOrientation('portrait', s);
    assert.equal(s.map.get(PAPER_ORIENTATION_KEY), 'portrait');
    assert.equal(readPaperOrientation(s), 'portrait');
  });

  test('奇怪的值當沒存過', () => {
    const s = memory();
    s.setItem(PAPER_ORIENTATION_KEY, 'diagonal');
    assert.equal(readPaperOrientation(s), 'landscape');
  });

  test('讀寫都丟錯（無痕模式）時用預設值、不丟錯', () => {
    assert.equal(readPaperOrientation(broken), 'landscape');
    assert.doesNotThrow(() => savePaperOrientation('portrait', broken));
    assert.equal(readPaperOrientation(null), 'landscape');
  });
});
