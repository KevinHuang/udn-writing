/**
 * 取景串流的解析度決策（lib/scan/preview.ts）。
 *
 * 這段算式管的是「Android 上即時對邊跟不跟得上手」與「存檔畫質會不會被犧牲」
 * 兩件事，而且兩種錯法都不會當掉、只會靜默地壞掉：
 *   - 長寬比沒對齊 → 拍完被丟去手動拖四角（救援路徑永遠不成立）
 *   - 不該壓的裝置壓了 → 稿紙從 12M 掉到 1.5M，辨識率崩掉
 * 所以這裡一條一條釘住。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { previewTargetSize, shouldApplyPreview } from '../lib/scan/preview';
import { SCAN_CONFIG } from '../lib/scan/config';

describe('previewTargetSize', () => {
  test('拍照管線可信：壓到 previewLongSide，而且照感光元件的長寬比', () => {
    // 4:3 的感光元件（4000×3000）→ 1440×1080，不是 1440×810
    const t = previewTargetSize(4000, 3000, true);
    assert.equal(t.width, SCAN_CONFIG.previewLongSide);
    assert.equal(t.height, 1080);
    assert.ok(Math.abs(t.width / t.height - 4000 / 3000) < 0.02, '長寬比要維持');
  });

  test('16:9 的感光元件也照它自己的比例，不會被硬掰成 4:3', () => {
    const t = previewTargetSize(3840, 2160, true);
    assert.equal(t.width, 1440);
    assert.equal(t.height, 810);
  });

  test('直式感光元件（長邊在高度）也算得對', () => {
    const t = previewTargetSize(1080, 1440, true);
    assert.equal(t.height, 1440);
    assert.equal(t.width, 1080);
  });

  test('感光元件比目標還小就照原樣 —— 不要插值放大', () => {
    const t = previewTargetSize(1280, 960, true);
    assert.equal(t.width, 1280);
    assert.equal(t.height, 960);
  });

  test('拍照管線不可信：串流就是成品畫質，維持最大', () => {
    const t = previewTargetSize(4000, 3000, false);
    assert.equal(t.width, 4000);
    assert.equal(t.height, 3000);
  });

  test('不可信時仍夾在 maxSourceLongSide —— 再大也會在拍照時被縮掉', () => {
    const t = previewTargetSize(8000, 6000, false);
    assert.equal(Math.max(t.width, t.height), SCAN_CONFIG.maxSourceLongSide);
    assert.ok(Math.abs(t.width / t.height - 8000 / 6000) < 0.02);
  });
});

describe('shouldApplyPreview', () => {
  const target = { width: 1440, height: 1080 };

  test('已經就是目標尺寸就不要再動 —— 有些機器切換時畫面會黑一下', () => {
    assert.equal(shouldApplyPreview({ width: 1440, height: 1080 }, target, true), false);
  });

  test('串流比目標大才要壓', () => {
    assert.equal(shouldApplyPreview({ width: 4000, height: 3000 }, target, true), true);
  });

  test('串流已經比目標小就放著 —— 壓成目標等於把它放大', () => {
    assert.equal(shouldApplyPreview({ width: 1280, height: 960 }, target, true), false);
  });

  test('不可信的裝置要往上拉回最大，所以比目標小也要套用', () => {
    assert.equal(shouldApplyPreview({ width: 1440, height: 1080 }, { width: 4000, height: 3000 }, false), true);
  });

  test('拿不到目前尺寸時照套（總比留在未知狀態好）', () => {
    assert.equal(shouldApplyPreview({}, target, true), true);
  });
});
