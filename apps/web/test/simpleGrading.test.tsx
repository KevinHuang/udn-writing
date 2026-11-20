/**
 * 簡易批改在批改頁的資訊（lib/simpleGrading.ts）：只給老師看的那一塊。
 *
 * 釘住：後端缺欄位時不能拖垮批改頁、辨識完成度一律捨去（不要讓老師以為比實際好）、
 * 什麼時候出現這一塊、請老師留意的寫法。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  completionPercent, parseSimpleGradingInfo, sheetSummaryLine, showSimpleGrading, teacherAlertText,
} from '../lib/simpleGrading';

const sheet = {
  template: 'udn', completion: 0.929, lowCompletion: false, chars: 600, paragraphs: 5,
  confirmedTypos: 3, pendingTypos: 1, indentIssues: 1, punctuationIssues: 0,
};

describe('簡易批改的資訊', () => {
  test('後端回傳缺欄位、亂掉時不當掉', () => {
    const info = parseSimpleGradingInfo({ eligible: true, sheet: { completion: 'x' }, detail: { teacherAlert: null } });
    assert.equal(info.eligible, true);
    assert.equal(info.sheet?.completion, null);
    assert.equal(info.sheet?.confirmedTypos, 0);
    assert.equal(info.detail?.teacherAlert.needed, false);
    assert.deepEqual(info.detail?.checks, []);
    assert.deepEqual(parseSimpleGradingInfo(null), { eligible: false, reason: null, sheet: null, detail: null });
  });

  test('辨識完成度無條件捨去', () => {
    assert.equal(completionPercent(0.929), 92);
    assert.equal(completionPercent(0.8499), 84);
    assert.equal(completionPercent(1), 100);
  });

  test('一行摘要：零的不寫（除了確定的錯別字）', () => {
    assert.equal(sheetSummaryLine(sheet), '辨識完成度 92%・確定的錯別字 3 個・待確認 1 個・段首沒空兩格 1 處');
    assert.equal(
      sheetSummaryLine({ ...sheet, completion: null, confirmedTypos: 0, pendingTypos: 0, indentIssues: 0 }),
      '確定的錯別字 0 個');
  });

  test('會用簡易批改、或之前用簡易批改批過，才出現這一塊', () => {
    const base = { eligible: false, reason: 'no_grid' as const, sheet: null, detail: null };
    assert.equal(showSimpleGrading(null), false);
    assert.equal(showSimpleGrading(base), false);
    assert.equal(showSimpleGrading({ ...base, eligible: true, reason: null }), true);
    // 批改後老師又校對改了文字：已經存的評分依據還是要看得到
    const detail = { systemZero: false, scoreBasis: '依據', zeroReason: '', teacherAlert: { needed: false, reason: '', paragraph: null }, checks: [] };
    assert.equal(showSimpleGrading({ ...base, reason: 'edited', detail }), true);
  });

  test('請老師留意：有段落就附上', () => {
    assert.equal(teacherAlertText({ needed: false, reason: 'x', paragraph: 2 }), null);
    assert.equal(teacherAlertText({ needed: true, reason: '提到被霸凌', paragraph: 3 }), '提到被霸凌（第 3 段）');
    assert.equal(teacherAlertText({ needed: true, reason: '', paragraph: null }), '作文裡有需要關心的內容');
  });
});
