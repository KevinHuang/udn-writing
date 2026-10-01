/**
 * 自動蓋佳作的標準 —— 畫面這一側的判斷與文字。
 *
 * 真正蓋章的是後端（apps/api 的 FeaturedRuleHelper，作品**第一次**批改完成時）。
 * 這一支只負責回答畫面上的問題：「這份作業現在用的是哪個標準？」、「要怎麼寫給老師看？」
 *
 * 規則（使用者決定，見 docs/migrations/009）：
 *   - 作業另外調整過 → 用作業的（不論誰批改）
 *   - 否則用**當下批改的人**自己的標準 —— 所以畫面上只能講「你批改時」的情形
 *   - 每篇只判斷一次；只對之後的批改生效
 */

import { MAX_LEVEL } from './scoring';
import { FEATURED_DEFAULT_LEVEL } from './submissionMarks';

/** 自己的標準。沒開的時候 minScore 仍然記著，重新打開不用再選一次 */
export interface MyFeaturedRule {
  enabled: boolean;
  minScore: number;
}

export const DEFAULT_MY_RULE: MyFeaturedRule = { enabled: false, minScore: FEATURED_DEFAULT_LEVEL };

/**
 * 作業另外調整過的標準，鍵是作業 id。
 * **沒有這個鍵＝沿用批改者的標準**；值是 null ＝ 這份作業不自動蓋。
 */
export type AssignmentRules = Record<string, number | null>;

/** 作業的三種設定方式，與後端 PUT 的 mode 一致 */
export type AssignmentRuleMode = 'inherit' | 'off' | 'custom';

/** 門檻的選項：6 到 1 */
export const RULE_LEVELS = Array.from({ length: MAX_LEVEL }, (_, i) => MAX_LEVEL - i);

export interface EffectiveRule {
  /** 幾級分以上自動蓋。null ＝ 不自動蓋 */
  minScore: number | null;
  /** 這個標準從哪裡來 */
  source: 'assignment' | 'mine';
}

/** 你批改這份作業時，實際會用的標準 */
export function effectiveRule(
  assignmentId: string,
  rules: AssignmentRules,
  mine: MyFeaturedRule,
): EffectiveRule {
  if (Object.prototype.hasOwnProperty.call(rules, assignmentId)) {
    return { minScore: rules[assignmentId], source: 'assignment' };
  }
  return { minScore: mine.enabled ? mine.minScore : null, source: 'mine' };
}

/** 作業目前是哪一種設定 */
export function modeOf(assignmentId: string, rules: AssignmentRules): AssignmentRuleMode {
  if (!Object.prototype.hasOwnProperty.call(rules, assignmentId)) return 'inherit';
  return rules[assignmentId] === null ? 'off' : 'custom';
}

/** 「5 級分以上」。6 級分只有一種，不寫「以上」 */
export function levelText(minScore: number): string {
  return minScore >= MAX_LEVEL ? `${MAX_LEVEL} 級分` : `${minScore} 級分以上`;
}

/** 標準的一句話說明 */
export function ruleText(rule: EffectiveRule): string {
  return rule.minScore === null ? '不自動蓋' : `${levelText(rule.minScore)}自動蓋佳作`;
}

/** 改一份作業的設定之後，本地的 AssignmentRules 該長什麼樣子（與後端的結果一致） */
export function applyAssignmentRule(
  rules: AssignmentRules,
  assignmentId: string,
  mode: AssignmentRuleMode,
  minScore: number | null,
): AssignmentRules {
  const next = { ...rules };
  if (mode === 'inherit') delete next[assignmentId];
  else next[assignmentId] = mode === 'off' ? null : minScore;
  return next;
}
