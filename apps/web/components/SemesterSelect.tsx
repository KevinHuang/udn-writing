import React, { useMemo } from 'react';
import { Calendar } from 'lucide-react';
import { semesterLabel } from '../lib/semester';
import { FieldSelect, type SelectSection } from './FieldSelect';

interface SemesterOption {
  value: string;
  label: string;
}

interface SemesterSelectProps {
  id: string;
  value: string;
  options: SemesterOption[];
  onChange: (semester: string) => void;
  /** 目前學期。選單裡在那一列標「本學期」 */
  current?: string;
  /**
   * pill：獨立的膠囊（頁首右側）。
   * field：篩選列裡的一張卡片（成績管理），標籤在上、值在下。
   */
  variant?: 'pill' | 'field';
  className?: string;
}

/**
 * 學期下拉選單。教師端、學生端所有的學期切換都用這一個。
 *
 * 選單的外觀與互動都在 FieldSelect，這裡只負責把學期排成
 * 「115 學年度 → 第 1 學期／第 2 學期」的分組，並標出本學期。
 */
export const SemesterSelect: React.FC<SemesterSelectProps> = ({
  id,
  value,
  options,
  onChange,
  current,
  variant = 'pill',
  className = '',
}) => {
  /** 依學年度分組，保留原本的順序（新的在前） */
  const sections = useMemo<SelectSection[]>(() => {
    const out: SelectSection[] = [];
    for (const opt of options) {
      const m = /^(\d+)-(\d+)$/.exec(opt.value);
      const key = m ? m[1] : `raw:${opt.value}`;
      const item = {
        value: opt.value,
        // 有分組標題時列裡只寫「第 N 學期」，學年度不必每一列再重複一次
        label: m ? `第 ${m[2]} 學期` : opt.label,
        badge: opt.value === current ? '本學期' : undefined,
      };
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(item);
      else out.push({ key, title: m ? `${m[1]} 學年度` : undefined, items: [item] });
    }
    return out;
  }, [options, current]);

  return (
    <FieldSelect
      id={id}
      value={value}
      sections={sections}
      onChange={onChange}
      label="學期"
      icon={Calendar}
      displayLabel={options.find((o) => o.value === value)?.label ?? semesterLabel(value)}
      variant={variant}
      className={className}
    />
  );
};
