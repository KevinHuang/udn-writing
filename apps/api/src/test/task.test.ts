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
  resetDb, rawDb, seedUser, seedSchool, seedCourse, seedInstructor, seedSystemAdmin, seedOrg,
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

  /*
    資料夾是前端最容易漏送的一欄：表單選了、state 也有值，但 payload 忘了帶，
    題目就一律落在根目錄；更糟的是 UPDATE 無條件寫 ref_folder_id，
    等於每次編輯都把題目洗回根目錄，連「移動至…」都失效。
    API 這一層原本完全沒測到，所以前端漏送也沒人發現。
  */
  test('建立時指定的資料夾真的存進 ref_folder_id', async () => {
    const { cookie } = await asTeacher();
    const folder = await (await req(srv, '/service/instructor/folders', cookie,
      { method: 'POST', ...json({ name: '第一次段考', parentId: null, shared: false }) })).json();

    const created = await (await req(srv, '/service/instructor/tasks', cookie,
      { method: 'POST', ...json({ ...full, refFolderId: Number(folder.id) }) })).json();

    const row = await rawDb.one(`SELECT ref_folder_id::text FROM task WHERE id = $1`, [created.id]);
    assert.equal(row.ref_folder_id, String(folder.id));
  });

  test('更新時帶著同一個資料夾，不會被洗回根目錄', async () => {
    const { cookie } = await asTeacher();
    const folder = await (await req(srv, '/service/instructor/folders', cookie,
      { method: 'POST', ...json({ name: '寫作社講義', parentId: null, shared: false }) })).json();
    const created = await (await req(srv, '/service/instructor/tasks', cookie,
      { method: 'POST', ...json({ ...full, refFolderId: Number(folder.id) }) })).json();

    await req(srv, `/service/instructor/tasks/${created.id}`, cookie,
      { method: 'PUT', ...json({ ...full, refFolderId: Number(folder.id), title: '改個標題' }) });

    const row = await rawDb.one(
      `SELECT title, ref_folder_id::text FROM task WHERE id = $1`, [created.id]);
    assert.equal(row.title, '改個標題');
    assert.equal(row.ref_folder_id, String(folder.id));
  });

  test('移動：更新成另一個資料夾就會搬過去；帶 null 回到根目錄', async () => {
    const { cookie } = await asTeacher();
    const a = await (await req(srv, '/service/instructor/folders', cookie,
      { method: 'POST', ...json({ name: 'A', parentId: null, shared: false }) })).json();
    const b = await (await req(srv, '/service/instructor/folders', cookie,
      { method: 'POST', ...json({ name: 'B', parentId: null, shared: false }) })).json();
    const created = await (await req(srv, '/service/instructor/tasks', cookie,
      { method: 'POST', ...json({ ...full, refFolderId: Number(a.id) }) })).json();

    await req(srv, `/service/instructor/tasks/${created.id}`, cookie,
      { method: 'PUT', ...json({ ...full, refFolderId: Number(b.id) }) });
    assert.equal(
      (await rawDb.one(`SELECT ref_folder_id::text FROM task WHERE id = $1`, [created.id])).ref_folder_id,
      String(b.id));

    await req(srv, `/service/instructor/tasks/${created.id}`, cookie,
      { method: 'PUT', ...json({ ...full, refFolderId: null }) });
    assert.equal(
      (await rawDb.one(`SELECT ref_folder_id FROM task WHERE id = $1`, [created.id])).ref_folder_id,
      null);
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

/**
 * 共同題庫只有聯合報管理人員能動。
 *
 * 授課教師對共同題庫**唯讀**：不能新增、修改、封存、刪除題目與資料夾，
 * 也不能把自己的題目改成共用 —— 那等於把個人題目匯入共同題庫。
 * 以前 POST /tasks、POST /folders 直接吃前端送來的 shared，畫面沒按鈕，
 * 打 API 照樣建得進去。
 */
describe('共同題庫的權限', () => {
  const base = { title: '共用題', description: '題說', note: '', pic1: '', picPosition: 'after', level: [], source: [] };
  const post = (cookie: string, path: string, body: unknown) =>
    req(srv, path, cookie, { method: 'POST', ...json(body) });
  const put = (cookie: string, path: string, body: unknown) =>
    req(srv, path, cookie, { method: 'PUT', ...json(body) });
  const setIdentity = (cookie: string, type: string) => post(cookie, '/auth/identity', { type });
  const countShared = async (table: string) =>
    (await rawDb.one(`SELECT count(*)::int AS n FROM ${table} WHERE shared = true`)).n;

  /** 舊資料裡老師自己建的共用題與共用資料夾（直接寫資料庫造出來） */
  const seedLegacyShared = async (userId: string) => ({
    task: (await rawDb.one(
      `INSERT INTO task (title, description, ref_user_id, shared) VALUES ('舊共用題', '題說', $1, true) RETURNING id::text`,
      [userId])).id as string,
    folder: (await rawDb.one(
      `INSERT INTO task_folder (name, shared, ref_user_id) VALUES ('舊共用夾', true, $1) RETURNING id::text`,
      [userId])).id as string,
  });

  test('授課教師不能在共同題庫新增題目或資料夾 → 403，什麼都沒寫進去', async () => {
    const { cookie } = await asTeacher();
    assert.equal((await post(cookie, '/service/instructor/tasks', { ...base, shared: true })).status, 403);
    assert.equal((await post(cookie, '/service/instructor/folders', { name: '共用夾', shared: true })).status, 403);
    assert.equal(await countShared('task'), 0);
    assert.equal(await countShared('task_folder'), 0);
  });

  test('授課教師不能把自己的題目改成共用（＝匯入）→ 403', async () => {
    const { cookie } = await asTeacher();
    const mine = await (await post(cookie, '/service/instructor/tasks', { ...base, shared: false })).json();
    const res = await put(cookie, `/service/instructor/tasks/${mine.id}`, { ...base, shared: true });
    assert.equal(res.status, 403);
    assert.equal(await countShared('task'), 0, '題目仍然是個人的');
  });

  test('舊資料裡自己建的共用題：修改、封存、刪除都 → 403', async () => {
    const { user, cookie } = await asTeacher();
    const { task } = await seedLegacyShared(user.id);
    assert.equal((await put(cookie, `/service/instructor/tasks/${task}`, { ...base, shared: true })).status, 403);
    assert.equal((await put(cookie, `/service/instructor/tasks/${task}/archived`, { archived: true })).status, 403);
    assert.equal((await req(srv, `/service/instructor/tasks/${task}`, cookie, { method: 'DELETE' })).status, 403);
    const row = await rawDb.one(`SELECT title, is_archived FROM task WHERE id = $1`, [task]);
    assert.equal(row.title, '舊共用題');
    assert.equal(row.is_archived, false);
  });

  test('共同題庫的資料夾：改名、刪除都 → 403', async () => {
    const { user, cookie } = await asTeacher();
    const { folder } = await seedLegacyShared(user.id);
    assert.equal((await put(cookie, `/service/instructor/folders/${folder}`, { name: '改名' })).status, 403);
    assert.equal((await req(srv, `/service/instructor/folders/${folder}`, cookie, { method: 'DELETE' })).status, 403);
    assert.equal((await rawDb.one(`SELECT name FROM task_folder WHERE id = $1`, [folder])).name, '舊共用夾');
  });

  test('個人題庫照常可以新增、修改、封存、刪除', async () => {
    const { cookie } = await asTeacher();
    const mine = await (await post(cookie, '/service/instructor/tasks', { ...base, shared: false })).json();
    assert.equal((await put(cookie, `/service/instructor/tasks/${mine.id}`, { ...base, title: '改過', shared: false })).status, 200);
    assert.equal((await put(cookie, `/service/instructor/tasks/${mine.id}/archived`, { archived: true })).status, 200);
    assert.equal((await req(srv, `/service/instructor/tasks/${mine.id}`, cookie, { method: 'DELETE' })).status, 200);
  });

  /** 別人建的題目，直接寫資料庫造 */
  const seedTaskOf = async (userId: string, shared: boolean, orgId: string | null, title: string) =>
    (await rawDb.one(
      `INSERT INTO task (title, description, ref_user_id, shared, ref_org_id) VALUES ($1, '題說', $2, $3, $4) RETURNING id::text`,
      [title, userId, shared, orgId])).id as string;
  const listTitles = async (cookie: string) =>
    ((await (await req(srv, '/service/instructor/tasks', cookie)).json()) as { title: string }[]).map((t) => t.title);

  test('聯合報管理人員可以在共同題庫新增題目與資料夾，不帶班也掛得上組織', async () => {
    // 不帶班的管理人員：以前整個 /instructor 只認授課教師，題庫 API 一律 403
    await seedUser(ACCOUNT, '管理員');
    await seedSystemAdmin(ACCOUNT);
    const org = await seedOrg();
    const cookie = await login(srv);
    await setIdentity(cookie, 'system_admin');

    const task = await (await post(cookie, '/service/instructor/tasks', { ...base, shared: true })).json();
    const folder = await (await post(cookie, '/service/instructor/folders', { name: '共用夾', shared: true })).json();
    // 共用的一定要有組織，授課教師才看得到（以前 task 完全沒寫 ref_org_id）
    assert.equal(String(task.ref_org_id), org);
    assert.equal(String(folder.ref_org_id), org);
  });

  test('管理人員建的共用題，授課教師看得到', async () => {
    await seedSystemAdmin(ACCOUNT);
    const { cookie } = await asTeacher();                 // 同一個帳號也帶班
    await setIdentity(cookie, 'system_admin');
    assert.equal((await post(cookie, '/service/instructor/tasks', { ...base, title: '管理員出的題', shared: true })).status, 200);

    await setIdentity(cookie, 'instructor');
    assert.ok((await listTitles(cookie)).includes('管理員出的題'), '切回教師身分要看得到');
  });

  test('管理人員看得到全部共用題（不分組織）；授課教師只看得到自己組織的', async () => {
    await seedSystemAdmin(ACCOUNT);
    const { cookie } = await asTeacher();
    const other = await seedUser('other@test.edu.tw', '別校老師');
    await seedTaskOf(other.id, true, await seedOrg('別的組織'), '別組織的共用題');
    await seedTaskOf(other.id, false, null, '別人的個人題');

    await setIdentity(cookie, 'system_admin');
    const asAdmin = await listTitles(cookie);
    assert.ok(asAdmin.includes('別組織的共用題'));
    assert.ok(!asAdmin.includes('別人的個人題'), '別人的個人題不是共同題庫的一部分');

    await setIdentity(cookie, 'instructor');
    assert.ok(!(await listTitles(cookie)).includes('別組織的共用題'));
  });

  test('管理人員可以改、封存、刪別人的共用題；動不了別人的個人題，也不能把共用題改成個人題', async () => {
    await seedUser(ACCOUNT, '管理員');
    await seedSystemAdmin(ACCOUNT);
    const other = await seedUser('other@test.edu.tw', '別人');
    const shared = await seedTaskOf(other.id, true, await seedOrg(), '別人的共用題');
    const personal = await seedTaskOf(other.id, false, null, '別人的個人題');
    const cookie = await login(srv);
    await setIdentity(cookie, 'system_admin');

    // 送 shared: false 也不會讓它變成「掛在別人名下的個人題」
    assert.equal((await put(cookie, `/service/instructor/tasks/${shared}`, { ...base, title: '管理員改過', shared: false })).status, 200);
    const row = await rawDb.one(`SELECT title, shared FROM task WHERE id = $1`, [shared]);
    assert.equal(row.title, '管理員改過');
    assert.equal(row.shared, true);

    assert.equal((await put(cookie, `/service/instructor/tasks/${shared}/archived`, { archived: true })).status, 200);
    assert.equal((await put(cookie, `/service/instructor/tasks/${personal}`, { ...base, shared: false })).status, 404);
    assert.equal((await req(srv, `/service/instructor/tasks/${personal}`, cookie, { method: 'DELETE' })).status, 404);
    assert.equal((await req(srv, `/service/instructor/tasks/${shared}`, cookie, { method: 'DELETE' })).status, 200);
  });


  test('有管理資格、但切回授課教師身分時一樣不能動共同題庫', async () => {
    await seedSystemAdmin(ACCOUNT);
    const { cookie } = await asTeacher();
    await setIdentity(cookie, 'instructor');
    assert.equal((await post(cookie, '/service/instructor/tasks', { ...base, shared: true })).status, 403);
  });
});
