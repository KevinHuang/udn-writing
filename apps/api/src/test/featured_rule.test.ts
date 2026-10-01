/**
 * 自動蓋佳作（dal/featured_rule_helper.ts、docs/migrations/009）。
 *
 * 釘住使用者決定的三條規則 —— 任何一條鬆掉，老師都會覺得「系統動了我的章」：
 *   1. 用當下批改的人的標準；作業另外調整過就用作業的
 *   2. 每篇只判斷一次，之後改分、取消章都不再動
 *   3. 只對之後的批改生效（已經批改過的作品再存檔不算）
 *
 * 批改一律走 POST /submissions/:id/feedback（教師存檔）—— 它與 AI 批改最後都呼叫
 * InstructorHelper.saveFeedback，自動蓋章就掛在那裡。
 */
import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  resetDb, rawDb, seedUser, seedSchool, seedCourse, seedInstructor, seedLearner,
  seedTask, seedAssignment, seedSubmission, startFakeIdp, startServer, login, req,
  type TestServer,
} from './helpers';

const ACCOUNT = 'me@test.edu.tw';
let srv: TestServer;
let idp: { close: () => Promise<void> };

before(async () => {
  idp = await startFakeIdp({ mail: ACCOUNT });
  srv = await startServer();
});
after(async () => { await srv.close(); await idp.close(); await rawDb.$pool.end(); });
beforeEach(resetDb);

const json = (method: string, body: unknown) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

/** 我的班、一份作業、三位學生各交一篇；另外一個別人的班 */
async function scenario() {
  const me = await seedUser(ACCOUNT, '我');
  const other = await seedUser('other@test.edu.tw', '別的老師');
  const school = await seedSchool();
  const mine = await seedCourse(school, '我的班');
  const theirs = await seedCourse(school, '別人的班');
  await seedInstructor(mine, me.id);
  await seedInstructor(theirs, other.id);

  const task = await seedTask(me.id);
  const assignment = await seedAssignment(mine, task, me.id);
  const theirAssignment = await seedAssignment(theirs, task, other.id);

  const subs: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const s = await seedUser(`s${i}@test.edu.tw`, `學生${i}`);
    await seedLearner(mine, s.id, i);
    subs.push(await seedSubmission(assignment, s.id));
  }
  return { me, other, assignment, theirAssignment, subs, cookie: await login(srv) };
}

const grade = (cookie: string, submissionId: string, score: number) =>
  req(srv, `/service/instructor/submissions/${submissionId}/feedback`, cookie,
    json('POST', { score, analysis_content: { score, response: '評語' } }));

const setMyRule = (cookie: string, body: unknown) =>
  req(srv, '/service/instructor/featured-rule', cookie, json('PUT', body));

const setAssignmentRule = (cookie: string, assignmentId: string, body: unknown) =>
  req(srv, `/service/instructor/assignments/${assignmentId}/featured-rule`, cookie, json('PUT', body));

const featured = async (submissionId: string) =>
  (await rawDb.oneOrNone(
    `SELECT 1 FROM submission_mark WHERE ref_submission_id = $1 AND kind = 'featured'`, [submissionId],
  )) !== null;

describe('自己的標準', () => {
  test('沒設定過是關閉、5 級分', async () => {
    const { cookie } = await scenario();
    const res = await req(srv, '/service/instructor/featured-rule', cookie);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { enabled: false, min_score: 5 });
  });

  test('存得進去也讀得回來', async () => {
    const { cookie } = await scenario();
    assert.equal((await setMyRule(cookie, { enabled: true, min_score: 4 })).status, 200);
    const res = await req(srv, '/service/instructor/featured-rule', cookie);
    assert.deepEqual(await res.json(), { enabled: true, min_score: 4 });
  });

  test('格式不對 → 400', async () => {
    const { cookie } = await scenario();
    for (const body of [{}, { enabled: true }, { enabled: 'yes', min_score: 5 },
      { enabled: true, min_score: 0 }, { enabled: true, min_score: 7 }, { enabled: true, min_score: 4.5 }]) {
      assert.equal((await setMyRule(cookie, body)).status, 400, JSON.stringify(body));
    }
  });
});

describe('批改完成時自動蓋章', () => {
  test('沒開 → 不蓋', async () => {
    const { cookie, subs } = await scenario();
    await grade(cookie, subs[0], 6);
    assert.equal(await featured(subs[0]), false);
  });

  test('開了：達到標準蓋、沒達到不蓋（等於標準也算達到）', async () => {
    const { cookie, subs } = await scenario();
    await setMyRule(cookie, { enabled: true, min_score: 5 });
    await grade(cookie, subs[0], 5);
    await grade(cookie, subs[1], 6);
    await grade(cookie, subs[2], 4);
    assert.equal(await featured(subs[0]), true);
    assert.equal(await featured(subs[1]), true);
    assert.equal(await featured(subs[2]), false);
  });

  test('每篇只判斷一次：老師取消章之後再存檔，不會蓋回去', async () => {
    const { cookie, subs } = await scenario();
    await setMyRule(cookie, { enabled: true, min_score: 5 });
    await grade(cookie, subs[0], 6);
    await req(srv, `/service/instructor/submissions/${subs[0]}/marks/featured`, cookie,
      json('PUT', { marked: false }));
    await grade(cookie, subs[0], 6);  // 老師改評語再存檔
    assert.equal(await featured(subs[0]), false);
  });

  test('每篇只判斷一次：第一次沒達標，之後改成高分也不自動蓋', async () => {
    const { cookie, subs } = await scenario();
    await setMyRule(cookie, { enabled: true, min_score: 5 });
    await grade(cookie, subs[0], 3);
    await grade(cookie, subs[0], 6);
    assert.equal(await featured(subs[0]), false);
  });

  test('每篇只判斷一次：重置批改後重批也不再判斷，自動蓋的章照樣留著', async () => {
    const { cookie, subs } = await scenario();
    await setMyRule(cookie, { enabled: true, min_score: 5 });
    await grade(cookie, subs[0], 6);
    await req(srv, `/service/instructor/grading/reset/${subs[0]}`, cookie, { method: 'POST' });
    await grade(cookie, subs[0], 2);
    // 重置不清標記（apps/web/CLAUDE.md），也不會因為重批的低分被拿掉
    assert.equal(await featured(subs[0]), true);
  });

  test('只對之後的批改生效：開啟前就批改過的作品，再存檔也不蓋', async () => {
    const { cookie, subs } = await scenario();
    await grade(cookie, subs[0], 6);
    await setMyRule(cookie, { enabled: true, min_score: 5 });
    await grade(cookie, subs[0], 6);
    assert.equal(await featured(subs[0]), false);
  });

  test('老師已經手動蓋過的，自動蓋章不會出錯也不會重複', async () => {
    const { cookie, subs } = await scenario();
    await setMyRule(cookie, { enabled: true, min_score: 5 });
    // 還沒批改不能從畫面蓋章，但資料庫允許 —— 直接寫一筆模擬「先蓋了」
    await rawDb.none(
      `INSERT INTO submission_mark (ref_submission_id, kind, ref_user_id) VALUES ($1, 'featured', NULL)`,
      [subs[0]],
    );
    const res = await grade(cookie, subs[0], 6);
    assert.equal(res.status, 200);
    const { n } = await rawDb.one(
      `SELECT count(*)::int AS n FROM submission_mark WHERE ref_submission_id = $1`, [subs[0]],
    );
    assert.equal(n, 1);
  });
});

describe('作業另外調整的標準', () => {
  test('custom：以作業的標準為準（6 級分），不看自己的（5 級分）', async () => {
    const { cookie, subs, assignment } = await scenario();
    await setMyRule(cookie, { enabled: true, min_score: 5 });
    assert.equal((await setAssignmentRule(cookie, assignment, { mode: 'custom', min_score: 6 })).status, 200);
    await grade(cookie, subs[0], 5);
    await grade(cookie, subs[1], 6);
    assert.equal(await featured(subs[0]), false);
    assert.equal(await featured(subs[1]), true);
  });

  test('custom：自己沒開，作業調整過照樣自動蓋', async () => {
    const { cookie, subs, assignment } = await scenario();
    await setAssignmentRule(cookie, assignment, { mode: 'custom', min_score: 4 });
    await grade(cookie, subs[0], 4);
    assert.equal(await featured(subs[0]), true);
  });

  test('off：自己開著，這份作業也不自動蓋', async () => {
    const { cookie, subs, assignment } = await scenario();
    await setMyRule(cookie, { enabled: true, min_score: 1 });
    await setAssignmentRule(cookie, assignment, { mode: 'off' });
    await grade(cookie, subs[0], 6);
    assert.equal(await featured(subs[0]), false);
  });

  test('inherit：回到沿用自己的標準，GET 也不再列出這份作業', async () => {
    const { cookie, subs, assignment } = await scenario();
    await setMyRule(cookie, { enabled: true, min_score: 5 });
    await setAssignmentRule(cookie, assignment, { mode: 'off' });
    let rows = await (await req(srv, '/service/instructor/featured-rules/assignments', cookie)).json();
    assert.deepEqual(rows, [{ assignment_id: String(assignment), min_score: null }]);

    await setAssignmentRule(cookie, assignment, { mode: 'inherit' });
    rows = await (await req(srv, '/service/instructor/featured-rules/assignments', cookie)).json();
    assert.deepEqual(rows, []);
    await grade(cookie, subs[0], 5);
    assert.equal(await featured(subs[0]), true);
  });

  test('用的是當下批改的人的標準：作業沒調整時，別人的設定不影響我', async () => {
    const { cookie, subs, other } = await scenario();
    // 別的老師開了 1 級分，我沒開
    await rawDb.none(
      `INSERT INTO featured_rule_user (ref_user_id, enabled, min_score) VALUES ($1, true, 1)`, [other.id],
    );
    await grade(cookie, subs[0], 6);
    assert.equal(await featured(subs[0]), false);
  });

  test('不能調整別人班上的作業', async () => {
    const { cookie, theirAssignment } = await scenario();
    const res = await setAssignmentRule(cookie, theirAssignment, { mode: 'custom', min_score: 5 });
    assert.equal(res.status, 404);
    const { n } = await rawDb.one(`SELECT count(*)::int AS n FROM featured_rule_assignment`);
    assert.equal(n, 0);
  });

  test('格式不對 → 400', async () => {
    const { cookie, assignment } = await scenario();
    for (const body of [{}, { mode: 'auto' }, { mode: 'custom' }, { mode: 'custom', min_score: 9 }]) {
      assert.equal((await setAssignmentRule(cookie, assignment, body)).status, 400, JSON.stringify(body));
    }
  });
});
