/**
 * 課程關鍵字搜尋。
 *
 * 管理人員看得到全省跨縣市的課程，光靠縣市晶片還是要在幾十張卡片裡找。
 * 這裡定義「一個關鍵字算不算命中一門課」—— 收在同一支函式，
 * 免得日後別的畫面再各寫一套比對規則。
 *
 * 比對的欄位刻意涵蓋整串課名與拆出來的三層（縣市／學校／班級），
 * 因為老師打的可能是「淡江」「國二」「701」或老師姓名，
 * 都該找得到同一門課。
 */

import { Course } from '../types';
import { normalize } from './schoolName';

/**
 * 一門課的可搜尋文字。
 *
 * name 是校務系統給的整串原文，city/schoolName/className 是匯入時
 * 解析好的結果 —— 兩邊都放進來，解析失敗的課程也還搜得到。
 */
function haystack(course: Course): string {
  return normalize(
    [
      course.name,
      course.code,
      course.city,
      course.schoolName,
      course.className,
      course.teacherName,
    ]
      .filter(Boolean)
      .join(' '),
  ).toLowerCase();
}

/**
 * 空白分隔的多關鍵字，全部都要命中（AND）。
 *
 * 用 AND 而不是 OR：「淡江 國二」應該是縮小範圍，
 * 用 OR 會把所有淡江和所有國二都倒出來，等於沒篩。
 *
 * **順序不能顛倒：先切詞，再逐詞 normalize。**
 * normalize() 會把空白整個拿掉（那是給整串校名用的，見 lib/schoolName.ts），
 * 先正規化再 split 的話「淡江 國二」會被黏成「淡江國二」，永遠只切得出一個詞，
 * 多關鍵字等於完全失效 —— 而且不會報錯，只會安靜地少給結果。
 */
export function matchesCourseQuery(course: Course, query: string): boolean {
  const terms = query
    .split(/[\s\u3000]+/)
    .map((t) => normalize(t).toLowerCase())
    .filter(Boolean);
  if (terms.length === 0) return true;
  const text = haystack(course);
  return terms.every((t) => text.includes(t));
}

export function filterCoursesByQuery(courses: Course[], query: string): Course[] {
  if (!query.trim()) return courses;
  return courses.filter((c) => matchesCourseQuery(c, query));
}
