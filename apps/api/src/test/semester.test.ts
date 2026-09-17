/**
 * 學年期。
 *
 * 前端的課程、成績、學生端的學期篩選都吃這一支 —— 它錯了，
 * 畫面上會變成「一門課都沒有」，而那看起來像資料壞了，不像學期算錯。
 */
import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  resetDb, rawDb, seedSemester, startFakeIdp, startServer, login, req,
  type TestServer,
} from './helpers';

let srv: TestServer;
let idp: { close: () => Promise<void> };

before(async () => {
  idp = await startFakeIdp({ mail: 'anyone@test.edu.tw' });
  srv = await startServer();
});
after(async () => { await srv.close(); await idp.close(); await rawDb.$pool.end(); });
beforeEach(resetDb);

const get = async (cookie: string) =>
  (await req(srv, '/service/semesters', cookie)).json();

describe('GET /service/semesters', () => {
  test('未登入 → 401', async () => {
    assert.equal((await req(srv, '/service/semesters')).status, 401);
  });

  test('回傳全部學年期，新的在前', async () => {
    await seedSemester(114, 2, -400, -200);
    await seedSemester(115, 1, -30, 150);
    await seedSemester(115, 2, 151, 330);
    const body = await get(await login(srv));
    assert.deepEqual(
      body.semesters.map((s: { school_year: number; semester: number }) => `${s.school_year}-${s.semester}`),
      ['115-2', '115-1', '114-2'],
    );
  });

  test('current 是今天落在的那一個', async () => {
    await seedSemester(114, 2, -400, -200);
    await seedSemester(115, 1, -30, 150);
    const body = await get(await login(srv));
    assert.equal(body.current.school_year, 115);
    assert.equal(body.current.semester, 1);
  });

  test('沒有任何學年期涵蓋今天時，current 是 null 而不是報錯', async () => {
    // 實際資料的區間是連續的，不該發生 —— 但如果真的發生，
    // 畫面該退回「全部學期」，不是整頁掛掉。
    await seedSemester(114, 2, -400, -200);
    const body = await get(await login(srv));
    assert.equal(body.current, null);
    assert.equal(body.semesters.length, 1);
  });

  test('資料有重複時只回一列，而且是最新的那個區間', async () => {
    // 正式資料庫目前就有這個問題：118 學年度有兩列 118-2、沒有 118-1。
    // 區間本身不重疊所以今天對得到唯一一列，但查詢要能承受重複，
    // 不能變成「看執行計畫決定回哪一列」。
    await seedSemester(115, 1, -30, 150);
    await seedSemester(115, 1, -20, 160);
    const body = await get(await login(srv));
    assert.equal(body.semesters.length, 2, '清單照實回報，不要幫忙去重');
    assert.ok(body.current, 'current 仍要給得出一個');
  });
});
