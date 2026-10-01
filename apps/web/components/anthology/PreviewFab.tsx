import React from "react";
import { Eye, Loader2 } from "lucide-react";

/**
 * 手機與平板上的「預覽」浮動圓鈕：眼睛圖示＋右上角的篇數。
 *
 * 清單很長時，頁底的預覽按鈕要捲很久才找得到；先前用一整條固定操作列，
 * 但它蓋住太多畫面（使用者 2026-10-01 要求改成小圓鈕）。頁底原本的按鈕保留，
 * 這顆只是捷徑，1024px 以上不出現。
 *
 * 外層是 sticky 的一整列（pointer-events-none，不擋到底下的內容），圓鈕靠右。
 * 貼在哪裡由呼叫端的 className 決定：
 *   整頁捲動（學生端）  bottom-24 —— 底部導覽約 80px
 *   main 自己捲（教師端）bottom-2  —— main 已經留了 pb-24 給底部導覽
 */
export const PreviewFab: React.FC<{
  id: string;
  /** 已選幾篇。顯示在右上角 */
  count: number;
  /** 例：「預覽作品集」。給螢幕閱讀器與滑鼠提示 */
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
}> = ({ id, count, label, onClick, disabled = false, loading = false, className = "" }) => (
  <div className={`lg:hidden sticky z-10 flex justify-end pointer-events-none ${className}`}>
    <button
      id={id}
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={`${label}（已選 ${count} 篇）`}
      title={`${label}（已選 ${count} 篇）`}
      className="pointer-events-auto relative w-14 h-14 rounded-full bg-primary hover:bg-primary/90 text-on-accent shadow-lg shadow-primary/30 flex items-center justify-center transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {loading ? <Loader2 size={22} className="animate-spin" /> : <Eye size={24} />}
      <span className="absolute -top-1 -right-1 min-w-[1.5rem] h-6 px-1.5 rounded-full bg-secondary text-on-accent text-caption font-bold tabular-nums flex items-center justify-center border-2 border-card">
        {count}
      </span>
    </button>
  </div>
);
