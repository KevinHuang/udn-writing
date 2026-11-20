/**
 * 簡易批改在批改頁的資訊（只給老師看；後端 GET /instructor/grading/:id/simple，docs/simple-grading.md）。
 *
 * 稿紙代繳交、經逐格辨識、文字沒被老師改過的作文，按「AI 批改」會改用簡易批改：
 * 學生沒有校稿，辨識不確定的字不引用、不批評。學生看得到的級分與評語照舊在評語欄；
 * 這裡是**只給老師看**的那一份：評分依據、請老師留意、系統拿掉了哪些引用、辨識摘要。
 *
 * 純邏輯，元件在 components/SimpleGradingPanel.tsx。
 */

export interface SheetSummary {
  template: string | null;
  /** 可信的格子 ÷ 有寫字的格子（0～1） */
  completion: number | null;
  lowCompletion: boolean;
  chars: number | null;
  paragraphs: number | null;
  confirmedTypos: number;
  pendingTypos: number;
  indentIssues: number;
  punctuationIssues: number;
}

export interface SimpleGradingDetail {
  systemZero: boolean;
  scoreBasis: string;
  zeroReason: string;
  teacherAlert: { needed: boolean; reason: string; paragraph: number | null };
  checks: string[];
}

export interface SimpleGradingInfo {
  /** 這篇按「AI 批改」會不會用簡易批改 */
  eligible: boolean;
  /** 不能用的原因：沒有逐格辨識／老師校對改過文字 */
  reason: 'no_grid' | 'edited' | null;
  sheet: SheetSummary | null;
  /** 簡易批改過才有 */
  detail: SimpleGradingDetail | null;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** 後端的回傳 → 畫面用的形狀。欄位缺了不當掉：這一塊只是輔助資訊，不能拖垮整個批改頁 */
export function parseSimpleGradingInfo(raw: unknown): SimpleGradingInfo {
  const r = (raw ?? {}) as Record<string, unknown>;
  const s = r.sheet as Record<string, unknown> | null | undefined;
  const d = r.detail as Record<string, unknown> | null | undefined;
  const alert = (d?.teacherAlert ?? {}) as Record<string, unknown>;
  return {
    eligible: r.eligible === true,
    reason: r.reason === 'no_grid' || r.reason === 'edited' ? r.reason : null,
    sheet: s ? {
      template: typeof s.template === 'string' ? s.template : null,
      completion: typeof s.completion === 'number' ? s.completion : null,
      lowCompletion: s.lowCompletion === true,
      chars: typeof s.chars === 'number' ? s.chars : null,
      paragraphs: typeof s.paragraphs === 'number' ? s.paragraphs : null,
      confirmedTypos: num(s.confirmedTypos),
      pendingTypos: num(s.pendingTypos),
      indentIssues: num(s.indentIssues),
      punctuationIssues: num(s.punctuationIssues),
    } : null,
    detail: d ? {
      systemZero: d.systemZero === true,
      scoreBasis: str(d.scoreBasis),
      zeroReason: str(d.zeroReason),
      teacherAlert: {
        needed: alert.needed === true,
        reason: str(alert.reason),
        paragraph: typeof alert.paragraph === 'number' ? alert.paragraph : null,
      },
      checks: Array.isArray(d.checks) ? d.checks.filter((c): c is string => typeof c === 'string') : [],
    } : null,
  };
}

/** 辨識完成度：無條件捨去成整數百分比（92.9% 寫 92%，不要讓老師以為比實際好） */
export const completionPercent = (completion: number) => Math.floor(completion * 100);

/** 批改頁要不要出現這一塊：會用簡易批改，或之前用簡易批改批過 */
export const showSimpleGrading = (info: SimpleGradingInfo | null): info is SimpleGradingInfo =>
  !!info && (info.eligible || info.detail !== null);

/** 一行辨識摘要，例如「辨識完成度 92%・確定的錯別字 3 個・待確認 1 個・段首沒空兩格 1 處」 */
export function sheetSummaryLine(sheet: SheetSummary): string {
  return [
    sheet.completion !== null ? `辨識完成度 ${completionPercent(sheet.completion)}%` : '',
    `確定的錯別字 ${sheet.confirmedTypos} 個`,
    sheet.pendingTypos > 0 ? `待確認 ${sheet.pendingTypos} 個` : '',
    sheet.indentIssues > 0 ? `段首沒空兩格 ${sheet.indentIssues} 處` : '',
    sheet.punctuationIssues > 0 ? `標點在行首 ${sheet.punctuationIssues} 處` : '',
  ].filter(Boolean).join('・');
}

/** 請老師留意的那一句（學生看不到） */
export function teacherAlertText(alert: SimpleGradingDetail['teacherAlert']): string | null {
  if (!alert.needed) return null;
  const where = alert.paragraph ? `（第 ${alert.paragraph} 段）` : '';
  return `${alert.reason || '作文裡有需要關心的內容'}${where}`;
}

/**
 * 「AI 辨識未校對」提示條在簡易批改的作文上要多講一句：
 * 校對**不是必要的** —— 簡易批改本來就是給沒校稿的文字用的；校對改過文字反而會改用一般批改。
 */
export const PROOFREAD_NOTE =
  '按「AI 批改」會用簡易批改：辨識不確定的字不會被引用或批評。若先校對改過文字，就改用一般批改。';
