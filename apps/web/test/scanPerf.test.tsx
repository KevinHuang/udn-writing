/**
 * 掃描偵測的耗時統計（lib/scan/perf.ts）。
 *
 * 這支統計是後續所有效能改動的唯一證據來源 —— 它自己算錯的話，
 * 「改完有沒有比較快」就整個沒有意義了。特別釘住兩件容易寫錯的事：
 * 用中位數而不是平均（手機的 GC 尖峰會把平均整個帶走），
 * 以及 fps 要從真實時間算，不是拿 1000 除以單幀耗時。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FrameTimings, percentile, formatSummary } from '../lib/scan/perf';

const frame = (total: number, at: number, extra: Partial<{ full: boolean; hit: boolean }> = {}) => ({
  draw: total * 0.2,
  read: total * 0.3,
  detect: total * 0.4,
  overlay: total * 0.1,
  total,
  full: extra.full ?? false,
  hit: extra.hit ?? true,
  at,
});

describe('percentile', () => {
  test('沒有樣本回 0，不是 NaN', () => {
    assert.equal(percentile([], 50), 0);
  });

  test('用最接近的排名，不內插', () => {
    assert.equal(percentile([10, 20, 30, 40], 50), 20);
    assert.equal(percentile([10, 20, 30, 40], 95), 40);
    assert.equal(percentile([5], 50), 5);
  });

  test('不會改到傳進來的陣列（呼叫端還要繼續用）', () => {
    const src = [30, 10, 20];
    percentile(src, 50);
    assert.deepEqual(src, [30, 10, 20]);
  });
});

describe('FrameTimings', () => {
  test('超過容量就丟掉最舊的 —— 每秒寫九次，不能無限成長', () => {
    const t = new FrameTimings(3);
    for (let i = 0; i < 5; i++) t.push(frame(10, i * 100));
    assert.equal(t.size, 3);
  });

  test('中位數不會被單一尖峰帶走（這就是不用平均的理由）', () => {
    const t = new FrameTimings(10);
    [20, 20, 20, 20, 900].forEach((ms, i) => t.push(frame(ms, i * 110)));
    const s = t.summary();
    assert.equal(s.p50.total, 20); // 平均會是 196
    assert.equal(s.totalP95, 900); // 尖峰還是看得到，只是分開看
  });

  test('fps 由第一幀到最後一幀的真實時間算出來', () => {
    const t = new FrameTimings(30);
    // 每 100ms 一幀，共 11 幀 → 1000ms 內有 10 個間隔 → 10 fps
    for (let i = 0; i < 11; i++) t.push(frame(35, i * 100));
    assert.equal(Math.round(t.summary().fps), 10);
  });

  test('只有一幀時 fps 回 0，不是 Infinity', () => {
    const t = new FrameTimings(30);
    t.push(frame(35, 0));
    assert.equal(t.summary().fps, 0);
  });

  test('完整偵測與框到的比例', () => {
    const t = new FrameTimings(10);
    t.push(frame(30, 0, { full: true, hit: false }));
    t.push(frame(30, 110, { full: true, hit: false }));
    t.push(frame(30, 220, { full: false, hit: true }));
    t.push(frame(30, 330, { full: false, hit: true }));
    const s = t.summary();
    assert.equal(s.fullRatio, 0.5);
    assert.equal(s.hitRatio, 0.5);
  });

  test('清空之後重新統計（換鏡頭、重開相機時要歸零）', () => {
    const t = new FrameTimings(10);
    t.push(frame(999, 0));
    t.clear();
    assert.equal(t.size, 0);
    assert.equal(t.summary().frames, 0);
    assert.equal(t.summary().p50.total, 0);
  });
});

describe('formatSummary', () => {
  test('數字都帶單位，缺的欄位不會印出 undefined', () => {
    const t = new FrameTimings(10);
    for (let i = 0; i < 5; i++) t.push(frame(40, i * 100));
    const text = formatSummary(t.summary(), { stream: '1440×1080@30' });
    assert.match(text, /1440×1080@30/);
    assert.match(text, /p50 40ms/);
    assert.doesNotMatch(text, /undefined|NaN/);
  });
});
