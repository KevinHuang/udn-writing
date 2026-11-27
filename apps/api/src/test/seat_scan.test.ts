/**
 * 整疊掃描的讀座號（docs/batch-scan.md）：POST /assignments/:id/seat_scan。
 *
 * 這一支只讀不寫，錯了不會當掉，只會**把作文分給錯的人**，所以釘住的是：
 *   - 別人班的作業不能拿來試（也不能藉此把照片丟給辨識服務）；
 *   - 服務回傳的東西不認得時，一律退成「看不清／認不出來」，不給座號；
 *   - 頁數對不上就整批不收（座號會配到別張照片上）；
 *   - 什麼都不存：不進 GCS、不寫 batch_proxy_submission。
 *
 * 有本機辨識服務的 Python 環境時，另外用真的服務走一次（沒有就略過，同 grid_ocr.test.ts）。
 */
import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  resetDb, rawDb, seedUser, seedSchool, seedCourse, seedInstructor, seedLearner, seedTask, seedAssignment,
  startFakeIdp, startServer, login, req, type TestServer,
} from './helpers';
import { resetStorageCalls, storageCalls } from '../dal/simulated_storage';
import { SEAT_SCAN_MAX_PAGES, toSeatScanPage, toSeatScanPages } from '../lib/seat_scan';

const ACCOUNT = 'scan@test.edu.tw';
const SERVICE_DIR = path.resolve(__dirname, '../../../../services/handwriting-ocr');
const SERVICE_PYTHON = path.join(SERVICE_DIR, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const SERVICE_PORT = 18091;                     // grid_ocr.test.ts 用 18090；測試檔是依序跑的，但不要賭
const SERVICE_URL = `http://127.0.0.1:${SERVICE_PORT}`;
const hasService = existsSync(SERVICE_PYTHON);

const fixture = (name: string) => readFileSync(path.join(__dirname, 'fixtures', 'grid', name)).toString('base64');
const TINY = { base64Image: '/9j/4AAQSkZJRg==', mimeType: 'image/jpeg' };

let srv: TestServer;
let idp: { close: () => Promise<void> };
let service: ChildProcess | undefined;

before(async () => {
  idp = await startFakeIdp({ mail: ACCOUNT });
  srv = await startServer();
  if (hasService) {
    service = spawn(SERVICE_PYTHON, ['-m', 'gaozhi.service.server'], {
      cwd: SERVICE_DIR, env: { ...process.env, PORT: String(SERVICE_PORT), PYTHONIOENCODING: 'utf-8' }, stdio: 'ignore',
    });
    const until = Date.now() + 30000;
    for (;;) {
      try { if ((await fetch(`${SERVICE_URL}/healthz`)).ok) break; } catch { /* 還沒起來 */ }
      if (Date.now() > until) throw new Error('辨識服務沒有起來');
      await new Promise((r) => setTimeout(r, 300));
    }
  }
});
after(async () => {
  service?.kill();
  delete process.env.GRID_OCR_SERVICE_URL;
  await srv.close(); await idp.close(); await rawDb.$pool.end();
});
beforeEach(async () => {
  await resetDb();
  resetStorageCalls();
  delete process.env.GRID_OCR_SERVICE_URL;
});

const scan = (cookie: string, assignmentId: string, images: unknown) =>
  req(srv, `/service/instructor/assignments/${assignmentId}/seat_scan`, cookie, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ images }),
  });

async function twoClasses() {
  const me = await seedUser(ACCOUNT, '我');
  const other = await seedUser('other@test.edu.tw', '別的老師');
  const mine = await seedUser('a@test.edu.tw', '學生甲');
  const schoolA = await seedSchool('甲中學', 'a.edu.tw');
  const schoolB = await seedSchool('乙中學', 'b.edu.tw');
  const courseA = await seedCourse(schoolA, '我的班');
  const courseB = await seedCourse(schoolB, '別人的班');
  await seedInstructor(courseA, me.id);
  await seedInstructor(courseB, other.id);
  await seedLearner(courseA, mine.id, 1);
  const task = await seedTask(me.id, '那次失敗之後');
  const assignA = await seedAssignment(courseA, task, me.id);
  const assignB = await seedAssignment(courseB, task, other.id);
  return { assignA, assignB };
}

describe('toSeatScanPage：服務回傳的東西不認得就不給座號', () => {
  test('讀得清楚的稿紙：座號、頁碼、缺角、截圖都照轉', () => {
    const page = toSeatScanPage({
      kind: 'sheet', template: 'udn', format: '聯合報國中寫作稿紙', paper: 'A3', page: 1,
      seat: { state: 'clear', seat: 12, tens: 1, ones: 2 }, corners_missing: [], crops: ['AAAA', '', 5],
    }, 3);
    assert.deepEqual(page, {
      index: 3, kind: 'sheet', template: 'udn', format: '聯合報國中寫作稿紙', paper: 'A3', page: 1,
      seat: { state: 'clear', seatNo: 12, tens: 1, ones: 2 },
      cornersMissing: [], crops: ['data:image/jpeg;base64,AAAA'],
    });
  });

  test('⚠️ 塗兩格、太淡時就算服務附了一個數字，也不當成座號', () => {
    for (const state of ['double', 'unclear', 'blank']) {
      const page = toSeatScanPage({ kind: 'sheet', template: 'cap', page: 1, seat: { state, seat: 7, tens: 0, ones: 7 } }, 0);
      assert.equal(page.seat?.state, state);
      assert.equal(page.seat?.seatNo, null);
    }
  });

  test('⚠️ 說是 clear 卻沒有正整數座號（0、小數、字串、缺漏）→ 看不清', () => {
    for (const seat of [0, 1.5, '12', null, undefined, -3]) {
      const page = toSeatScanPage({ kind: 'sheet', template: 'cap', page: 1, seat: { state: 'clear', seat } }, 0);
      assert.deepEqual([page.seat?.state, page.seat?.seatNo], ['unclear', null], `seat=${String(seat)}`);
    }
  });

  test('不認得的 state → 看不清；不認得的 kind → 認不出來', () => {
    assert.equal(toSeatScanPage({ kind: 'sheet', seat: { state: 'maybe', seat: 3 } }, 0).seat?.state, 'unclear');
    assert.deepEqual(toSeatScanPage({ kind: 'lined', template: 'en' }, 2), { index: 2, kind: 'unknown' });
    assert.deepEqual(toSeatScanPage(null, 1), { index: 1, kind: 'unknown' });
    assert.deepEqual(toSeatScanPage({ kind: 'blank', error: 'x' }, 4), { index: 4, kind: 'blank' });
  });

  test('沒有座號劃記的頁（聯合盃、第 2 頁）：seat 是 null，不是「沒塗」', () => {
    assert.equal(toSeatScanPage({ kind: 'sheet', template: 'ucup', page: 1 }, 0).seat, null);
  });

  test('⚠️ 頁數和送出去的照片對不上 → 整批不收', () => {
    assert.equal(toSeatScanPages({ pages: [{ kind: 'blank' }] }, 2), null);
    assert.equal(toSeatScanPages({}, 1), null);
    assert.equal(toSeatScanPages(null, 1), null);
    assert.deepEqual(toSeatScanPages({ pages: [{ kind: 'blank' }, { kind: 'unknown' }] }, 2)?.map((p) => p.index), [0, 1]);
  });
});

describe('POST /assignments/:id/seat_scan', () => {
  test('⚠️ 別人班的作業 → 404，照片不會送去辨識服務', async () => {
    const s = await twoClasses();
    process.env.GRID_OCR_SERVICE_URL = 'http://127.0.0.1:1';      // 真的送出去會是 503，不是 404
    const cookie = await login(srv);
    const res = await scan(cookie, s.assignB, [TINY]);
    assert.equal(res.status, 404);
  });

  test('不存在、或不是數字的作業編號 → 404（不是 500）', async () => {
    await twoClasses();
    const cookie = await login(srv);
    assert.equal((await scan(cookie, '999999', [TINY])).status, 404);
    assert.equal((await scan(cookie, 'abc', [TINY])).status, 404);
  });

  test('沒登入 → 進不來', async () => {
    const s = await twoClasses();
    const res = await scan('', s.assignA, [TINY]);
    assert.ok(res.status === 401 || res.status === 403, `status ${res.status}`);
  });

  test('沒有照片、超過一批的張數 → 400', async () => {
    const s = await twoClasses();
    const cookie = await login(srv);
    assert.equal((await scan(cookie, s.assignA, [])).status, 400);
    assert.equal((await scan(cookie, s.assignA, Array(SEAT_SCAN_MAX_PAGES + 1).fill(TINY))).status, 400);
  });

  test('辨識服務沒設定 → 503，老師改用一位一位的代繳交', async () => {
    const s = await twoClasses();
    const cookie = await login(srv);
    const res = await scan(cookie, s.assignA, [TINY]);
    assert.equal(res.status, 503);
    assert.equal(((await res.json()) as { code: string }).code, 'SEAT_SCAN_UNAVAILABLE');
  });

  test('辨識服務連不上 → 503', async () => {
    const s = await twoClasses();
    process.env.GRID_OCR_SERVICE_URL = 'http://127.0.0.1:1';
    const cookie = await login(srv);
    const res = await scan(cookie, s.assignA, [TINY]);
    assert.equal(res.status, 503);
  });

  test('真的辨識服務：稿紙認得出頁碼、白紙認不出來；什麼都不存', { skip: !hasService }, async () => {
    const s = await twoClasses();
    process.env.GRID_OCR_SERVICE_URL = SERVICE_URL;
    const cookie = await login(srv);
    const res = await scan(cookie, s.assignA, [
      { base64Image: fixture('udn_written_p1.jpg'), mimeType: 'image/jpeg' },
      { base64Image: fixture('plain_paper.jpg'), mimeType: 'image/jpeg' },
    ]);
    assert.equal(res.status, 200);
    const { pages } = (await res.json()) as { pages: Array<Record<string, any>> };
    assert.equal(pages.length, 2);
    // 這張是加印座號劃記之前印的國中稿紙：劃記的位置是空的，讀起來是「沒塗」，交給老師指定
    assert.deepEqual([pages[0].index, pages[0].kind, pages[0].template, pages[0].page], [0, 'sheet', 'udn', 1]);
    assert.deepEqual([pages[0].seat.state, pages[0].seat.seatNo], ['blank', null]);
    assert.equal(pages[0].crops.length, 2);
    assert.ok(pages[0].crops[0].startsWith('data:image/jpeg;base64,'));
    assert.equal(pages[1].index, 1);
    assert.notEqual(pages[1].kind, 'sheet');
    assert.equal(storageCalls.length, 0);
    assert.equal((await rawDb.one<{ n: number }>(`SELECT count(*)::int AS n FROM batch_proxy_submission`)).n, 0);
  });
});
