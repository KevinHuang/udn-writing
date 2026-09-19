/**
 * 學期代碼與顯示名稱。
 *
 * 代碼的形狀是 `${學年度}-${學期}`，例如 `115-1` —— 與資料庫的
 * `course.school_year` + `course.semester` 兩欄一一對應。
 *
 * ⚠️ **原型的四學期制（第1學期／寒假／第2學期／暑假）在資料庫裡不存在。**
 *    `semesters` 表只有 1 與 2，而 `course.semester` 是 integer，
 *    根本裝不下寒假的 `W` 與暑假的 `S`。原型那兩個選項永遠對不到任何課程，
 *    所以這裡只處理 1 與 2。若產品真的要開寒暑假班，那是 schema 的異動
 *    （見 artifacts/spec.md 的開放問題）。
 */

export interface Semester {
  /** `115-1` */
  value: string;
  /** `115學年度 第1學期` */
  label: string;
  schoolYear: number;
  term: number;
}

export const semesterValue = (schoolYear: number, term: number): string =>
  `${schoolYear}-${term}`;

/**
 * 把 `115-1` 換成「115學年度 第1學期」。
 *
 * **用算的不用查表。** 先前是去 SEMESTER_OPTIONS 找，查不到就原樣回傳 ——
 * 於是資料庫裡有、但選項清單裡沒有的學年期（例如既有課程用到的 110-2、
 * 113-1）會直接印出代碼。算出來的話多久以前的都對。
 */
export function semesterLabel(value: string): string {
  const m = /^(\d+)-(\d+)$/.exec(value ?? '');
  if (!m) return value ?? '';
  return `${m[1]}學年度 第${m[2]}學期`;
}

export const toSemester = (schoolYear: number, term: number): Semester => ({
  value: semesterValue(schoolYear, term),
  label: semesterLabel(semesterValue(schoolYear, term)),
  schoolYear,
  term,
});

/** 學期的先後：115-1 < 115-2 < 116-1 */
export const compareSemester = (a: Semester, b: Semester): number =>
  a.schoolYear - b.schoolYear || a.term - b.term;

/**
 * 學期下拉要列哪些：**到目前學期為止**，新的在前。
 *
 * `semesters` 表預先建到好幾年後（實測到 119-1），全部列出來的話，
 * 老師和學生打開下拉，最上面是四年後、一門課都沒有的學期，
 * 目前學期反而要往下找。還沒到的學期沒有東西可看，不列。
 *
 * 同一個學期只留一個 —— 表裡有重複列（118-2 有兩列，見 findings），
 * 重複的選項會讓 React 的 key 撞在一起。
 *
 * 後端沒給目前學期時（理論上不會）不過濾，寧可多列也不要整個選單是空的。
 */
export function selectableSemesters(
  options: Semester[],
  current: Semester | null,
): Semester[] {
  const seen = new Set<string>();
  return options
    .filter((s) => !current || compareSemester(s, current) <= 0)
    .filter((s) => (seen.has(s.value) ? false : (seen.add(s.value), true)))
    .sort((a, b) => compareSemester(b, a));
}
