/**
 * 批次代繳交的狀態推導、輪詢節奏與原稿路徑（lib/proxy/）。
 *
 * 背景辨識是黑箱（ocr-job 的原始碼不在這個 repo），我們只看得到它留下的
 * 時間戳與文字 —— 所以「現在是什麼狀態」全靠推導，推錯了畫面不會壞，
 * 只會安靜地叫老師去重試一個還在跑的工作，或把失敗的說成完成。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  proxyOcrStatusOf,
  wasTriggered,
  countStatuses,
  proxyBatchSummary,
  retryTargets,
  startTargets,
  OCR_TIMEOUT_MS,
  type ProxyStatusRow,
} from '../lib/proxy/status';
import { pollDelayMs, shouldKeepPolling, POLL_MAX_MS } from '../lib/proxy/poll';
import { proxyImagePath, originalsFor } from '../lib/proxy/paths';

const T0 = Date.parse('2026-09-29T08:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const MIN = 60 * 1000;

/** 剛收好照片、還沒按開始：created_at 與 last_update 是同一個 now() */
const row = (patch: Partial<ProxyStatusRow> = {}): ProxyStatusRow => ({
  userId: '345',
  batchId: '88',
  submissionId: null,
  createdAt: iso(T0),
  lastUpdate: iso(T0),
  ocrTime: null,
  hasContent: false,
  imgFiles: ['sub_12_345_0929-1600_a.jpg'],
  ...patch,
});

describe('wasTriggered', () => {
  test('剛收照片（兩個時間一樣）→ 還沒按開始', () => {
    assert.equal(wasTriggered(row()), false);
  });
  test('last_update 晚於 created_at → 按過開始了', () => {
    assert.equal(wasTriggered(row({ lastUpdate: iso(T0 + 20 * MIN) })), true);
  });
});

describe('proxyOcrStatusOf', () => {
  test('沒有批次列 → 未登錄', () => {
    assert.equal(proxyOcrStatusOf(undefined, { nowMs: T0 }), 'idle');
  });

  test('這台裝置正在傳 → 上傳中（優先於伺服器上的舊資料）', () => {
    const done = row({ ocrTime: iso(T0 + MIN), hasContent: true });
    assert.equal(proxyOcrStatusOf(done, { nowMs: T0, upload: 'uploading' }), 'uploading');
    assert.equal(proxyOcrStatusOf(undefined, { nowMs: T0, upload: 'upload_failed' }), 'upload_failed');
  });

  test('收好照片、沒按開始 → 待辨識（不管過了多久都不算逾時）', () => {
    assert.equal(proxyOcrStatusOf(row(), { nowMs: T0 + 3 * 60 * MIN }), 'queued');
  });

  test('按了開始、還在等 → 辨識中', () => {
    const r = row({ lastUpdate: iso(T0 + 20 * MIN) });
    assert.equal(proxyOcrStatusOf(r, { nowMs: T0 + 21 * MIN }), 'running');
  });

  test('⚠️ 拍完一整班才按開始：第一位的 created_at 早了二十分鐘，按下去那一瞬間**不可以**是失敗', () => {
    // 這一格就是「用 created_at 算逾時」那個 bug 的回歸測試
    const r = row({ createdAt: iso(T0), lastUpdate: iso(T0 + 20 * MIN) });
    assert.equal(proxyOcrStatusOf(r, { nowMs: T0 + 20 * MIN + 1000 }), 'running');
  });

  test('按了開始、超過逾時門檻還沒結果 → 失敗（可以重試）', () => {
    const r = row({ lastUpdate: iso(T0 + MIN) });
    assert.equal(proxyOcrStatusOf(r, { nowMs: T0 + MIN + OCR_TIMEOUT_MS }), 'failed');
    assert.equal(proxyOcrStatusOf(r, { nowMs: T0 + MIN + OCR_TIMEOUT_MS - 1 }), 'running');
  });

  test('逾時門檻可以注入', () => {
    const r = row({ lastUpdate: iso(T0 + MIN) });
    assert.equal(proxyOcrStatusOf(r, { nowMs: T0 + 3 * MIN, timeoutMs: MIN }), 'failed');
  });

  test('有 ocr_time 也真的有文字 → 完成', () => {
    const r = row({ lastUpdate: iso(T0 + MIN), ocrTime: iso(T0 + 3 * MIN), hasContent: true });
    assert.equal(proxyOcrStatusOf(r, { nowMs: T0 + 4 * MIN }), 'done');
  });

  test('⚠️ 有 ocr_time 但沒有文字 → 失敗（ocr_time 有值不等於成功）', () => {
    const r = row({ lastUpdate: iso(T0 + MIN), ocrTime: iso(T0 + 3 * MIN), hasContent: false });
    assert.equal(proxyOcrStatusOf(r, { nowMs: T0 + 4 * MIN }), 'failed');
  });

  test('沒按開始卻有結果（每小時的自動 OCR 撿走了）→ 照樣算完成', () => {
    const r = row({ ocrTime: iso(T0 + 60 * MIN), hasContent: true });
    assert.equal(proxyOcrStatusOf(r, { nowMs: T0 + 61 * MIN }), 'done');
  });
});

describe('proxyBatchSummary', () => {
  test('沒有人進流程 → null（整顆 pill 不顯示）', () => {
    assert.equal(proxyBatchSummary(countStatuses(['idle', 'idle'])), null);
  });

  test('未登錄的人不算進分母', () => {
    const text = proxyBatchSummary(countStatuses(['idle', 'idle', 'idle', 'running', 'done']));
    assert.equal(text, '代繳交 辨識中 1（共 2 位）');
  });

  test('辨識失敗與上傳失敗合在一起算「失敗」', () => {
    const text = proxyBatchSummary(countStatuses(['running', 'failed', 'upload_failed', 'done']));
    assert.equal(text, '代繳交 辨識中 1・失敗 2（共 4 位）');
  });

  test('全部完成 → 一句完成', () => {
    assert.equal(proxyBatchSummary(countStatuses(['done', 'done'])), '代繳交 2 位已辨識完成');
  });
});

describe('retryTargets / startTargets', () => {
  const entries = [
    { studentId: 'a', status: 'queued' as const },
    { studentId: 'b', status: 'failed' as const },
    { studentId: 'c', status: 'upload_failed' as const },
    { studentId: 'd', status: 'running' as const },
    { studentId: 'e', status: 'queued' as const },
  ];

  test('重試只挑辨識失敗的 —— 上傳失敗要重傳，不是重新辨識', () => {
    assert.deepEqual(retryTargets(entries), ['b']);
  });

  test('開始辨識只挑待辨識的 —— 辨識中的不重複送', () => {
    assert.deepEqual(startTargets(entries), ['a', 'e']);
  });
});

describe('輪詢', () => {
  test('一開始快、之後逐步放慢，有上限', () => {
    assert.equal(pollDelayMs(0), 3000);
    assert.equal(pollDelayMs(1), 5000);
    assert.equal(pollDelayMs(2), 10000);
    assert.equal(pollDelayMs(3), POLL_MAX_MS);
    assert.equal(pollDelayMs(50), POLL_MAX_MS);
  });

  test('只有「辨識中」才需要繼續問', () => {
    assert.equal(shouldKeepPolling(['done', 'failed', 'queued']), false);
    assert.equal(shouldKeepPolling(['done', 'running']), true);
  });
});

describe('原稿路徑', () => {
  test('裸檔名補上作業資料夾', () => {
    assert.equal(
      proxyImagePath('12', 'sub_12_345_0929-1600_a.jpg'),
      'submit/assign_12/sub_12_345_0929-1600_a.jpg',
    );
  });

  test('⚠️ 已經含路徑的不要重複補（不然會變成 submit/assign_12/submit/assign_12/…）', () => {
    assert.equal(proxyImagePath('12', 'submit/assign_12/x.jpg'), 'submit/assign_12/x.jpg');
    assert.equal(
      proxyImagePath('12', 'https://storage.googleapis.com/writing-classroom/x.jpg'),
      'https://storage.googleapis.com/writing-classroom/x.jpg',
    );
  });

  test('submission 自己有原稿就用它的', () => {
    assert.deepEqual(originalsFor('12', ['submit/assign_12/s.jpg'], ['b.jpg']), ['submit/assign_12/s.jpg']);
  });

  test('⚠️ submission 沒有原稿（黑箱沒寫回來）→ 退回批次的照片，不可以是空的', () => {
    assert.deepEqual(originalsFor('12', [], ['b.jpg']), ['submit/assign_12/b.jpg']);
    assert.deepEqual(originalsFor('12', undefined, undefined), []);
  });
});
