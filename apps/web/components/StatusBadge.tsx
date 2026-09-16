import React from 'react';
import { Clock, CheckCircle, AlertCircle, Send, FileText } from 'lucide-react';
import { SubmissionStatus } from '../types';
import { statusStyle, OVERDUE_STYLE } from '../lib/statusStyles';

const ICONS: Record<SubmissionStatus, React.ComponentType<{ size?: number }>> = {
  Unsubmitted: Clock,
  Draft: FileText,
  Pending: AlertCircle,
  Graded: CheckCircle,
  Published: Send,
};

interface StatusBadgeProps {
  status: SubmissionStatus;
  /** 逾期是獨立維度，會蓋掉狀態色改用朱砂 */
  overdue?: boolean;
  /** 只顯示文字顏色，不畫底色與外框 */
  plain?: boolean;
  className?: string;
}

/**
 * 繳交狀態徽章。
 *
 * 顏色一律取自 lib/statusStyles.ts，元件裡不要自己寫顏色 ——
 * 改版前這段三元判斷在十個檔案各寫一次，同一個狀態在不同頁面
 * 長得不一樣，還有兩個狀態撞成同一個顏色。
 */
export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  overdue = false,
  plain = false,
  className = '',
}) => {
  const style = overdue ? OVERDUE_STYLE : statusStyle(status);
  const Icon = ICONS[status] ?? Clock;

  if (plain) {
    return (
      <span className={`inline-flex items-center gap-1.5 text-caption ${style.text} ${className}`}>
        <Icon size={12} />
        {style.label}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-brand text-caption ${style.badge} ${className}`}
    >
      <Icon size={12} />
      {style.label}
    </span>
  );
};
