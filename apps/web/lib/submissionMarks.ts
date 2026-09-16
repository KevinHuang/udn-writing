/**
 * 作品標記 —— 老師蓋在作文上的印章。
 *
 * 目前有兩種：**佳作**與**預選**。老師在批改時把值得留下來的作品挑出來，
 * **取用的地方還沒決定** —— 可能做在這個系統裡的展示頁，也可能匯出到別處
 * （選文、比賽送件都有可能），所以這一層只負責
 * 「記住哪些作品被蓋了什麼章、什麼時候蓋的」。
 *
 * ── 為什麼兩種章共用一份儲存 ──────────────────────────────
 * 另外開一支 lib/preselect.ts 複製一遍，會讓 App.tsx 的三條清理路徑
 * （刪作業／清除繳交／換題）每一條都變成兩次呼叫，漏一次就留下指向
 * 不存在作品的孤兒標記。放在同一份裡，dropMarks() 一次清乾淨。
 * 這個專案已經在 questionCount / submittedCount 那一家人身上
 * 學過「同一件事分兩處管」的代價。
 *
 * ── 鍵的形狀 ──────────────────────────────────────────────
 * 外層是 submission.id，內層是章的種類。與請假註記（lib/leave.ts）
 * 的差別在於：請假的那一份**根本沒有繳交紀錄**，只能用「作業＋學生」
 * 的複合鍵；蓋章一定是蓋在一篇真的交出來的作品上，必然有 submission。
 *
 * 重要：作品被刪掉時標記一定要跟著刪（見 App.tsx 的三條清理路徑）。
 */

import { Assignment, Submission, SubmissionStatus } from '../types';

export type MarkKind = 'featured' | 'preselect';

/** 畫面上不要自己寫「佳作」兩個字，一律從這裡取 */
export const MARK_META: Record<MarkKind, { label: string; title: string }> = {
  featured: { label: '佳作', title: '佳作' },
  preselect: { label: '預選', title: '預選' },
};

/** 章的順序。畫面照這個排，兩個地方才不會一個佳作在左、一個在右 */
export const MARK_KINDS: MarkKind[] = ['featured', 'preselect'];

export interface Mark {
  /**
   * 蓋章時間（ISO）。之後做取用的畫面可以依時間排序，
   * 也看得出這是哪一輪挑出來的。
   *
   * 目前刻意**沒有**說明欄位 —— 需求就是純蓋章。
   * 之後真要加，加在這個介面裡，畫面不必重排。
   */
  markedAt: string;
}

/** 外層鍵是 submission.id */
export type SubmissionMarks = Record<string, Partial<Record<MarkKind, Mark>>>;

/**
 * 這份作品現在能不能蓋章。
 *
 * **可用範圍的唯一來源。** 清單表格、手機卡片、個人批改頁三個地方
 * 都問這一支，不要各自去比對 status —— 三個地方各寫一次
 * `status === 'Graded'`，改規則時漏掉一處就是下一個漂移 bug。
 *
 * 已發還算數：它本來就是批改完成之後才會有的狀態。若排除它，
 * 老師一按發還，那篇的章就再也蓋不了也取消不了。
 */
export function canMark(status: SubmissionStatus): boolean {
  return status === 'Graded' || status === 'Published';
}

export function hasMark(
  marks: SubmissionMarks | undefined,
  submissionId: string,
  kind: MarkKind,
): boolean {
  return Boolean(marks?.[submissionId]?.[kind]);
}

export function markOf(
  marks: SubmissionMarks | undefined,
  submissionId: string,
  kind: MarkKind,
): Mark | undefined {
  return marks?.[submissionId]?.[kind];
}

/**
 * 蓋章或取消。回傳新的物件，不要就地修改 ——
 * 這份資料存在 React state 裡，改到同一個物件畫面不會更新。
 *
 * 取消時是把那一種**整個移除**，不是留下一個 false ——
 * 留著的話 Object.keys() 會數到不存在的標記。內層清空之後
 * 外層那一筆也要跟著刪，否則會累積一堆空殼。
 */
export function setMark(
  marks: SubmissionMarks,
  submissionId: string,
  kind: MarkKind,
  on: boolean,
): SubmissionMarks {
  const current = marks[submissionId];

  if (!on) {
    if (!current?.[kind]) return marks;          // 本來就沒蓋，不要製造新物件
    const entry = { ...current };
    delete entry[kind];
    const next = { ...marks };
    if (Object.keys(entry).length === 0) delete next[submissionId];
    else next[submissionId] = entry;
    return next;
  }

  // 已經蓋過就保留原本的時間，不要因為重複點擊而洗掉
  if (current?.[kind]) return marks;
  return {
    ...marks,
    [submissionId]: { ...current, [kind]: { markedAt: new Date().toISOString() } },
  };
}

/**
 * 移除一批作品的**所有**標記。作業被刪、繳交被清除、換題時都要呼叫，
 * 否則標記會指向已經不存在的作品。
 *
 * 兩種章一起清 —— 呼叫端不需要知道現在有幾種章。
 */
export function dropMarks(
  marks: SubmissionMarks,
  submissionIds: Iterable<string>,
): SubmissionMarks {
  const next = { ...marks };
  let changed = false;
  for (const id of submissionIds) {
    if (id in next) {
      delete next[id];
      changed = true;
    }
  }
  return changed ? next : marks;
}

export interface MarkedEntry {
  submission: Submission;
  assignment?: Assignment;
  mark: Mark;
}

/**
 * 取用／匯出的單一入口：把某一種章接回作品與作業，依蓋章時間由新到舊。
 *
 * 之後不管展示做在哪裡（這個系統的新頁面、或是匯出到別的地方），
 * 都呼叫這一支，不要各自去拼 submissions —— 那是這個專案已經
 * 踩過好幾次的坑（見 CLAUDE.md）。
 *
 * 找不到對應作品的標記會被略過，不會回傳半個空殼。
 */
export function markedEntries(
  marks: SubmissionMarks | undefined,
  kind: MarkKind,
  submissions: Submission[],
  assignments: Assignment[],
): MarkedEntry[] {
  if (!marks) return [];
  const subById = new Map(submissions.map((s) => [s.id, s]));
  const asgById = new Map(assignments.map((a) => [a.id, a]));

  return Object.entries(marks)
    .map(([submissionId, entry]): MarkedEntry | null => {
      const mark = entry?.[kind];
      if (!mark) return null;
      const submission = subById.get(submissionId);
      if (!submission) return null;
      return {
        submission,
        assignment: asgById.get(submission.assignmentId),
        mark,
      };
    })
    .filter((e): e is MarkedEntry => e !== null)
    .sort((a, b) => b.mark.markedAt.localeCompare(a.mark.markedAt));
}
