import React from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmDialogProps {
  title: string;
  /** 說明。用 \n 分段，這裡會保留換行 */
  message: string;
  /** 確認鍵的字。刪除類的動作要寫清楚做什麼，不要只寫「確定」 */
  confirmLabel: string;
  /** 破壞性動作用朱砂，其餘用花青 */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 二次確認視窗。
 *
 * 取代 window.confirm ——瀏覽器原生的那個長相不受控、在深色模式下
 * 完全不像這個系統的一部分，而且沒辦法把「會影響幾題」這種關鍵資訊
 * 分段講清楚。刪除題目與刪除資料夾都走這一支。
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  title,
  message,
  confirmLabel,
  danger = false,
  onConfirm,
  onCancel,
}) => {
  // Esc 取消。刪除類的視窗一定要留一條最省力的退路
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  /*
    掛到 document.body，並且壓過手機的底部導覽（z-[1001]）。
    不掛 body 的話，呼叫端若是 `space-y-*` 容器，Tailwind v4 會給這個
    fixed inset-0 一段 margin-bottom，遮罩底部會短一截、露出後面的畫面。
  */
  return createPortal(
    <div
      id="confirm-dialog"
      className="fixed inset-0 z-[1100] flex items-center justify-center p-4 sm:p-6"
    >
      <div
        className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm"
        onClick={onCancel}
      />
      <div className="relative w-full max-w-sm bg-surface rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-border">
        <div className="p-6 border-b border-border flex items-start justify-between gap-3">
          <h2 className="text-title font-bold text-text-primary flex items-center gap-2">
            <AlertTriangle
              size={20}
              className={danger ? 'text-danger-600' : 'text-warning-600'}
            />
            {title}
          </h2>
          <button
            id="confirm-dialog-btn-close"
            onClick={onCancel}
            title="關閉"
            className="tap-target shrink-0 p-1.5 rounded-full text-text-secondary hover:bg-surface-soft transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-6">
          {/* 訊息裡有 \n 分段，沒有 pre-line 會全部黏成一坨 */}
          <p className="text-body text-text-secondary leading-relaxed whitespace-pre-line">
            {message}
          </p>
        </div>

        <div className="p-6 bg-surface-soft/50 border-t border-border flex justify-end gap-3">
          <button
            id="confirm-dialog-btn-cancel"
            onClick={onCancel}
            className="px-4 py-2 text-text-secondary hover:bg-card rounded-xl font-bold transition-colors"
          >
            取消
          </button>
          <button
            id="confirm-dialog-btn-confirm"
            onClick={onConfirm}
            className={`px-4 py-2 rounded-xl font-bold text-on-accent shadow-lg transition-all active:scale-95 ${
              danger
                ? 'bg-danger-600 hover:opacity-90 shadow-danger-600/20'
                : 'bg-primary hover:bg-primary/90 shadow-primary/20'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
