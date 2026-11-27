/**
 * 掃描開不起來時退回手機相機（lib/scan/fallback.ts）。
 *
 * 釘的是「什麼時候**不要**出現」：掃描是好的、或只是還在載入時就跳出備用按鈕，
 * 大家都會去按那顆比較快的，掃描（拉正、去陰影）就等於沒有了。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { scanFallbackHint, scanFallbackOf } from '../lib/scan/fallback';

const ok = { insecure: false, cvState: 'ready' as const, cameraError: null };

describe('scanFallbackOf', () => {
  test('掃描是好的 → 不給備用的路', () => {
    assert.equal(scanFallbackOf(ok), null);
  });

  test('⚠️ 影像處理工具還在載入 → 不算壞', () => {
    assert.equal(scanFallbackOf({ ...ok, cvState: 'loading' }), null);
  });

  test('相機開不起來、影像處理是好的 → 給，而且拍完還能拉正', () => {
    const f = scanFallbackOf({ ...ok, cameraError: '沒有相機權限' });
    assert.equal(f?.canRectify, true);
    assert.match(f!.reason, /沒有相機權限/);
  });

  test('相機開不起來的當下影像處理還在載入 → 給，但先當作不能拉正', () => {
    assert.equal(scanFallbackOf({ ...ok, cvState: 'loading', cameraError: '找不到鏡頭' })?.canRectify, false);
  });

  test('不是安全連線 → 給', () => {
    assert.equal(scanFallbackOf({ ...ok, insecure: true })?.canRectify, true);
  });

  test('影像處理工具壞了 → 給，照片照原樣收；不管相機有沒有別的問題', () => {
    for (const extra of [{}, { insecure: true }, { cameraError: 'x' }]) {
      const f = scanFallbackOf({ ...ok, cvState: 'error', ...extra });
      assert.equal(f?.canRectify, false);
      assert.match(f!.reason, /不能自動拉正/);
    }
  });

  test('說明照實寫：能拉正和不能拉正是兩句話', () => {
    assert.match(scanFallbackHint({ reason: '', canRectify: true }), /自動框出稿紙、拉正/);
    assert.match(scanFallbackHint({ reason: '', canRectify: false }), /照原樣收下/);
  });
});
