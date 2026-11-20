/**
 * 掃描的方向與對齊框（lib/scan/geometry.ts）。
 *
 * 釘住的是「照拍到的方向存」：以前 warpDocument 一律把長邊擺水平，
 * 直式稿紙拍完就躺著。這裡的錯不會當掉，只會讓每一張直式稿紙安靜地轉 90°。
 * 也釘住橫的紙算出來的尺寸和以前一模一樣——橫式稿紙的裁切與辨識輸入不能被這次改動影響。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { guideRect, topLabelPosition, videoRect, warpTargetSize } from '../lib/scan/geometry';
import { SCAN_CONFIG } from '../lib/scan/config';

/** 舊版 warpDocument 的尺寸算法（只處理已經轉成橫的寬高），拿來對照橫的紙不變 */
function legacyLandscapeSize(width: number, height: number) {
  let ratio = width / height;
  if (Math.abs(ratio - SCAN_CONFIG.paperRatio) / SCAN_CONFIG.paperRatio < SCAN_CONFIG.snapTolerance) {
    ratio = SCAN_CONFIG.paperRatio;
  }
  const W = Math.round(Math.min(Math.max(width * 1.2, 1000), SCAN_CONFIG.outputLongSide));
  return { width: W, height: Math.round(W / ratio) };
}

describe('warpTargetSize', () => {
  test('直的紙輸出直的（不再轉成橫的）', () => {
    const s = warpTargetSize(1400, 2000);
    assert.ok(s.height > s.width, `應該是直的，得到 ${s.width}×${s.height}`);
  });

  test('橫的紙輸出橫的', () => {
    const s = warpTargetSize(2000, 1400);
    assert.ok(s.width > s.height);
  });

  test('橫的紙的尺寸和舊版完全相同', () => {
    for (const [w, h] of [[2000, 1414], [2600, 1500], [900, 640], [3400, 2400], [2200, 2100]]) {
      assert.deepEqual(warpTargetSize(w, h), legacyLandscapeSize(w, h), `${w}×${h}`);
    }
  });

  test('直的紙就是橫的紙的寬高對調', () => {
    for (const [w, h] of [[2000, 1414], [2600, 1500], [900, 640]]) {
      const land = warpTargetSize(w, h);
      const port = warpTargetSize(h, w);
      assert.deepEqual(port, { width: land.height, height: land.width });
    }
  });

  test('比例接近 A3／B4 就吸到標準比例', () => {
    const s = warpTargetSize(1380, 2000);
    assert.equal(s.height, 2400);
    assert.equal(s.width, Math.round(2400 / SCAN_CONFIG.paperRatio));
  });

  test('長邊夾在 1000 與 outputLongSide 之間', () => {
    assert.equal(Math.max(...Object.values(warpTargetSize(300, 420))), 1000);
    assert.equal(
      Math.max(...Object.values(warpTargetSize(5000, 7000))),
      SCAN_CONFIG.outputLongSide,
    );
  });

  test('正方形當橫的處理，不會除以零', () => {
    const s = warpTargetSize(1000, 1000);
    assert.ok(s.width >= s.height);
    assert.ok(Number.isFinite(warpTargetSize(1000, 0).height));
  });
});

describe('videoRect', () => {
  test('直拿：3:4 的相機影像完整縮進快門以上的區域，左右不裁', () => {
    const r = videoRect(3000, 4000, 390, 844, 100);
    assert.equal(r.w, 390);
    assert.equal(r.h, 520);
    assert.equal(r.x, 0);
    assert.equal(r.y, (744 - 520) / 2);
  });

  test('橫拿：4:3 的相機影像縮進右側控制欄以外的區域，上下不裁', () => {
    const r = videoRect(4000, 3000, 844, 390, 120);
    assert.equal(r.h, 390);
    assert.equal(r.w, 520);
    assert.ok(r.x + r.w <= 844 - 120);
  });

  test('相機還沒給尺寸時就用整個可用區域', () => {
    assert.deepEqual(videoRect(0, 0, 390, 844, 100), { x: 0, y: 0, w: 390, h: 744 });
  });
});

describe('guideRect', () => {
  const frame = { x: 0, y: 112, w: 390, h: 520 };

  test('橫式稿紙：手機直拿也給橫框', () => {
    const g = guideRect(frame, 'landscape');
    assert.ok(g.w > g.h);
    assert.ok(Math.abs(g.w - 390 * SCAN_CONFIG.guideFill) < 1e-9);
  });

  test('直式稿紙：給直框', () => {
    const g = guideRect(frame, 'portrait');
    assert.ok(g.h > g.w);
  });

  test('框在相機影像裡面、置中、是 A3 比例', () => {
    for (const paper of ['landscape', 'portrait'] as const) {
      const g = guideRect(frame, paper);
      assert.ok(g.x >= frame.x && g.x + g.w <= frame.x + frame.w + 1e-9);
      assert.ok(g.y >= frame.y && g.y + g.h <= frame.y + frame.h + 1e-9);
      assert.ok(Math.abs(g.x - frame.x - (frame.w - g.w) / 2) < 1e-9);
      const ratio = Math.max(g.w, g.h) / Math.min(g.w, g.h);
      assert.ok(Math.abs(ratio - SCAN_CONFIG.paperRatio) < 1e-9);
    }
  });

  /*
    最重要的一條：使用者把稿紙對準框，就要過得了自動拍照的門檻
    （紙至少佔相機畫面 minCaptureAreaRatio、四角離邊緣 frameMarginRatio）。
    以前框和門檻各算各的，iPhone 直拿時稿紙對準框只佔相機畫面一成多，永遠「請靠近一點」。
  */
  const sensors = [
    { name: '手機直拿（3:4）', vw: 3000, vh: 4000, cw: 390, ch: 844, reserve: 100 },
    { name: '手機橫拿（4:3）', vw: 4000, vh: 3000, cw: 844, ch: 390, reserve: 120 },
  ];
  for (const sensor of sensors) {
    for (const paper of ['landscape', 'portrait'] as const) {
      for (const scale of [1, 0.85]) {
        test(`${sensor.name}、${paper === 'landscape' ? '橫式' : '直式'}稿紙、稿紙是框的 ${scale * 100}%：過得了自動拍照的門檻`, () => {
          const f = videoRect(sensor.vw, sensor.vh, sensor.cw, sensor.ch, sensor.reserve);
          const g = guideRect(f, paper);
          // 畫面座標 → 相機影像座標
          const s = sensor.vw / f.w;
          const pw = g.w * s * scale;
          const ph = g.h * s * scale;
          const left = (g.x - f.x) * s + (g.w * s - pw) / 2;
          const top = (g.y - f.y) * s + (g.h * s - ph) / 2;
          const area = (pw * ph) / (sensor.vw * sensor.vh);
          assert.ok(area >= SCAN_CONFIG.minCaptureAreaRatio, `只佔 ${(area * 100).toFixed(1)}%`);
          const margin = Math.min(sensor.vw, sensor.vh) * SCAN_CONFIG.frameMarginRatio;
          assert.ok(left >= margin && top >= margin, '四角太靠近相機邊緣');
          assert.ok(left + pw <= sensor.vw - margin && top + ph <= sensor.vh - margin, '四角太靠近相機邊緣');
        });
      }
    }
  }
});

describe('topLabelPosition', () => {
  const label = { w: 60, h: 20 };

  test('框上面有空間就放在框外、水平置中', () => {
    const pos = topLabelPosition({ x: 20, y: 100, w: 300, h: 400 }, label);
    assert.equal(pos.inside, false);
    assert.equal(pos.y + label.h, 100 - 4);
    assert.equal(pos.x, 20 + (300 - 60) / 2);
  });

  test('框貼著畫面頂端時改放框內左上角', () => {
    const pos = topLabelPosition({ x: 20, y: 10, w: 300, h: 400 }, label);
    assert.equal(pos.inside, true);
    assert.ok(pos.y >= 10);
  });

  test('框上面的空間被頂端狀態列佔住時也放框內（不被「請靠近一點」蓋住）', () => {
    // 框上緣在 60px：沒有 minTop 時小標會放在 36~56，正好在 72px 高的狀態列裡
    const g = { x: 20, y: 60, w: 300, h: 400 };
    assert.equal(topLabelPosition(g, label).inside, false);
    const pos = topLabelPosition(g, label, 4, 72);
    assert.equal(pos.inside, true);
    assert.ok(pos.y >= 60);
  });
});
