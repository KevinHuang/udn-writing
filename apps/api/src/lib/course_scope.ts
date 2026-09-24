/**
 * 「這個人看得到哪些班級」——教師端每一支查詢的資料範圍。
 *
 * 為什麼要有這個：所有教師端的 SQL 都寫著同一句
 *   `ref_course_id IN (SELECT ref_course_id FROM uc_instructor WHERE ref_user_id = $n)`
 * 而管理人員在 uc_instructor 裡一列都沒有 —— 換成管理身分之後，那句子查詢是空集合，
 * 於是作業清單、批改清單、名冊、標記、請假**全部回空陣列**，畫面看起來就是「什麼都沒有」。
 * 批改頁更慘：作文全文那一支雖然拿得到，但外層路由的 isInstructor 直接 403，整頁空白。
 *
 * 所以把「範圍」抽成一個值，讓同一段 SQL 依身分產生不同的子查詢：
 *   - 授課教師     → 自己有掛課的班級
 *   - 聯合報管理人員 → 全部班級
 *   - 校務管理     → 自己管的那幾所學校底下的班級
 *
 * ⚠️ `course` 是唯一帶 `ref_school_id` 的表；assignment 與 submission 都要
 *    經由 course 才追得到學校（assignment.ref_course_id → course.ref_school_id）。
 */

export type CourseScope =
  /**
   * 授課教師：只有自己有掛課的班。
   *
   * userId 允許字串 —— Postgres 的 bigint 經過 pg-promise 回來是字串，
   * session 裡的 `userInfo.id` 實際上就是 `'8461'` 這種形狀。
   */
  | { kind: 'instructor'; userId: number | string }
  /** 聯合報管理人員：全部 */
  | { kind: 'all' }
  /** 校務管理：自己管的學校底下的班 */
  | { kind: 'schools'; schoolIds: Array<number | string> };

/**
 * 把數字安全地放進 SQL。
 *
 * 這裡的值一律來自 session 或我們自己的資料表（使用者 id、學校 id），
 * 不是客戶端傳進來的；即使如此還是擋一次，免得哪天有人把路徑參數接進來。
 */
function int(value: number | string): string {
  const n = typeof value === 'string' ? Number(value.trim()) : value;
  if (value === '' || value === null || value === undefined || !Number.isSafeInteger(n)) {
    throw new Error(`course scope 只接受整數，收到：${String(value)}`);
  }
  return String(n);
}

/**
 * 產生「範圍內的班級 id」子查詢，直接嵌進既有的 `ref_course_id IN (…)`。
 *
 * 回傳的字串**已經含括號**，呼叫端寫成 `ref_course_id IN ${courseScopeSubquery(scope)}`。
 */
export function courseScopeSubquery(scope: CourseScope): string {
  switch (scope.kind) {
    case 'all':
      return '(SELECT id FROM public.course)';
    case 'schools':
      // 一所學校都沒有時要回空集合，不能回全部 —— 那會變成權限放大
      if (!scope.schoolIds.length) return '(SELECT id FROM public.course WHERE false)';
      return `(SELECT id FROM public.course WHERE ref_school_id IN (${scope.schoolIds
        .map(int)
        .join(',')}))`;
    case 'instructor':
      return `(SELECT ref_course_id FROM public.uc_instructor WHERE ref_user_id = ${int(
        scope.userId,
      )})`;
    default:
      /*
        ⚠️ 不要安靜地回空字串或 undefined。
        session 上的 userInfo.id 型別是 any，所以「忘了包成 scope、
        直接把 id 傳進來」TypeScript 擋不住 —— 實際踩過：SQL 變成
        `IN undefined`，課程封存整支 500。這裡炸出來才看得見。
      */
      throw new Error(`未知的 course scope：${JSON.stringify(scope)}`);
  }
}

/**
 * 這個範圍會不會「什麼都看不到」。
 *
 * 校務管理若一所學校都沒對應到（school_admin 表裡查不到帳號），與其讓後面每一支
 * 查詢都安靜地回空陣列，不如讓呼叫端早一點知道。
 */
export function isEmptyScope(scope: CourseScope): boolean {
  return scope.kind === 'schools' && scope.schoolIds.length === 0;
}

/** 這個範圍是不是「只有自己的班」——需要記錄操作者時仍要拿 userId */
export function isInstructorScope(
  scope: CourseScope,
): scope is { kind: 'instructor'; userId: number | string } {
  return scope.kind === 'instructor';
}
