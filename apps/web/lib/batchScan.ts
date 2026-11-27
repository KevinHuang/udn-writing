/**
 * 整疊掃描（docs/batch-scan.md）：老師把全班的稿紙用掃描機掃成一份 PDF，系統照學生塗的座號分給學生。
 * 移植自 1Campus Write 的 hosting/utils/batchScan.ts（feat/batch-scan），聯合報這邊改過的地方標了「聯合報」。
 *
 * 這裡是純邏輯：把每一頁分成「一位學生一份」（分檔）、對名單（認人）、算出要送出的與還沒對到的學生。
 * 規則只有一個方向 —— **寧可請老師看，也不要分錯人**：
 *   - 第 1 頁開新的一份；第 2 頁接在緊鄰的前一張第 1 頁後面；空白頁略過；認不出的頁另外列出、不送。
 *   - 塗的座號讀得出來、在名單上、沒有別份用同一個座號、這位學生還可以代繳交，才自動配好；其他一律請老師看。
 *   - 聯合報：名單上有人沒有座號時（校務系統沒給、跨班的課座號重複），**整份不自動認人**，每一份都由老師指定。
 *     1Campus 是整個功能不開放；這裡留著「自動分成一人一份」這一半，老師只要點名字、不必一張一張拍。
 *   - 聯合報：聯合盃稿紙沒有座號劃記（稿紙印著不能留下辨識身份的記號），一樣每一份由老師指定。
 */

export type SeatState = 'clear' | 'blank' | 'double' | 'unclear';
export type ScanPageKind = 'sheet' | 'blank' | 'unknown';

/**
 * 辨識服務讀回來的一頁（POST /assignments/:id/seat_scan 的 pages；後端的同一份型別在
 * apps/api/src/lib/seat_scan.ts 的 SeatScanPage）。index 是**整疊**裡的第幾張（0 起算）——
 * 後端回的是一批裡的第幾張，api/batchScan.ts 會加上這一批的起點。
 */
export interface ScanPage {
  index: number;
  kind: ScanPageKind;
  template?: string | null;
  format?: string | null;
  paper?: string | null;
  /** 稿紙第幾頁（1 起算） */
  page?: number | null;
  /** 這一頁有座號劃記的位置才有；聯合盃、各種稿紙的第 2 頁是 null */
  seat?: { state: SeatState; seatNo: number | null; tens: number | null; ones: number | null } | null;
  cornersMissing?: string[];
  /** 表頭截圖（data URL），給老師核對姓名與座號 */
  crops?: string[];
}

/** 一份要請老師看的原因。 */
export type GroupIssue =
  | 'no_seat' // 沒有塗座號（或是加印劃記之前印的舊稿紙）
  | 'no_seatmark' // 這種稿紙沒有座號劃記（聯合盃）
  | 'double' // 十位或個位塗了兩格
  | 'unclear' // 塗得太淡、看不清
  | 'not_in_roster' // 塗的座號不在名單上
  | 'duplicate' // 兩份以上塗成同一個座號
  | 'orphan_page' // 第 2 頁前面沒有第 1 頁（順序顛倒、漏掃）
  | 'corners'; // 定位標記缺角，送出時會被擋下

export const ISSUE_TEXT: Record<GroupIssue, string> = {
  no_seat: '沒有塗座號',
  no_seatmark: '這種稿紙沒有座號劃記',
  double: '座號塗了兩格',
  unclear: '座號塗得太淡，看不清楚',
  not_in_roster: '塗的座號不在名單上',
  duplicate: '和別份塗成同一個座號',
  orphan_page: '這一張是第 2 頁，前面沒有第 1 頁',
  corners: '稿紙四角的黑色小方塊沒掃到，請重掃這一張',
};

/** 一位學生的一份（一張或正反兩張）。 */
export interface ScanGroup {
  id: string;
  /** 這一份的頁（整疊裡的 index，照順序） */
  pages: number[];
  /** 第 1 頁（有表頭的那一頁）；落單的第 2 頁沒有 */
  seatPage: ScanPage | null;
  /** 塗的座號（讀得出來、沒有別的問題才有） */
  seatNo: number | null;
  /** 自動配到的學生；要請老師看的是 null */
  autoStudentId: string | null;
  issue: GroupIssue | null;
  /** 塗的座號是一位已經有作文（或照片）的學生：這一份預設不送 */
  takenStudentId: string | null;
}

export interface BatchScanResult {
  groups: ScanGroup[];
  /** 略過的空白頁數 */
  blankPages: number;
  /** 認不出來的頁（混進來的題目卷、標記被切到），不送 */
  otherPages: ScanPage[];
  /** 稿紙種類（混在一起時有兩種以上） */
  templates: string[];
  /** 每人幾頁：有第 2 頁接在第 1 頁後面就是 2 */
  pagesPerStudent: 1 | 2;
  /** 兩頁的稿紙整疊都只有第 1 頁：提醒老師確認是不是忘了開雙面掃描 */
  frontOnly: boolean;
  /** 學測第一、二大題混在一起：一份作業只收一題 */
  twoQuestions: boolean;
}

/** 名單上的一位學生（批改清單的 Submission 取這三欄就夠）。 */
export interface RosterStudent {
  studentId: string;
  name: string;
  /** 校務系統沒給就是 null —— **不要當成 0** */
  seatNo: number | null;
}

/**
 * 一頁一份的稿紙：學測的第 1、2 頁是兩個大題，各自是一份作文，不是同一份的正反面。
 * 其他（會考、聯合報國中、聯合盃）都是「第 2 頁接在第 1 頁後面」。
 */
const SINGLE_PAGE_TEMPLATES = new Set(['gsat']);

const seatIssue = (page: ScanPage): GroupIssue | null => {
  if (!page.seat) return 'no_seatmark';
  const { state, seatNo } = page.seat;
  if (state === 'clear' && seatNo && seatNo > 0) return null;
  if (state === 'double') return 'double';
  if (state === 'unclear' || state === 'clear') return 'unclear'; // clear 卻沒有座號：後端不會給，保險
  return 'no_seat';
};

/** 名單上沒有座號的學生：有任何一位，整份作業就不自動認人。 */
export const studentsWithoutSeat = (roster: RosterStudent[]): RosterStudent[] =>
  roster.filter((s) => !(Number(s.seatNo) > 0));

/** 名單上重複的座號（跨班合上的課）：有的話一樣不自動認人——同一個座號是兩個人。 */
export const duplicateRosterSeats = (roster: RosterStudent[]): number[] => {
  const seen = new Map<number, number>();
  for (const s of roster) {
    const n = Number(s.seatNo);
    if (n > 0) seen.set(n, (seen.get(n) ?? 0) + 1);
  }
  return [...seen.entries()].filter(([, count]) => count > 1).map(([n]) => n).sort((a, b) => a - b);
};

/** 這份名單能不能照座號自動認人。 */
export const canAutoMatch = (roster: RosterStudent[]): boolean =>
  roster.length > 0 && studentsWithoutSeat(roster).length === 0 && duplicateRosterSeats(roster).length === 0;

/**
 * 分檔：每一頁照順序分成一位學生一份（純函式）。
 */
export const buildGroups = (pages: ScanPage[]): BatchScanResult => {
  const sorted = [...pages].sort((a, b) => a.index - b.index);
  const groups: ScanGroup[] = [];
  const otherPages: ScanPage[] = [];
  let blankPages = 0;
  const templates = new Set<string>();
  const gsatPages = new Set<number>();
  let previous: { page: ScanPage; group: ScanGroup } | null = null;

  const newGroup = (page: ScanPage, seatPage: ScanPage | null, issue: GroupIssue | null): ScanGroup => {
    const group: ScanGroup = {
      id: `g${page.index}`,
      pages: [page.index],
      seatPage,
      seatNo: seatPage && !issue ? seatPage.seat?.seatNo ?? null : null,
      autoStudentId: null,
      issue,
      takenStudentId: null,
    };
    groups.push(group);
    return group;
  };

  for (const page of sorted) {
    if (page.kind === 'blank') {
      blankPages += 1;
      continue; // 空白頁不打斷正反面：雙面掃描時背面沒寫字也可能被判成空白
    }
    if (page.kind !== 'sheet' || !page.template || !page.page) {
      otherPages.push(page);
      previous = null;
      continue;
    }
    templates.add(page.template);
    const corners = (page.cornersMissing?.length ?? 0) > 0;
    if (SINGLE_PAGE_TEMPLATES.has(page.template)) {
      gsatPages.add(page.page);
      const group = newGroup(page, page, corners ? 'corners' : seatIssue(page));
      previous = { page, group };
      continue;
    }
    if (page.page === 1) {
      const group = newGroup(page, page, corners ? 'corners' : seatIssue(page));
      previous = { page, group };
      continue;
    }
    // 第 2 頁：接在緊鄰的前一張第 1 頁後面（同一種稿紙、那一份還沒有第 2 頁）
    const host: ScanGroup | null =
      previous?.page.page === 1 && previous.page.template === page.template && previous.group.pages.length === 1
        ? previous.group
        : null;
    if (host) {
      host.pages.push(page.index);
      if (corners) {
        host.issue = 'corners'; // 缺角一定要重掃，蓋過「沒塗座號」那種可以由老師指定的原因
        host.seatNo = null;
      }
      previous = { page, group: host };
    } else {
      const group = newGroup(page, null, corners ? 'corners' : 'orphan_page');
      previous = { page, group };
    }
  }

  const twoPageGroups = groups.filter((g) => g.pages.length === 2).length;
  const twoPageSheets = templates.size > 0 && [...templates].every((t) => !SINGLE_PAGE_TEMPLATES.has(t));
  return {
    groups,
    blankPages,
    otherPages,
    templates: [...templates],
    pagesPerStudent: twoPageGroups > 0 ? 2 : 1,
    frontOnly: twoPageSheets && twoPageGroups === 0 && groups.every((g) => g.issue !== 'orphan_page'),
    twoQuestions: gsatPages.has(1) && gsatPages.has(2),
  };
};

/**
 * 認人：塗的座號對名單（純函式）。
 * roster：這個班的名單；eligibleIds：還可以代繳交的學生（沒交、只有草稿，而且還沒有登錄照片）。
 * 自動配好的條件：名單能照座號認人、座號讀得出來、在名單上、沒有別份用同一個座號、這位學生還可以代繳交。
 * 塗的是已經有作文的學生：標 takenStudentId，這一份預設不送（老師可以改指定給別人）。
 */
export const matchGroups = (groups: ScanGroup[], roster: RosterStudent[], eligibleIds: Iterable<string>): ScanGroup[] => {
  const clean = groups.map((g) => ({ ...g, autoStudentId: null, takenStudentId: null }));
  if (!canAutoMatch(roster)) return clean;
  const bySeat = new Map<number, RosterStudent>();
  for (const s of roster) bySeat.set(Number(s.seatNo), s);
  const eligible = new Set(eligibleIds);
  const seatCount = new Map<number, number>();
  for (const g of clean) {
    if (!g.issue && g.seatNo) seatCount.set(g.seatNo, (seatCount.get(g.seatNo) ?? 0) + 1);
  }
  return clean.map((g) => {
    if (g.issue || !g.seatNo) return g;
    const student = bySeat.get(g.seatNo);
    if (!student) return { ...g, issue: 'not_in_roster' as const };
    if ((seatCount.get(g.seatNo) ?? 0) > 1) return { ...g, issue: 'duplicate' as const };
    if (!eligible.has(student.studentId)) return { ...g, takenStudentId: student.studentId };
    return { ...g, autoStudentId: student.studentId };
  });
};

/** 老師對一份的決定：指定給哪位學生，或「這一份不送」。 */
export type GroupPick = { studentId: string } | { drop: true };
export type Picks = Record<string, GroupPick | undefined>;

export interface BatchPlan {
  /** 要送出的：每份配給哪位學生 */
  sends: { group: ScanGroup; studentId: string }[];
  /** 還在等老師決定的份（指定一位，或選「不送」） */
  unresolved: ScanGroup[];
  /** 老師選了不送的份 */
  dropped: ScanGroup[];
  /** 還可以代繳交、但沒有對到任何一份的學生 */
  absent: RosterStudent[];
  usedStudentIds: Set<string>;
}

/** 缺角的那一份不能送（送了也會被伺服器擋下來）：只能重掃，或選「不送」。 */
export const canAssign = (group: ScanGroup): boolean => group.issue !== 'corners';

/** 一份的最終去向：老師的決定優先，其次是自動配好的。 */
const targetOf = (group: ScanGroup, picks: Picks): string | null | 'drop' => {
  const pick = picks[group.id];
  if (pick && 'drop' in pick) return 'drop';
  if (!canAssign(group)) return null;
  if (pick && 'studentId' in pick) return pick.studentId;
  return group.autoStudentId;
};

/**
 * 整理成要送出的清單（純函式）。picks：老師在核對畫面做的決定（groupId → 學生或不送）。
 * 同一位學生被兩份用到時，以先出現的為準，後面那份回到「等老師決定」（畫面上不讓這種事發生，這裡只是保險）。
 */
export const planBatch = (groups: ScanGroup[], candidates: RosterStudent[], picks: Picks): BatchPlan => {
  const eligible = new Set(candidates.map((c) => c.studentId));
  const used = new Set<string>();
  const sends: BatchPlan['sends'] = [];
  const unresolved: ScanGroup[] = [];
  const dropped: ScanGroup[] = [];
  for (const group of groups) {
    const target = targetOf(group, picks);
    if (target === 'drop') {
      dropped.push(group);
    } else if (target && eligible.has(target) && !used.has(target)) {
      used.add(target);
      sends.push({ group, studentId: target });
    } else {
      unresolved.push(group);
    }
  }
  return { sends, unresolved, dropped, absent: candidates.filter((c) => !used.has(c.studentId)), usedStudentIds: used };
};

/**
 * 核對畫面上，某一份可以指定給哪些學生（純函式）：還可以代繳交、還沒被別份用掉的學生；
 * 塗的座號對得上的那位（就算因為撞號沒有自動配）排第一個。
 */
export const choicesFor = (
  group: ScanGroup,
  candidates: RosterStudent[],
  plan: BatchPlan,
  picks: Picks,
): { student: RosterStudent; suggested: boolean }[] => {
  const current = targetOf(group, picks);
  const readSeat = group.seatPage?.seat?.state === 'clear' ? group.seatPage.seat.seatNo : null;
  return candidates
    .filter((c) => !plan.usedStudentIds.has(c.studentId) || c.studentId === current)
    .map((student) => ({ student, suggested: readSeat != null && student.seatNo === readSeat }))
    .sort((a, b) => Number(b.suggested) - Number(a.suggested) || (a.student.seatNo ?? 999) - (b.student.seatNo ?? 999));
};

/** 這一份讀到的座號怎麼寫給老師看。 */
export const seatReadText = (group: ScanGroup): string => {
  if (!group.seatPage) return '沒有第 1 頁，讀不到座號';
  const seat = group.seatPage.seat;
  if (!seat) return ISSUE_TEXT.no_seatmark;
  if (seat.state === 'clear' && seat.seatNo) return `塗的是 ${String(seat.seatNo).padStart(2, '0')} 號`;
  if (seat.state === 'double') return ISSUE_TEXT.double;
  if (seat.state === 'blank') return ISSUE_TEXT.no_seat;
  return ISSUE_TEXT.unclear;
};

/**
 * 一次送給 /seat_scan 幾頁。後端一次最多收 8 張、整個請求 20MB；掃描的稿紙長邊 3000 一張 1～1.5MB，
 * base64 之後再大三分之一，8 張有機會超過。4 張留得出餘裕，一批也只要兩三秒，進度條走得比較順。
 */
export const SEAT_SCAN_CHUNK = 4;

/** 一份 PDF 最多幾頁：一班雙面約 80 頁；再多多半是選錯檔，也免得瀏覽器記憶體被吃光。 */
export const BATCH_SCAN_MAX_PAGES = 120;

/** 把整疊照片切成每批 size 張（純函式）。 */
export const chunk = <T,>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};
