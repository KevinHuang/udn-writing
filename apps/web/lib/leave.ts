/**
 * 請假註記。
 *
 * 逾期沒交有兩種：真的沒寫，和請假。老師手上才有這個資訊，
 * 系統只看得到「沒有繳交紀錄」，所以需要一個地方讓老師標註。
 *
 * 為什麼不放在 Submission 上：請假的那一份**根本沒有繳交紀錄**，
 * 沒有東西可以掛。所以另外用「作業 × 學生」當鍵存一份註記。
 *
 * 標成請假之後，那一份就不算逾期未繳 —— 關心名單（lib/concern.ts）
 * 也吃這份資料，否則畫面上寫著請假、名單裡卻還在催繳。
 */

export type LeaveMarks = Record<string, true>;

/** 註記的鍵。用 :: 分隔，因為 id 本身可能含單個冒號或連字號 */
export const leaveKey = (assignmentId: string, studentId: string): string =>
  `${assignmentId}::${studentId}`;

export function isOnLeave(
  marks: LeaveMarks | undefined,
  assignmentId: string,
  studentId: string,
): boolean {
  return marks?.[leaveKey(assignmentId, studentId)] === true;
}

/**
 * 設定或取消請假。回傳新的物件，不要就地修改 ——
 * 這份資料存在 React state 裡，改到同一個物件畫面不會更新。
 */
export function setLeave(
  marks: LeaveMarks,
  assignmentId: string,
  studentId: string,
  onLeave: boolean,
): LeaveMarks {
  const key = leaveKey(assignmentId, studentId);
  if (onLeave) return { ...marks, [key]: true };
  const next = { ...marks };
  delete next[key];
  return next;
}
