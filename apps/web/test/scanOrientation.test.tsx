/**
 * 掃描畫面怎麼擺（lib/scan/orientation.ts）。
 *
 * 只看瀏覽器實際的寬高，不猜手機怎麼拿 —— 校園版猜過，照片被存成轉 90°，已撤回。
 * 這裡釘住兩條界線：正方形算橫的（電腦視窗常常接近正方形，快門放右邊也不會擋到）、
 * 結果頁的左右排只給「又寬又矮」的手機橫拿畫面，電腦與平板維持原本的上下排。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isCompactLandscape, scanViewMode } from '../lib/scan/orientation';

describe('scanViewMode', () => {
  test('手機直拿是直的', () => {
    assert.equal(scanViewMode(390, 844), 'portrait');
  });
  test('手機橫拿是橫的', () => {
    assert.equal(scanViewMode(844, 390), 'landscape');
  });
  test('正方形算橫的', () => {
    assert.equal(scanViewMode(800, 800), 'landscape');
  });
});

describe('isCompactLandscape', () => {
  test('手機橫拿（高度不到 600）是', () => {
    assert.equal(isCompactLandscape(844, 390), true);
    assert.equal(isCompactLandscape(932, 430), true);
  });
  test('電腦與平板橫放不是', () => {
    assert.equal(isCompactLandscape(1440, 900), false);
    assert.equal(isCompactLandscape(1024, 768), false);
  });
  test('直的畫面不是，再矮也不是', () => {
    assert.equal(isCompactLandscape(390, 844), false);
    assert.equal(isCompactLandscape(300, 500), false);
  });
});
