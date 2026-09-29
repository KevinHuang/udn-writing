/**
 * 代繳交的上傳佇列（lib/proxy/queue.ts）。
 *
 * 老師是連續在拍的 —— 前一位還在傳，下一位就交進來了。
 * 這裡釘的是：同時傳幾位、重拍要換掉哪一個、失敗之後的顏色跟著誰走。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  enqueue,
  nextPending,
  markUploading,
  markFailed,
  markDone,
  requeue,
  uploadStateOf,
  hasUnsentPhotos,
  UPLOAD_CONCURRENCY,
  type UploadJob,
} from '../lib/proxy/queue';

const job = (id: string, studentId: string, pageCount = 2) => ({ id, studentId, pageCount });

describe('enqueue', () => {
  test('新的工作排在最後、狀態是待傳', () => {
    const q = enqueue(enqueue([], job('1', 'a')), job('2', 'b'));
    assert.deepEqual(q.map((j) => [j.id, j.state]), [['1', 'pending'], ['2', 'pending']]);
  });

  test('同一位學生重拍：還沒傳的舊工作被換掉', () => {
    const q = enqueue(enqueue([], job('1', 'a')), job('2', 'a', 3));
    assert.deepEqual(q.map((j) => j.id), ['2']);
    assert.equal(q[0].pageCount, 3);
  });

  test('同一位學生重拍：傳失敗的舊工作也換掉（不然他會一直是紅的）', () => {
    let q = enqueue([], job('1', 'a'));
    q = markFailed(markUploading(q, '1'), '1', 'network');
    q = enqueue(q, job('2', 'a'));
    assert.deepEqual(q.map((j) => j.id), ['2']);
  });

  test('⚠️ 同一位學生重拍：**正在傳**的舊工作留著讓它傳完', () => {
    let q = enqueue([], job('1', 'a'));
    q = markUploading(q, '1');
    q = enqueue(q, job('2', 'a'));
    // 中途砍掉會留下半套檔案；讓它傳完，伺服器會用新的那一批把它退役
    assert.deepEqual(q.map((j) => [j.id, j.state]), [['1', 'uploading'], ['2', 'pending']]);
  });
});

describe('nextPending', () => {
  test(`同時最多傳 ${UPLOAD_CONCURRENCY} 位`, () => {
    let q: UploadJob[] = [];
    for (const id of ['1', '2', '3']) q = enqueue(q, job(id, 's' + id));
    q = markUploading(q, nextPending(q)!.id);
    q = markUploading(q, nextPending(q)!.id);
    assert.equal(nextPending(q), undefined, '兩條都在用，第三位要等');

    q = markDone(q, '1');
    assert.equal(nextPending(q)?.id, '3');
  });

  test('依交進來的順序傳', () => {
    const q = enqueue(enqueue([], job('1', 'a')), job('2', 'b'));
    assert.equal(nextPending(q)?.id, '1');
  });
});

describe('失敗與重傳', () => {
  test('失敗會記次數與原因，重傳會清掉原因', () => {
    let q = markUploading(enqueue([], job('1', 'a')), '1');
    q = markFailed(q, '1', '網路中斷');
    assert.equal(q[0].attempts, 1);
    assert.equal(q[0].error, '網路中斷');

    q = requeue(q, '1');
    assert.equal(q[0].state, 'pending');
    assert.equal(q[0].error, undefined);
    assert.equal(q[0].attempts, 1, '次數留著');
  });

  test('失敗的工作不會被 nextPending 自己撿回去（要老師按重傳）', () => {
    const q = markFailed(markUploading(enqueue([], job('1', 'a')), '1'), '1', 'x');
    assert.equal(nextPending(q), undefined);
  });
});

describe('uploadStateOf', () => {
  test('沒有工作 → undefined（交給伺服器的狀態）', () => {
    assert.equal(uploadStateOf([], 'a'), undefined);
  });

  test('待傳與傳送中在老師眼裡都是「上傳中」', () => {
    const q = enqueue([], job('1', 'a'));
    assert.equal(uploadStateOf(q, 'a'), 'uploading');
    assert.equal(uploadStateOf(markUploading(q, '1'), 'a'), 'uploading');
  });

  test('失敗 → 上傳失敗', () => {
    const q = markFailed(markUploading(enqueue([], job('1', 'a')), '1'), '1', 'x');
    assert.equal(uploadStateOf(q, 'a'), 'upload_failed');
  });

  test('傳好就移出佇列，狀態回到伺服器為準', () => {
    const q = markDone(markUploading(enqueue([], job('1', 'a')), '1'), '1');
    assert.equal(uploadStateOf(q, 'a'), undefined);
    assert.equal(hasUnsentPhotos(q), false);
  });
});
