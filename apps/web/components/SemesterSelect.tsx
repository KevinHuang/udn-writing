import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, Check, ChevronDown } from 'lucide-react';
import { semesterLabel } from '../lib/semester';

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
   * field：嵌在篩選列裡的一欄（成績管理），標籤在上、值在下。
   */
  variant?: 'pill' | 'field';
  className?: string;
}

/** 下拉面板的寬度下限。觸發鈕比這個寬時跟著觸發鈕 */
const PANEL_MIN_WIDTH = 240;
/** 面板與觸發鈕、視窗邊緣的距離 */
const GAP = 8;
const EDGE = 16;

interface Group {
  key: string;
  /** 「115 學年度」。代碼認不出來時是 null，選項直接顯示整串 label */
  title: string | null;
  items: (SemesterOption & { term: string | null })[];
}

/** 依學年度分組，保留原本的順序（新的在前） */
function groupByYear(options: SemesterOption[]): Group[] {
  const groups: Group[] = [];
  for (const opt of options) {
    const m = /^(\d+)-(\d+)$/.exec(opt.value);
    const key = m ? m[1] : `raw:${opt.value}`;
    const last = groups[groups.length - 1];
    const item = { ...opt, term: m ? m[2] : null };
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, title: m ? `${m[1]} 學年度` : null, items: [item] });
  }
  return groups;
}

/**
 * 學期下拉選單。教師端、學生端所有的學期切換都用這一個。
 *
 * 不用原生 <select>：它彈出來的清單是作業系統畫的，改不了樣式
 * （使用者回報「看起來醜醜的」就是那一塊）。自己畫之後可以依學年度分組、
 * 標出本學期，也跟頁面的圓角、配色一致。
 *
 * 面板用 portal 掛在 body 上、fixed 定位 —— 成績管理的篩選列是
 * overflow-hidden，面板放在裡面會被裁掉。
 *
 * 鍵盤：觸發鈕上 ↓／↑／Enter／空白鍵打開；清單裡 ↑↓ 移動、Home／End、
 * Enter 選取、Esc 關閉並回到觸發鈕、Tab 關閉。
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
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<React.CSSProperties | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const groups = useMemo(() => groupByYear(options), [options]);
  const label = options.find((o) => o.value === value)?.label ?? semesterLabel(value);

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
      className={`text-text-secondary shrink-0 transition-transform duration-200 ${open ? 'rotate-180 text-primary' : ''}`}
    />
  );

  const trigger =
    variant === 'field' ? (
      <button
        ref={triggerRef}
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => (open ? hide() : openMenu())}
        onKeyDown={onTriggerKey}
        className={`w-full text-left px-4 py-2.5 hover:bg-surface/80 transition-colors cursor-pointer outline-none focus-visible:bg-surface/80 ${open ? 'bg-surface/80' : ''} ${className}`}
      >
        <span className="flex items-center gap-1.5 text-caption text-text-secondary uppercase tracking-wider">
          <Calendar size={12} className="shrink-0 text-primary" />
          學期
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <span className="flex-1 min-w-0 truncate text-ui text-text-primary">{label}</span>
          {chevron}
        </span>
      </button>
    ) : (
      <button
        ref={triggerRef}
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => (open ? hide() : openMenu())}
        onKeyDown={onTriggerKey}
        className={`inline-flex items-center gap-2 bg-card border rounded-full pl-4 pr-3 py-2 shadow-sm text-left transition-all outline-none hover:shadow-md hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/30 ${
          open ? 'border-primary/50 ring-2 ring-primary/20' : 'border-border'
        } ${className}`}
      >
        <Calendar size={16} className="text-primary shrink-0" />
        <span className="text-caption text-text-secondary whitespace-nowrap shrink-0">學期</span>
        <span className="h-4 w-px bg-border shrink-0" aria-hidden="true"></span>
        <span className="flex-1 min-w-0 truncate text-body text-text-primary">{label}</span>
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
            className="z-[60] w-60 max-w-[calc(100vw-2rem)] overflow-y-auto overscroll-contain rounded-2xl bg-card border border-border-card shadow-xl p-1.5 animate-pop-in"
          >
            {groups.map((g, gi) => (
              <div
                key={g.key}
                role="group"
                aria-label={g.title ?? undefined}
                className={gi > 0 ? 'mt-1 pt-1 border-t border-border/70' : ''}
              >
                {g.title && (
                  <div className="px-3 pt-1.5 pb-1 text-caption font-bold text-text-muted tracking-wider">
                    {g.title}
                  </div>
                )}
                {g.items.map((o) => {
                  const selected = o.value === value;
                  const isCurrent = o.value === current;
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
                      <span className="flex-1 min-w-0 truncate">
                        {o.term ? `第 ${o.term} 學期` : o.label}
                      </span>
                      {isCurrent && (
                        <span className="shrink-0 text-caption font-bold px-2 py-0.5 rounded-full bg-sun-300 text-text-primary">
                          本學期
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
