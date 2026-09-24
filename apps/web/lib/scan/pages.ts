import { SCAN_CONFIG } from './config';

/**
 * 多張稿紙一起辨識時的計算與文案。
 *
 * 為什麼要抽成純函式：這個專案的測試沒有 jsdom，元件裡的東西一律測不到。
 * 而這裡每一支都是「算錯了畫面不會壞、只會安靜地給出錯的結果」的那種：
 * 文字串接順序、原稿要覆蓋還是接續、上限差一格……所以全部下沉到這裡，
 * 用 test/scanPages.test.tsx 一條一條釘住。
 */

/** 一張的辨識結果。index 從 1 起算 —— 這些數字是要講給人聽的 */
export interface PageOcrOutcome {
  index: number;
  text: string;
  /** 存進 GCS 的原稿路徑。辨識不到文字但檔案有存到是常見情況 */
  files: string[];
  /** 請求本身失敗（逾時、500）。跟「回來了但沒有文字」是兩件事 */
  failed?: boolean;
}

export interface BatchOcrSummary {
  /** 依拍攝順序串好的文字。全部沒讀到就是空字串 */
  text: string;
  files: string[];
  /** 回來了但沒有文字的張號 */
  emptyPages: number[];
  /** 請求失敗的張號 */
  failedPages: number[];
  successCount: number;
  total: number;
}

/**
 * 把逐張的結果收斂成一份摘要。
 *
 * ⚠️ 文字**先濾掉空的再 join**，不要邊跑邊累加。
 *    三張裡中間那張沒辨識出文字時，累加寫法會產生 `A\n\n\n\nC`——
 *    多出來的空行在 Markdown 裡是另一個段落，學生會看到作文中間破一個洞。
 *
 * ⚠️ 順序就是拍攝順序，**不要重排**。使用者是照著稿紙順序拍的，
 *    任何「聰明的」重排都只會把對的順序弄亂。
 */
export function summarizeBatchOcr(outcomes: PageOcrOutcome[]): BatchOcrSummary {
  const text = outcomes
    .map((o) => o.text)
    .filter((t) => t && t.trim())
    .join('\n\n');

  return {
    text,
    files: outcomes.flatMap((o) => o.files),
    emptyPages: outcomes.filter((o) => !o.failed && !o.text.trim()).map((o) => o.index),
    failedPages: outcomes.filter((o) => o.failed).map((o) => o.index),
    successCount: outcomes.filter((o) => o.text.trim()).length,
    total: outcomes.length,
  };
}

/** 「第 2、4 張」。頓號是中文列舉的寫法，不要用逗號 */
function pageList(pages: number[], total: number): string {
  if (total === 1) return '這一張';
  return `第 ${pages.join('、')} 張`;
}

/**
 * 批次辨識結束後要對使用者說的話。全部順利就回空陣列（沒消息就是好消息）。
 *
 * @param variant 'alert' 合成一段給學生端的 alert；'list' 一行一條給老師端的問題清單
 */
export function batchOcrMessages(s: BatchOcrSummary, variant: 'alert' | 'list'): string[] {
  if (s.total === 0) return [];

  const allFailed = s.successCount === 0;

  if (variant === 'list') {
    const lines: string[] = [];
    if (s.emptyPages.length) lines.push(`${pageList(s.emptyPages, s.total)}：辨識不到文字`);
    if (s.failedPages.length) lines.push(`${pageList(s.failedPages, s.total)}：辨識失敗`);
    if (allFailed) lines.push('這一批都沒有辨識出文字。可以直接在下方打字登錄。');
    return lines;
  }

  // alert：學生端只會看到一則，把話講完整比講精確重要
  if (allFailed) {
    /*
      「一張文字都沒讀到」有兩種原因，要分開講：
      整批都是請求失敗（斷網、後端掛了）叫人重掃只是白費力氣，
      要說的是稍後再試；真的讀不到字才是「重掃一次或直接打字」。
    */
    if (s.failedPages.length === s.total) {
      return ['辨識失敗，請稍後再試，或直接在下方打字。'];
    }
    return [
      s.total === 1
        ? '這一張沒有辨識出文字，可以重掃一次或直接打字。'
        : `這 ${s.total} 張都沒有辨識出文字，可以重掃一次或直接打字。`,
    ];
  }
  if (!s.emptyPages.length && !s.failedPages.length) return [];

  const parts: string[] = [];
  if (s.emptyPages.length) parts.push(`${pageList(s.emptyPages, s.total)}沒有讀到文字`);
  if (s.failedPages.length) parts.push(`${pageList(s.failedPages, s.total)}辨識失敗`);
  return [`辨識完成。${parts.join('，')}，其餘已經接在作文後面。`];
}

/**
 * 掃描回來的原稿路徑要覆蓋還是接續。
 *
 * 重掃是整份覆蓋：這次第一次掃描時，先前留存的原稿全部換掉。不這樣做的話，
 * 學生重掃一次就會留下兩套原稿，老師批改時分不出哪一份才是現在這篇作文。
 *
 * ⚠️ 整批只結算一次，不要每張各算各的。每張各算的話，「第一次」會落在
 *    「第一張成功的那一張」上 —— 第 1 張請求失敗、第 2 張成功時，
 *    第 2 張又會再覆蓋一次，等於行為取決於哪一張失敗。
 */
export function mergePicFiles(prev: string[], incoming: string[], replace: boolean): string[] {
  if (!incoming.length) return replace ? [] : prev;
  return replace ? [...incoming] : [...prev, ...incoming];
}

/** 送出鈕上的字。total 是**含畫面上這一張**的總數 */
export function pagesButtonLabel(total: number): string {
  return total <= 1 ? '使用這一張' : `使用這 ${total} 張`;
}

/**
 * 收下目前這張之後還能不能再拍。
 *
 * ⚠️ `collected` 是托盤裡已經收好的，畫面上還有「目前這張」沒收。
 *    上限講的是最後送出去的總張數，所以要 +1 再比 —— 差這一格，
 *    就會變成「按了再拍下一張，到下一頁才發現滿了」。
 */
export function canAddMore(collected: number): boolean {
  return collected + 1 < SCAN_CONFIG.maxScanPages;
}

/**
 * 托盤本身滿了 —— 首頁的「開啟相機／從相簿選擇」要用這個，**不是 canAddMore**。
 *
 * ⚠️ 兩者差一格，而且差在關鍵處：從首頁拍的那張會變成「畫面上這張」，
 *    托盤張數不變。用 canAddMore 去鎖首頁的話，托盤 7 張時就不給拍了 ——
 *    但第 8 張是合法的，使用者會被擋在 7 張（實測踩到）。
 */
export function trayFull(collected: number): boolean {
  return collected >= SCAN_CONFIG.maxScanPages;
}

/** 到上限時要說的話；還沒到就回空字串 */
export function limitHint(collected: number): string {
  if (canAddMore(collected)) return '';
  return `一次最多 ${SCAN_CONFIG.maxScanPages} 張，請先送出辨識`;
}
