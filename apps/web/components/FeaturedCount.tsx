import React from 'react';
import { Stamp } from 'lucide-react';
import { MARK_META } from '../lib/submissionMarks';

/**
 * 作業列上的「佳作 N」。0 篇不顯示 —— 每一列都寫「佳作 0」只會讓清單變吵。
 * 數字來自 submissionStats(…, marks).featured（lib/assignments.ts）。
 */
export const FeaturedCount: React.FC<{ count: number }> = ({ count }) =>
  count > 0 ? (
    <span
      className="inline-flex items-center gap-0.5 text-caption text-secondary font-bold tabular-nums whitespace-nowrap"
      title={`這份作業有 ${count} 篇${MARK_META.featured.label}`}
    >
      <Stamp size={12} className="shrink-0" aria-hidden="true" />
      {MARK_META.featured.label} {count}
    </span>
  ) : null;
