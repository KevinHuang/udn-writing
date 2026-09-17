/**
 * 校務系統課程名稱的解析。
 *
 * 校務系統給過來的是一整串，例如「新北市淡江中學國三孝班」——
 * 縣市、學校、班級沒有分開。但管理人員要依縣市篩選、依學校分組、
 * 出跨校報表，這三段就必須是分開的。
 *
 * 作法：**匯入時解析一次，把結果存進 Course**，之後所有畫面讀存好的
 * 欄位，不再碰字串。原始字串完整保留在 Course.name，解析錯了也不會
 * 弄丟資料。這跟「每次要用就重新解析」是兩回事 —— 後者這個專案已經
 * 被咬過三次（座號、學期代碼、學生 ID）。
 *
 * 解析不到就標 low，交給管理人員確認，不猜。留白看得見，猜錯看不見。
 */

import { SchoolLevel } from '../types';

export interface ParsedCourseName {
  city: string | null;
  schoolName: string | null;
  schoolLevel: SchoolLevel | null;
  className: string | null;
  /** high = 三段都拆乾淨；low = 有缺或有歧義，需要人工確認 */
  confidence: 'high' | 'low';
}

/** 全國 22 個直轄市、縣、市。這是封閉集合，所以查表比正規表示式可靠 */
export const CITIES = [
  '臺北市', '新北市', '桃園市', '臺中市', '臺南市', '高雄市',
  '基隆市', '新竹市', '嘉義市',
  '新竹縣', '苗栗縣', '彰化縣', '南投縣', '雲林縣', '嘉義縣',
  '屏東縣', '宜蘭縣', '花蓮縣', '臺東縣', '澎湖縣', '金門縣', '連江縣',
] as const;

/**
 * 校名結尾關鍵字。**長的一定要排在短的前面** ——
 * 否則「國民中學」會先被「國民」以外的短詞切斷，切出半截校名。
 */
const SCHOOL_SUFFIXES: { suffix: string; level: SchoolLevel | null }[] = [
  { suffix: '國民中學', level: '國中' },
  { suffix: '國民小學', level: '國小' },
  { suffix: '實驗中學', level: '國中' },
  { suffix: '實驗小學', level: '國小' },
  { suffix: '完全中學', level: '國中' },
  { suffix: '高級中學', level: null },   // 可能含國中部，判不出來
  { suffix: '附設國中', level: '國中' },
  { suffix: '附設國小', level: '國小' },
  { suffix: '中學', level: null },       // 淡江中學是完全中學，兩可
  { suffix: '國中', level: '國中' },
  { suffix: '國小', level: '國小' },
  { suffix: '小學', level: '國小' },
];

/**
 * 同一所學校的不同寫法。
 *
 * 髒資料靠這張表收：縣市簡寫（北市）、學校改名、全銜與簡稱並存。
 * 管理人員遇到一次補一次，之後同樣的字串就自動歸位。
 * key 是原始字串的「校名段」，比對前會先做正規化。
 */
export const SCHOOL_ALIASES: Record<
  string,
  { city: string; schoolName: string; schoolLevel: SchoolLevel }
> = {
  北市大安國中: { city: '臺北市', schoolName: '大安國中', schoolLevel: '國中' },
  // 完全中學：這套系統用的是國中部，釘死才不會每個班都掉進待確認
  新北市淡江中學: { city: '新北市', schoolName: '淡江中學', schoolLevel: '國中' },
  新北市私立淡江高級中學: { city: '新北市', schoolName: '淡江中學', schoolLevel: '國中' },
};

/**
 * 正規化：臺／台 視為同一字，去掉空白與全形空白。
 * 校務系統兩種寫法都會出現，不統一就會切出兩所學校。
 */
export const normalize = (input: string): string =>
  input.replace(/[\s\u3000]/g, '').replace(/台/g, '臺');

/** 由校名推定學制。判不出來回 null */
const levelOf = (schoolName: string): SchoolLevel | null => {
  for (const { suffix, level } of SCHOOL_SUFFIXES) {
    if (schoolName.endsWith(suffix)) return level;
  }
  return null;
};

/**
 * 班級名稱裡出現「分校／分部」代表校名沒有切完整 ——
 * 「淡江中學八里分校」是另一個校區，不能併進本校。
 * 這種一律送人工確認，不要猜。
 */
const hasCampusMarker = (className: string): boolean =>
  /分校|分部|校區/.test(className);

const EMPTY: ParsedCourseName = {
  city: null,
  schoolName: null,
  schoolLevel: null,
  className: null,
  confidence: 'low',
};

/**
 * 把「新北市淡江中學國三孝班」拆成縣市／學校／班級。
 *
 * 純函式，沒有副作用，可以單獨驗證。
 */
export function parseCourseName(raw: string): ParsedCourseName {
  const text = normalize(raw ?? '');
  if (!text) return { ...EMPTY };

  // ── 別名先比。中了就用，不再走字典 ────────────────────────
  for (const [alias, mapped] of Object.entries(SCHOOL_ALIASES)) {
    const key = normalize(alias);
    if (text.startsWith(key)) {
      const className = text.slice(key.length);
      return {
        ...mapped,
        className: className || null,
        confidence: className && !hasCampusMarker(className) ? 'high' : 'low',
      };
    }
  }

  // ── 縣市：取最長前綴 ─────────────────────────────────────
  let city: string | null = null;
  let rest = text;
  for (const candidate of CITIES) {
    if (text.startsWith(candidate) && (!city || candidate.length > city.length)) {
      city = candidate;
    }
  }
  if (city) rest = text.slice(city.length);

  // 公私立前綴不是校名的一部分。留著會切出「立第一女子高級中學」這種半截校名
  const ownership = ['市立', '縣立', '國立', '私立'].find((o) => rest.startsWith(o));
  if (ownership) rest = rest.slice(ownership.length);
  else if (city && rest.startsWith('立')) rest = rest.slice(1); // 「臺北市立…」的「立」黏在縣市後面

  // ── 學校：往下找第一個校名結尾關鍵字，長的先比 ─────────────
  let schoolName: string | null = null;
  let className: string | null = null;
  let levelFromSuffix: SchoolLevel | null = null;
  let ambiguousLevel = false;

  let bestEnd = -1;
  let bestSuffix: (typeof SCHOOL_SUFFIXES)[number] | null = null;
  for (const entry of SCHOOL_SUFFIXES) {
    const at = rest.indexOf(entry.suffix);
    if (at === -1) continue;
    const end = at + entry.suffix.length;
    // 取結束位置最前面的那一個 —— 校名在班級之前，先出現的才是校名
    if (bestEnd === -1 || end < bestEnd) {
      bestEnd = end;
      bestSuffix = entry;
    }
  }

  if (bestSuffix && bestEnd > 0) {
    schoolName = rest.slice(0, bestEnd);
    className = rest.slice(bestEnd) || null;
    levelFromSuffix = bestSuffix.level;
    ambiguousLevel = bestSuffix.level === null;
  }

  const schoolLevel = levelFromSuffix ?? (schoolName ? levelOf(schoolName) : null);

  // ── 信心度 ──────────────────────────────────────────────
  // 三段齊全、而且學制沒有歧義，才算 high。
  // 「高級中學」「中學」判不出是不是國中部，一律送人工確認。
  const confidence: 'high' | 'low' =
    city && schoolName && className && !ambiguousLevel && !hasCampusMarker(className)
      ? 'high'
      : 'low';

  return {
    city,
    schoolName,
    schoolLevel: schoolLevel ?? (ambiguousLevel ? '國中' : null),
    className,
    confidence,
  };
}

/** 顯示用：把解析結果組回一段可讀文字。缺的段落略過 */
export const describeParsed = (p: ParsedCourseName): string =>
  [p.city, p.schoolName, p.className].filter(Boolean).join(' ');


/**
 * 從校名取出縣市。
 *
 * ⚠️ **這支才是接上真實資料後真正需要的。**
 *    上面那一整套 parseCourseName() 是為了拆解「新北市淡江中學國三孝班」
 *    這種把縣市、學校、班級黏成一串的課程名稱 —— 但真實資料**不長那樣**：
 *    校名在 school.school_name（「新北市二重國中」）、班級在
 *    course.course_name（「國三8班」）、學段在 school.school_type，
 *    三者本來就是分開的欄位。
 *
 *    所以接上 API 之後只剩「校名的縣市前綴」要取，那就是這一支。
 *    parseCourseName() 目前還留著給 mockData 與校務同步視窗用，
 *    等那兩處也接上真實資料就可以整個刪掉（見 artifacts/spec.md）。
 */
export const cityOf = (schoolName: string): string | null =>
  CITIES.find((c) => normalize(schoolName ?? '').startsWith(c)) ?? null;
