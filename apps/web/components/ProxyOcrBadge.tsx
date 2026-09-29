import React from 'react';
import { Loader2 } from 'lucide-react';
import { PROXY_OCR_STYLE, UNPROOFREAD_STYLE } from '../lib/statusStyles';
import type { ProxyOcrStatus } from '../lib/proxy/status';

interface ProxyOcrBadgeProps {
  status: ProxyOcrStatus;
  className?: string;
}

/**
 * 批次代繳交的辨識徽章，疊在繳交狀態徽章旁邊（它們是兩個維度）。
 *
 * 批改清單上只在「還有事要處理」時出現：
 *   待辨識／辨識中／辨識失敗 —— 照字面
 *   已辨識 —— 顯示成「AI 辨識未校對」：文字是機器認的，批改前要對過原稿。
 *            老師校對存檔之後這一批就退役，徽章自然消失。
 */
export const ProxyOcrBadge: React.FC<ProxyOcrBadgeProps> = ({ status, className = '' }) => {
  if (status === 'idle') return null;
  const style = status === 'done' ? UNPROOFREAD_STYLE : PROXY_OCR_STYLE[status];
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-caption whitespace-nowrap w-fit ${style.badge} ${className}`}
    >
      {(status === 'running' || status === 'uploading') && (
        <Loader2 size={11} className="animate-spin shrink-0" />
      )}
      {style.label}
    </span>
  );
};
