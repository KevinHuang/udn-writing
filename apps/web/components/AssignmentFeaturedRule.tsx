import React, { useState } from 'react';
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
 *
 * 手機上收成一行（點了才展開說明與下拉）：這是很少改的設定，完整展開要 155px，
 * 老師打開批改清單會一位學生都看不到（實測 375px）。640px 以上維持展開。
 */
export const AssignmentFeaturedRule: React.FC<AssignmentFeaturedRuleProps> = ({
  assignmentId, rules, mine, onChange,
}) => {
  const [open, setOpen] = useState(false);
  const mode = modeOf(assignmentId, rules);
  const rule = effectiveRule(assignmentId, rules, mine);
  const value = mode === 'custom' ? `custom:${rule.minScore}` : mode;

  const mineText = mine.enabled ? levelText(mine.minScore) : '沒有開啟';
  const hint =
    mode === 'inherit'
      ? `沿用批改者自己的標準。你批改時：${mine.enabled ? ruleText(rule) : '不自動蓋（你沒有開啟）'}`
      : '不論誰批改，都以這份作業的設定為準';

  const summary = (
    <>
      <Stamp size={16} className="shrink-0 text-secondary" />
      <span className="min-w-0 truncate">
        自動蓋佳作：{mode === 'inherit' ? '沿用批改者的標準' : `本作業 ${ruleText(rule)}`}
      </span>
    </>
  );
  /** 手機上收起時，說明與下拉都藏起來；640px 以上一律顯示 */
  const shown = open ? '' : 'hidden sm:block';

  return (
    <div
      id="gradinglist-featured-rule"
      className="bg-card/80 border border-border-card rounded-brand px-3 sm:px-4 py-2 sm:py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3"
    >
      <div className="min-w-0">
        {/* 手機：整行是開關 */}
        <button
          id="gradinglist-featured-rule-toggle"
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="sm:hidden tap-target w-full flex items-center gap-2 text-left text-body text-text-primary"
        >
          {summary}
          <ChevronDown size={16} className={`ml-auto shrink-0 text-text-secondary transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        <p className="hidden sm:flex items-center gap-2 text-body text-text-primary">{summary}</p>
        <p className={`${shown} text-caption text-text-muted mt-0.5`}>{hint}。只對之後第一次批改完成的作品生效。</p>
      </div>
      <label className={`${shown} relative shrink-0`}>
        <span className="sr-only">這份作業的自動佳作標準</span>
        <select
          id="gradinglist-select-featured-rule"
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'inherit' || v === 'off') onChange(v, null);
            else onChange('custom', Number(v.split(':')[1]));
          }}
          className="w-full sm:w-auto appearance-none bg-card border border-border-strong rounded-xl pl-3 pr-9 py-2 text-body text-text-primary outline-none cursor-pointer hover:border-secondary/60 focus:ring-2 focus:ring-secondary/30 transition-colors"
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
