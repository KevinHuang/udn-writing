import { MAX_IMAGES_PER_REQUEST } from './image_input';

/** 座號劃記讀到什麼：清楚的一格／沒塗／同一位數塗了兩格／太淡看不清 */
export type SeatState = 'clear' | 'blank' | 'double' | 'unclear';
/** 這一頁是什麼：我們的稿紙／掃描機多掃的白紙／認不出來（混進來的題目卷、標記被切到） */
export type ScanPageKind = 'sheet' | 'blank' | 'unknown';

/** 回給前端的一頁。前端的同一份型別在 apps/web/lib/batchScan.ts（ScanPage），欄位要一起改。 */
export interface SeatScanPage {
    /** 這一批裡的第幾張（0 起算） */
    index: number;
    kind: ScanPageKind;
    template?: string | null;
    format?: string | null;
    paper?: string | null;
    /** 稿紙第幾頁（1 起算） */
    page?: number | null;
    /** 這一頁有座號劃記的位置才有；聯合盃稿紙、各種稿紙的第 2 頁是 null */
    seat?: { state: SeatState; seatNo: number | null; tens: number | null; ones: number | null } | null;
    /** 沒掃到的定位標記角落（有就要重掃那一張） */
    cornersMissing?: string[];
    /** 表頭截圖（data URL），給老師核對姓名與座號 */
    crops?: string[];
}

/**
 * 整疊掃描（docs/batch-scan.md）：老師把全班的稿紙用掃描機掃成一份 PDF，系統讀每一頁的稿紙頁碼與學生塗的座號。
 * 移植自 1Campus Write 的 functions/lib/seatScan.js（feat/batch-scan）。
 *
 * 這裡是後端的純函式：把辨識服務 /seat-scan 回傳的每一頁轉成給前端的格式。
 * 「哪幾頁是同一位學生」「塗的座號是誰」「老師核對」都在前端（apps/web/lib/batchScan.ts）；
 * 送出時每位學生照舊走 POST /submissions/ocr_proxy，名冊與作業範圍由那一支再檢查一次。
 * 所以這一支**只讀不寫**：不存照片、不碰資料表。
 */

/**
 * 一次送幾頁。和代繳交一次上傳的張數同一個上限：
 * 照片長邊 3000 約 1MB，8 頁轉成 base64 約 11MB，在 API（20MB）與辨識服務（30MB）的上限內；
 * 一頁約 0.5 秒，前端分批送、顯示進度。
 */
export const SEAT_SCAN_MAX_PAGES = MAX_IMAGES_PER_REQUEST;

const SEAT_STATES = new Set<SeatState>(['clear', 'blank', 'double', 'unclear']);
const PAGE_KINDS = new Set<ScanPageKind>(['sheet', 'blank', 'unknown']);

const intOrNull = (value: unknown): number | null => (Number.isInteger(value) ? (value as number) : null);
const stringOrNull = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

/** 服務回傳的資料不可信任地當成 any 用：先收成一般物件 */
const record = (value: unknown): Record<string, unknown> =>
    (value && typeof value === 'object' ? (value as Record<string, unknown>) : {});

/**
 * 辨識服務 /seat-scan 回傳的一頁 → 給前端的格式。index 是這一批裡的第幾張（0 起算，前端用來對回照片）。
 *
 * 服務回傳的欄位不認得或缺漏時，一律當作「認不出來／看不清」，**不讓前端誤分**：
 * 這個功能錯的方向只能是「多請老師看一眼」，不能是「分給錯的人」。
 * 座號只有 state 是 clear 時才給數字 —— 塗兩格、太淡時服務可能還是回一個猜的值。
 */
export function toSeatScanPage(raw: unknown, index: number): SeatScanPage {
    const page = record(raw);
    const kind: ScanPageKind = PAGE_KINDS.has(page.kind as ScanPageKind) ? (page.kind as ScanPageKind) : 'unknown';
    if (kind !== 'sheet') return { index, kind };

    let seat: SeatScanPage['seat'] = null;
    if (page.seat && typeof page.seat === 'object') {
        const s = record(page.seat);
        const state: SeatState = SEAT_STATES.has(s.state as SeatState) ? (s.state as SeatState) : 'unclear';
        const seatNo = state === 'clear' ? intOrNull(s.seat) : null;
        seat = {
            // 說是 clear 卻沒有座號（或不是正整數）：當作看不清，不要讓 0 號、空值流進對名單的那一步
            state: state === 'clear' && !(seatNo && seatNo > 0) ? 'unclear' : state,
            seatNo: seatNo && seatNo > 0 ? seatNo : null,
            tens: intOrNull(s.tens),
            ones: intOrNull(s.ones),
        };
    }
    return {
        index,
        kind,
        template: stringOrNull(page.template),
        format: stringOrNull(page.format),
        paper: stringOrNull(page.paper),
        page: intOrNull(page.page),
        seat,
        cornersMissing: Array.isArray(page.corners_missing) ? page.corners_missing.map(String) : [],
        crops: Array.isArray(page.crops)
            ? page.crops.filter((c): c is string => typeof c === 'string' && c.length > 0)
                .map((c) => `data:image/jpeg;base64,${c}`)
            : [],
    };
}

/**
 * 辨識服務的回應 → 給前端的每一頁。頁數要和送出去的照片一樣多（服務照順序一頁一筆）；
 * 對不上時回 null，呼叫端回 502 —— 不能讓前端把座號配到別張照片上。
 */
export function toSeatScanPages(payload: unknown, expectedCount: number): SeatScanPage[] | null {
    const pages = record(payload).pages;
    if (!Array.isArray(pages) || pages.length !== expectedCount) return null;
    return pages.map((page, index) => toSeatScanPage(page, index));
}
