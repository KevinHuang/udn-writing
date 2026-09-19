import React from 'react';
import { ArrowLeft } from 'lucide-react';

/**
 * 教師端各頁的頁首：返回鍵＋大標＋副標，右側放這一頁的操作。
 *
 * HOME、課程管理、題庫中心、批改作業、成績管理原本各寫一份，
 * 返回鍵的內距、標題間距、副標縮排各不相同，切頁時大標會左右跳。
 * 一律走這個元件，位置才會一致。頁面外層也要用同一個寬度（PAGE_CONTAINER）。
 */

/** 教師端頁面的外層寬度。與 HOME 相同，大標才會落在同一條線上 */
export const PAGE_CONTAINER = 'max-w-7xl mx-auto';

interface PageHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** 有給才顯示返回鍵 */
  onBack?: () => void;
  /** 返回鍵的 id（沿用各頁原本的 id） */
  backId?: string;
  /** 右側的操作（學期下拉、按鈕…） */
  actions?: React.ReactNode;
  /**
   * 右側操作很寬（題庫中心的分頁＋搜尋＋按鈕）時，到 lg 才並排，
   * 否則平板寬度會把標題擠到換行。
   */
  wideActions?: boolean;
  className?: string;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  subtitle,
  onBack,
  backId,
  actions,
  wideActions = false,
  className = '',
}) => {
  const row = wideActions
    ? 'lg:flex-row lg:justify-between lg:items-end'
    : 'md:flex-row md:justify-between md:items-end';
  return (
    <div className={`flex flex-col ${row} gap-4 ${className}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              id={backId}
              onClick={onBack}
              title="返回"
              className="tap-target p-2 -ml-2 rounded-full hover:bg-card/50 text-text-secondary transition-colors shrink-0"
            >
              <ArrowLeft size={24} />
            </button>
          )}
          <h2 className="text-display font-bold text-text-primary tracking-tight min-w-0">
            {title}
          </h2>
        </div>
        {subtitle && (
          // 有返回鍵時副標縮排到與大標對齊：返回鍵 40px − 左移 8px ＋ 間距 12px = 44px
          <p className={`text-text-secondary mt-2 font-normal text-ui ${onBack ? 'md:ml-11' : ''}`}>
            {subtitle}
          </p>
        )}
      </div>
      {actions}
    </div>
  );
};
