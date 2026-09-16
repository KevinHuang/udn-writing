/**
 * 示範資料的一致性檢查。
 *
 * 起因：c1 的名冊被加了一位學生，但 MOCK_COURSES 的 studentCount 沒跟著改 ——
 * 畫面上寫「全班人數 32」，成績表卻列出 33 位。手動維護的數字一定會漂，
 * 而且 TypeScript 與 ESLint 都抓不到，只能靠這種檢查擋住。
 *
 * 同一個道理，Assignment 的 submittedCount 也已經整個移除 ——
 * 它從來沒有人讀，45 份裡有 40 份的數字是錯的。
 *
 * 用 npm run lint 一起跑。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// import.meta.url 對含空白與中文的路徑會是百分號編碼，一定要用 fileURLToPath
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'mockData.ts'), 'utf8');

const problems = [];

/** 抓出 RAW_ROSTERS 每個班的人數 */
const rosterBlock = src.match(/export const RAW_ROSTERS[^{]*\{([\s\S]*?)\n\};/);
if (!rosterBlock) problems.push('找不到 RAW_ROSTERS，檢查腳本需要更新');

const rosterSize = {};
if (rosterBlock) {
  for (const m of rosterBlock[1].matchAll(/(\w[\w-]*):\s*\[([\s\S]*?)\]/g)) {
    rosterSize[m[1]] = [...m[2].matchAll(/"([^"]+)"/g)].length;
  }
}

/** 抓出 MOCK_COURSES 每一門課宣告的 studentCount */
const courseBlock = src.match(/export const MOCK_COURSES[^[]*\[([\s\S]*?)\n\];/);
if (!courseBlock) problems.push('找不到 MOCK_COURSES，檢查腳本需要更新');

if (courseBlock) {
  for (const m of courseBlock[1].matchAll(/id:\s*"([^"]+)"[\s\S]*?studentCount:\s*(\d+)/g)) {
    const [, id, declared] = m;
    const actual = rosterSize[id];
    // 沒有名冊的（往年課程）不檢查
    if (actual !== undefined && Number(declared) !== actual) {
      problems.push(`課程 ${id} 的 studentCount 是 ${declared}，但 RAW_ROSTERS 有 ${actual} 人`);
    }
  }
}

/*
  往年課程的名冊是在 RAW_ROSTERS 定義之後用產生器補上的，不在上面那個
  字面量區塊裡。這裡把那份 [id, size] 清單也讀進來 ——
  少了這段，檢查就會在「當初出錯的那個位置」剛好有個破口。
*/
for (const m of src.matchAll(/\['(c-old-[\w-]+)',\s*(\d+)\]/g)) {
  rosterSize[m[1]] = Number(m[2]);
}

/*
  示範學生的 id 必須與 studentIdFor(courseId, seatNo) 的組法一致。
  兩者對不上時，學生一提交就會多出一筆「不在任何名冊裡」的紀錄。
*/
const constants = readFileSync(join(here, '..', 'lib', 'constants.ts'), 'utf8');
const demo = constants.match(/DEMO_STUDENT[\s\S]*?id:\s*'([^']+)'[\s\S]*?courseId:\s*'([^']+)'/);
if (!demo) {
  problems.push('讀不到 DEMO_STUDENT，檢查腳本需要更新');
} else {
  const [, id, courseId] = demo;
  // studentIdFor(courseId, 1) === `s-${courseId}-0`
  const expected = `s-${courseId}-0`;
  if (id !== expected) {
    problems.push(`DEMO_STUDENT.id 是 ${id}，但依 studentIdFor 應該是 ${expected}`);
  }
}

/** submittedCount 已經移除，不要再加回來 */
if (/submittedCount/.test(src)) {
  problems.push('mockData.ts 又出現 submittedCount —— 這個欄位沒有人讀且必然漂移，請改為由 submissions 計算');
}

if (problems.length) {
  console.error('\n示範資料一致性檢查未通過：');
  problems.forEach((p) => console.error('  - ' + p));
  console.error('');
  process.exit(1);
}

const n = Object.keys(rosterSize).length;
console.log(`示範資料一致性檢查通過：${n} 個班的名冊人數與 studentCount 相符。`);
