/**
 * 拍照時的全螢幕（lib/scan/fullscreen.ts）。
 *
 * 釘住的是「什麼時候不要動使用者的畫面」：電腦不進、iPhone 不支援就不進、
 * 本來就在全螢幕的不算我們進的（之後也不該替使用者退掉），被瀏覽器拒絕也不能讓拍照壞掉。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { enterScanFullscreen, exitScanFullscreen, type FullscreenDoc } from '../lib/scan/fullscreen';

function fakeDoc(opts: { supported?: boolean; reject?: boolean; already?: boolean } = {}) {
  const calls = { request: 0, exit: 0, options: undefined as FullscreenOptions | undefined };
  const doc: FullscreenDoc = {
    fullscreenElement: opts.already ? ({} as Element) : null,
    documentElement: {},
    exitFullscreen: async () => {
      calls.exit++;
      doc.fullscreenElement = null;
    },
  };
  if (opts.supported !== false) {
    doc.documentElement.requestFullscreen = async (options) => {
      calls.request++;
      calls.options = options;
      if (opts.reject) throw new Error('denied');
      doc.fullscreenElement = {} as Element;
    };
  }
  return { doc, calls };
}

describe('enterScanFullscreen', () => {
  test('觸控裝置、支援、沒在全螢幕 → 進入並回 true，連系統導覽列一起收', async () => {
    const { doc, calls } = fakeDoc();
    assert.equal(await enterScanFullscreen(doc, true), true);
    assert.equal(calls.request, 1);
    assert.deepEqual(calls.options, { navigationUI: 'hide' });
  });

  test('電腦（非觸控）不進', async () => {
    const { doc, calls } = fakeDoc();
    assert.equal(await enterScanFullscreen(doc, false), false);
    assert.equal(calls.request, 0);
  });

  test('不支援（iPhone Safari）不進、不丟錯', async () => {
    const { doc } = fakeDoc({ supported: false });
    assert.equal(await enterScanFullscreen(doc, true), false);
  });

  test('本來就在全螢幕不算我們進的', async () => {
    const { doc, calls } = fakeDoc({ already: true });
    assert.equal(await enterScanFullscreen(doc, true), false);
    assert.equal(calls.request, 0);
  });

  test('瀏覽器拒絕時回 false、不丟錯', async () => {
    const { doc } = fakeDoc({ reject: true });
    assert.equal(await enterScanFullscreen(doc, true), false);
  });
});

describe('exitScanFullscreen', () => {
  test('在全螢幕就退出', async () => {
    const { doc, calls } = fakeDoc();
    await enterScanFullscreen(doc, true);
    exitScanFullscreen(doc);
    assert.equal(calls.exit, 1);
  });

  test('已經不在全螢幕（使用者按了返回鍵）就不動', () => {
    const { doc, calls } = fakeDoc();
    exitScanFullscreen(doc);
    assert.equal(calls.exit, 0);
  });
});
