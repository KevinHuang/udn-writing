import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

export interface SelectItem {
  value: string;
  label: string;
  /** 右邊的小標籤，例如學期選單的「本學期」 */
  badge?: string;
}

export interface SelectSection {
  key: string;
  /** 分組標題（例如「115 學年度」）。沒有就不畫標題 */
  title?: string;
  items: SelectItem[];
}

interface FieldSelectProps {
  id: string;
  value: string;
  sections: SelectSection[];
  onChange: (value: string) => void;
  /** 觸發鈕上的小標籤：學期、作業… */
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  /** 觸發鈕上顯示的值。沒給就從 sections 裡找 */
  displayLabel?: string;
  /**
   * pill：獨立的膠囊（頁首右側）。
   * field：篩選列裡的一張卡片（成績管理），標籤在上、值在下。
   */
  variant?: 'pill' | 'field';
  /** 面板寬度。選項文字長（例如作業名稱）時放寬 */
  panelWidth?: string;
  disabled?: boolean;
  className?: string;
}

/** 面板的寬度下限。觸發鈕比這個寬時跟著觸發鈕 */
const PANEL_MIN_WIDTH = 240;
/** 面板與觸發鈕、視窗邊緣的距離 */
const GAP = 8;
const EDGE = 16;

/**
 * 自己畫的下拉選單。教師端、學生端所有「看起來像一張卡片」的選單都用這一個。
 *
 * 不用原生 <select>：它彈出來的清單是作業系統畫的，改不了樣式
 * （使用者回報「看起來醜醜的」、藍色反白那一塊就是它）。
 *
 * 面板用 portal 掛在 body 上、fixed 定位 —— 成績管理的篩選列與表格容器
 * 都有 overflow，面板放在裡面會被裁掉。
 *
 * 鍵盤：觸發鈕上 ↓／↑／Enter／空白鍵打開；清單裡 ↑↓ 移動、Home／End、
 * Enter 選取、Esc 關閉並回到觸發鈕、Tab 關閉。
 */
export const FieldSelect: React.FC<FieldSelectProps> = ({
  id,
  value,
  sections,
  onChange,
  label,
  icon: Icon,
  displayLabel,
  variant = 'pill',
  panelWidth = 'w-60',
  disabled = false,
  className = '',
}) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<React.CSSProperties | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const current =
    displayLabel ??
    sections.flatMap((s) => s.items).find((o) => o.value === value)?.label ??
    value;

  /** 依觸發鈕的位置擺面板。右邊放不下就改成靠右對齊 */
  const place = useCallback(() => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const vw = document.documentElement.clientWidth;
    const width = Math.max(r.width, PANEL_MIN_WIDTH);
    const alignRight = r.left + width > vw - EDGE;
    setPos({
      top: r.bottom + GAP,
      minWidth: r.width,
      maxHeight: Math.max(160, Math.min(360, window.innerHeight - r.bottom - GAP - EDGE)),
      ...(alignRight ? { right: Math.max(EDGE, vw - r.right) } : { left: r.left }),
    });
  }, []);

  // 開關都在事件裡處理（不用 effect 同步 state）：打開前先擺好位置，面板第一次畫出來就在對的地方
  const openMenu = () => {
    if (disabled) return;
    place();
    setOpen(true);
  };
  const hide = () => {
    setOpen(false);
    setPos(null);
  };

  const optionEls = () =>
    Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);

  // 打開時把焦點放在目前選的那一列（沒有就第一列），鍵盤才能直接上下移。
  // 相依只看「面板擺好了沒」—— 捲動時 pos 會一直變，不能每次都把焦點搶回來
  const placed = pos !== null;
  useEffect(() => {
    if (!open || !placed) return;
    const els = optionEls();
    (els.find((el) => el.dataset.value === value) ?? els[0])?.focus();
  }, [open, placed]); // eslint-disable-line react-hooks/exhaustive-deps

  // 點外面關閉；捲動或縮放時跟著觸發鈕移動
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || listRef.current?.contains(t)) return;
      hide();
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  const close = (refocus: boolean) => {
    hide();
    if (refocus) triggerRef.current?.focus();
  };

  const pick = (v: string) => {
    if (v !== value) onChange(v);
    close(true);
  };

  const onTriggerKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      openMenu();
    }
  };

  const onListKey = (e: React.KeyboardEvent) => {
    const els = optionEls();
    const i = els.indexOf(document.activeElement as HTMLButtonElement);
    const focusAt = (n: number) => els[Math.max(0, Math.min(els.length - 1, n))]?.focus();
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); focusAt(i + 1); break;
      case 'ArrowUp': e.preventDefault(); focusAt(i - 1); break;
      case 'Home': e.preventDefault(); focusAt(0); break;
      case 'End': e.preventDefault(); focusAt(els.length - 1); break;
      case 'Escape': e.preventDefault(); close(true); break;
      case 'Tab': close(false); break;
    }
  };

  const chevron = (
    <ChevronDown
      size={14}
      className={`shrink-0 transition-transform duration-200 ${open ? 'rotate-180 text-primary' : 'text-primary/70'}`}
    />
  );

  const shared = {
    ref: triggerRef,
    id,
    type: 'button' as const,
    disabled,
    'aria-haspopup': 'listbox' as const,
    'aria-expanded': open,
    'aria-controls': open ? listId : undefined,
    onClick: () => (open ? hide() : openMenu()),
    onKeyDown: onTriggerKey,
  };

  const trigger =
    variant === 'field' ? (
      <button
        {...shared}
        className={`w-full text-left rounded-xl border bg-card px-4 py-2.5 shadow-sm transition-all cursor-pointer outline-none hover:border-primary/50 hover:shadow-md focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border disabled:hover:shadow-sm ${
          open ? 'border-primary/50 ring-2 ring-primary/20' : 'border-border'
        } ${className}`}
      >
        <span className="flex items-center gap-1.5 text-caption text-text-secondary uppercase tracking-wider">
          <Icon size={12} className="shrink-0 text-primary" />
          {label}
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <span className="flex-1 min-w-0 truncate text-ui font-bold text-text-primary">{current}</span>
          {chevron}
        </span>
      </button>
    ) : (
      <button
        {...shared}
        className={`inline-flex items-center gap-2 bg-card border rounded-full pl-4 pr-3 py-2 shadow-sm text-left transition-all outline-none hover:shadow-md hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/30 ${
          open ? 'border-primary/50 ring-2 ring-primary/20' : 'border-border'
        } ${className}`}
      >
        <Icon size={16} className="text-primary shrink-0" />
        <span className="text-caption text-text-secondary whitespace-nowrap shrink-0">{label}</span>
        <span className="h-4 w-px bg-border shrink-0" aria-hidden="true"></span>
        <span className="flex-1 min-w-0 truncate text-body text-text-primary">{current}</span>
        {chevron}
      </button>
    );

  return (
    <>
      {trigger}
      {open && pos &&
        createPortal(
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-labelledby={id}
            onKeyDown={onListKey}
            style={{ position: 'fixed', ...pos }}
            className={`z-[60] ${panelWidth} max-w-[calc(100vw-2rem)] overflow-y-auto overscroll-contain rounded-2xl bg-card border border-border-card shadow-xl p-1.5 animate-pop-in`}
          >
            {sections.map((s, si) => (
              <div
                key={s.key}
                role="group"
                aria-label={s.title}
                className={si > 0 ? 'mt-1 pt-1 border-t border-border/70' : ''}
              >
                {s.title && (
                  <div className="px-3 pt-1.5 pb-1 text-caption font-bold text-text-muted tracking-wider">
                    {s.title}
                  </div>
                )}
                {s.items.map((o) => {
                  const selected = o.value === value;
                  return (
                    <button
                      key={o.value}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      tabIndex={-1}
                      data-value={o.value}
                      onClick={() => pick(o.value)}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-left text-body transition-colors outline-none ${
                        selected
                          ? 'bg-primary/10 text-primary font-bold focus-visible:ring-2 focus-visible:ring-primary/40'
                          : 'text-text-primary hover:bg-surface-soft focus:bg-surface-soft'
                      }`}
                    >
                      <span className="flex-1 min-w-0 truncate">{o.label}</span>
                      {o.badge && (
                        <span className="shrink-0 text-caption font-bold px-2 py-0.5 rounded-full bg-sun-300 text-text-primary">
                          {o.badge}
                        </span>
                      )}
                      <Check
                        size={16}
                        className={`shrink-0 ${selected ? 'opacity-100' : 'opacity-0'}`}
                        aria-hidden="true"
                      />
                    </button>
                  );
                })}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
};
