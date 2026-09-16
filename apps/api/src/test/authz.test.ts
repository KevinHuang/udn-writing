/**
 * 授權：誰能打哪些 endpoint。
 *
 * 這是 spec.md 裡最重要的一組驗收 —— `lib/access.ts` 自己註明原型的權限
 * 「不是真的存取控制」，真正的把關必須在伺服器端。
 */
import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  resetDb, rawDb, seedUser, seedSystemAdmin, seedSchool, seedCourse,
  seedInstructor, seedLearner, startFakeIdp, startServer, login, req,
  type TestServer,
} from './helpers';

const ACCOUNT = 'someone@test.edu.tw';
let srv: TestServer;
let idp: { close: () => Promise<void> };

before(async () => {
  idp = await startFakeIdp({ mail: ACCOUNT });
  srv = await startServer();
});
after(async () => { await srv.close(); await idp.close(); await rawDb.$pool.end(); });
beforeEach(resetDb);

/** 造一個只有學生身分的人並登入。 */
async function loginAsLearner() {
  const user = await seedUser(ACCOUNT, '學生');
  await seedLearner(await seedCourse(await seedSchool()), user.id);
  return login(srv);
}

/** 造一個只有教師身分的人並登入。 */
async function loginAsInstructor() {
  const user = await seedUser(ACCOUNT, '教師');
  await seedInstructor(await seedCourse(await seedSchool()), user.id);
  return login(srv);
}

describe('未登入一律擋下', () => {
  const paths: Array<[string, string]> = [
    ['GET', '/auth/me'],
    ['GET', '/service/user/my_identity'],
    ['GET', '/service/student/my_assignments'],
    ['GET', '/service/instructor/assignments'],
    ['GET', '/service/instructor/courses'],
    ['POST', '/service/admin/sync/school'],
    ['POST', '/service/admin/import'],
    ['POST', '/service/admin/gen_final_report'],
    ['GET', '/service/admin/schools/1/classes'],
    ['GET', '/service/admin/instructors/abc/courses'],
  ];
  for (const [method, path] of paths) {
    test(`${method} ${path} → 401`, async () => {
      const res = await req(srv, path, undefined, { method });
      assert.equal(res.status, 401, `${method} ${path}`);
    });
  }
});

describe('學生身分', () => {
  test('可以打學生的 endpoint', async () => {
    const res = await req(srv, '/service/student/my_assignments', await loginAsLearner());
    assert.equal(res.status, 200);
  });

  test('打教師的 endpoint → 403', async () => {
    const res = await req(srv, '/service/instructor/assignments', await loginAsLearner());
    assert.equal(res.status, 403);
  });

  test('打管理者的 endpoint → 403（不是 401，人已經登入了）', async () => {
    const cookie = await loginAsLearner();
    for (const path of ['/service/admin/sync/school', '/service/admin/import']) {
      const res = await req(srv, path, cookie, { method: 'POST' });
      assert.equal(res.status, 403, path);
    }
  });
});

describe('教師身分', () => {
  test('可以打教師的 endpoint', async () => {
    const res = await req(srv, '/service/instructor/courses', await loginAsInstructor());
    assert.equal(res.status, 200);
  });

  test('打學生的 endpoint → 403', async () => {
    const res = await req(srv, '/service/student/my_assignments', await loginAsInstructor());
    assert.equal(res.status, 403);
  });

  test('打管理者的 endpoint → 403', async () => {
    const res = await req(srv, '/service/admin/sync/school', await loginAsInstructor(), { method: 'POST' });
    assert.equal(res.status, 403);
  });
});

describe('系統管理者身分', () => {
  test('/auth/me 回報 isSystemAdmin', async () => {
    await seedSystemAdmin(ACCOUNT);
    const body = await (await req(srv, '/auth/me', await login(srv))).json();
    assert.equal(body.isSystemAdmin, true);
  });

  test('管理者以外的人一律被 isSystemAdmin 擋下', async () => {
    // 刻意不測「管理者打得通」的成功路徑 —— 那幾條會真的去呼叫 DevAPI、
    // 寫入資料或呼叫 AI。守衛擋下的路徑不會進到 handler，測起來才安全。
    const cookie = await loginAsInstructor();
    const res = await req(srv, '/service/admin/gen_final_report', cookie, { method: 'POST' });
    assert.equal(res.status, 403);
  });
});

describe('管理端的兩支唯讀查詢已收緊（C 方案）', () => {
  test('學生打 /admin/schools/:id/classes → 403', async () => {
    const cookie = await loginAsLearner();
    const school = await seedSchool();
    const res = await req(srv, `/service/admin/schools/${school}/classes?school_year=115&semester=1`, cookie);
    assert.equal(res.status, 403);
  });

  test('教師打 /admin/schools/:id/classes → 403（那支會吐出全校學生的 email 與座號）', async () => {
    const cookie = await loginAsInstructor();
    const school = await seedSchool('別間學校', 'other.edu.tw');
    const res = await req(srv, `/service/admin/schools/${school}/classes?school_year=115&semester=1`, cookie);
    assert.equal(res.status, 403);
  });

  test('/admin/instructors/:key/courses 可以用姓名查人，所以限定系統管理者', async () => {
    const res = await req(srv, '/service/admin/instructors/王小明/courses', await loginAsInstructor());
    assert.equal(res.status, 403);
  });
});

describe('教師端的 /instructor/school-courses', () => {
  test('缺少學年期參數 → 400', async () => {
    const res = await req(srv, '/service/instructor/school-courses', await loginAsInstructor());
    assert.equal(res.status, 400);
  });

  test('學生打不進來（整個 instructor router 需要教師身分）', async () => {
    const res = await req(srv, '/service/instructor/school-courses?school_year=115&semester=1', await loginAsLearner());
    assert.equal(res.status, 403);
  });

  test('回傳自己學校的課程，且不含任何學生個資', async () => {
    const teacher = await seedUser(ACCOUNT, '陳老師');
    const school = await seedSchool('永平中學');
    const mine = await seedCourse(school, '國三孝班');
    const sibling = await seedCourse(school, '國三仁班');   // 同校，別人的課
    await seedInstructor(mine, teacher.id);
    const student = await seedUser('stu@test.edu.tw', '林同學');
    await seedLearner(mine, student.id, 7);

    const res = await req(srv, '/service/instructor/school-courses?school_year=115&semester=1', await login(srv));
    assert.equal(res.status, 200);
    const rows = await res.json();

    // 同校的兩門課都看得到（要能瀏覽才能挑）
    assert.equal(rows.length, 2);
    const own = rows.find((r: any) => r.course_id === mine)!;
    assert.equal(own.course_name, '國三孝班');
    assert.equal(own.school_name, '永平中學');
    assert.equal(Number(own.student_count), 1);
    assert.equal(own.teacher_names, '陳老師');
    assert.equal(own.is_mine, true);
    assert.equal(rows.find((r: any) => r.course_id === sibling)!.is_mine, false);

    // ⚠️ 這是這支 endpoint 存在的理由：管理端那支會把
    //    每個學生的 account（email）、座號、原班級一起吐出來。
    const serialised = JSON.stringify(rows);
    assert.ok(!serialised.includes('stu@test.edu.tw'), '不應該出現學生的 email');
    assert.ok(!serialised.includes('林同學'), '不應該出現學生姓名');
    assert.ok(!serialised.includes('seat_no'), '不應該出現座號');
    for (const r of rows) assert.ok(!('students' in r), '不應該夾帶名冊');
  });

  test('看不到沒有掛課的學校', async () => {
    const teacher = await seedUser(ACCOUNT, '陳老師');
    const myCourse = await seedCourse(await seedSchool('永平中學', 'a.edu.tw'), '我的班');
    await seedInstructor(myCourse, teacher.id);
    // 另一間完全無關的學校
    await seedCourse(await seedSchool('別的中學', 'b.edu.tw'), '別人的班');

    const res = await req(srv, '/service/instructor/school-courses?school_year=115&semester=1', await login(srv));
    const rows = await res.json();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].school_name, '永平中學');
  });
});
