/**
 * 代繳交（教師把學生的紙本作文登錄進系統）的授權與資料安全。
 *
 * 這一支釘的是兩個**既有**的洞：
 *
 *   1. `/submissions/proxy` 與 `/submissions/ocr_proxy` 完全沒有範圍檢查 ——
 *      只要是教師身分，就能對**任意** user_id ＋ 任意 assignment_id 寫入
 *      submission（別人班的學生、別人班的作業都可以）。
 *
 *   2. `BatchProxySubmissionHelper` 整段 SQL 是字串接出來的，
 *      而 batch_uuid 直接來自 client 的 request body。
 *
 * 兩個都不會讓畫面壞掉，所以只能靠測試釘住。
 */
import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  resetDb, rawDb, seedUser, seedSchool, seedCourse, seedInstructor, seedLearner,
  seedTask, seedAssignment, seedSystemAdmin, seedSchoolAdmin,
  startFakeIdp, startServer, login, req,
  type TestServer,
} from './helpers';
import BatchProxySubmissionHelper from '../dal/batch_proxy_submission_helper';
import { storageCalls, resetStorageCalls } from '../dal/simulated_storage';
import { ocrJobCalls, resetOcrJobCalls } from '../dal/simulated_ocr_job';

const ACCOUNT = 'me@test.edu.tw';
let srv: TestServer;
let idp: { close: () => Promise<void> };

before(async () => {
  idp = await startFakeIdp({ mail: ACCOUNT });
  srv = await startServer();
});
after(async () => { await srv.close(); await idp.close(); await rawDb.$pool.end(); });
beforeEach(async () => {
  await resetDb();
  resetStorageCalls();
  resetOcrJobCalls();
});

const post = (cookie: string, path: string, body: unknown) =>
  req(srv, path, cookie, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const setIdentity = (cookie: string, type: string) =>
  post(cookie, '/auth/identity', { type });

const countSubmissions = async () =>
  (await rawDb.one<{ n: number }>(`SELECT count(*)::int AS n FROM submission`)).n;
const countBatches = async () =>
  (await rawDb.one<{ n: number }>(`SELECT count(*)::int AS n FROM batch_proxy_submission`)).n;

/**
 * 兩間學校各一個班。
 *   我的班（courseA）：登入的這個人是授課教師，學生甲在名冊上
 *   別人的班（courseB）：別的老師教，學生乙在名冊上
 * 另外有一位**誰的班都不在**的學生丙。
 */
async function twoClasses() {
  const me = await seedUser(ACCOUNT, '我');
  const other = await seedUser('other@test.edu.tw', '別的老師');
  const mine = await seedUser('a@test.edu.tw', '學生甲');
  const theirs = await seedUser('b@test.edu.tw', '學生乙');
  const stranger = await seedUser('c@test.edu.tw', '路人丙');

  const schoolA = await seedSchool('甲中學', 'a.edu.tw');
  const schoolB = await seedSchool('乙中學', 'b.edu.tw');
  const courseA = await seedCourse(schoolA, '我的班');
  const courseB = await seedCourse(schoolB, '別人的班');
  await seedInstructor(courseA, me.id);
  await seedInstructor(courseB, other.id);
  await seedLearner(courseA, mine.id, 1);
  await seedLearner(courseB, theirs.id, 1);

  const task = await seedTask(me.id, '那次失敗之後');
  const assignA = await seedAssignment(courseA, task, me.id);
  const assignB = await seedAssignment(courseB, task, other.id);

  return { me, other, mine, theirs, stranger, schoolA, schoolB, courseA, courseB, assignA, assignB };
}

const IMAGES = ['/9j/4AAQSkZJRg=='];

describe('POST /submissions/proxy 的授權', () => {
  test('自己班的學生，代繳交成功', async () => {
    const s = await twoClasses();
    const cookie = await login(srv);
    const res = await post(cookie, '/service/instructor/submissions/proxy', {
      assignment_id: s.assignA, user_id: s.mine.id,
      content: '那次失敗之後，我學會了面對自己的不足。', word_count: 18, files: [],
    });
    assert.equal(res.status, 200);
    assert.equal(await countSubmissions(), 1);
  });

  test('⚠️ 別人班的作業＋別人班的學生 → 404，而且一列都沒寫進去', async () => {
    const s = await twoClasses();
    const cookie = await login(srv);
    const res = await post(cookie, '/service/instructor/submissions/proxy', {
      assignment_id: s.assignB, user_id: s.theirs.id,
      content: '這不該寫得進去', word_count: 7, files: [],
    });
    assert.equal(res.status, 404, '以前這裡是 200 —— 任一教師可以對任意學生代繳交');
    assert.equal(await countSubmissions(), 0);
  });

  test('⚠️ 自己班的作業，但那位學生不在這個班的名冊上 → 404', async () => {
    const s = await twoClasses();
    const cookie = await login(srv);
    const res = await post(cookie, '/service/instructor/submissions/proxy', {
      assignment_id: s.assignA, user_id: s.stranger.id,
      content: '路人的作文', word_count: 5, files: [],
    });
    assert.equal(res.status, 404);
    assert.equal(await countSubmissions(), 0);
  });

  test('校務管理：自己學校的班可以，別的學校不行', async () => {
    const s = await twoClasses();
    await seedSchoolAdmin(s.schoolA, ACCOUNT, '校務管理');
    const cookie = await login(srv);
    await setIdentity(cookie, 'school_admin');

    const ok = await post(cookie, '/service/instructor/submissions/proxy', {
      assignment_id: s.assignA, user_id: s.mine.id, content: '甲校的作文', word_count: 5, files: [],
    });
    assert.equal(ok.status, 200);

    const no = await post(cookie, '/service/instructor/submissions/proxy', {
      assignment_id: s.assignB, user_id: s.theirs.id, content: '乙校的作文', word_count: 5, files: [],
    });
    assert.equal(no.status, 404, '校務管理只能動自己學校');
    assert.equal(await countSubmissions(), 1);
  });

  test('聯合報管理人員：兩校都可以', async () => {
    const s = await twoClasses();
    await seedSystemAdmin(ACCOUNT);
    const cookie = await login(srv);
    await setIdentity(cookie, 'system_admin');

    const a = await post(cookie, '/service/instructor/submissions/proxy', {
      assignment_id: s.assignA, user_id: s.mine.id, content: '甲校', word_count: 2, files: [],
    });
    const b = await post(cookie, '/service/instructor/submissions/proxy', {
      assignment_id: s.assignB, user_id: s.theirs.id, content: '乙校', word_count: 2, files: [],
    });
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(await countSubmissions(), 2);
  });
});

describe('POST /submissions/ocr_proxy 的授權', () => {
  test('⚠️ 別人班的學生 → 404，而且不會先上傳再擋', async () => {
    const s = await twoClasses();
    const cookie = await login(srv);
    const res = await post(cookie, '/service/instructor/submissions/ocr_proxy', {
      assignmentId: s.assignB, studentId: s.theirs.id, images: IMAGES,
    });
    assert.equal(res.status, 404);
    assert.equal(await countBatches(), 0, '擋下來就不該留下 batch 列');
    assert.equal(storageCalls.length, 0, '⚠️ 不能先把照片寫進 GCS 再擋');
  });

  test('⚠️ 自己班的作業，但學生不在名冊上 → 404', async () => {
    const s = await twoClasses();
    const cookie = await login(srv);
    const res = await post(cookie, '/service/instructor/submissions/ocr_proxy', {
      assignmentId: s.assignA, studentId: s.stranger.id, images: IMAGES,
    });
    assert.equal(res.status, 404);
    assert.equal(await countBatches(), 0);
    assert.equal(storageCalls.length, 0);
  });
});

describe('BatchProxySubmissionHelper 的 SQL 安全', () => {
  test('⚠️ 檔名裡的單引號與分號是資料，不是語法', async () => {
    const s = await twoClasses();
    const nasty = ["a'.jpg", 'b");--.jpg', "c'); DROP TABLE submission;--.jpg"];

    const batch = await BatchProxySubmissionHelper.submit(
      s.mine.id, s.assignA, s.me.id, nasty);

    const row = await rawDb.one<{ img_files: unknown; batch_uuid: string }>(
      `SELECT img_files, batch_uuid FROM batch_proxy_submission WHERE id = $1`, [batch.id]);
    assert.deepEqual(row.img_files, nasty, '原樣存進去、原樣讀出來');

    const still = await rawDb.one<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'submission'`);
    assert.equal(still.n, 1, 'submission 這張表還在');
  });

  test('img_files 存成 JSON 陣列（不是 Postgres 的 array literal）', async () => {
    const s = await twoClasses();
    const batch = await BatchProxySubmissionHelper.submit(
      s.mine.id, s.assignA, s.me.id, ['x.jpg', 'y.jpg']);
    const row = await rawDb.one<{ kind: string }>(
      `SELECT json_typeof(img_files) AS kind FROM batch_proxy_submission WHERE id = $1`,
      [batch.id]);
    assert.equal(row.kind, 'array');
  });

  test('batch_uuid 由後端產生，每一批都不一樣', async () => {
    const s = await twoClasses();
    const first = await BatchProxySubmissionHelper.submit(s.mine.id, s.assignA, s.me.id, ['1.jpg']);
    const second = await BatchProxySubmissionHelper.submit(s.mine.id, s.assignA, s.me.id, ['2.jpg']);
    assert.match(first.batch_uuid, /^[0-9a-f-]{36}$/);
    assert.notEqual(first.batch_uuid, second.batch_uuid);
  });

  test('新的一批會讓舊的退役，但舊的那一列還在（不是刪掉）', async () => {
    const s = await twoClasses();
    const first = await BatchProxySubmissionHelper.submit(s.mine.id, s.assignA, s.me.id, ['1.jpg']);
    await BatchProxySubmissionHelper.submit(s.mine.id, s.assignA, s.me.id, ['2.jpg']);

    const rows = await rawDb.manyOrNone<{ id: string; is_valid: boolean }>(
      `SELECT id::text, is_valid FROM batch_proxy_submission
        WHERE ref_user_id = $1 AND ref_assignment_id = $2 ORDER BY id`,
      [s.mine.id, s.assignA]);
    assert.equal(rows.length, 2);
    assert.equal(rows.find((r) => r.id === first.id)?.is_valid, false);
    assert.equal(rows.filter((r) => r.is_valid).length, 1, '任何時刻只有一批是現行的');
  });

  test('⚠️ 退役只動「現行的那一批」—— 歷史列的 last_update 不可以被推掉', async () => {
    const s = await twoClasses();
    const first = await BatchProxySubmissionHelper.submit(s.mine.id, s.assignA, s.me.id, ['1.jpg']);
    await BatchProxySubmissionHelper.submit(s.mine.id, s.assignA, s.me.id, ['2.jpg']);
    const before = await rawDb.one<{ last_update: Date }>(
      `SELECT last_update FROM batch_proxy_submission WHERE id = $1`, [first.id]);

    // 再收第三批：第一批已經是 is_valid = false，不該再被動到
    await BatchProxySubmissionHelper.submit(s.mine.id, s.assignA, s.me.id, ['3.jpg']);
    const after = await rawDb.one<{ last_update: Date }>(
      `SELECT last_update FROM batch_proxy_submission WHERE id = $1`, [first.id]);

    assert.equal(+after.last_update, +before.last_update,
      'last_update 是「什麼時候送去辨識」的時間基準，被推掉的話逾時就算不準了');
  });
});

describe('範圍查詢', () => {
  test('latestValidFor 只回自己看得到的班', async () => {
    const s = await twoClasses();
    await BatchProxySubmissionHelper.submit(s.theirs.id, s.assignB, s.other.id, ['x.jpg']);

    const asMe = await BatchProxySubmissionHelper.latestValidFor(
      s.assignB, { kind: 'instructor', userId: s.me.id });
    assert.equal(asMe.length, 0, '別人班的批次查不到');

    const asAdmin = await BatchProxySubmissionHelper.latestValidFor(s.assignB, { kind: 'all' });
    assert.equal(asAdmin.length, 1);
    assert.deepEqual(asAdmin[0].img_files, ['x.jpg']);
  });

  test('statusOf：有照片但還沒辨識 → ocr_time 空、has_content false', async () => {
    const s = await twoClasses();
    await BatchProxySubmissionHelper.submit(s.mine.id, s.assignA, s.me.id, ['1.jpg', '2.jpg']);

    const rows = await BatchProxySubmissionHelper.statusOf(
      s.assignA, { kind: 'instructor', userId: s.me.id });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].ocr_time, null);
    assert.equal(rows[0].has_content, false);
    assert.equal(rows[0].submission_id, null);
    assert.deepEqual(rows[0].img_files, ['1.jpg', '2.jpg']);
  });

  test('statusOf：辨識完成（有 ocr_time 也真的有文字）', async () => {
    const s = await twoClasses();
    const batch = await BatchProxySubmissionHelper.submit(s.mine.id, s.assignA, s.me.id, ['1.jpg']);
    await rawDb.none(`UPDATE batch_proxy_submission SET ocr_time = now() WHERE id = $1`, [batch.id]);
    await rawDb.none(
      `INSERT INTO submission (ref_user_id, ref_assignment_id, content, word_count, is_submitted)
       VALUES ($1, $2, '辨識出來的作文', 7, true)`,
      [s.mine.id, s.assignA]);

    const rows = await BatchProxySubmissionHelper.statusOf(
      s.assignA, { kind: 'instructor', userId: s.me.id });
    assert.ok(rows[0].ocr_time);
    assert.equal(rows[0].has_content, true);
  });

  test('⚠️ statusOf：有 ocr_time 但作文是空的 → has_content false（這就是「辨識失敗」）', async () => {
    const s = await twoClasses();
    const batch = await BatchProxySubmissionHelper.submit(s.mine.id, s.assignA, s.me.id, ['1.jpg']);
    await rawDb.none(`UPDATE batch_proxy_submission SET ocr_time = now() WHERE id = $1`, [batch.id]);
    await rawDb.none(
      `INSERT INTO submission (ref_user_id, ref_assignment_id, content, word_count, is_submitted)
       VALUES ($1, $2, '   ', 0, true)`,
      [s.mine.id, s.assignA]);

    const rows = await BatchProxySubmissionHelper.statusOf(
      s.assignA, { kind: 'instructor', userId: s.me.id });
    assert.equal(rows[0].has_content, false, 'ocr_time 有值不等於成功');
  });

  test('touchTriggered 會推進 last_update（重試才不會立刻又被判逾時）', async () => {
    const s = await twoClasses();
    const batch = await BatchProxySubmissionHelper.submit(s.mine.id, s.assignA, s.me.id, ['1.jpg']);
    await rawDb.none(
      `UPDATE batch_proxy_submission SET last_update = now() - interval '30 minutes' WHERE id = $1`,
      [batch.id]);

    await BatchProxySubmissionHelper.touchTriggered([batch.id]);

    const row = await rawDb.one<{ stale: boolean }>(
      `SELECT last_update < now() - interval '5 minutes' AS stale
         FROM batch_proxy_submission WHERE id = $1`, [batch.id]);
    assert.equal(row.stale, false);
  });

  test('retire：校對過之後這一批就退役，範圍外的動不了', async () => {
    const s = await twoClasses();
    await BatchProxySubmissionHelper.submit(s.mine.id, s.assignA, s.me.id, ['1.jpg']);

    const nope = await BatchProxySubmissionHelper.retire(
      s.assignA, s.mine.id, { kind: 'instructor', userId: s.other.id });
    assert.equal(nope, 0, '別的老師動不了我班上的批次');

    const done = await BatchProxySubmissionHelper.retire(
      s.assignA, s.mine.id, { kind: 'instructor', userId: s.me.id });
    assert.equal(done, 1);

    const rows = await BatchProxySubmissionHelper.statusOf(
      s.assignA, { kind: 'instructor', userId: s.me.id });
    assert.equal(rows.length, 0, '退役之後就不算「未校對」了');
  });
});

// ─────────────────────────────────────────────
// 先收照片、後台辨識
// ─────────────────────────────────────────────

const JPEG = { base64Image: '/9j/4AAQSkZJRg==', mimeType: 'image/jpeg' };

const upload = (cookie: string, assignmentId: string, studentId: string, images: unknown) =>
  post(cookie, '/service/instructor/submissions/ocr_proxy', { assignmentId, studentId, images });

const startOcr = (cookie: string, body: Record<string, unknown>) =>
  post(cookie, '/service/instructor/submissions/ocr_proxy/start', body);

describe('POST /submissions/ocr_proxy：只上傳，不辨識', () => {
  test('收下照片、寫一筆批次，而且**不會**觸發辨識', async () => {
    const s = await twoClasses();
    const cookie = await login(srv);
    const res = await upload(cookie, s.assignA, s.mine.id, [JPEG, JPEG]);
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(body.files.length, 2);
    assert.equal(body.folder, `submit/assign_${s.assignA}`);
    assert.ok(body.files.every((f: string) => !f.includes('/')), 'files 是裸檔名，與 img_files 一致');
    assert.equal(storageCalls.length, 2);
    assert.equal(await countBatches(), 1);
    assert.equal(ocrJobCalls.length, 0, '⚠️ 上傳不可以順便觸發辨識 —— 老師還在拍下一位');
  });

  test('舊的形狀 images: string[] 照樣收（當成 JPEG）', async () => {
    const s = await twoClasses();
    const cookie = await login(srv);
    const res = await upload(cookie, s.assignA, s.mine.id, IMAGES);
    assert.equal(res.status, 200);
    assert.equal(storageCalls.length, 1);
  });

  test('不是圖片 → 400，什麼都沒存', async () => {
    const s = await twoClasses();
    const cookie = await login(srv);
    const res = await upload(cookie, s.assignA, s.mine.id, [{ base64Image: 'aGVsbG8=', mimeType: 'text/plain' }]);
    assert.equal(res.status, 400);
    assert.equal(storageCalls.length, 0);
    assert.equal(await countBatches(), 0);
  });

  test('一次太多張 → 400', async () => {
    const s = await twoClasses();
    const cookie = await login(srv);
    const res = await upload(cookie, s.assignA, s.mine.id, Array.from({ length: 9 }, () => JPEG));
    assert.equal(res.status, 400);
    assert.equal(storageCalls.length, 0);
  });

  test('同一位重拍：舊的那批退役，只剩新的一批是現行的', async () => {
    const s = await twoClasses();
    const cookie = await login(srv);
    await upload(cookie, s.assignA, s.mine.id, [JPEG]);
    await upload(cookie, s.assignA, s.mine.id, [JPEG, JPEG]);
    const valid = await rawDb.one<{ n: number }>(
      `SELECT count(*)::int AS n FROM batch_proxy_submission WHERE is_valid = true`);
    assert.equal(valid.n, 1);
  });
});

describe('POST /submissions/ocr_proxy/start：觸發與重試', () => {
  test('不帶 studentIds → 這份作業所有待辨識的都送出去', async () => {
    const s = await twoClasses();
    const second = await seedUser('a2@test.edu.tw', '學生甲二');
    await seedLearner(s.courseA, second.id, 2);
    const cookie = await login(srv);
    await upload(cookie, s.assignA, s.mine.id, [JPEG]);
    await upload(cookie, s.assignA, second.id, [JPEG]);

    const res = await startOcr(cookie, { assignmentId: s.assignA });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.started.length, 2);
    assert.equal(body.failed.length, 0);
    assert.equal(ocrJobCalls.length, 2, '一位學生一個 execution');
    assert.ok(ocrJobCalls.every((c) => c.assignmentId === s.assignA && c.batchUUID));
  });

  test('送出去之後 last_update 晚於 created_at —— 前端靠這個分辨「待辨識」與「辨識中」', async () => {
    const s = await twoClasses();
    const cookie = await login(srv);
    await upload(cookie, s.assignA, s.mine.id, [JPEG]);
    const before = await rawDb.one<{ same: boolean }>(
      `SELECT created_at = last_update AS same FROM batch_proxy_submission WHERE is_valid`);
    assert.equal(before.same, true, '剛收照片時兩個時間一樣');

    await startOcr(cookie, { assignmentId: s.assignA });
    const after = await rawDb.one<{ later: boolean }>(
      `SELECT last_update > created_at AS later FROM batch_proxy_submission WHERE is_valid`);
    assert.equal(after.later, true);
  });

  test('⚠️ 重試**不重傳照片**：同一位送兩次，job 叫兩次，但批次還是那一筆', async () => {
    const s = await twoClasses();
    const cookie = await login(srv);
    await upload(cookie, s.assignA, s.mine.id, [JPEG, JPEG]);
    const uploadsBefore = storageCalls.length;

    await startOcr(cookie, { assignmentId: s.assignA, studentIds: [s.mine.id] });
    await startOcr(cookie, { assignmentId: s.assignA, studentIds: [s.mine.id] });

    assert.equal(ocrJobCalls.length, 2);
    assert.equal(ocrJobCalls[0].batchUUID, ocrJobCalls[1].batchUUID, '同一批照片');
    assert.equal(await countBatches(), 1, '沒有因為重試多出新的批次');
    assert.equal(storageCalls.length, uploadsBefore, '沒有重傳');
  });

  test('已經辨識完成的 → already_done；帶 force 才重跑', async () => {
    const s = await twoClasses();
    const cookie = await login(srv);
    await upload(cookie, s.assignA, s.mine.id, [JPEG]);
    await rawDb.none(`UPDATE batch_proxy_submission SET ocr_time = now() WHERE is_valid`);

    const plain = await (await startOcr(cookie, { assignmentId: s.assignA, studentIds: [s.mine.id] })).json();
    assert.deepEqual(plain.skipped, [{ studentId: s.mine.id, reason: 'already_done' }]);
    assert.equal(ocrJobCalls.length, 0);

    const forced = await (await startOcr(cookie, { assignmentId: s.assignA, studentIds: [s.mine.id], force: true })).json();
    assert.equal(forced.started.length, 1);
    assert.equal(ocrJobCalls.length, 1);
  });

  test('⚠️ 別人班的學生 → not_found，而且一個 job 都沒開', async () => {
    const s = await twoClasses();
    await BatchProxySubmissionHelper.submit(s.theirs.id, s.assignB, s.other.id, ['x.jpg']);
    const cookie = await login(srv);

    const body = await (await startOcr(cookie, { assignmentId: s.assignB, studentIds: [s.theirs.id] })).json();
    assert.deepEqual(body.skipped, [{ studentId: s.theirs.id, reason: 'not_found' }]);
    assert.equal(ocrJobCalls.length, 0);
  });

  test('沒帶 assignmentId → 400', async () => {
    await twoClasses();
    const cookie = await login(srv);
    assert.equal((await startOcr(cookie, {})).status, 400);
  });
});

describe('GET /assignments/:id/proxy_status', () => {
  test('回伺服器時間與每一位的原始狀態（不含作文全文）', async () => {
    const s = await twoClasses();
    const cookie = await login(srv);
    await upload(cookie, s.assignA, s.mine.id, [JPEG]);

    const res = await req(srv, `/service/instructor/assignments/${s.assignA}/proxy_status`, cookie);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(!Number.isNaN(Date.parse(body.now)), 'now 是伺服器時間');
    assert.equal(body.rows.length, 1);
    const row = body.rows[0];
    assert.equal(row.user_id, s.mine.id);
    assert.equal(row.ocr_time, null);
    assert.equal(row.has_content, false);
    assert.equal(row.img_files.length, 1);
    assert.equal('content' in row, false, '輪詢不帶作文全文');
  });

  test('別人班的作業 → 空清單（不是 403，與其他查詢一致）', async () => {
    const s = await twoClasses();
    await BatchProxySubmissionHelper.submit(s.theirs.id, s.assignB, s.other.id, ['x.jpg']);
    const cookie = await login(srv);
    const res = await req(srv, `/service/instructor/assignments/${s.assignB}/proxy_status`, cookie);
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).rows, []);
  });
});

describe('校對完成（confirm_ocr）', () => {
  test('存檔時帶 confirm_ocr → 這一批退役，不再算「未校對」', async () => {
    const s = await twoClasses();
    const cookie = await login(srv);
    await upload(cookie, s.assignA, s.mine.id, [JPEG]);
    await rawDb.none(`UPDATE batch_proxy_submission SET ocr_time = now() WHERE is_valid`);

    const res = await post(cookie, '/service/instructor/submissions/proxy', {
      assignment_id: s.assignA, user_id: s.mine.id,
      content: '老師校對過的作文', word_count: 8, files: [], confirm_ocr: true,
    });
    assert.equal(res.status, 200);

    const status = await (await req(srv, `/service/instructor/assignments/${s.assignA}/proxy_status`, cookie)).json();
    assert.equal(status.rows.length, 0);
  });

  test('沒帶 confirm_ocr → 批次留著（打字登錄不會意外把辨識紀錄退役）', async () => {
    const s = await twoClasses();
    const cookie = await login(srv);
    await upload(cookie, s.assignA, s.mine.id, [JPEG]);
    await post(cookie, '/service/instructor/submissions/proxy', {
      assignment_id: s.assignA, user_id: s.mine.id, content: '打字的', word_count: 3, files: [],
    });
    const status = await (await req(srv, `/service/instructor/assignments/${s.assignA}/proxy_status`, cookie)).json();
    assert.equal(status.rows.length, 1);
  });
});
