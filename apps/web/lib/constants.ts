/**
 * 原型層級的共用常數。
 */

/**
 * 原型的示範學生。原本 id／姓名／班級寫死在三個不同的地方
 * （useState("林冠宇")、useState("c1")、字面量 "st-alice-1"），
 * 任何一處改了另外兩處就對不起來，所以收攏成單一來源。
 */
export const DEMO_STUDENT = {
  /*
    這個 id **必須等於** studentIdFor(courseId, 1)，也就是 `s-c1-0`。

    原本寫 'st-alice-1'，但 mockData 產生的每一筆繳交紀錄都是用
    studentIdFor 組出來的 `s-c1-0` —— 同一個林冠宇有兩個身分。
    後果是學生按「提交作業」時，handleSubmitEssay 用 STUDENT_ID 去找
    既有紀錄永遠找不到，於是**另外新增一筆**：同一份作業出現兩筆同名紀錄，
    其中一筆的學生還不在任何名冊裡，關心名單（用 studentIdFor 比對）也看不到它。

    這與座號 split('-')[2] 那次是同一類問題：ID 的組法只能有一種。
    scripts/check-mockdata.mjs 會擋住再次改壞。
  */
  id: 's-c1-0',
  name: '林冠宇',
  courseId: 'c1',
} as const;

export const STUDENT_ID = DEMO_STUDENT.id;

/**
 * 原型的示範教師帳號。
 * 姓名同時是課程歸屬的比對鍵（見 lib/access.ts），所以要與
 * mockData 裡 Course.teacherName 寫的字串完全一致。
 */
export const DEMO_TEACHER = {
  name: 'Charles 老師',
} as const;

/** 依照目前時間回傳問候語 */
export const getGreeting = (): string => {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return '早安';
  if (hour >= 12 && hour < 18) return '午安';
  return '晚安';
};

/**
 * 產生新資料的識別碼。
 *
 * 收成一支函式有兩個理由：格式集中在一個地方，
 * 以及 Date.now() 直接寫在元件裡會被 React Compiler 的純度規則擋下來
 * （它分不出來這行是在事件處理裡跑，不是在 render 期間）。
 */
export const newId = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
