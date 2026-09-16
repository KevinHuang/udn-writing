/**
 * 作業的排列順序 —— 老師自己排的那一種。
 *
 * 為什麼要有這個：一門課的作業是**有教學順序**的（第一次寫記敘、
 * 第二次寫抒情…），而這個順序既不是截止日、也不是建立時間。
 * 老師心裡的那個順序只有他自己知道，所以要讓他排，排完全站跟著走。
 *
 * ── 存什麼、算什麼 ────────────────────────────────────────
 * 只存 `Assignment.order`（一個排序鍵），**卡片上的 1、2、3 一律用
 * 位置現算**。這一條是這個專案反覆踩過的坑：同一個資訊只要存兩份，
 * 遲早會對不上（questionCount / submittedCount / studentCount 那一家人）。
 * 刪掉中間一份作業之後 order 會留下空號，但畫面上的序號照樣是
 * 1、2、3 連續 —— 因為序號從來不是存下來的。
 *
 * ── 為什麼不另外存一份「順序清單」 ────────────────────────
 * 存成 Record<courseId, assignmentId[]> 的話，作業一被刪、一被建立，
 * 那份清單就要跟著清理，漏一條就留下指向不存在作業的孤兒 id
 * （作品標記已經踩過同一個坑，見 lib/submissionMarks.ts）。
 * 把鍵放在作業自己身上，作業消失，鍵就跟著消失。
 *
 * ── 沒有 order 的舊資料 ───────────────────────────────────
 * order 是選填的。示範資料與既有的作業都沒有，這時退回建立時間，
 * 順序仍然穩定。老師第一次拖拉時會把整個班的作業重新編號，
 * 之後就不再有混合狀態。
 */

import { Assignment } from '../types';

/** 建立時間的毫秒數。缺值當作最舊 —— 舊資料排在前面比較符合直覺 */
const createdMs = (a: Assignment): number => {
  if (!a.createdAt) return 0;
  const t = new Date(a.createdAt).getTime();
  return Number.isFinite(t) ? t : 0;
};

/**
 * 自訂順序的比較函式。
 *
 * 還沒排過的（沒有 order）排在排過的後面 —— 新派的作業自動接在最後，
 * 不會插進老師已經排好的隊伍中間。最後用 id 定錨，避免同分項目
 * 在每次重繪時漂移（清單無故重排是使用者最容易注意到的 bug）。
 */
export function compareByOrder(a: Assignment, b: Assignment): number {
  const oa = a.order ?? Number.POSITIVE_INFINITY;
  const ob = b.order ?? Number.POSITIVE_INFINITY;
  if (oa !== ob) return oa - ob;
  return createdMs(a) - createdMs(b) || a.id.localeCompare(b.id);
}

/** 這個班級的作業，依老師排定的順序。回傳新陣列 */
export function orderedAssignments(
  assignments: Assignment[],
  courseId: string,
): Assignment[] {
  return assignments
    .filter((a) => a.courseId === courseId)
    .sort(compareByOrder);
}

/**
 * 顯示用的序號表（1 起算），鍵是 assignment.id。
 *
 * 傳進來的必須是**整個班級**的順序，不能是篩選過的子集 ——
 * 序號要在切換篩選時保持不變，那是這份作業在課程裡的編號，
 * 不是它在目前畫面上的第幾列。
 */
export function orderNumbers(ordered: Assignment[]): Record<string, number> {
  const out: Record<string, number> = {};
  ordered.forEach((a, i) => {
    out[a.id] = i + 1;
  });
  return out;
}

/**
 * 把 dragId 移到 targetId 的位置，回傳移動後的完整順序。
 *
 * 這是**唯一**的移動原始操作：拖曳是「放到滑鼠底下那一列的位置」，
 * 上下鍵是「放到看得到的上／下一列的位置」，兩者都是同一件事。
 *
 * 往下拖會落在目標**後面**、往上拖會落在目標**前面** —— 這是把
 * 「拖到某一列上」讀成「佔走它的位置」的結果，兩個方向都符合直覺。
 * 移不動（找不到、或拖到自己身上）時回傳原陣列本身，呼叫端可以
 * 用 `next === list` 判斷沒有變化。
 */
export function moveAssignment(
  list: Assignment[],
  dragId: string,
  targetId: string,
): Assignment[] {
  const from = list.findIndex((a) => a.id === dragId);
  const to = list.findIndex((a) => a.id === targetId);
  if (from < 0 || to < 0 || from === to) return list;

  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * 把新的順序寫成 order，回傳**真正有變動**的那幾份作業。
 *
 * 只回傳有變的，是為了讓 onAssignmentOperation 的 updates 批次維持最小 ——
 * 整個班十份作業裡只挪了一份，沒必要送十筆更新。
 */
export function renumberAssignments(ordered: Assignment[]): Assignment[] {
  const updates: Assignment[] = [];
  ordered.forEach((a, i) => {
    if (a.order !== i) updates.push({ ...a, order: i });
  });
  return updates;
}

/**
 * 新作業要接在班級最後面時用的 order。
 *
 * 沒有這個的話新作業的 order 是 undefined，雖然一樣排在最後，
 * 但只要老師拖過一次就會被重新編號 —— 直接給值比較誠實。
 */
export function nextOrderFor(
  assignments: Assignment[],
  courseId: string,
): number {
  const used = assignments
    .filter((a) => a.courseId === courseId && a.order != null)
    .map((a) => a.order as number);
  return used.length ? Math.max(...used) + 1 : 0;
}
