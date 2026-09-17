import type { AssignmentStatus, SubmissionStatus } from './types.js';

/**
 * 從資料庫欄位推導出領域狀態。
 *
 * **這些規則只能有一份。** 前端要它來畫面、後端要它來判斷可不可以繳交，
 * 兩邊各寫一次的話遲早會漂移 —— 而漂移的症狀是「老師看到已關閉、
 * 學生還在繳交」這種沒人會聯想到根因的 bug。
 *
 * 放在 packages/shared 就是為了讓兩邊 import 同一支。
 */

/**
 * 作業的狀態。
 *
 * 資料庫沒有 status 欄位，只有 `opened` 與 `opened_at` 兩個欄位，
 * 三種狀態是它們的組合：
 *
 * | opened | opened_at | 狀態 | 意思 |
 * |---|---|---|---|
 * | true | 任何 | `Published` | 進行中。學生看得到、可以繳交 |
 * | false | `null` | `Draft` | **從未開放**。學生完全看不到 |
 * | false | 有值 | `Closed` | **開過又收回**。學生看得到成績，不能再繳交 |
 *
 * 關鍵在第二與第三列的差別 —— 兩者的 `opened` 都是 false，
 * 分辨它們的唯一依據就是「有沒有開放過」。所以**關閉時絕對不能**
 * 覆蓋 `opened_at`（後端的 `AssignmentHelper.updateStatus` 用 COALESCE 保護）。
 */
export function assignmentStatusOf(row: {
  opened: boolean | null;
  opened_at: string | Date | null;
}): AssignmentStatus {
  if (row.opened) return 'Published';
  return row.opened_at ? 'Closed' : 'Draft';
}


/**
 * 繳交紀錄的狀態。
 *
 * 資料庫同樣沒有 status 欄位 —— 五個值散在三張表：
 *
 * | 狀態 | 條件 | 誰看得到分數 |
 * |---|---|---|
 * | `Unsubmitted` | 名冊上有這個學生，但**沒有 submission 資料列** | — |
 * | `Draft` | `submission.is_submitted = false`（寫了但沒送出） | 只有學生自己 |
 * | `Pending` | 已送出，但沒有 `is_valid = true` 的批改 | — |
 * | `Graded` | 有有效批改，`is_returned = false` | **只有老師** |
 * | `Published` | 有有效批改，`is_returned = true` | 老師與學生 |
 *
 * ── 三件不直覺但很重要的事 ─────────────────────────────
 *
 * **① `Unsubmitted` 不是存起來的狀態，是「名冊 − 繳交」的差集。**
 *    所以這支函式吃的是**已經 LEFT JOIN 過名冊**的一列：未繳交的學生
 *    仍然會有一列，只是 `submissionId` 是 null。
 *    只吃 submission 表的話產不出這個值。
 *
 * **② `hasValidFeedback` 問的是「有沒有 is_valid = true 的」，不是「有沒有批改過」。**
 *    重批的機制是把舊的那筆設成 `is_valid = false` 再插一筆新的
 *    （見 `InstructorHelper.saveFeedback`），重置則是全部設成 false ——
 *    於是狀態自然退回 `Pending`，而歷史紀錄留著。
 *
 * **③ 草稿優先於批改結果。**
 *    `is_submitted = false` 卻有有效批改，正常操作走不到，但資料上可能出現。
 *    這時回傳 `Draft` 而不是 `Graded` —— 防的是「學生看到一份自己沒送出的
 *    草稿被打了分數」。代價是那筆批改在畫面上看不到（`Draft` 被排除在
 *    批改佇列外），老師要重批一次。兩害相權。
 *
 * ⚠️ **逾期不是第六個值。** 它是獨立維度，可以疊在任何狀態上
 *    （見 `lib/statusStyles.ts` 的 `OVERDUE_STYLE`），所以不在這裡處理。
 */
export function submissionStatusOf(row: {
  /** 名冊上有、但還沒交的人，這裡是 null */
  submissionId: string | number | null;
  /** 代繳交（教師代學生交）也算已送出，一樣是 true */
  isSubmitted: boolean | null;
  /** **只有 `is_valid = true` 的批改**才該傳進來 */
  hasValidFeedback: boolean;
  isReturned: boolean | null;
}): SubmissionStatus {
  if (row.submissionId == null) return 'Unsubmitted';
  // 草稿優先 —— 見上面第 ③ 點
  if (row.isSubmitted === false) return 'Draft';
  if (!row.hasValidFeedback) return 'Pending';
  return row.isReturned ? 'Published' : 'Graded';
}
