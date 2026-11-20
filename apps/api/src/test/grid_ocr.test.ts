/**
 * 稿紙逐格辨識（docs/grid-ocr.md）：批次代繳交的照片是「我的稿紙」印的稿紙時，改走逐格辨識。
 *
 * 用**真的辨識服務**（services/handwriting-ocr，在本機起一個）＋**模擬的 AI**（lib/grid_ocr/simulated_ai.ts）：
 * 找定位標記、拉正、切格、組回全文、錯字表都是真的，只有「讀出什麼字」是假的。
 * 本機沒有服務的 Python 環境時整組略過（見 SERVICE_PYTHON）。
 *
 * 釘住的是不會當掉、只會安靜出錯的事：
 *   - 缺角的稿紙要在**存進 GCS 之前**擋下來，讓老師趁紙還在手邊重拍；
 *   - 不是我們的稿紙照舊走 ocr-job，不能被逐格辨識吃掉；
 *   - 辨識期間老師重拍了，舊照片的結果不能蓋掉新的；
 *   - 已經批改過的作文不能被辨識結果覆寫。
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
import { ocrJobCalls, resetOcrJobCalls } from '../dal/simulated_ocr_job';
import { gridDispatchCalls, resetGridDispatchCalls } from '../lib/grid_ocr/dispatch';
import { runGridOcrBatch } from '../lib/grid_ocr/runner';
import { createSimulatedGridAi, parseInkHints, SIMULATED_GRID_TEXT } from '../lib/grid_ocr/simulated_ai';
import { createGridServiceClient } from '../lib/grid_ocr/service_client';
import StorageHelper from '../dal/storage_helper';

const ACCOUNT = 'grid@test.edu.tw';
const SERVICE_DIR = path.resolve(__dirname, '../../../../services/handwriting-ocr');
const SERVICE_PYTHON = path.join(SERVICE_DIR, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const SERVICE_PORT = 18090;
const hasService = existsSync(SERVICE_PYTHON);

const fixture = (name: string) => readFileSync(path.join(__dirname, 'fixtures', 'grid', name)).toString('base64');
const WRITTEN = () => fixture('udn_written_p1.jpg');
const MISSING_CORNER = () => fixture('udn_missing_corner.jpg');
const PLAIN = () => fixture('plain_paper.jpg');

let srv: TestServer;
let idp: { close: () => Promise<void> };
let service: ChildProcess | undefined;

async function waitForService(url: string, ms = 30000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      if ((await fetch(`${url}/healthz`)).ok) return;
    } catch { /* 還沒起來 */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('辨識服務沒有起來');
}

before(async () => {
  idp = await startFakeIdp({ mail: ACCOUNT });
  srv = await startServer();
  if (hasService) {
    service = spawn(SERVICE_PYTHON, ['-m', 'gaozhi.service.server'], {
      cwd: SERVICE_DIR, env: { ...process.env, PORT: String(SERVICE_PORT), PYTHONIOENCODING: 'utf-8' }, stdio: 'ignore',
    });
    process.env.GRID_OCR_SERVICE_URL = `http://127.0.0.1:${SERVICE_PORT}`;
    await waitForService(process.env.GRID_OCR_SERVICE_URL);
  }
  process.env.GRID_OCR_DISPATCH = 'record';
});
after(async () => {
  service?.kill();
  delete process.env.GRID_OCR_SERVICE_URL;
  await srv.close(); await idp.close(); await rawDb.$pool.end();
});
beforeEach(async () => {
  await resetDb();
  resetStorageCalls();
  resetOcrJobCalls();
  resetGridDispatchCalls();
});

async function myClass() {
  const me = await seedUser(ACCOUNT, '我');
  const student = await seedUser('s1@test.edu.tw', '學生甲');
  const school = await seedSchool('甲中學', 'a.edu.tw');
  const course = await seedCourse(school, '我的班');
  await seedInstructor(course, me.id);
  await seedLearner(course, student.id, 1);
  const task = await seedTask(me.id, '春天');
  const assignment = await seedAssignment(course, task, me.id);
  return { me, student, assignment };
}

const post = (cookie: string, p: string, body: unknown) =>
  req(srv, p, cookie, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const upload = (cookie: string, assignmentId: string, studentId: string, images: string[]) =>
  post(cookie, '/service/instructor/submissions/ocr_proxy', {
    assignmentId, studentId, images: images.map((b) => ({ base64Image: b, mimeType: 'image/jpeg' })),
  });

const gridRow = (batchId: string) =>
  rawDb.oneOrNone(`SELECT * FROM handwriting_grid_result WHERE ref_batch_id = $1::bigint`, [batchId]);

describe('模擬的 AI', () => {
  test('照服務附的「有字的格子」回答', () => {
    const hints = parseInkHints('以上是第 1、2 行。電腦判斷有字的格子（僅供參考，請以圖為準）：第 1 行 3–5、8 格；第 2 行 1 格。');
    assert.deepEqual([...hints.entries()], [[1, [3, 4, 5, 8]], [2, [1]]]);
  });
});

describe('稿紙逐格辨識：上傳時先檢查', { skip: !hasService && '本機沒有辨識服務的 Python 環境' }, () => {
  test('我們的稿紙 → 收下，之後走逐格辨識', async () => {
    const c = await myClass();
    const cookie = await login(srv);
    const res = await upload(cookie, c.assignment, c.student.id, [WRITTEN()]);
    assert.equal(res.status, 200);
    const body = await res.json() as { batchId: string; sheet: string };
    assert.equal(body.sheet, 'grid');
    const row = await gridRow(body.batchId);
    assert.equal(row?.status, 'pending');
    assert.equal(row?.sheet_template, 'udn');
  });

  test('⚠️ 缺一角 → 422 請重拍，而且什麼都沒存', async () => {
    const c = await myClass();
    const cookie = await login(srv);
    const res = await upload(cookie, c.assignment, c.student.id, [MISSING_CORNER()]);
    assert.equal(res.status, 422);
    const body = await res.json() as { error: string; code: string };
    assert.equal(body.code, 'SHEET_PROBLEM');
    assert.match(body.error, /右上角/);
    assert.equal(storageCalls.length, 0, '⚠️ 不能先把照片存進 GCS 再擋');
    assert.equal((await rawDb.one(`SELECT count(*)::int n FROM batch_proxy_submission`)).n, 0);
  });

  test('不是我們的稿紙 → 照舊收下、照舊走 ocr-job', async () => {
    const c = await myClass();
    const cookie = await login(srv);
    const res = await upload(cookie, c.assignment, c.student.id, [PLAIN()]);
    assert.equal(res.status, 200);
    const body = await res.json() as { batchId: string; sheet: string };
    assert.equal(body.sheet, 'other');
    assert.equal(await gridRow(body.batchId), null);

    const start = await post(cookie, '/service/instructor/submissions/ocr_proxy/start', { assignmentId: c.assignment });
    assert.equal(start.status, 200);
    assert.equal(ocrJobCalls.length, 1, '一般照片交給 ocr-job');
    assert.equal(gridDispatchCalls.length, 0);
  });
});

describe('稿紙逐格辨識：辨識與寫回', { skip: !hasService && '本機沒有辨識服務的 Python 環境' }, () => {
  async function uploadedAndStarted() {
    const c = await myClass();
    const cookie = await login(srv);
    const up = await upload(cookie, c.assignment, c.student.id, [WRITTEN()]);
    const { batchId } = await up.json() as { batchId: string };
    const start = await post(cookie, '/service/instructor/submissions/ocr_proxy/start', { assignmentId: c.assignment });
    assert.equal(start.status, 200);
    return { ...c, cookie, batchId };
  }

  test('開始辨識 → 我們的稿紙交給逐格辨識，不交給 ocr-job', async () => {
    const s = await uploadedAndStarted();
    assert.deepEqual(gridDispatchCalls, [s.batchId]);
    assert.equal(ocrJobCalls.length, 0);
    assert.equal((await gridRow(s.batchId))?.status, 'queued');
  });

  test('辨識完成：全文寫進作文、結果存好、進度看得到', async () => {
    const s = await uploadedAndStarted();
    const result = await runGridOcrBatch(s.batchId, { service: createGridServiceClient(), ai: createSimulatedGridAi() });
    assert.equal(result, 'done');

    const sub = await rawDb.one<{ content: string; pic_files: string[]; is_submitted: boolean }>(
      `SELECT content, pic_files, is_submitted FROM submission WHERE ref_user_id = $1 AND ref_assignment_id = $2`,
      [s.student.id, s.assignment]);
    // 寫了 13 個字（fixture），模擬的 AI 每一格回一個示範字
    assert.equal(Array.from(sub.content.replace(/\s/g, '')).length, 13);
    // 第 1 行從第 3 格寫起＝段首空兩格，全文開頭是兩個全形空白（服務照稿紙排的）
    assert.ok(sub.content.startsWith('　　' + SIMULATED_GRID_TEXT.slice(0, 2)), sub.content);
    assert.equal(sub.is_submitted, true);
    assert.match(sub.pic_files[0], new RegExp(`^submit/assign_${s.assignment}/`));

    const row = await gridRow(s.batchId);
    assert.equal(row?.status, 'done');
    assert.equal(row?.chars, 13);
    assert.equal(row?.pages[0].template, 'udn');
    assert.equal(row?.page_image_files.length, 1);
    // 拉正的稿紙圖真的存了
    assert.ok(await StorageHelper.readFile(`submit/assign_${s.assignment}/${row?.page_image_files[0]}`));

    const status = await req(srv, `/service/instructor/assignments/${s.assignment}/proxy_status`, s.cookie);
    const { rows } = await status.json() as { rows: Array<{ grid_status: string; has_content: boolean; ocr_time: string | null }> };
    assert.equal(rows[0].grid_status, 'done');
    assert.equal(rows[0].has_content, true);
    assert.ok(rows[0].ocr_time, '舊的狀態判斷（ocr_time＋有文字）也看得懂');
  });

  test('⚠️ 辨識期間老師重拍了 → 舊照片的結果不寫', async () => {
    const s = await uploadedAndStarted();
    await upload(s.cookie, s.assignment, s.student.id, [WRITTEN()]);   // 老師重拍：舊的那一批退役
    const result = await runGridOcrBatch(s.batchId, { service: createGridServiceClient(), ai: createSimulatedGridAi() });
    assert.equal(result, 'not_claimed');
    assert.equal((await gridRow(s.batchId))?.error_code, 'SUPERSEDED');
    assert.equal((await rawDb.one(`SELECT count(*)::int n FROM submission`)).n, 0);
  });

  test('⚠️ 已經批改過的作文 → 不覆寫', async () => {
    const s = await uploadedAndStarted();
    const subId = (await rawDb.one<{ id: string }>(
      `INSERT INTO submission (ref_user_id, ref_assignment_id, content, is_submitted) VALUES ($1, $2, '老師打的字', true) RETURNING id::text`,
      [s.student.id, s.assignment])).id;
    await rawDb.none(`INSERT INTO submission_feedback (ref_submission_id, score, content, is_valid) VALUES ($1, 5, '{}', true)`, [subId]);
    const result = await runGridOcrBatch(s.batchId, { service: createGridServiceClient(), ai: createSimulatedGridAi() });
    assert.equal(result, 'done');
    const sub = await rawDb.one<{ content: string }>(`SELECT content FROM submission WHERE id = $1`, [subId]);
    assert.equal(sub.content, '老師打的字');
  });

  test('AI 回應壞掉 → 失敗、原因看得到，作文不動；重新辨識可以再排進去', async () => {
    const s = await uploadedAndStarted();
    const broken = { ...createSimulatedGridAi(), cells: async () => ({ text: '這不是 JSON', usage: { inputTokens: 0, outputTokens: 0 } }) };
    const result = await runGridOcrBatch(s.batchId, { service: createGridServiceClient(), ai: broken });
    assert.equal(result, 'failed');
    const row = await gridRow(s.batchId);
    assert.equal(row?.error_code, 'BAD_REPLY');
    assert.match(row?.error_message ?? '', /重新辨識/);
    assert.equal((await rawDb.one(`SELECT count(*)::int n FROM submission`)).n, 0);

    resetGridDispatchCalls();
    const retry = await post(s.cookie, '/service/instructor/submissions/ocr_proxy/start', { assignmentId: s.assignment });
    assert.equal(retry.status, 200);
    assert.deepEqual(gridDispatchCalls, [s.batchId]);
  });

  test('正在辨識中的不重送（同一批跑兩次會互相蓋掉）', async () => {
    const s = await uploadedAndStarted();
    await rawDb.none(`UPDATE handwriting_grid_result SET status = 'running', started_at = now() WHERE ref_batch_id = $1`, [s.batchId]);
    resetGridDispatchCalls();
    const again = await post(s.cookie, '/service/instructor/submissions/ocr_proxy/start', { assignmentId: s.assignment });
    const body = await again.json() as { skipped: Array<{ reason: string }> };
    assert.equal(gridDispatchCalls.length, 0);
    assert.equal(body.skipped[0].reason, 'in_progress');
  });

  test('卡住超過 15 分鐘的可以重新辨識', async () => {
    const s = await uploadedAndStarted();
    await rawDb.none(`UPDATE handwriting_grid_result SET status = 'running', started_at = now() - interval '16 minutes' WHERE ref_batch_id = $1`, [s.batchId]);
    resetGridDispatchCalls();
    await post(s.cookie, '/service/instructor/submissions/ocr_proxy/start', { assignmentId: s.assignment });
    assert.deepEqual(gridDispatchCalls, [s.batchId]);
  });
});
