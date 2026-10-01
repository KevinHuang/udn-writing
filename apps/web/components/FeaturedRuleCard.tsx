import React from 'react';
import { Stamp } from 'lucide-react';
import { RULE_LEVELS, levelText, type MyFeaturedRule } from '../lib/featuredRule';

interface FeaturedRuleCardProps {
  rule: MyFeaturedRule;
  onChange: (rule: MyFeaturedRule) => void;
}

/**
 * 批改作業入口頁的「自動蓋佳作」設定 —— 這位老師自己的標準。
 *
 * 不論哪所學校、哪個班，作品**第一次**批改完成時（AI 批改或手動存檔）
 * 達到標準就自動蓋上佳作章。蓋章在後端做（FeaturedRuleHelper），
 * 所以不管從哪個畫面批改都一樣。
 *
 * 三條規則寫在卡片上，因為它們全都是「為什麼系統沒有動」的答案：
 * 老師取消章後章沒回來、改高分後沒蓋、舊作品沒補蓋 —— 不寫清楚會被當成 bug。
 */
export const FeaturedRuleCard: React.FC<FeaturedRuleCardProps> = ({ rule, onChange }) => (
  <section
    id="grading-hub-featured-rule"
    className="bg-card border border-border-card shadow-paper rounded-brand px-4 py-4 md:px-5 space-y-3"
  >
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="flex items-center gap-2 text-title font-bold text-text-primary">
          <Stamp size={18} className="text-secondary shrink-0" />
          自動蓋佳作
          <span className="text-body font-normal text-text-secondary">
            {rule.enabled ? `${levelText(rule.minScore)}` : '未開啟'}
          </span>
        </h3>
        <p className="text-caption text-text-muted mt-1">
          作品第一次批改完成時（AI 批改或手動存檔），達到標準就自動蓋上佳作章。所有學校、所有班級都適用。
        </p>
      </div>
      <button
        id="grading-hub-featured-rule-toggle"
        type="button"
        role="switch"
        aria-checked={rule.enabled}
        aria-label="自動蓋佳作"
        onClick={() => onChange({ ...rule, enabled: !rule.enabled })}
        className={`tap-target shrink-0 relative inline-flex h-7 w-12 items-center rounded-full border transition-colors ${
          rule.enabled ? 'bg-secondary border-secondary' : 'bg-surface-soft border-border-strong'
        }`}
      >
        <span
          className={`inline-block h-5 w-5 rounded-full bg-card shadow-paper transition-transform ${
            rule.enabled ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>

    {rule.enabled && (
      <>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="佳作標準">
          {RULE_LEVELS.map((lv) => (
            <button
              key={lv}
              id={`grading-hub-featured-rule-level-${lv}`}
              type="button"
              role="radio"
              aria-checked={rule.minScore === lv}
              onClick={() => onChange({ ...rule, minScore: lv })}
              className={`px-3 py-1.5 rounded-xl text-caption border transition-colors ${
                rule.minScore === lv
                  ? 'bg-secondary border-secondary text-on-accent'
                  : 'bg-card border-border-strong text-text-secondary hover:border-secondary hover:text-secondary'
              }`}
            >
              {levelText(lv)}
            </button>
          ))}
        </div>
        <ul className="text-caption text-text-muted space-y-0.5 list-disc pl-5">
          <li>每篇只判斷一次。之後改分數、改評語、或取消這個章，系統都不會再動。</li>
          <li>只對之後的批改生效。已經批改好的作品，請到該作業用「依級分蓋佳作」。</li>
          <li>個別作業可以在批改清單裡另外調整標準，調整過的不論誰批改都以作業的為準。</li>
        </ul>
      </>
    )}
  </section>
);
