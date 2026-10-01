import React from 'react';
import { ChevronDown, Stamp } from 'lucide-react';
import {
  RULE_LEVELS, effectiveRule, levelText, modeOf, ruleText,
  type AssignmentRuleMode, type AssignmentRules, type MyFeaturedRule,
} from '../lib/featuredRule';

interface AssignmentFeaturedRuleProps {
  assignmentId: string;
  rules: AssignmentRules;
  mine: MyFeaturedRule;
  onChange: (mode: AssignmentRuleMode, minScore: number | null) => void;
}

/**
 * 批改清單上的「這份作業的自動佳作標準」。
 *
 * 預設沿用批改者自己的標準（入口頁設定的那一份）；這裡可以改成這份作業專用的
 * 門檻、或這份作業不自動蓋。改過之後不論誰批改都以這裡為準 ——
 * 例如程度比較好的班，老師想把門檻提高到 6 級分。
 *
 * 下拉的值用字串編碼（inherit／off／custom:5），一個 select 就裝得下三種設定。
 */
export const AssignmentFeaturedRule: React.FC<AssignmentFeaturedRuleProps> = ({
  assignmentId, rules, mine, onChange,
}) => {
  const mode = modeOf(assignmentId, rules);
  const rule = effectiveRule(assignmentId, rules, mine);
  const value = mode === 'custom' ? `custom:${rule.minScore}` : mode;

  const mineText = mine.enabled ? levelText(mine.minScore) : '沒有開啟';
  const hint =
    mode === 'inherit'
      ? `沿用批改者自己的標準。你批改時：${mine.enabled ? ruleText(rule) : '不自動蓋（你沒有開啟）'}`
      : '不論誰批改，都以這份作業的設定為準';

  return (
    <div
      id="gradinglist-featured-rule"
      className="bg-card/80 border border-border-card rounded-brand px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
    >
      <div className="min-w-0">
        <p className="text-body text-text-primary flex items-center gap-2">
          <Stamp size={16} className="shrink-0 text-secondary" />
          自動蓋佳作：{mode === 'inherit' ? '沿用批改者的標準' : `本作業 ${ruleText(rule)}`}
        </p>
        <p className="text-caption text-text-muted mt-0.5">{hint}。只對之後第一次批改完成的作品生效。</p>
      </div>
      <label className="relative shrink-0">
        <span className="sr-only">這份作業的自動佳作標準</span>
        <select
          id="gradinglist-select-featured-rule"
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'inherit' || v === 'off') onChange(v, null);
            else onChange('custom', Number(v.split(':')[1]));
          }}
          className="appearance-none bg-card border border-border-strong rounded-xl pl-3 pr-9 py-2 text-body text-text-primary outline-none cursor-pointer hover:border-secondary/60 focus:ring-2 focus:ring-secondary/30 transition-colors"
        >
          <option value="inherit">沿用批改者的標準（你的：{mineText}）</option>
          {RULE_LEVELS.map((lv) => (
            <option key={lv} value={`custom:${lv}`}>本作業 {levelText(lv)}</option>
          ))}
          <option value="off">本作業不自動蓋</option>
        </select>
        <ChevronDown
          size={15}
          className="text-text-secondary absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
        />
      </label>
    </div>
  );
};
