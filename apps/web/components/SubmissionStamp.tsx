import React from 'react';
import { MARK_KINDS, MARK_META, type MarkKind } from '../lib/submissionMarks';

interface SubmissionStampProps {
  kind: MarkKind;
  /** 蓋了沒 */
  on: boolean;
  /** 不能蓋（還沒批改完成）。真的會下在 button 上，鍵盤也跳過 */
  disabled?: boolean;
  onToggle: () => void;
  /** 表格與批改頁用 md，手機卡片用 sm */
  size?: 'sm' | 'md';
  /** 給 e2e 與人工驗證用 */
  id?: string;
}

/**
 * 作品標記的印章。
 *
 * 一顆元件，三個畫面共用（批改清單的表格與手機卡片、個人批改頁），
 * 這樣「沒蓋是虛的、蓋了是實的」在哪裡都長一樣。
 *
 * 造型走印泥章：接近正方形、圓角很小 —— 這套設計的底是宣紙與水墨，
 * 一顆紅印章是它本來就會有的東西，不需要另外發明一種視覺語言。
 * 佳作用朱砂（secondary），預選用花青（primary），一眼分得開。
 *
 * 不能蓋的時候**照樣畫出來**，不要整格空掉：
 * 老師要先看得到才知道有這個功能，而且表格每一列的高度是先前
 * 特地對齊過的，突然少一格會讓往下掃的視線被打斷。
 */
export const SubmissionStamp: React.FC<SubmissionStampProps> = ({
  kind,
  on,
  disabled = false,
  onToggle,
  size = 'md',
  id,
}) => {
  const meta = MARK_META[kind];

  /*
    朱砂與花青兩組。實心底配 text-on-accent —— 那個 token 在碑拓模式
    會跟著翻成焦墨，不要寫死 text-white（見 CLAUDE.md）。
  */
  const tone =
    kind === 'featured'
      ? { solid: 'bg-secondary border-secondary', ink: 'hover:border-secondary hover:text-secondary' }
      : { solid: 'bg-primary border-primary', ink: 'hover:border-primary hover:text-primary' };

  const box = size === 'sm' ? 'h-6 px-1.5 text-caption' : 'h-7 px-2 text-caption';

  return (
    <button
      id={id}
      type="button"
      aria-pressed={on}
      aria-label={`${meta.label}${on ? '（已標記）' : ''}`}
      disabled={disabled}
      onClick={(e) => {
        /*
          手機卡片整張都可以點（會進批改頁），章在卡片裡面，
          不擋住冒泡的話蓋個章就被帶走了。
        */
        e.stopPropagation();
        onToggle();
      }}
      title={
        disabled
          ? `${meta.label}：批改完成後才能標記`
          : on
            ? `取消${meta.label}標記`
            : `標記為${meta.label}`
      }
      className={[
        'tap-target inline-flex items-center justify-center rounded-[4px] border tabular-nums',
        'whitespace-nowrap transition-all select-none',
        box,
        disabled
          ? 'border-dashed border-border-strong text-text-muted opacity-40 cursor-not-allowed'
          : on
            ? `${tone.solid} text-on-accent shadow-sm active:scale-95`
            : `border-dashed border-border-strong text-text-muted bg-transparent active:scale-95 ${tone.ink}`,
      ].join(' ')}
    >
      {meta.label}
    </button>
  );
};

interface StampRowProps {
  /** 這一份作品的狀態決定能不能蓋 —— 判斷收在 lib/submissionMarks 的 canMark */
  canMark: boolean;
  isOn: (kind: MarkKind) => boolean;
  onToggle: (kind: MarkKind) => void;
  size?: 'sm' | 'md';
  /** id 前綴，會接上 -{kind}-{submissionId} */
  idPrefix?: string;
  submissionId: string;
}

/**
 * 兩顆章排成一列。
 *
 * 有這一層是為了讓三個畫面**不要各自決定順序**（一個佳作在左、
 * 一個在右會讓人以為按錯），也不要各自 map 一次 MARK_KINDS。
 */
export const SubmissionStampRow: React.FC<StampRowProps> = ({
  canMark,
  isOn,
  onToggle,
  size = 'md',
  idPrefix = 'stamp',
  submissionId,
}) => (
  <div className="inline-flex items-center gap-1.5">
    {MARK_KINDS.map((kind) => (
      <SubmissionStamp
        key={kind}
        id={`${idPrefix}-${kind}-${submissionId}`}
        kind={kind}
        on={isOn(kind)}
        disabled={!canMark}
        onToggle={() => onToggle(kind)}
        size={size}
      />
    ))}
  </div>
);
