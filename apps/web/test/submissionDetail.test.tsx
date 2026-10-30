/**
 * 摘要換清單時把補過的作文接回去（lib/submissionDetail.ts）。
 *
 * 釘的是：直接開批改頁網址、摘要比完整那支晚回來時，作文與評語不能被蓋成空白；
 * 但狀態與分數要照摘要，剛重置的不能接回舊評語。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { Submission } from '@udn/shared';
import { rememberDetail, withDetail, type DetailCache } from '../lib/submissionDetail';

const CS = { content: 0, structure: 0, grammar: 0, vocabulary: 0 };

const sub = (over: Partial<Submission> = {}): Submission => ({
  id: '1',
  assignmentId: 'a',
  studentId: 's1',
  studentName: '王小明',
  content: '',
  submittedAt: '2026-10-30',
  status: 'Graded',
  result: { totalScore: 4, categoryScores: CS, feedback: '', isAi: true, isPublished: false },
  ...over,
} as Submission);

const fullOf = (over: Partial<Submission> = {}) =>
  sub({
    content: '我的童年是在一間小小的文具店裡度過的。',
    picFiles: ['p1.jpg'],
    result: { totalScore: 4, categoryScores: CS, feedback: '結構清楚。', isAi: true, isPublished: false },
    ...over,
  });

describe('withDetail', () => {
  test('沒補過完整的，摘要原封不動', () => {
    const summary = [sub()];
    assert.deepEqual(withDetail(summary, new Map()), summary);
  });

  test('補過完整的：摘要晚回來也留住作文、原稿與評語', () => {
    const cache: DetailCache = new Map();
    rememberDetail(cache, [fullOf()]);
    const [s] = withDetail([sub()], cache);
    assert.equal(s.content, '我的童年是在一間小小的文具店裡度過的。');
    assert.deepEqual(s.picFiles, ['p1.jpg']);
    assert.equal(s.result?.feedback, '結構清楚。');
  });

  test('狀態與分數照摘要（那是剛查的）', () => {
    const cache: DetailCache = new Map();
    rememberDetail(cache, [fullOf()]);
    const [s] = withDetail(
      [sub({ status: 'Published', result: { totalScore: 5, categoryScores: CS, feedback: '', isAi: false, isPublished: true } })],
      cache,
    );
    assert.equal(s.status, 'Published');
    assert.equal(s.result?.totalScore, 5);
    assert.equal(s.result?.isAi, false);
    assert.equal(s.result?.feedback, '結構清楚。');
  });

  test('摘要說沒有批改（剛重置），不接回舊評語', () => {
    const cache: DetailCache = new Map();
    rememberDetail(cache, [fullOf()]);
    const [s] = withDetail([sub({ status: 'Pending', result: undefined })], cache);
    assert.equal(s.result, undefined);
    assert.equal(s.content, '我的童年是在一間小小的文具店裡度過的。');
  });

  test('只接回同一個 id 的：清除繳交之後變成 unsub- 的那一列不會拿到舊作文', () => {
    const cache: DetailCache = new Map();
    rememberDetail(cache, [fullOf()]);
    const [s] = withDetail([sub({ id: 'unsub-a-s1', status: 'Unsubmitted', result: undefined })], cache);
    assert.equal(s.content, '');
  });

  test('再補一次完整就換成新的', () => {
    const cache: DetailCache = new Map();
    rememberDetail(cache, [fullOf()]);
    rememberDetail(cache, [fullOf({ content: '重新繳交的版本。' })]);
    assert.equal(withDetail([sub()], cache)[0].content, '重新繳交的版本。');
  });
});
