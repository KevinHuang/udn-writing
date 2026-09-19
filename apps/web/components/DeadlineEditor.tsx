import React, { useState } from 'react';
import { Clock, X, Timer } from 'lucide-react';
import { Assignment } from '../types';
import {
  allowsLate,
  deadlineOf,
  endNow,
  hasDeadline,
  localDateTimeString,
  setDeadline,
} from '../lib/assignments';

interface DeadlineEditorProps {
  assignment: Assignment;
  onSave: (next: Assignment) => void;
  onCancel: () => void;
}

/**
 * 修改截止設定。
 *
 * 收不收件只看截止日（見 lib/assignments.ts），所以以前的「結束收件」
 * 與「重新開放」都在這裡完成：
 *   結束收件 ＝「立即截止」
 *   重新開放 ＝ 把截止日往後改，或改成不設截止日
 */
export const DeadlineEditor: React.FC<DeadlineEditorProps> = ({
  assignment,
  onSave,
  onCancel,
}) => {
  const [enabled, setEnabled] = useState(hasDeadline(assignment));
  const [value, setValue] = useState(() => {
    /*
      ⚠️ **不要直接 slice(0, 16)。** API 回來的截止日是帶時區的 ISO 字串
         （例如 `2026-09-24T15:59:00.000Z`），截前 16 字得到的是 **UTC** 的
         15:59，在台灣會顯示成比實際早 8 小時。要先轉成本地時間。
    */
    const current = deadlineOf(assignment);
    if (current) return localDateTimeString(current);
    // 開啟時的起始值：一週後 23:59，與新增作業一致
    const d = new Date();
    d.setDate(d.getDate() + 7);
    d.setHours(23, 59, 0, 0);
    return localDateTimeString(d);
  });
  const [allowLate, setAllowLate] = useState(allowsLate(assignment));

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const invalid = enabled && !value;

  const save = () => {
    if (invalid) return;
    // 不設截止日時「允許遲交」沒有意義，一併清掉，避免留下看不到的設定
    onSave(setDeadline(assignment, enabled ? value : '', enabled && allowLate));
  };

  return (
    <div id="deadline-editor" className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6">
      <div className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-sm bg-surface rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-border">
        <div className="p-5 border-b border-border flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-title font-bold text-text-primary flex items-center gap-2">
              <Clock size={18} className="text-primary shrink-0" />
              截止設定
            </h2>
            <p className="mt-1 text-caption text-text-secondary line-clamp-1">{assignment.title}</p>
          </div>
          <button
            id="deadline-editor-btn-close"
            onClick={onCancel}
            title="關閉"
            className="tap-target shrink-0 p-1.5 rounded-full text-text-secondary hover:bg-surface-soft transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-caption text-text-secondary leading-relaxed">
            過了截止時間，學生就不能再交。要延長收件，把時間往後改就好。
          </p>

          <label className="flex items-center gap-2 text-body text-text-primary cursor-pointer">
            <input
              id="deadline-editor-toggle"
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="w-4 h-4 shrink-0 accent-primary cursor-pointer"
            />
            設定截止時間
          </label>

          {enabled ? (
            <>
              <input
                id="deadline-editor-input"
                type="datetime-local"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="w-full px-3.5 py-2.5 border border-border rounded-brand bg-card text-text-primary text-ui focus:ring-4 focus:ring-primary/10 focus:border-primary outline-none transition-all"
              />
              <label className="flex items-start gap-2 text-body text-text-primary cursor-pointer">
                <input
                  id="deadline-editor-allowlate"
                  type="checkbox"
                  checked={allowLate}
                  onChange={(e) => setAllowLate(e.target.checked)}
                  className="w-4 h-4 mt-1 shrink-0 accent-primary cursor-pointer"
                />
                <span>
                  允許遲交
                  <span className="block text-caption text-text-muted">
                    截止後仍可繳交，作品會標示「遲交」。
                  </span>
                </span>
              </label>
            </>
          ) : (
            <p className="px-3.5 py-2.5 text-caption text-text-muted border border-dashed border-border rounded-brand">
              不限期，學生隨時可以交。
            </p>
          )}
        </div>

        <div className="p-5 bg-surface-soft/50 border-t border-border flex flex-wrap items-center gap-2">
          {/* 以前的「結束收件」。不經過上面的欄位，按了就直接存 */}
          <button
            id="deadline-editor-btn-endnow"
            onClick={() => onSave(endNow(assignment))}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-body text-danger-700 hover:bg-danger-50 transition-colors whitespace-nowrap"
          >
            <Timer size={15} className="shrink-0" />
            立即截止
          </button>
          <div className="ml-auto flex gap-2">
            <button
              id="deadline-editor-btn-cancel"
              onClick={onCancel}
              className="px-4 py-2 text-text-secondary hover:bg-card rounded-xl font-bold transition-colors"
            >
              取消
            </button>
            <button
              id="deadline-editor-btn-save"
              onClick={save}
              disabled={invalid}
              className="px-4 py-2 rounded-xl font-bold text-on-accent bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 transition-all active:scale-95 disabled:opacity-50"
            >
              儲存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
