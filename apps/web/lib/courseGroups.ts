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

/** 縣市或學校還沒確定的課程，統一收在這一組 */
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
 * 依「縣市＋學校」分組，保持傳入的順序。
 *
 * 解析不到縣市或學校的收進同一組，不要讓它們散落成一堆單獨的組 ——
 * 那會讓待確認的課程看起來像很多所不同的學校。
 */
export function groupCoursesBySchool(courses: Course[]): SchoolGroup[] {
  const map = new Map<string, SchoolGroup>();
  courses.forEach((c) => {
    const label = c.city && c.schoolName ? `${c.city}${c.schoolName}` : UNASSIGNED_GROUP;
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
