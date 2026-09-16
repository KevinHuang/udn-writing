/**
 * 可視範圍。
 *
 * 兩種教師端身分：
 *   - 聯合報管理人員（ADMIN）：全省所有學校、所有課程
 *   - 授課教師（TEACHER）：只有掛在自己名下的班級
 *
 * 判斷收在這一支，不要在畫面裡散落 `if (role === ADMIN)` ——
 * 漏掉任何一個畫面就是資料外洩。專案裡 lib/scoring.ts、
 * lib/assignments.ts 都是同樣的理由。
 *
 * 注意：這是原型的展示用權限，不是真的存取控制。真實系統必須在
 * 伺服器端過濾，而且要用 teacherId 而非姓名比對（會同名）。
 */

import { Course, UserRole } from '../types';

export interface CurrentUser {
  role: UserRole;
  /** 顯示名稱，同時也是目前比對課程歸屬的鍵 */
  name: string;
}

export const isAdmin = (user: CurrentUser): boolean => user.role === UserRole.ADMIN;

/** 這個使用者看得到的課程 */
export const visibleCourses = (courses: Course[], user: CurrentUser): Course[] =>
  isAdmin(user) ? courses : courses.filter((c) => c.teacherName === user.name);

/** 這個使用者能不能從校務系統拉這個班級進來 */
export const canImportCourse = (
  user: CurrentUser,
  courseTeacherName: string,
): boolean => isAdmin(user) || courseTeacherName === user.name;

/** 需要管理人員補齊縣市／學校的課程 */
export const coursesNeedingReview = (courses: Course[]): Course[] =>
  courses.filter((c) => c.parseConfidence === 'low');
