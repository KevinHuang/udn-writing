/**
 * 資料範圍的 SQL 片段（lib/course_scope.ts）。
 *
 * 這一支釘的是「權限放大」這種不會當掉、只會安靜出錯的東西：
 * 校務管理一所學校都沒對應到時**必須看不到任何班級**，不能退化成「全部」；
 * 以及塞進 SQL 的一律是整數，不會變成注入點。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { courseScopeSubquery, isEmptyScope, isInstructorScope } from '../lib/course_scope';

describe('courseScopeSubquery', () => {
  test('授課教師：只有自己有掛課的班', () => {
    const sql = courseScopeSubquery({ kind: 'instructor', userId: 42 });
    assert.match(sql, /uc_instructor/);
    assert.match(sql, /ref_user_id = 42/);
  });

  test('聯合報管理人員：全部班級', () => {
    const sql = courseScopeSubquery({ kind: 'all' });
    assert.match(sql, /SELECT id FROM public\.course/);
    assert.doesNotMatch(sql, /WHERE/, '不應該有任何過濾條件');
  });

  test('校務管理：限定自己管的學校', () => {
    const sql = courseScopeSubquery({ kind: 'schools', schoolIds: [3, 7] });
    assert.match(sql, /ref_school_id IN \(3,7\)/);
  });

  test('⚠️ 一所學校都沒有時是空集合，不能變成全部 —— 那是權限放大', () => {
    const sql = courseScopeSubquery({ kind: 'schools', schoolIds: [] });
    assert.match(sql, /WHERE false/);
  });

  test('只吃整數，不讓字串混進 SQL', () => {
    assert.throws(
      () => courseScopeSubquery({ kind: 'schools', schoolIds: ['1); DROP TABLE course;--' as unknown as number] }),
      /整數/,
    );
    assert.throws(() => courseScopeSubquery({ kind: 'instructor', userId: 1.5 }), /整數/);
    assert.throws(() => courseScopeSubquery({ kind: 'instructor', userId: NaN }), /整數/);
  });
});

describe('isEmptyScope / isInstructorScope', () => {
  test('只有「管不到任何學校的校務管理」算空範圍', () => {
    assert.equal(isEmptyScope({ kind: 'schools', schoolIds: [] }), true);
    assert.equal(isEmptyScope({ kind: 'schools', schoolIds: [1] }), false);
    assert.equal(isEmptyScope({ kind: 'all' }), false);
    assert.equal(isEmptyScope({ kind: 'instructor', userId: 1 }), false);
  });

  test('要記錄操作者時才需要 userId', () => {
    assert.equal(isInstructorScope({ kind: 'instructor', userId: 9 }), true);
    assert.equal(isInstructorScope({ kind: 'all' }), false);
  });
});
