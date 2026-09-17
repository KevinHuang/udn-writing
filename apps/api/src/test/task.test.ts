/**
 * 題目與題庫資料夾。
 *
 * 重點在兩件事：
 *   1. migration 002 補的五個欄位**存得進去也讀得回來** ——
 *      少一個就是老師存檔時資料安靜消失。
 *   2. 刪資料夾時底下的東西**退到上一層，不跟著刪**。
 */
import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  resetDb, rawDb, seedUser, seedSchool, seedCourse, seedInstructor,
  startFakeIdp, startServer, login, req, type TestServer,
} from './helpers';

const ACCOUNT = 'teacher@test.edu.tw';
let srv: TestServer;
let idp: { close: () => Promise<void> };

before(async () => {
  idp = await startFakeIdp({ mail: ACCOUNT });
  srv = await startServer();
});
after(async () => { await srv.close(); await idp.close(); await rawDb.$pool.end(); });
beforeEach(resetDb);

/** 一位有課的教師（題庫的可視範圍要靠 uc_instructor 推出組織） */
async function asTeacher() {
  const user = await seedUser(ACCOUNT, '陳老師');
  await seedInstructor(await seedCourse(await seedSchool()), user.id);
  return { user, cookie: await login(srv) };
}

const json = (body: unknown) => ({
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

describe('題目：migration 002 的五個欄位', () => {
  const full = {
    title: '那次失敗之後', description: '題說', note: '教師的話',
    pic1: '', picPosition: 'before', shared: false,
    level: ['國中'], source: ['聯合報'],
    writingType: '記敘抒情', maxScore: 6,
    preferredAiModel: '教育會考國寫輔助AI', pic1Description: '一張操場的照片',
  };

  test('建立時五個欄位都存得進去，讀回來一模一樣', async () => {
    const { cookie } = await asTeacher();
    const created = await (await req(srv, '/service/instructor/tasks', cookie,
      { method: 'POST', ...json(full) })).json();

    assert.equal(created.writing_type, '記敘抒情');
    assert.equal(created.max_score, 6);
    assert.equal(created.preferred_ai_model, '教育會考國寫輔助AI');
    assert.equal(created.pic1_description, '一張操場的照片');
    assert.equal(created.is_archived, false);

    const list = await (await req(srv, '/service/instructor/tasks', cookie)).json();
    const found = list.find((t: { id: string }) => String(t.id) === String(created.id));
    assert.equal(found.writing_type, '記敘抒情');
    assert.equal(found.max_score, 6);
  });

  test('更新時五個欄位也會被寫入 —— 這是「存檔後資料安靜消失」的那一關', async () => {
    const { cookie } = await asTeacher();
    const created = await (await req(srv, '/service/instructor/tasks', cookie,
      { method: 'POST', ...json(full) })).json();

    await req(srv, `/service/instructor/tasks/${created.id}`, cookie,
      { method: 'PUT', ...json({ ...full, writingType: '論說', maxScore: 4, pic1Description: '換了' }) });

    const row = await rawDb.one(
      `SELECT writing_type, max_score, pic1_description FROM task WHERE id = $1`, [created.id]);
    assert.equal(row.writing_type, '論說');
    assert.equal(row.max_score, 4);
    assert.equal(row.pic1_description, '換了');
  });

  test('沒帶的欄位存成 NULL，不是空字串', async () => {
    const { cookie } = await asTeacher();
    const { writingType, maxScore, preferredAiModel, pic1Description, ...minimal } = full;
    const created = await (await req(srv, '/service/instructor/tasks', cookie,
      { method: 'POST', ...json(minimal) })).json();
    assert.equal(created.writing_type, null);
    assert.equal(created.max_score, null);
  });
});

describe('題目：封存', () => {
  test('封存與取消封存', async () => {
    const { cookie } = await asTeacher();
    const t0 = await (await req(srv, '/service/instructor/tasks', cookie,
      { method: 'POST', ...json({ title: 'x', description: 'y', note: '', pic1: '', picPosition: 'after', shared: false, level: [], source: [] }) })).json();

    await req(srv, `/service/instructor/tasks/${t0.id}/archived`, cookie, { method: 'PUT', ...json({ archived: true }) });
    assert.equal((await rawDb.one(`SELECT is_archived FROM task WHERE id=$1`, [t0.id])).is_archived, true);

    await req(srv, `/service/instructor/tasks/${t0.id}/archived`, cookie, { method: 'PUT', ...json({ archived: false }) });
    assert.equal((await rawDb.one(`SELECT is_archived FROM task WHERE id=$1`, [t0.id])).is_archived, false);
  });

  test('archived 不是布林 → 400', async () => {
    const { cookie } = await asTeacher();
    const res = await req(srv, '/service/instructor/tasks/1/archived', cookie, { method: 'PUT', ...json({ archived: 'yes' }) });
    assert.equal(res.status, 400);
  });

  test('別人的題目 → 404（不區分「不存在」與「不是你的」）', async () => {
    const other = await seedUser('other@test.edu.tw', '別人');
    const theirs = await rawDb.one(
      `INSERT INTO task (title, description, ref_user_id, shared) VALUES ('別人的','x',$1,false) RETURNING id::text`,
      [other.id]);
    const { cookie } = await asTeacher();
    const res = await req(srv, `/service/instructor/tasks/${theirs.id}/archived`, cookie, { method: 'PUT', ...json({ archived: true }) });
    assert.equal(res.status, 404);
  });
});

describe('題庫資料夾', () => {
  const mkFolder = (cookie: string, name: string, parentId: string | null = null, shared = false) =>
    req(srv, '/service/instructor/folders', cookie, { method: 'POST', ...json({ name, parentId, shared }) });

  test('建立、列出、改名', async () => {
    const { cookie } = await asTeacher();
    const f = await (await mkFolder(cookie, '記敘抒情')).json();
    assert.equal(f.name, '記敘抒情');
    assert.equal(f.ref_parent_id, null);

    await req(srv, `/service/instructor/folders/${f.id}`, cookie, { method: 'PUT', ...json({ name: '抒情' }) });
    const list = await (await req(srv, '/service/instructor/folders', cookie)).json();
    assert.equal(list.length, 1);
    assert.equal(list[0].name, '抒情');
  });

  test('沒有名字 → 400', async () => {
    const { cookie } = await asTeacher();
    assert.equal((await mkFolder(cookie, '   ')).status, 400);
  });

  test('看不到別人的個人資料夾', async () => {
    const other = await seedUser('other@test.edu.tw', '別人');
    await rawDb.none(`INSERT INTO task_folder (name, ref_user_id, shared) VALUES ('別人的', $1, false)`, [other.id]);
    const { cookie } = await asTeacher();
    assert.deepEqual(await (await req(srv, '/service/instructor/folders', cookie)).json(), []);
  });

  test('刪資料夾時，子資料夾與題目都**退到上一層**，不跟著被刪', async () => {
    // 這是產品明確的行為 —— 前端的確認視窗寫著「裡面的東西會移到上一層，
    // 不會被刪除」。資料庫上 fk_task_folder_parent 是 ON DELETE CASCADE，
    // 所以後端必須先改掛再刪，順序錯了整棵子樹會被帶走。
    const { user, cookie } = await asTeacher();
    const grandparent = await (await mkFolder(cookie, '祖父')).json();
    const parent = await (await mkFolder(cookie, '父', String(grandparent.id))).json();
    const child = await (await mkFolder(cookie, '子', String(parent.id))).json();
    const task = await rawDb.one(
      `INSERT INTO task (title, description, ref_user_id, shared, ref_folder_id)
       VALUES ('一題','x',$1,false,$2) RETURNING id::text`, [user.id, parent.id]);

    const res = await req(srv, `/service/instructor/folders/${parent.id}`, cookie, { method: 'DELETE' });
    assert.equal(res.status, 200);

    const folders = await rawDb.manyOrNone(`SELECT id::text, name, ref_parent_id::text FROM task_folder ORDER BY name`);
    assert.equal(folders.length, 2, '祖父與子都要還在，只有「父」被刪');
    const survivingChild = folders.find((f) => f.name === '子')!;
    assert.equal(survivingChild.ref_parent_id, String(grandparent.id), '子資料夾接到祖父');

    const movedTask = await rawDb.one(`SELECT ref_folder_id::text FROM task WHERE id = $1`, [task.id]);
    assert.equal(movedTask.ref_folder_id, String(grandparent.id), '題目退到上一層，沒有被刪');
  });

  test('刪根層級的資料夾，底下的東西退到根層級（NULL）', async () => {
    const { user, cookie } = await asTeacher();
    const root = await (await mkFolder(cookie, '根')).json();
    const task = await rawDb.one(
      `INSERT INTO task (title, description, ref_user_id, shared, ref_folder_id)
       VALUES ('一題','x',$1,false,$2) RETURNING id::text`, [user.id, root.id]);

    await req(srv, `/service/instructor/folders/${root.id}`, cookie, { method: 'DELETE' });
    assert.equal((await rawDb.one(`SELECT ref_folder_id FROM task WHERE id=$1`, [task.id])).ref_folder_id, null);
  });

  test('刪別人的資料夾 → 404', async () => {
    const other = await seedUser('other@test.edu.tw', '別人');
    const theirs = await rawDb.one(
      `INSERT INTO task_folder (name, ref_user_id, shared) VALUES ('別人的', $1, false) RETURNING id::text`, [other.id]);
    const { cookie } = await asTeacher();
    assert.equal((await req(srv, `/service/instructor/folders/${theirs.id}`, cookie, { method: 'DELETE' })).status, 404);
  });
});
