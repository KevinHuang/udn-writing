/**
 * 「啟動就該失敗」的防護，以及路由的邊界行為。
 *
 * 防護沒辦法在同一個行程裡測（模組載入時就跑掉了），所以開子行程驗證。
 * 這些防護的價值就在於**擋得住不小心**，所以它們本身要有測試蓋住。
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { startFakeIdp, startServer, req, rawDb, type TestServer } from './helpers';

const API_ROOT = path.resolve(__dirname, '../..');
const ENV_FILE = path.resolve(API_ROOT, '../../.env');

/** 在子行程裡載入某個模組，回傳 stderr 與結束碼。 */
function loadInChild(module: string, env: Record<string, string | undefined>) {
  const r = spawnSync(
    'npx',
    ['tsx', `--env-file=${ENV_FILE}`, '-e', `import('${module}').catch(e => { console.error(e.message); process.exit(1); })`],
    { cwd: API_ROOT, env: { ...process.env, ...env }, encoding: 'utf8' }
  );
  return { code: r.status, stderr: (r.stderr ?? '') + (r.stdout ?? '') };
}

describe('production 資料庫防護', () => {
  test('DB_NAME 指向 production 而 NODE_ENV 不是 production → 拒絕啟動', () => {
    const { code, stderr } = loadInChild('./src/dal/database.ts', {
      DB_NAME: 'writing_classroom',
      NODE_ENV: 'development',
    });
    assert.notEqual(code, 0, '應該要失敗');
    assert.match(stderr, /拒絕連線/);
    assert.match(stderr, /writing_classroom_test/);
  });

  test('指向測試庫時可以正常載入', () => {
    const { code } = loadInChild('./src/dal/database.ts', {
      DB_NAME: process.env.TEST_DB_NAME,
      NODE_ENV: 'test',
    });
    assert.equal(code, 0);
  });
});

describe('SESSION_KEY 防護', () => {
  test('沒有 SESSION_KEY → 拒絕啟動，且不回退到預設金鑰', () => {
    const { code, stderr } = loadInChild('./src/app.ts', {
      SESSION_KEY: '',
      DB_NAME: process.env.TEST_DB_NAME,
    });
    assert.notEqual(code, 0, '應該要失敗');
    assert.match(stderr, /缺少環境變數 SESSION_KEY/);
  });
});

describe('測試資料庫防護', () => {
  function runSetup(env: Record<string, string | undefined>) {
    const r = spawnSync('npx', ['tsx', `--env-file=${ENV_FILE}`, './src/test/setup.ts'],
      { cwd: API_ROOT, env: { ...process.env, ...env }, encoding: 'utf8' });
    return { code: r.status, out: (r.stderr ?? '') + (r.stdout ?? '') };
  }

  test('TEST_DB_NAME 與 DB_NAME 相同 → 中止', () => {
    const { code, out } = runSetup({ DB_NAME: 'same_db', TEST_DB_NAME: 'same_db' });
    assert.equal(code, 1);
    assert.match(out, /會把開發資料洗掉/);
  });

  test('TEST_DB_NAME 指向 production → 中止', () => {
    const { code, out } = runSetup({ DB_NAME: 'whatever', TEST_DB_NAME: 'writing_classroom' });
    assert.equal(code, 1);
    assert.match(out, /production/);
  });

  test('沒有設 TEST_DB_NAME → 中止', () => {
    const { code, out } = runSetup({ TEST_DB_NAME: '' });
    assert.equal(code, 1);
    assert.match(out, /TEST_DB_NAME/);
  });
});

describe('路由邊界', () => {
  let srv: TestServer;
  let idp: { close: () => Promise<void> };
  before(async () => {
    idp = await startFakeIdp({ mail: 'x@test.edu.tw' });
    srv = await startServer();
  });
  after(async () => { await srv.close(); await idp.close(); await rawDb.$pool.end(); });

  test('/service 底下打不到的路徑回 JSON 404，不是 index.html', async () => {
    // 這裡先前回的是 HTTP 200 + HTML：fallback 檢查的是 /api，
    // 但實際的 API 前綴是 /service。呼叫端要到 JSON.parse 才炸。
    const res = await req(srv, '/service/does-not-exist');
    assert.equal(res.status, 404);
    assert.match(res.headers.get('content-type') ?? '', /application\/json/);
    assert.deepEqual(await res.json(), { error: 'Not Found' });
  });

  test('/auth 底下打不到的路徑也是 JSON 404', async () => {
    const res = await req(srv, '/auth/does-not-exist');
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'Not Found' });
  });

  test('已改成 POST 的 admin 路由，用 GET 打回 405', async () => {
    const res = await req(srv, '/service/admin/sync/school');
    assert.equal(res.status, 405);
  });

  test('登出：POST 是正式方法，GET 暫時相容舊前端', async () => {
    assert.equal((await req(srv, '/auth/logout', undefined, { method: 'POST' })).status, 200);
    // ⚠️ apps/web 接上之後要把 GET 這條拿掉，屆時這個 assert 要改成 405
    assert.equal((await req(srv, '/auth/logout')).status, 200);
  });
});
