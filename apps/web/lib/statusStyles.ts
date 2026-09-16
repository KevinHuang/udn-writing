/**
 * 繳交狀態的顏色與文字 —— 全站唯一來源。
 *
 * 改版前這組對照散在十個檔案裡各寫各的，同一個狀態在不同畫面
 * 會出現三到五種顏色，「已批改」甚至和別的狀態撞成同一色。
 *
 * 現在一個狀態一個礦物顏料，各自可辨識：
 *   未繳交  淡墨 ink      —— 還沒發生的事，不該搶眼
 *   草稿    淡墨 ink      —— 學生寫了但還沒送出
 *   待批改  赭石 warning  —— 等老師處理
 *   已批改  石綠 success  —— 完成
 *   已發還  花青 info     —— 已送到學生手上
 * 逾期另外用朱砂 danger 疊加，因為它和上面六個是不同維度。
 */

import { SubmissionStatus } from '../types';

export interface StatusStyle {
  /** 顯示文字 */
  label: string;
  /** 徽章：淡底 + 深字 + 細框。色階在深色模式會自動對調 */
  badge: string;
  /** 只要文字顏色時用（清單右側、表格內） */
  text: string;
  /** 左側色條或圓點的背景色 */
  dot: string;
}

export const SUBMISSION_STATUS: Record<SubmissionStatus, StatusStyle> = {
  Unsubmitted: {
    label: '未繳交',
    badge: 'bg-ink-100 text-ink-600 border border-ink-200',
    text: 'text-ink-500',
    dot: 'bg-ink-400',
  },
  Draft: {
    label: '草稿',
    badge: 'bg-ink-100 text-ink-600 border border-ink-200',
    text: 'text-ink-500',
    dot: 'bg-ink-400',
  },
  Pending: {
    label: '待批改',
    badge: 'bg-warning-100 text-warning-700 border border-warning-200',
    text: 'text-warning-600',
    dot: 'bg-warning-500',
  },
  Graded: {
    label: '已批改',
    badge: 'bg-success-100 text-success-700 border border-success-200',
    text: 'text-success-600',
    dot: 'bg-success-500',
  },
  Published: {
    label: '已發還',
    badge: 'bg-info-100 text-info-700 border border-info-200',
    text: 'text-info-600',
    dot: 'bg-info-500',
  },
};

/** 逾期是獨立維度，可以疊在任何狀態上 */
export const OVERDUE_STYLE: StatusStyle = {
  label: '已逾期',
  badge: 'bg-danger-100 text-danger-700 border border-danger-200',
  text: 'text-danger-600',
  dot: 'bg-danger-500',
};

/** 找不到對應時回退到中性，不要讓畫面爆掉 */
export function statusStyle(status: SubmissionStatus | undefined): StatusStyle {
  return (status && SUBMISSION_STATUS[status]) || SUBMISSION_STATUS.Unsubmitted;
}
