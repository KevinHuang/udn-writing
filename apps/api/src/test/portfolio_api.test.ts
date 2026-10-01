/**
 * 數位作品集專用資料介面（routes/portfolio.ts）。
 *
 * 這組端點是**另一個平台**的資料來源，給錯一筆就是學生作品外流。釘住的規則：
 *   - 身分來自 1Campus access token；沒有、無效 → 401；不是學生 → 403
 *   - 學生只拿得到自己**已發還**的作品
 *   - 同校觀摩 = 佳作 ＋ 學生願意公開 ＋ 已發還 ＋ 同校；預選、沒決定、不願意、別校都不給
 *   - 觀摩的級分依班級設定；觀摩不給評語與座號
 *   - 原稿照片的網址有簽章與期限，改一個字或過期都拿不到
 *   - 家長端點在 1Campus 文件到之前回 501；接上之後只看得到自己的子女
 */
import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  resetDb, rawDb, seedUser, seedSchool, seedCourse, seedInstructor, seedLearner,
  seedTask, seedAssignment, seedSubmission, startFakeIdp, startServer, req,
  type TestServer,
} from './helpers';
import { clearPortfolioIdentityCache } from '../lib/portfolio_identity';
import { signedImagePath } from '../lib/portfolio_image';
import { notConfiguredParentLinks, setParentLinkResolver } from '../lib/parent_links';

const ALICE = 'alice@test.edu.tw';     // A 校一班
const BOB = 'bob@test.edu.tw';         // A 校二班（與 Alice 同校）
const CAROL = 'carol@test.edu.tw';     // B 校
const TEACHER = 'teacher@test.edu.tw';

let srv: TestServer;
let idp: { close: () => Promise<void> };

before(async () => {
  idp = await startFakeIdp({
    mail: TEACHER,
    tokens: {
      'tok-alice': { mail: ALICE, lastName: '王', firstName: '小美' },
      'tok-bobby': { mail: BOB },
      'tok-carol': { mail: CAROL },
      'tok-teacher': { mail: TEACHER },
      'tok-parent': { mail: 'parent@test.edu.tw' },
    },
  });
  srv = await startServer();
});
after(async () => { await srv.close(); await idp.close(); await rawDb.$pool.end(); });
beforeEach(async () => {
  await resetDb();
  clearPortfolioIdentityCache();
  setParentLinkResolver(notConfiguredParentLinks);
});

const get = (path: string, token?: string) =>
  req(srv, `/service/portfolio/v1${path}`, undefined, token ? { headers: { authorization: `Bearer ${token}` } } : {});
const json = async (path: string, token?: string) => {
  const res = await get(path, token);
  return { status: res.status, body: res.status < 300 ? await res.json() : await res.json().catch(() => null) };
};

/** 已批改。returned 決定學生看不看得到 */
const grade = (submissionId: string, teacherId: string, score: number, returned: boolean) =>
  rawDb.none(
    `INSERT INTO submission_feedback (ref_submission_id, score, content, ref_user_id, is_ai, is_valid, is_returned)
     VALUES ($1, $2, $3, $4, true, true, $5)`,
    [submissionId, score, JSON.stringify({ score, response: `評語-${submissionId}` }), teacherId, returned],
  );
const mark = (submissionId: string, kind: 'featured' | 'preselect') =>
  rawDb.none(`INSERT INTO submission_mark (ref_submission_id, kind) VALUES ($1, $2)`, [submissionId, kind]);
const consent = (submissionId: string, willing: boolean) =>
  rawDb.none(`INSERT INTO submission_publish_consent (ref_submission_id, willing) VALUES ($1, $2)`, [submissionId, willing]);

async function world() {
  const teacher = await seedUser(TEACHER, '老師');
  const alice = await seedUser(ALICE, '王小美');
  const bob = await seedUser(BOB, '李大明');
  const carol = await seedUser(CAROL, '陳小華');
  const schoolA = await seedSchool('甲國中', 'a.edu.tw');
  const schoolB = await seedSchool('乙國中', 'b.edu.tw');
  const a1 = await seedCourse(schoolA, '國二1班');
  const a2 = await seedCourse(schoolA, '國二2班');
  const b1 = await seedCourse(schoolB, '國二1班');
  for (const c of [a1, a2, b1]) await seedInstructor(c, teacher.id);
  await seedLearner(a1, alice.id, 5);
  await seedLearner(a2, bob.id, 7);
  await seedLearner(b1, carol.id, 3);
  const task = await seedTask(teacher.id, '我的夢想');
  const asg = {
    a1: await seedAssignment(a1, task, teacher.id),
    a2: await seedAssignment(a2, task, teacher.id),
    b1: await seedAssignment(b1, task, teacher.id),
  };
  return { teacher, alice, bob, carol, schoolA, schoolB, a1, a2, b1, asg };
}

describe('驗證', () => {
  test('沒有 token → 401；1Campus 說無效 → 401', async () => {
    assert.equal((await get('/me')).status, 401);
    assert.equal((await get('/me', 'bad-xxxxxxxx')).status, 401);
  });

  test('token 不收網址參數', async () => {
    await world();
    const res = await req(srv, '/service/portfolio/v1/me?access_token=tok-alice');
    assert.equal(res.status, 401);
  });

  test('/me：學生拿得到學校；不是學生的人 roles 是空的、學生端點 403', async () => {
    const w = await world();
    const me = await json('/me', 'tok-alice');
    assert.equal(me.status, 200);
    assert.deepEqual(me.body.roles, ['student']);
    assert.deepEqual(me.body.schools, [{ id: w.schoolA, name: '甲國中' }]);
    assert.equal(me.body.parent_links_available, false);

    const t = await json('/me', 'tok-teacher');
    assert.deepEqual(t.body.roles, []);
    assert.equal((await get('/me/works', 'tok-teacher')).status, 403);
    assert.equal((await get('/showcase', 'tok-teacher')).status, 403);
  });
});

describe('自己的作品', () => {
  test('只給已發還的，帶評語、級分、佳作、公開意願；別人的不給', async () => {
    const w = await world();
    const returned = await seedSubmission(w.asg.a1, w.alice.id, '我的夢想是當作家。');
    const task2 = await seedTask(w.teacher.id, '一次難忘的旅行');
    const unreturned = await seedSubmission(await seedAssignment(w.a1, task2, w.teacher.id), w.alice.id);
    await grade(returned, w.teacher.id, 5, true);
    await grade(unreturned, w.teacher.id, 6, false);
    await mark(returned, 'featured');
    await consent(returned, true);
    const bobs = await seedSubmission(w.asg.a2, w.bob.id);
    await grade(bobs, w.teacher.id, 4, true);

    const { status, body } = await json('/me/works', 'tok-alice');
    assert.equal(status, 200);
    assert.equal(body.length, 1);
    const work = body[0];
    assert.equal(work.id, returned);
    assert.equal(work.title, '我的夢想');
    assert.equal(work.score, 5);
    assert.equal(work.feedback, `評語-${returned}`);
    assert.equal(work.content, '我的夢想是當作家。');
    assert.equal(work.seat_no, 5);
    assert.equal(work.featured, true);
    assert.equal(work.publish_consent, true);
    assert.equal(work.school.name, '甲國中');
    assert.equal(work.semester, '115-1');
  });
});

describe('同校觀摩', () => {
  /** Bob（同校）各種狀態的作品各一篇，加上 Carol（別校）的一篇 */
  async function showcaseWorld() {
    const w = await world();
    const t = async (title: string) => seedAssignment(w.a2, await seedTask(w.teacher.id, title), w.teacher.id);
    const ok = await seedSubmission(w.asg.a2, w.bob.id, '公開的佳作內容');
    const undecided = await seedSubmission(await t('還沒決定'), w.bob.id);
    const unwilling = await seedSubmission(await t('不願公開'), w.bob.id);
    const notReturned = await seedSubmission(await t('還沒發還'), w.bob.id);
    const preselectOnly = await seedSubmission(await t('只是預選'), w.bob.id);
    const otherSchool = await seedSubmission(w.asg.b1, w.carol.id);

    for (const id of [ok, undecided, unwilling, preselectOnly, otherSchool]) await grade(id, w.teacher.id, 6, true);
    await grade(notReturned, w.teacher.id, 6, false);
    for (const id of [ok, undecided, unwilling, notReturned, otherSchool]) await mark(id, 'featured');
    await mark(preselectOnly, 'preselect');
    for (const id of [ok, notReturned, preselectOnly, otherSchool]) await consent(id, true);
    await consent(unwilling, false);
    return { ...w, ok, undecided, unwilling, notReturned, preselectOnly, otherSchool };
  }

  test('只有「佳作＋願意公開＋已發還＋同校」的會出現', async () => {
    const w = await showcaseWorld();
    const { status, body } = await json('/showcase', 'tok-alice');
    assert.equal(status, 200);
    assert.deepEqual(body.map((x: { id: string }) => x.id), [w.ok]);
    // 別校的學生看不到甲校的作品
    assert.deepEqual((await json('/showcase', 'tok-carol')).body.map((x: { id: string }) => x.id), [w.otherSchool]);
  });

  test('觀摩不給評語與座號；級分預設不給，班級打開才給', async () => {
    const w = await showcaseWorld();
    let item = (await json('/showcase', 'tok-alice')).body[0];
    assert.equal(item.score, null);
    assert.equal('feedback' in item, false);
    assert.equal('seat_no' in item, false);
    assert.equal(item.excerpt, '公開的佳作內容');

    await rawDb.none(`INSERT INTO course_showcase (ref_course_id, show_score) VALUES ($1, true)`, [w.a2]);
    item = (await json('/showcase', 'tok-alice')).body[0];
    assert.equal(item.score, 6);
  });

  test('school_id 只能是自己的學校；學期格式不對 → 400；學期篩選有效', async () => {
    const w = await showcaseWorld();
    assert.equal((await get(`/showcase?school_id=${w.schoolB}`, 'tok-alice')).status, 403);
    assert.equal((await get(`/showcase?school_id=${w.schoolA}`, 'tok-alice')).status, 200);
    assert.equal((await get('/showcase?semester=abc', 'tok-alice')).status, 400);
    assert.equal((await json('/showcase?semester=114-2', 'tok-alice')).body.length, 0);
    assert.equal((await json('/showcase?semester=115-1', 'tok-alice')).body.length, 1);
  });

  test('單篇：觀摩裡的給觀摩版；不在觀摩裡的、別校的一律 404', async () => {
    const w = await showcaseWorld();
    const detail = await json(`/works/${w.ok}`, 'tok-alice');
    assert.equal(detail.status, 200);
    assert.equal(detail.body.content, '公開的佳作內容');
    assert.equal('feedback' in detail.body, false);
    for (const id of [w.undecided, w.unwilling, w.notReturned, w.preselectOnly, w.otherSchool, '999999', 'abc']) {
      assert.equal((await get(`/works/${id}`, 'tok-alice')).status, 404, String(id));
    }
    // 作者本人看到的是完整版
    const own = await json(`/works/${w.ok}`, 'tok-bobby');
    assert.equal(own.status, 200);
    assert.equal(own.body.feedback, `評語-${w.ok}`);
  });
});

describe('原稿照片', () => {
  async function withImages() {
    const w = await world();
    const sub = await seedSubmission(w.asg.a1, w.alice.id);
    await rawDb.none(`UPDATE submission SET pic_files = $2::jsonb WHERE id = $1`,
      [sub, JSON.stringify(['submit/assign_1/p1.jpg', 'submit/assign_1/p2.jpg'])]);
    await grade(sub, w.teacher.id, 5, true);
    return { ...w, sub };
  }

  test('作品帶簽章網址，一張一個；照網址拿得到圖', async () => {
    const w = await withImages();
    const work = (await json('/me/works', 'tok-alice')).body[0];
    assert.equal(work.images.length, 2);
    assert.match(work.images[0], new RegExp(`^/service/portfolio/v1/images/${w.sub}/0\\?exp=\\d+&sig=`));
    // 不需要 Authorization —— <img> 送不出標頭
    const res = await req(srv, work.images[1]);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
  });

  test('簽章改一個字、過期、換別張 → 403；超出張數 → 404', async () => {
    const w = await withImages();
    const url = signedImagePath(w.sub, 0);
    const tampered = url.slice(0, -1) + (url.endsWith('A') ? 'B' : 'A');
    assert.equal((await req(srv, tampered)).status, 403);
    assert.equal((await req(srv, signedImagePath(w.sub, 0, Date.now() - 20 * 60 * 1000))).status, 403);
    assert.equal((await req(srv, url.replace(`/${w.sub}/0?`, `/${w.sub}/1?`))).status, 403);
    assert.equal((await req(srv, signedImagePath(w.sub, 5))).status, 404);
  });

  test('pic_files 空著時退回批次代繳交的照片', async () => {
    const w = await world();
    const sub = await seedSubmission(w.asg.a1, w.alice.id);
    await grade(sub, w.teacher.id, 5, true);
    await rawDb.none(
      `INSERT INTO batch_proxy_submission (ref_assignment_id, ref_user_id, submitter_id, img_files, is_valid)
       VALUES ($1, $2, $3, $4::json, true)`,
      [w.asg.a1, w.alice.id, w.teacher.id, JSON.stringify(['scan-a.jpg'])],
    );
    const work = (await json('/me/works', 'tok-alice')).body[0];
    assert.equal(work.images.length, 1);
    assert.equal((await req(srv, work.images[0])).status, 200);
  });
});

describe('家長（預留）', () => {
  test('1Campus 家長身分還沒接上 → 501', async () => {
    await world();
    assert.equal((await get('/children', 'tok-parent')).status, 501);
    assert.equal((await get(`/children/${ALICE}/works`, 'tok-parent')).status, 501);
  });

  test('接上之後：只看得到自己的子女，而且只有已發還的', async () => {
    const w = await world();
    const sub = await seedSubmission(w.asg.a1, w.alice.id);
    await grade(sub, w.teacher.id, 5, true);
    const bobs = await seedSubmission(w.asg.a2, w.bob.id);
    await grade(bobs, w.teacher.id, 4, true);
    setParentLinkResolver({
      available: true,
      async childrenOf(parent) { return parent.mail === 'parent@test.edu.tw' ? [ALICE] : []; },
    });

    const kids = await json('/children', 'tok-parent');
    assert.deepEqual(kids.body.map((k: { account: string }) => k.account), [ALICE]);
    const works = await json(`/children/${ALICE}/works`, 'tok-parent');
    assert.deepEqual(works.body.map((x: { id: string }) => x.id), [sub]);
    assert.equal((await get(`/children/${BOB}/works`, 'tok-parent')).status, 404);
  });
});
