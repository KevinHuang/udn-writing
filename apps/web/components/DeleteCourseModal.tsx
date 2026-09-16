import React, { useState } from 'react';
import { X, AlertTriangle, Archive, Trash2, Users, FileText, PenLine } from 'lucide-react';
import { Course } from '../types';
import { CourseFootprint, isCourseEmptyOfWork } from '../lib/assignments';

interface DeleteCourseModalProps {
  course: Course;
  footprint: CourseFootprint;
  onCancel: () => void;
  /** 改用封存（建議的作法） */
  onArchive: () => void;
  /** 確定刪除 */
  onConfirm: () => void;
}

/**
 * 刪除課程的確認。
 *
 * 分兩種情況：
 *
 * 1. **學生還沒寫過任何東西** —— 一次確認就刪。這種課程刪掉不會弄丟
 *    救不回來的內容：名單可以重新同步，作業可以重新派發。
 *
 * 2. **已經有學生的作文** —— 先擋一次，建議改用「封存」（資料留著、
 *    課程從清單收起來）。老師執意要刪，才進到第二次確認，
 *    而且要據實列出會消失的東西。
 *
 * 之所以要兩段，是因為這個動作在原型與真實系統都無法復原，
 * 而失去的是學生自己寫的字 —— 那不是老師一個人的東西。
 */
export const DeleteCourseModal: React.FC<DeleteCourseModalProps> = ({
  course,
  footprint,
  onCancel,
  onArchive,
  onConfirm,
}) => {
  const empty = isCourseEmptyOfWork(footprint);
  /** 有資料時的第二段確認 */
  const [confirming, setConfirming] = useState(false);

  const stats = [
    { icon: Users, label: '學生', value: `${footprint.students} 位` },
    { icon: FileText, label: '已派發作業', value: `${footprint.assignments} 份` },
    { icon: PenLine, label: '學生已寫的作文', value: `${footprint.submissions} 篇` },
  ];

  return (
    <div
      id="course-delete-modal"
      className="fixed inset-0 z-[110] flex items-center justify-center p-4"
    >
      <div className="absolute inset-0 bg-ink-900/45 backdrop-blur-sm" onClick={onCancel} />

      <div className="relative w-full max-w-lg bg-surface rounded-3xl shadow-2xl border border-border overflow-hidden flex flex-col max-h-[88vh]">
        {/* 標頭 */}
        <div className="p-5 sm:p-6 border-b border-border flex items-start justify-between gap-4 shrink-0">
          <div className="flex items-start gap-3 min-w-0">
            <span
              className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
                empty ? 'bg-surface-soft text-text-secondary' : 'bg-danger-50 text-danger-600'
              }`}
            >
              {empty ? <Trash2 size={19} /> : <AlertTriangle size={19} />}
            </span>
            <div className="min-w-0">
              <h2 className="text-title font-bold text-text-primary">
                {empty ? '刪除課程' : confirming ? '最後確認' : '這個課程已經有學生的作文'}
              </h2>
              <p className="text-caption text-text-secondary mt-1 font-normal break-all">
                {course.name}
              </p>
            </div>
          </div>
          <button
            id="course-delete-btn-close"
            onClick={onCancel}
            className="shrink-0 p-2 text-text-muted hover:text-text-primary hover:bg-surface-soft rounded-full transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 sm:p-6 flex flex-col gap-4">
          {empty ? (
            <p className="text-body text-text-secondary">
              這個課程還沒有任何學生繳交的內容，刪除後只會移除課程與名單。
              名單之後可以重新從校務系統同步回來。
            </p>
          ) : (
            <>
              <p className="text-body text-text-secondary">
                {confirming
                  ? '刪除之後無法復原。以下內容會一併永久消失：'
                  : '建議改用「封存課程」—— 資料完整留著，課程只會從清單收起來，之後隨時可以復原。'}
              </p>

              <ul className="bg-card border border-border rounded-brand divide-y divide-border">
                {stats.map(({ icon: Icon, label, value }) => (
                  <li
                    key={label}
                    className="flex items-center gap-3 px-4 py-3 text-body text-text-primary"
                  >
                    <Icon size={15} className="shrink-0 text-text-secondary" />
                    <span className="text-text-secondary">{label}</span>
                    <span className="ml-auto tabular-nums">{value}</span>
                  </li>
                ))}
              </ul>

              {confirming && (
                <div className="flex items-start gap-2.5 rounded-brand border border-danger-200 bg-danger-50 px-4 py-3">
                  <AlertTriangle size={15} className="shrink-0 mt-0.5 text-danger-600" />
                  <p className="text-body text-danger-700">
                    學生寫的作文與批改紀錄救不回來。名單和作業之後可以重建，
                    <strong className="font-bold">他們寫過的字不行。</strong>
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* 動作 */}
        <div className="p-5 sm:p-6 bg-surface-soft/50 border-t border-border flex flex-wrap items-center justify-end gap-3 shrink-0">
          <button
            id="course-delete-btn-cancel"
            onClick={onCancel}
            className="px-5 py-2.5 text-ui text-text-secondary hover:text-text-primary transition-colors whitespace-nowrap"
          >
            取消
          </button>

          {empty ? (
            <button
              id="course-delete-btn-confirm"
              onClick={onConfirm}
              className="px-6 py-2.5 rounded-brand text-ui text-on-solid bg-danger-500 hover:bg-danger-600 shadow-lg shadow-danger-500/20 transition-all flex items-center gap-2 whitespace-nowrap"
            >
              <Trash2 size={16} className="shrink-0" />
              刪除課程
            </button>
          ) : confirming ? (
            <>
              <button
                id="course-delete-btn-back"
                onClick={() => setConfirming(false)}
                className="px-5 py-2.5 text-ui text-text-secondary hover:text-text-primary transition-colors whitespace-nowrap"
              >
                返回
              </button>
              <button
                id="course-delete-btn-confirm"
                onClick={onConfirm}
                className="px-6 py-2.5 rounded-brand text-ui text-on-solid bg-danger-500 hover:bg-danger-600 shadow-lg shadow-danger-500/20 transition-all flex items-center gap-2 whitespace-nowrap"
              >
                <Trash2 size={16} className="shrink-0" />
                我了解，仍要永久刪除
              </button>
            </>
          ) : (
            <>
              <button
                id="course-delete-btn-force"
                onClick={() => setConfirming(true)}
                className="px-5 py-2.5 rounded-brand text-ui text-danger-600 border border-danger-200 hover:bg-danger-50 transition-colors whitespace-nowrap"
              >
                仍要刪除
              </button>
              <button
                id="course-delete-btn-archive"
                onClick={onArchive}
                className="px-6 py-2.5 rounded-brand text-ui text-on-accent bg-primary hover:bg-primary/90 shadow-lg shadow-primary/25 transition-all flex items-center gap-2 whitespace-nowrap"
              >
                <Archive size={16} className="shrink-0" />
                改用封存
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
