import { api } from './client';
import { semesterValue } from '../lib/semester';
import { cityOf } from '../lib/schoolName';
import type { Course, SchoolLevel } from '@udn/shared';

/** `GET /service/courses` 回傳的資料庫列。欄位名稱是 snake_case。 */
interface RawCourse {
  id: string;
  course_name: string | null;
  school_year: number;
  semester: number;
  school_name: string | null;
  school_type: string | null;
  source_index: string | null;
  is_active: boolean | null;
  stud_count: string | number | null;
}

/**
 * 資料庫列 → 前端的 Course。
 *
 * **對應只寫在這裡一處。** 元件拿到的永遠是 Course，不知道後端長什麼樣 ——
 * 這正是 CLAUDE.md 那條「在入口解析一次，其他地方讀存好的欄位」。
 *
 * 值得注意的是原型的假設與真實資料不同：原型以為課程名稱是
 * 「新北市淡江中學國三孝班」這種黏在一起的字串，所以才有 parseCourseName()
 * 與「待確認」那套流程。真實資料裡校名、班級、學段**本來就是三個欄位**，
 * 只有縣市要從校名前綴取。
 */
function toCourse(r: RawCourse): Course {
  const schoolName = r.school_name ?? '';
  const className = r.course_name ?? '';
  const city = cityOf(schoolName);
  const level: SchoolLevel | undefined =
    r.school_type === '國中' || r.school_type === '國小' ? r.school_type : undefined;

  return {
    id: String(r.id),
    /*
      校務系統的課程編號（`course.source_index`，對應 dsa 的 course.id）。
      前端拿它當「課程代碼」顯示。

      ⚠️ **-1 是資料庫的預設值**，意思是「這門課不是從校務系統同步來的」，
         不是一個編號。不濾掉的話卡片上會印出「-1」（實測看到的就是這個）。
    */
    code: r.source_index != null && String(r.source_index) !== '-1'
      ? String(r.source_index)
      : '',
    // 顯示用的完整名稱。資料庫沒有這一欄，是組出來的 ——
    // 管理人員會同時看到多校的課程，只印「國三8班」分不出是哪一間
    name: [schoolName, className].filter(Boolean).join(' '),
    semester: semesterValue(r.school_year, r.semester),
    studentCount: Number(r.stud_count ?? 0),
    isArchived: r.is_active === false,
    city: city ?? undefined,
    schoolName: schoolName || undefined,
    schoolLevel: level,
    className: className || undefined,
    // 校名裡認不出縣市時標成待確認 —— 這是唯一還需要「解析」的欄位
    parseConfidence: city ? 'high' : 'low',
  };
}

/**
 * 目前身分看得到的課程。
 *
 * 管理者拿到全部、教師只拿到自己的 —— **範圍由伺服器端決定**，
 * 前端不再自己過濾（`lib/access.ts` 的 visibleCourses 只是原型的展示用權限）。
 */
export async function fetchCourses(): Promise<Course[]> {
  const rows = await api.get<RawCourse[]>('/service/courses');
  return rows.map(toCourse);
}

/** 班級名冊。座號來自 uc_learner.seat_no */
export interface RosterEntry { seatNo: number; name: string; userId: string }

export async function fetchRoster(courseId: string): Promise<RosterEntry[]> {
  const rows = await api.get<Array<{ user_id: string; name: string; seat_no: number | null }>>(
    `/service/instructor/courses/${courseId}/students`,
  );
  return rows
    .map((r, i) => ({
      userId: String(r.user_id),
      name: r.name ?? '',
      // 座號可能是空的（校務系統沒給），用順位頂著才不會全部顯示 0
      seatNo: r.seat_no ?? i + 1,
    }))
    .sort((a, b) => a.seatNo - b.seatNo);
}

/**
 * 更新課程。**只送要改的欄位**，後端對沒給的欄位維持原值。
 *
 * 注意這裡能寫的欄位就是 course 資料表有的那幾欄。前端 Course 上的
 * `aiModels` 與 `city` / `schoolName` / `schoolLevel` 都**沒有對應的欄位**：
 * 前三者來自 school 資料表（校務同步維護），aiModels 則根本沒有欄位。
 * 送它們過來不會有效果，所以型別上就不開放。
 */
export async function updateCourse(
  id: string,
  patch: { course_name?: string; is_active?: boolean },
): Promise<void> {
  await api.put(`/service/instructor/courses/${id}`, patch);
}

/**
 * 封存／復原課程。
 *
 * 封存存在 `course.is_active`（false = 已封存），所以這裡是布林反過來的 ——
 * 對應 toCourse() 的 `isArchived: r.is_active === false`。
 */
export async function setCourseArchived(id: string, archived: boolean): Promise<void> {
  await updateCourse(id, { is_active: !archived });
}

export async function deleteCourse(id: string): Promise<void> {
  await api.del(`/service/instructor/courses/${id}`);
}
