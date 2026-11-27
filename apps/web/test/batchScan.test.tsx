/**
 * 整疊掃描的分檔與認人（lib/batchScan.ts）。
 *
 * 這一段錯了畫面不會壞，只會**把甲的作文交到乙的名下**，而且老師一次送一整班、很難回頭一份一份對。
 * 所以釘住的都是「什麼時候不可以自動配」：撞號、塗兩格、名單沒座號、已經有作文的人、缺角。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGroups,
  canAutoMatch,
  choicesFor,
  chunk,
  matchGroups,
  planBatch,
  seatReadText,
  type RosterStudent,
  type ScanPage,
} from '../lib/batchScan';

const sheet = (index: number, page: number, seatNo: number | null, extra: Partial<ScanPage> = {}): ScanPage => ({
  index,
  kind: 'sheet',
  template: 'udn',
  page,
  seat: page === 1 ? { state: seatNo ? 'clear' : 'blank', seatNo, tens: null, ones: null } : null,
  cornersMissing: [],
  ...extra,
});
const blank = (index: number): ScanPage => ({ index, kind: 'blank' });
const unknown = (index: number): ScanPage => ({ index, kind: 'unknown' });

const roster: RosterStudent[] = [1, 2, 3, 4].map((n) => ({ studentId: `s${n}`, name: `學生${n}`, seatNo: n }));
const ids = (list: RosterStudent[]) => list.map((s) => s.studentId);

describe('buildGroups：分成一人一份', () => {
  test('雙面掃描：第 2 頁接在前一張第 1 頁後面', () => {
    const r = buildGroups([sheet(0, 1, 1), sheet(1, 2, null), sheet(2, 1, 2), sheet(3, 2, null)]);
    assert.deepEqual(r.groups.map((g) => g.pages), [[0, 1], [2, 3]]);
    assert.deepEqual(r.groups.map((g) => g.seatNo), [1, 2]);
    assert.equal(r.pagesPerStudent, 2);
    assert.equal(r.frontOnly, false);
  });

  test('背面沒寫字被判成空白頁：略過，不打斷下一位', () => {
    const r = buildGroups([sheet(0, 1, 1), blank(1), sheet(2, 1, 2), sheet(3, 2, null)]);
    assert.deepEqual(r.groups.map((g) => g.pages), [[0], [2, 3]]);
    assert.equal(r.blankPages, 1);
  });

  test('⚠️ 第 2 頁前面不是第 1 頁（順序顛倒、漏掃）：自己一份、要老師看，不接到別人後面', () => {
    const r = buildGroups([sheet(0, 2, null), sheet(1, 1, 1), sheet(2, 2, null), sheet(3, 2, null)]);
    assert.deepEqual(r.groups.map((g) => [g.pages, g.issue]), [[[0], 'orphan_page'], [[1, 2], null], [[3], 'orphan_page']]);
  });

  test('⚠️ 中間混了認不出來的頁：後面的第 2 頁不接到它前面那一位', () => {
    const r = buildGroups([sheet(0, 1, 1), unknown(1), sheet(2, 2, null)]);
    assert.deepEqual(r.groups.map((g) => [g.pages, g.issue]), [[[0], null], [[2], 'orphan_page']]);
    assert.equal(r.otherPages.length, 1);
  });

  test('⚠️ 不同稿紙的第 2 頁不接在一起', () => {
    const r = buildGroups([sheet(0, 1, 1), sheet(1, 2, null, { template: 'cap' })]);
    assert.deepEqual(r.groups.map((g) => g.pages), [[0], [1]]);
  });

  test('整疊只有第 1 頁：提醒老師是不是忘了開雙面', () => {
    assert.equal(buildGroups([sheet(0, 1, 1), sheet(1, 1, 2)]).frontOnly, true);
  });

  test('學測：第 1、2 頁是兩個大題，各自一份；混在一起要提醒', () => {
    const g1 = sheet(0, 1, 1, { template: 'gsat' });
    const g2 = sheet(1, 2, 2, { template: 'gsat', seat: { state: 'clear', seatNo: 2, tens: 0, ones: 2 } });
    const r = buildGroups([g1, g2]);
    assert.deepEqual(r.groups.map((g) => g.pages), [[0], [1]]);
    assert.equal(r.twoQuestions, true);
    assert.equal(r.frontOnly, false);
  });

  test('座號沒塗、塗兩格、太淡、這種稿紙沒有劃記：都不給座號，各有原因', () => {
    const seat = (state: 'blank' | 'double' | 'unclear') => ({ state, seatNo: null, tens: null, ones: null });
    const r = buildGroups([
      sheet(0, 1, null),
      sheet(1, 1, null, { seat: seat('double') }),
      sheet(2, 1, null, { seat: seat('unclear') }),
      sheet(3, 1, null, { template: 'ucup', seat: null }),
    ]);
    assert.deepEqual(r.groups.map((g) => g.issue), ['no_seat', 'double', 'unclear', 'no_seatmark']);
    assert.ok(r.groups.every((g) => g.seatNo === null));
  });

  test('⚠️ 缺角：不管哪一頁缺，整份標成要重掃，座號也不採用', () => {
    const r = buildGroups([sheet(0, 1, 1), sheet(1, 2, null, { cornersMissing: ['左下角'] }), sheet(2, 1, 2, { cornersMissing: ['右上角'] })]);
    assert.deepEqual(r.groups.map((g) => [g.issue, g.seatNo]), [['corners', null], ['corners', null]]);
  });
});

describe('matchGroups：塗的座號對名單', () => {
  const groupsOf = (...seats: (number | null)[]) => buildGroups(seats.map((s, i) => sheet(i, 1, s))).groups;

  test('座號在名單上、沒人撞號、還沒交 → 自動配好', () => {
    const matched = matchGroups(groupsOf(2, 1), roster, ids(roster));
    assert.deepEqual(matched.map((g) => g.autoStudentId), ['s2', 's1']);
  });

  test('⚠️ 兩份塗成同一個座號：兩份都不配（不知道哪一份才是他的）', () => {
    const matched = matchGroups(groupsOf(2, 2, 3), roster, ids(roster));
    assert.deepEqual(matched.map((g) => [g.issue, g.autoStudentId]), [['duplicate', null], ['duplicate', null], [null, 's3']]);
  });

  test('⚠️ 塗的座號不在名單上 → 不配', () => {
    const [g] = matchGroups(groupsOf(40), roster, ids(roster));
    assert.deepEqual([g.issue, g.autoStudentId], ['not_in_roster', null]);
  });

  test('⚠️ 塗的是已經有作文的學生 → 不配，記下是誰，不蓋掉他的作文', () => {
    const [g] = matchGroups(groupsOf(2), roster, ['s1', 's3', 's4']);
    assert.deepEqual([g.autoStudentId, g.takenStudentId, g.issue], [null, 's2', null]);
  });

  test('⚠️ 名單上有人沒有座號 → 整份不自動認人', () => {
    const partial = [...roster.slice(0, 3), { studentId: 's4', name: '學生4', seatNo: null }];
    assert.equal(canAutoMatch(partial), false);
    assert.ok(matchGroups(groupsOf(1, 2), partial, ids(partial)).every((g) => g.autoStudentId === null));
  });

  test('⚠️ 名單上座號重複（跨班合上的課）→ 整份不自動認人', () => {
    const dup = [...roster, { studentId: 's5', name: '學生5', seatNo: 1 }];
    assert.equal(canAutoMatch(dup), false);
    assert.ok(matchGroups(groupsOf(1, 2), dup, ids(dup)).every((g) => g.autoStudentId === null));
  });

  test('座號 0 不算有座號', () => {
    assert.equal(canAutoMatch([{ studentId: 'a', name: '甲', seatNo: 0 }]), false);
    assert.equal(canAutoMatch([]), false);
  });

  test('重新對一次名單時，上一次的結果不留著', () => {
    const first = matchGroups(groupsOf(1), roster, ids(roster));
    const second = matchGroups(first, roster, ['s2']);
    assert.deepEqual([second[0].autoStudentId, second[0].takenStudentId], [null, 's1']);
  });
});

describe('planBatch：要送出哪些', () => {
  const groups = matchGroups(buildGroups([sheet(0, 1, 1), sheet(1, 1, null), sheet(2, 1, 3)]).groups, roster, ids(roster));

  test('自動配好的直接送；沒配到的等老師；沒對到的學生列出來', () => {
    const plan = planBatch(groups, roster, {});
    assert.deepEqual(plan.sends.map((s) => s.studentId), ['s1', 's3']);
    assert.deepEqual(plan.unresolved.map((g) => g.id), ['g1']);
    assert.deepEqual(ids(plan.absent), ['s2', 's4']);
  });

  test('老師指定、改指定、選不送', () => {
    const plan = planBatch(groups, roster, { g1: { studentId: 's4' }, g0: { studentId: 's2' }, g2: { drop: true } });
    assert.deepEqual(plan.sends.map((s) => [s.group.id, s.studentId]), [['g0', 's2'], ['g1', 's4']]);
    assert.deepEqual(plan.dropped.map((g) => g.id), ['g2']);
    assert.deepEqual(plan.unresolved, []);
    assert.deepEqual(ids(plan.absent), ['s1', 's3']);
  });

  test('⚠️ 同一位學生不會收到兩份：後面那份退回等老師決定', () => {
    const plan = planBatch(groups, roster, { g1: { studentId: 's1' } });
    assert.deepEqual(plan.sends.map((s) => [s.group.id, s.studentId]), [['g0', 's1'], ['g2', 's3']]);
    assert.deepEqual(plan.unresolved.map((g) => g.id), ['g1']);
  });

  test('⚠️ 指定給不能代繳交的學生（已經有作文）→ 不送', () => {
    const plan = planBatch(groups, roster.slice(0, 3), { g1: { studentId: 's4' } });
    assert.deepEqual(plan.unresolved.map((g) => g.id), ['g1']);
  });

  test('⚠️ 缺角的那一份就算指定了人也不送，只能選不送（或重掃）', () => {
    const bad = matchGroups(buildGroups([sheet(0, 1, 1, { cornersMissing: ['左上角'] })]).groups, roster, ids(roster));
    assert.deepEqual(planBatch(bad, roster, { g0: { studentId: 's1' } }).sends, []);
    assert.equal(planBatch(bad, roster, { g0: { studentId: 's1' } }).unresolved.length, 1);
    assert.equal(planBatch(bad, roster, { g0: { drop: true } }).unresolved.length, 0);
  });

  test('choicesFor：只列還沒被用掉的人，塗的座號對得上的排第一個', () => {
    const dup = matchGroups(buildGroups([sheet(0, 1, 3), sheet(1, 1, 3), sheet(2, 1, 1)]).groups, roster, ids(roster));
    const plan = planBatch(dup, roster, {});
    const choices = choicesFor(dup[0], roster, plan, {});
    assert.deepEqual(choices.map((c) => c.student.studentId), ['s3', 's2', 's4']);   // s1 已經被第三份用掉
    assert.deepEqual(choices.map((c) => c.suggested), [true, false, false]);
    // 這一份自己目前指定的人要留在選單裡
    const picks = { g0: { studentId: 's3' } };
    const after = planBatch(dup, roster, picks);
    assert.ok(choicesFor(dup[0], roster, after, picks).some((c) => c.student.studentId === 's3'));
    assert.ok(!choicesFor(dup[1], roster, after, picks).some((c) => c.student.studentId === 's3'));
  });
});

describe('文字與小工具', () => {
  test('seatReadText', () => {
    const [ok, none] = buildGroups([sheet(0, 1, 7), sheet(1, 1, null)]).groups;
    assert.equal(seatReadText(ok), '塗的是 07 號');
    assert.equal(seatReadText(none), '沒有塗座號');
    assert.equal(seatReadText(buildGroups([sheet(0, 2, null)]).groups[0]), '沒有第 1 頁，讀不到座號');
  });

  test('chunk', () => {
    assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
    assert.deepEqual(chunk([], 4), []);
  });
});
