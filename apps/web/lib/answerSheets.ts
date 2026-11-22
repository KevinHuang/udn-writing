/**
 * 《我的稿紙》（靜態版）：網站上可以下載、列印的空白稿紙。
 *
 * 2026-11-20 使用者決定第一版做靜態的：稿紙由 services/handwriting-ocr 的
 * tools/build_static_sheets.py 先產生好，放在 public/sheets/，這裡只列清單。
 * 不用部署辨識服務、不用改資料庫；四角一樣印定位標記，之後做逐格辨識時這些稿紙照樣認得。
 *
 * ⚠️ 檔名要和 build_static_sheets.py 的 SHEETS 對得上（`<格式>_<紙張>.pdf`、預覽 `<格式>_<紙張>_p<頁>.png`），
 *    test/answerSheets.test.tsx 會檢查每個檔案都在。改稿紙就重跑那支腳本，連同檔案一起 commit。
 */

export type SheetPaper = 'A3' | 'B4';

export interface SheetPaperOption {
  paper: SheetPaper;
  /** 紙張旁的說明，例如「原尺寸」 */
  note: string;
}

export interface AnswerSheet {
  /** 和 build_static_sheets.py 的 format 一樣，也是檔名開頭 */
  id: 'udn' | 'ucup' | 'cap' | 'gsat';
  label: string;
  /** 一兩句話：這是什麼稿紙、什麼時候用 */
  description: string;
  /** 一份幾頁（都是正反兩面） */
  pages: number;
  /** 第一個是預設（稿紙原本的尺寸） */
  papers: SheetPaperOption[];
}

export const ANSWER_SHEETS: AnswerSheet[] = [
  {
    id: 'udn',
    label: '聯合報國中寫作稿紙',
    description: '聯合報寫作教室國中專用稿紙。第二頁左側有錯字訂正、寫作能力分析與老師評語欄。',
    pages: 2,
    papers: [
      { paper: 'A3', note: '原尺寸' },
      { paper: 'B4', note: '整張等比例縮小' },
    ],
  },
  {
    id: 'ucup',
    label: '聯合盃作文大賽稿紙',
    // 比賽是匿名評分：稿紙上印著「請勿填寫姓名、學校及足以辨識身分之記號」。寫出來讓老師自己決定怎麼用
    description: '聯合盃作文大賽專用稿紙，每頁 20 行、每行 25 字，適合模擬參賽。比賽採匿名評分，稿紙上印著「請勿填寫姓名」。',
    pages: 2,
    papers: [
      { paper: 'B4', note: '原尺寸' },
      { paper: 'A3', note: '整張等比例放大' },
    ],
  },
  {
    id: 'cap',
    label: '會考稿紙',
    description: '教育會考寫作測驗答案卷的格式，每頁 23 行、每行 22 字，適合模擬會考。',
    pages: 2,
    papers: [
      { paper: 'B4', note: '考場原尺寸' },
      { paper: 'A3', note: '整張等比例放大' },
    ],
  },
  {
    id: 'gsat',
    label: '學測稿紙',
    description: '學測國文寫作答案卷的格式：第一頁是知性題（第一大題），第二頁是情意題（第二大題）。',
    pages: 2,
    papers: [
      { paper: 'A3', note: '考場原尺寸' },
      { paper: 'B4', note: '整張等比例縮小' },
    ],
  },
];

const SHEET_DIR = '/sheets';

export const sheetFileStem = (id: AnswerSheet['id'], paper: SheetPaper): string => `${id}_${paper}`;

export const sheetPdfUrl = (id: AnswerSheet['id'], paper: SheetPaper): string =>
  `${SHEET_DIR}/${sheetFileStem(id, paper)}.pdf`;

/** 每一頁的預覽圖，依頁序 */
export const sheetPreviewUrls = (sheet: AnswerSheet, paper: SheetPaper): string[] =>
  Array.from({ length: sheet.pages }, (_, i) => `${SHEET_DIR}/${sheetFileStem(sheet.id, paper)}_p${i + 1}.png`);

/** 下載時的檔名：「聯合報國中寫作稿紙_A3.pdf」。網址上的檔名是英文，存到電腦上要看得懂 */
export const sheetDownloadName = (sheet: AnswerSheet, paper: SheetPaper): string => `${sheet.label}_${paper}.pdf`;
