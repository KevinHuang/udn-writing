import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Stamp, X } from 'lucide-react';
import type { Submission } from '../types';
import {
  FEATURED_DEFAULT_LEVEL, MARK_META, canMark, featuredCandidates, hasMark,
  type SubmissionMarks,
} from '../lib/submissionMarks';
import { seatText } from '../lib/gradingQueue';
import { MAX_LEVEL } from '../lib/scoring';

interface FeaturedByLevelDialogProps {
  /** 這份作業的整份名冊（rosterOf 的結果），順序就是清單上的順序 */
  submissions: Submission[];
  marks: SubmissionMarks;
  /** 一開始選哪個門檻。這份作業有自動佳作標準時帶那一個，老師不用再選一次 */
  initialLevel?: number;
  /** 真的去蓋章。回傳成功與失敗的篇數 */
  onConfirm: (submissionIds: string[]) => Promise<{ done: number; failed: number }>;
  onClose: () => void;
}

/** 門檻的選項：1～6 級分。0 級分「以上」等於全部，沒有意義 */
const LEVELS = Array.from({ length: MAX_LEVEL }, (_, i) => MAX_LEVEL - i);

/**
 * 依級分蓋佳作。
 *
 * 從數位作品集原型的「佳作門檻」改過來的：原型是**自動評選**
 * （達門檻就設成佳作、未達就取消），這裡改成**幫老師勾選** ——
 * 列出達到門檻、還沒蓋章的作品，老師按下去才蓋。
 *
 * 只蓋不取消（見 lib/submissionMarks.ts 的 featuredCandidates）。
 * 尚未批改的作品沒有級分，本來就不能蓋章，所以不列入，並且講出有幾篇，
 * 老師才不會以為系統漏算。
 */
export const FeaturedByLevelDialog: React.FC<FeaturedByLevelDialogProps> = ({
  submissions,
  marks,
  initialLevel = FEATURED_DEFAULT_LEVEL,
  onConfirm,
  onClose,
}) => {
  const [level, setLevel] = useState(initialLevel);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ done: number; failed: number } | null>(null);

  const candidates = useMemo(
    () => featuredCandidates(submissions, marks, level),
    [submissions, marks, level],
  );
  const alreadyFeatured = submissions.filter(
    (s) => hasMark(marks, s.id, 'featured'),
  ).length;
  const notGraded = submissions.filter(
    (s) => !canMark(s.status) && s.status !== 'Unsubmitted' && s.status !== 'Draft',
  ).length;

  // 蓋章途中不給關，不然老師以為取消了、其實後面幾篇照樣蓋上去
  const close = () => { if (!running) onClose(); };

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const label = MARK_META.featured.label;

  const confirm = async () => {
    setRunning(true);
    try {
      setResult(await onConfirm(candidates.map((s) => s.id)));
    } finally {
      setRunning(false);
    }
  };

  // 掛到 body 並壓過手機底部導覽，理由同 ConfirmDialog
  return createPortal(
    <div
      id="featured-level-dialog"
      className="fixed inset-0 z-[1100] flex items-center justify-center p-4 sm:p-6"
    >
      <div className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm" onClick={close} />
      <div className="relative w-full max-w-md max-h-[90vh] bg-surface rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-border">
        <div className="p-6 border-b border-border flex items-start justify-between gap-3">
          <div>
            <h2 className="text-title font-bold text-text-primary flex items-center gap-2">
              <Stamp size={20} className="text-secondary" />
              依級分蓋{label}
            </h2>
            <p className="text-caption text-text-muted mt-1">
              挑出達到級分的作品，確認後一次蓋上{label}章。不會取消已經蓋好的章。
            </p>
          </div>
          <button
            id="featured-level-btn-close"
            onClick={close}
            disabled={running}
            title="關閉"
            className="tap-target shrink-0 p-1.5 rounded-full text-text-secondary hover:bg-surface-soft transition-colors disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        {result ? (
          <div className="p-6 space-y-2">
            <p className="text-body text-text-primary">
              已蓋上 {result.done} 個{label}章。
            </p>
            {result.failed > 0 && (
              <p className="text-body text-danger-700">
                有 {result.failed} 篇沒有蓋成功，請稍後在清單上個別再試一次。
              </p>
            )}
          </div>
        ) : (
          <div className="p-6 space-y-5 overflow-y-auto">
            <div className="space-y-2">
              <span className="text-caption text-text-secondary">級分門檻</span>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="級分門檻">
                {LEVELS.map((lv) => (
                  <button
                    key={lv}
                    id={`featured-level-option-${lv}`}
                    type="button"
                    role="radio"
                    aria-checked={level === lv}
                    onClick={() => setLevel(lv)}
                    className={`px-3 py-1.5 rounded-xl text-caption border transition-colors ${
                      level === lv
                        ? 'bg-secondary border-secondary text-on-accent'
                        : 'bg-card border-border-strong text-text-secondary hover:border-secondary hover:text-secondary'
                    }`}
                  >
                    {lv === MAX_LEVEL ? `${lv} 級分` : `${lv} 級分以上`}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <span className="text-caption text-text-secondary">
                將蓋上{label}章（{candidates.length} 篇）
              </span>
              {candidates.length === 0 ? (
                <p className="text-body text-text-muted bg-surface-soft/60 rounded-xl px-4 py-3">
                  沒有需要新蓋的作品。
                </p>
              ) : (
                <ul className="max-h-56 overflow-y-auto divide-y divide-border rounded-xl border border-border-card bg-card">
                  {candidates.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2 text-body">
                      <span className="text-text-primary min-w-0 truncate">
                        <span className="text-text-muted font-mono mr-2">{seatText(s.seatNo)}</span>
                        {s.studentName}
                      </span>
                      <span className="shrink-0 font-bold text-secondary">
                        {s.result?.totalScore} 級分
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <ul className="text-caption text-text-muted space-y-0.5">
                {alreadyFeatured > 0 && <li>已經是{label}的 {alreadyFeatured} 篇維持不變。</li>}
                {notGraded > 0 && <li>還沒批改的 {notGraded} 篇沒有級分，不列入。</li>}
              </ul>
            </div>
          </div>
        )}

        <div className="p-6 bg-surface-soft/50 border-t border-border flex justify-end gap-3">
          {result ? (
            <button
              id="featured-level-btn-done"
              onClick={onClose}
              className="px-4 py-2 rounded-xl font-bold text-on-accent bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 transition-all active:scale-95"
            >
              完成
            </button>
          ) : (
            <>
              <button
                id="featured-level-btn-cancel"
                onClick={close}
                disabled={running}
                className="px-4 py-2 text-text-secondary hover:bg-card rounded-xl font-bold transition-colors disabled:opacity-50"
              >
                取消
              </button>
              <button
                id="featured-level-btn-confirm"
                onClick={() => void confirm()}
                disabled={running || candidates.length === 0}
                className="flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-on-accent bg-secondary hover:bg-secondary/90 shadow-lg shadow-secondary/20 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {running && <Loader2 size={16} className="animate-spin" />}
                {running ? '蓋章中…' : `蓋上 ${candidates.length} 個${label}章`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};
