/**
 * 繳交摘要與完整內容的合併（lib/submissionMerge.ts）。
 *
 * 2026-11-23 的問題：摘要（沒有作文與評語）比完整內容晚到時整份換掉，批改頁的作文與評語變成空白，
 * 老師這時存檔會把 AI 的評語蓋成空白。這裡釘住「晚到的摘要不能抹掉已經有的內容」，
 * 也釘住反方向：換了一版批改之後，舊評語不能留下來配新分數。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSubmissionSummary } from '../lib/submissionMerge';
import type { Submission } from '../types';

const summaryRow = (patch: Partial<Submission> = {}): Submission => ({
  id: '2666',
  assignmentId: '183',
  studentId: '1680',
  studentName: '王小明',
  content: '',
  submittedAt: '2026-11-23T05:00:00.000Z',
  status: 'Graded',
  feedbackId: '3726',
  result: { totalScore: 4, feedback: '', isAi: true, isPublished: false },
  ...patch,
});
/** 完整內容那支 API 來的同一筆 */
const fullRow = (patch: Partial<Submission> = {}): Submission => summaryRow({
  content: '小時候，我家養了一隻名叫阿福的小狗。',
  picFiles: ['submit/assign_183/p1.jpg'],
  detailed: true,
  result: { totalScore: 4, feedback: '你從阿福生病的故事出發……', isAi: true, isPublished: false },
  ...patch,
});

describe('mergeSubmissionSummary', () => {
  test('手上沒有任何完整內容：就是摘要', () => {
    const summary = [summaryRow()];
    assert.equal(mergeSubmissionSummary([], summary), summary);
    assert.equal(mergeSubmissionSummary([summaryRow()], summary), summary);
  });

  test('晚到的摘要不抹掉作文、原稿照片與評語（同一版批改）', () => {
    const [merged] = mergeSubmissionSummary([fullRow()], [summaryRow()]);
    assert.equal(merged.content, '小時候，我家養了一隻名叫阿福的小狗。');
    assert.deepEqual(merged.picFiles, ['submit/assign_183/p1.jpg']);
    assert.equal(merged.result?.feedback, '你從阿福生病的故事出發……');
    assert.equal(merged.detailed, true);
  });

  test('狀態與分數以摘要為準', () => {
    const [merged] = mergeSubmissionSummary(
      [fullRow()],
      [summaryRow({ status: 'Published', result: { totalScore: 4, feedback: '', isAi: true, isPublished: true } })],
    );
    assert.equal(merged.status, 'Published');
    assert.equal(merged.result?.isPublished, true);
    // 發還不會換一版批改，評語留著
    assert.equal(merged.result?.feedback, '你從阿福生病的故事出發……');
  });

  test('換了一版批改（重新評分、老師存檔）：舊評語不留，作文留著', () => {
    const [merged] = mergeSubmissionSummary(
      [fullRow({ feedbackId: '3725', result: { totalScore: 5, feedback: '舊的評語', isAi: true, isPublished: false } })],
      [summaryRow({ feedbackId: '3726' })],
    );
    assert.equal(merged.result?.totalScore, 4);
    assert.equal(merged.result?.feedback, '');
    assert.equal(merged.content, '小時候，我家養了一隻名叫阿福的小狗。');
  });

  test('批改被重置：沒有批改結果，作文留著', () => {
    const [merged] = mergeSubmissionSummary(
      [fullRow()],
      [summaryRow({ status: 'Pending', feedbackId: undefined, result: undefined })],
    );
    assert.equal(merged.result, undefined);
    assert.equal(merged.status, 'Pending');
    assert.equal(merged.content, '小時候，我家養了一隻名叫阿福的小狗。');
  });

  test('摘要裡沒有的繳交（被清除）不留；別份作業只有摘要的照舊', () => {
    const other = summaryRow({ id: '9001', assignmentId: '200', studentName: '別班的學生' });
    const merged = mergeSubmissionSummary([fullRow(), fullRow({ id: '2667', studentName: '已被清除' })], [summaryRow(), other]);
    assert.deepEqual(merged.map((s) => s.id), ['2666', '9001']);
    assert.equal(merged[1], other);
  });
});
