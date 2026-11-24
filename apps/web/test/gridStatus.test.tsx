/**
 * 稿紙逐格辨識在代繳交視窗、批改清單上的狀態（lib/proxy/status.ts、lib/proxy/queue.ts）。
 *
 * 逐格辨識的狀態是後端明確記下來的（handwriting_grid_result），不像 ocr-job 要從 ocr_time 推。
 * 這裡釘住：對應成畫面上的五種狀態、卡住太久當失敗（和後端 15 分鐘一致）、失敗原因給老師看，
 * 以及「伺服器說要重拍」和「網路斷了沒傳上去」分得開（前者重傳沒用）。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { failureReasonOf, GRID_STALE_MS, proxyOcrStatusOf, type ProxyStatusRow } from '../lib/proxy/status';
import { enqueue, markFailed } from '../lib/proxy/queue';

const T0 = Date.parse('2026-11-20T08:00:00Z');
const row = (patch: Partial<ProxyStatusRow>): ProxyStatusRow => ({
  userId: '1', batchId: '10', submissionId: null,
  createdAt: '2026-11-20T07:50:00Z', lastUpdate: '2026-11-20T07:50:00Z',
  ocrTime: null, hasContent: false, imgFiles: ['a.jpg'],
  ...patch,
});

describe('逐格辨識的狀態對應', () => {
  test('pending → 待辨識；queued、running → 辨識中；done → 完成；failed → 失敗', () => {
    assert.equal(proxyOcrStatusOf(row({ gridStatus: 'pending' }), { nowMs: T0 }), 'queued');
    assert.equal(proxyOcrStatusOf(row({ gridStatus: 'queued' }), { nowMs: T0 }), 'running');
    assert.equal(proxyOcrStatusOf(row({ gridStatus: 'running', gridStartedAt: new Date(T0 - 60_000).toISOString() }), { nowMs: T0 }), 'running');
    assert.equal(proxyOcrStatusOf(row({ gridStatus: 'done', ocrTime: '2026-11-20T07:59:00Z', hasContent: true }), { nowMs: T0 }), 'done');
    assert.equal(proxyOcrStatusOf(row({ gridStatus: 'failed' }), { nowMs: T0 }), 'failed');
  });

  test('不用 ocr-job 那套逾時：pending 放多久都還是「待辨識」', () => {
    const r = row({ gridStatus: 'pending', lastUpdate: '2026-11-20T06:00:00Z' });
    assert.equal(proxyOcrStatusOf(r, { nowMs: T0 }), 'queued');
  });

  test('辨識中卡住超過 15 分鐘 → 失敗，並說明原因', () => {
    const started = new Date(T0 - GRID_STALE_MS - 1000).toISOString();
    const r = row({ gridStatus: 'running', gridStartedAt: started });
    assert.equal(GRID_STALE_MS, 15 * 60 * 1000, '要和後端 STALE_RUNNING_MINUTES 一致');
    assert.equal(proxyOcrStatusOf(r, { nowMs: T0 }), 'failed');
    assert.match(failureReasonOf(r, T0) ?? '', /太久/);
  });

  /*
    queued 卡住：job 啟動了卻在領取（claim）之前就掛掉 —— started_at 永遠是空的。
    以前這一格只對應成「辨識中」，而逾時只看 running，於是那一列永遠轉圈，
    而「重試」只出現在失敗的人身上，老師沒有任何辦法讓它動。
  */
  test('送出去卻一直沒被領取（queued 卡住超過 15 分鐘）→ 失敗', () => {
    const r = row({ gridStatus: 'queued', gridUpdatedAt: new Date(T0 - GRID_STALE_MS - 1000).toISOString() });
    assert.equal(proxyOcrStatusOf(r, { nowMs: T0 }), 'failed');
    assert.match(failureReasonOf(r, T0) ?? '', /一直沒有開始/);
  });

  test('queued 還沒超過 15 分鐘 → 還是「辨識中」，不要嚇老師', () => {
    const r = row({ gridStatus: 'queued', gridUpdatedAt: new Date(T0 - 60_000).toISOString() });
    assert.equal(proxyOcrStatusOf(r, { nowMs: T0 }), 'running');
    assert.equal(failureReasonOf(r, T0), null);
  });

  test('舊資料沒有 gridUpdatedAt → 不當成卡住（維持現況）', () => {
    assert.equal(proxyOcrStatusOf(row({ gridStatus: 'queued' }), { nowMs: T0 }), 'running');
  });

  test('卡住的兩種原因分得開：領到了沒跑完 vs 根本沒領到', () => {
    const stuckRunning = row({ gridStatus: 'running', gridStartedAt: new Date(T0 - GRID_STALE_MS - 1).toISOString() });
    const stuckQueued = row({ gridStatus: 'queued', gridUpdatedAt: new Date(T0 - GRID_STALE_MS - 1).toISOString() });
    assert.match(failureReasonOf(stuckRunning, T0) ?? '', /太久沒有完成/);
    assert.match(failureReasonOf(stuckQueued, T0) ?? '', /一直沒有開始/);
  });

  test('失敗原因：逐格辨識有，ocr-job 沒有', () => {
    assert.equal(failureReasonOf(row({ gridStatus: 'failed', gridError: '右上角定位標記看不清楚，請重拍' }), T0),
      '右上角定位標記看不清楚，請重拍');
    assert.equal(failureReasonOf(row({ ocrTime: '2026-11-20T07:59:00Z', hasContent: false }), T0), null);
  });

  test('沒有 gridStatus 的照舊從 ocr_time 推（一般照片走 ocr-job）', () => {
    assert.equal(proxyOcrStatusOf(row({ ocrTime: '2026-11-20T07:59:00Z', hasContent: true }), { nowMs: T0 }), 'done');
  });
});

describe('上傳佇列：要重拍 vs 沒傳上去', () => {
  test('伺服器說要重拍 → retake；網路失敗 → 不是', () => {
    let q = enqueue([], { id: 'j1', studentId: '1', pageCount: 2 });
    q = markFailed(q, 'j1', '右上角定位標記看不清楚，請重拍', true);
    assert.equal(q[0].retake, true);
    q = enqueue([], { id: 'j2', studentId: '2', pageCount: 1 });
    q = markFailed(q, 'j2', '網路或伺服器錯誤');
    assert.equal(q[0].retake, false);
  });

  test('重拍之後新的工作取代舊的失敗', () => {
    let q = markFailed(enqueue([], { id: 'j1', studentId: '1', pageCount: 2 }), 'j1', '請重拍', true);
    q = enqueue(q, { id: 'j2', studentId: '1', pageCount: 2 });
    assert.deepEqual(q.map((j) => [j.id, j.state]), [['j2', 'pending']]);
  });
});
