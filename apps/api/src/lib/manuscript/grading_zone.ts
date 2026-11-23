/**
 * 稿紙上的批改區在拉正的稿紙圖上的位置（docs/manuscript.md「稿紙上的批改區」）。
 *
 * 聯合報國中寫作稿紙的第二頁左側印了三個給老師填的區塊：錯字訂正、寫作能力分析、老師評語。
 * 這裡只回答「每一格在圖上的哪裡」；填什麼（確定的錯字、四向度的等第、評語）由前端用畫面上
 * 當下的批改結果組出來（apps/web/lib/gradingZone.ts）—— 老師改評語時稿紙上要跟著變，不能等存檔。
 *
 * 為什麼用格子反推，不直接用「每公釐幾個像素」：拉正的圖是整張紙，但印成 B4 時整個版面縮成 86.5% 再置中，
 * 換算要知道當時印的是哪一種紙。每一格（含空白格）的像素位置辨識結果裡都有，
 * 拿它們和稿紙上的公釐位置對一次，兩種紙都對得上，也順便驗證這一頁真的是第二頁的版面。
 *
 * 純函式，不碰資料庫與網路。
 */

export type ZoneRect = [number, number, number, number];

export interface GradingZonePayload {
    /** 錯字訂正：六行（由右而左），每行六格（由上而下）。rect 都是拉正的稿紙圖上的 [左, 上, 右, 下] 像素 */
    typoColumns: ZoneRect[][];
    /** 寫作能力分析：四向度（會考的順序，同 SUB_SCORE_DIMENSIONS）各自的四格，由上而下是極佳、佳、尚可、待加強 */
    levelCells: ZoneRect[][];
    /** 老師評語的框 */
    commentBox: ZoneRect;
}

/**
 * 聯合報國中稿紙第二頁，單位 mm，原點在紙的左上角。
 * 批改區量自 services/handwriting-ocr/headers/udn_original.pdf 的向量檔（2026-11-23）；
 * 作答格和 services/handwriting-ocr/templates/udn.json 的第二頁一樣 —— 稿紙改版時兩邊要一起改。
 */
const UDN_PAGE_2 = {
    grid: { x0: 106.004, y0: 38.5, cols: 23, cellW: 10, cellH: 10, colPitch: 13 },
    // 六行的左緣，由右而左；每行六格、每格 10mm
    typo: { lefts: [82.9, 69.9, 56.9, 43.9, 30.9, 17.9], top: 38.5, cell: 10, rows: 6 },
    // 表格的四欄由右而左是立意取材、結構組織、遣詞造句、錯別字格式與標點；標題列下面四列各 10mm
    level: { columns: [[66.9, 79.9], [53.9, 66.9], [40.9, 53.9], [17.9, 40.9]], top: 118.5, rowH: 10, rows: 4 },
    comment: [17.9, 158.5, 95.9, 258.5],
};

interface CellLike { col?: unknown; row?: unknown; rect?: unknown }

/** 一個方向上「稿紙的 mm ↔ 圖上的像素」的統計：平均、mm 的離散程度、mm 與像素一起變動的程度 */
function axisStats(points: Array<[number, number]>) {
    const n = points.length;
    const meanMm = points.reduce((s, p) => s + p[0], 0) / n;
    const meanPx = points.reduce((s, p) => s + p[1], 0) / n;
    return {
        meanMm,
        meanPx,
        spread: points.reduce((s, p) => s + (p[0] - meanMm) ** 2, 0),
        cross: points.reduce((s, p) => s + (p[0] - meanMm) * (p[1] - meanPx), 0),
    };
}

// 版面縮放後的置中留白很小（B4 不到 1mm）；偏移超過這麼多 mm，表示這一頁不是第二頁的版面（第一頁會差 76mm）
const MAX_OFFSET_MM = 15;
// 格子位置和版面差超過這麼多 mm，或直向、橫向的比例差超過這個比例：寧可不畫，也不要畫歪
const MAX_RESIDUAL_MM = 2;
const MAX_ASPECT_DRIFT = 0.03;

/**
 * 這一頁的批改區位置。不是聯合報國中稿紙、不是第二頁的版面、格子對不上，都回 null（原稿照舊，只是不畫批改區）。
 */
export function gradingZoneOf(template: string | null | undefined, cells: CellLike[] | null | undefined): GradingZonePayload | null {
    if (template !== 'udn' || !Array.isArray(cells)) return null;
    const { grid } = UDN_PAGE_2;
    const xs: Array<[number, number]> = [];
    const ys: Array<[number, number]> = [];
    for (const cell of cells) {
        const col = Number(cell?.col);
        const row = Number(cell?.row);
        const rect = Array.isArray(cell?.rect) ? cell.rect.map(Number) : [];
        if (!Number.isInteger(col) || !Number.isInteger(row) || col < 1 || col > grid.cols || row < 1) continue;
        if (rect.length !== 4 || !rect.every(Number.isFinite)) continue;
        // 直書由右而左：第 1 行在最右邊
        xs.push([grid.x0 + (grid.cols - col) * grid.colPitch + grid.cellW / 2, (rect[0] + rect[2]) / 2]);
        ys.push([grid.y0 + (row - 1) * grid.cellH + grid.cellH / 2, (rect[1] + rect[3]) / 2]);
    }
    if (xs.length < 4) return null;
    /*
      最小平方的直線 px = scale × mm + offset。拉正的圖直向、橫向是同一個比例，所以兩個方向合起來算一個 scale：
      批改區在最左邊、離作答格最遠有三百多 mm，比例差一點點，位置就差很多；直向有 22 格可以對，比只靠橫向穩。
    */
    const x = axisStats(xs);
    const y = axisStats(ys);
    if (!(x.spread + y.spread > 0)) return null;
    const scale = (x.cross + y.cross) / (x.spread + y.spread);
    if (!(scale > 0)) return null;
    // 兩個方向各自的比例差太多：圖不是等比例拉正的（或格子的行號對錯了）
    // （只有一行或一列的格子時那個方向比不出來；spread 用 1 當門檻，不用 0：平均值的浮點誤差會讓它不是剛好 0）
    if (x.spread > 1 && y.spread > 1 && Math.abs((x.cross / x.spread) / (y.cross / y.spread) - 1) > MAX_ASPECT_DRIFT) return null;
    const ox = x.meanPx - scale * x.meanMm;
    const oy = y.meanPx - scale * y.meanMm;
    if (Math.abs(ox) > MAX_OFFSET_MM * scale || Math.abs(oy) > MAX_OFFSET_MM * scale) return null;
    const squared = xs.reduce((s, p) => s + (p[1] - (scale * p[0] + ox)) ** 2, 0)
        + ys.reduce((s, p) => s + (p[1] - (scale * p[0] + oy)) ** 2, 0);
    if (Math.sqrt(squared / (xs.length * 2)) > MAX_RESIDUAL_MM * scale) return null;

    return zoneAt(scale, ox, oy);
}

/** 稿紙上的 mm → 圖上的像素（px = scale × mm + 偏移），排出三個區塊的每一格 */
function zoneAt(scale: number, ox: number, oy: number): GradingZonePayload {
    const { typo, level, comment } = UDN_PAGE_2;
    const round = (v: number) => Math.round(v * 10) / 10;
    const toPx = (x0: number, y0: number, x1: number, y1: number): ZoneRect => [
        round(scale * x0 + ox), round(scale * y0 + oy), round(scale * x1 + ox), round(scale * y1 + oy),
    ];
    const rows = (count: number) => Array.from({ length: count }, (_, i) => i);
    return {
        typoColumns: typo.lefts.map((left) =>
            rows(typo.rows).map((r) => toPx(left, typo.top + r * typo.cell, left + typo.cell, typo.top + (r + 1) * typo.cell))),
        levelCells: level.columns.map(([left, right]) =>
            rows(level.rows).map((r) => toPx(left, level.top + r * level.rowH, right, level.top + (r + 1) * level.rowH))),
        commentBox: toPx(comment[0], comment[1], comment[2], comment[3]),
    };
}

/**
 * 空白稿紙第二頁的底圖是每 mm 幾個像素（apps/web/public/sheets/udn_A3_p2_grading.png，
 * services/handwriting-ocr/tools/build_static_sheets.py 產生）。前端拿到的數字和它手上那張圖對不上就不畫
 *（apps/web/lib/gradingZone.ts BLANK_GRADING_SHEETS），所以改解析度要兩邊一起改。
 */
export const BLANK_SHEET_PX_PER_MM = 8;

export interface BlankGradingZonePayload {
    pxPerMm: number;
    zone: GradingZonePayload;
}

/**
 * 沒有第二頁照片時的批改區：畫在空白稿紙第二頁（A3 原尺寸）的底圖上，位置就是稿紙上的 mm 乘上解析度。
 * 只寫一頁的作文沒有拍第二頁；國中作文常常一頁就寫完，沒有這個的話大半的作文看不到批改區。
 */
export function blankGradingZone(template: string | null | undefined): BlankGradingZonePayload | null {
    if (template !== 'udn') return null;
    return { pxPerMm: BLANK_SHEET_PX_PER_MM, zone: zoneAt(BLANK_SHEET_PX_PER_MM, 0, 0) };
}
