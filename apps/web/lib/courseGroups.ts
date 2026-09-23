/**
 * 課程依學校分組 —— 全站唯一來源。
 *
 * 管理人員看得到全省的課程，攤成一長串卡片牆找不到東西，所以一律
 * 「依學校分組」。分組讀的是匯入時 parseCourseName 解析好的
 * city / schoolName，**不要在畫面裡再拆一次字串**。
 *
 * 這段原本在 CourseList 寫了一次，成績管理的班級挑選視窗會是第二次 ——
 * 收在這裡，兩邊的分組方式與「待確認歸屬」的判斷才不會漂移。
 */

import { Course } from '../types';

/**
 * 還沒確定的歸屬。兩個用途：
 *   分組   —— 連校名都沒有的課程收在這一組
 *   縣市晶片 —— 認不出縣市的課程（校名沒有縣市前綴）收在這個晶片
 */
export const UNASSIGNED_GROUP = '待確認歸屬';

export interface SchoolGroup {
  /** 分組鍵，同時也是顯示標籤 */
  key: string;
  label: string;
  city?: string;
  schoolName?: string;
  courses: Course[];
}

/**
 * 縣市要不要另外寫出來。
 *
 * 縣市是從校名前綴認出來的（lib/schoolName.ts 的 cityOf），所以認得出縣市的
 * 校名本身就帶著它 ——「新北市二重國中」再前綴一次會變成「新北市新北市二重國中」。
 * 校名已經以縣市開頭就不重複。
 */
export function showCitySeparately(city: string | undefined, schoolName: string | undefined): boolean {
  return Boolean(city) && !(schoolName ?? '').startsWith(city as string);
}

/** 學校的顯示名：需要時前綴縣市（見 showCitySeparately） */
export function schoolLabel(city: string | undefined, schoolName: string, separator = ''): string {
  return showCitySeparately(city, schoolName) ? `${city}${separator}${schoolName}` : schoolName;
}

/**
 * 依學校分組（認得出縣市時帶上縣市），保持傳入的順序。
 *
 * **只有連校名都沒有的才收進「待確認歸屬」。** 原型以為縣市與校名要從同一串
 * 課名拆，拆不到縣市就等於整個拆失敗；但真實資料的校名來自 school 表，
 * 一定拿得到，只是大多數不帶縣市前綴（「石牌國中」）。以前照原型的規則，
 * 實測 28 個班有 27 個被併成一組「待確認歸屬」—— 石牌、中山、嶺東全混在一起，
 * 批改入口的待批改清單只看得到「待確認歸屬 作文班」，分不出是哪一間。
 */
export function groupCoursesBySchool(courses: Course[]): SchoolGroup[] {
  const map = new Map<string, SchoolGroup>();
  courses.forEach((c) => {
    const label = c.schoolName ? schoolLabel(c.city, c.schoolName) : UNASSIGNED_GROUP;
    const group = map.get(label);
    if (group) {
      group.courses.push(c);
    } else {
      map.set(label, {
        key: label,
        label,
        city: c.city,
        schoolName: c.schoolName,
        courses: [c],
      });
    }
  });
  return [...map.values()];
}

/**
 * 各縣市的課程數，另含 all 總數。
 *
 * 計數由**實際資料**產生，不是寫死的縣市清單 —— 校務系統送來別的縣市
 * （花蓮縣…）時才不會少一個晶片、那些班級篩不到。
 */
export function cityCountsOf(courses: Course[]): Record<string, number> {
  const counts: Record<string, number> = { all: courses.length };
  courses.forEach((c) => {
    const key = c.city ?? UNASSIGNED_GROUP;
    counts[key] = (counts[key] ?? 0) + 1;
  });
  return counts;
}

/** 縣市晶片的順序：全部 → 各縣市（字典序）→ 待確認歸屬殿後 */
export function cityChipsOf(counts: Record<string, number>): string[] {
  return [
    'all',
    ...Object.keys(counts)
      .filter((k) => k !== 'all' && k !== UNASSIGNED_GROUP)
      .sort(),
    ...(counts[UNASSIGNED_GROUP] ? [UNASSIGNED_GROUP] : []),
  ];
}

/**
 * 「整間學校」這個選擇要怎麼表示。
 *
 * 成績管理原本只認班級 id，加上「全校總覽」之後多了一種範圍。
 * 與其另外開一個 state（兩個值要同步，遲早會有一邊忘了更新），
 * 用同一個字串表示：班級就是 id，整間學校是 `school:<學校分組的 key>`。
 */
const SCHOOL_PREFIX = 'school:';

export const schoolScopeValue = (groupKey: string): string => `${SCHOOL_PREFIX}${groupKey}`;

/** 是整間學校的話回傳學校分組的 key，否則 null（代表那是班級 id） */
export const schoolScopeKey = (scope: string | null): string | null =>
  scope?.startsWith(SCHOOL_PREFIX) ? scope.slice(SCHOOL_PREFIX.length) : null;
