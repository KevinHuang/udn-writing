import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { NOTE_COLORS, type CardRemoval, type ManuscriptDecisionInput, type ManuscriptNote } from '../lib/manuscript';

/**
 * 原稿紅筆的便條（docs/manuscript.md）：編號和左邊原稿上的一樣，點一下互相跳過去。
 * 老師在這裡確認、否決、改正確的字、刪掉自己加的錯字、拿掉格式提醒；每按一下就存。
 *
 * 搬自 1Campus Write 的 hosting/components/ManuscriptNotes.tsx。卡片的改寫、刪除沒有搬：
 * 聯合報這邊卡片已經併進評語，老師直接在評語欄改。
 */

const KIND_LABELS: Record<ManuscriptNote['kind'], string> = {
  typo: '錯字', teacherTypo: '老師加的', pending: '待確認', vetoedTypo: '已否決',
  format: '格式', vetoedFormat: '已否決', highlight: '亮點', circle: '密圈', suggestion: '建議', idiom: '成語',
};

const button = 'rounded-lg border px-3 py-1.5 text-caption transition-colors disabled:cursor-not-allowed disabled:opacity-50';
const plainButton = `${button} border-border-strong bg-card text-text-secondary hover:border-primary/40 hover:text-primary`;
const strongButton = `${button} border-danger-300 bg-danger-100 text-danger-700 hover:bg-danger-200`;

/** 改正確的字／加錯字：正確的字必填（最多 4 個字），說明可寫可不寫 */
const CorrectForm: React.FC<{
  idPrefix: string; initialCorrect: string; submitLabel: string; busy: boolean;
  onSubmit: (correct: string, note: string) => void; onCancel: () => void;
}> = ({ idPrefix, initialCorrect, submitLabel, busy, onSubmit, onCancel }) => {
  const [correct, setCorrect] = useState(initialCorrect);
  const [note, setNote] = useState('');
  const trimmed = correct.trim();
  return (
    <form
      className="mt-2 space-y-2 rounded-xl border border-border-card bg-surface-soft p-3"
      onSubmit={(e) => { e.preventDefault(); if (trimmed) onSubmit(trimmed, note.trim()); }}
    >
      <label className="flex items-center gap-2 text-body text-text-primary">
        正確的字
        {/* 16px 以上：iPhone 點進去不會自動放大畫面 */}
        <input
          id={`${idPrefix}-correct`}
          value={correct}
          maxLength={4}
          autoFocus
          onChange={(e) => setCorrect(e.target.value)}
          className="w-24 rounded-lg border border-border-strong bg-card px-2 py-1 text-title font-essay text-text-primary"
        />
      </label>
      <textarea
        id={`${idPrefix}-note`}
        value={note}
        maxLength={200}
        rows={2}
        placeholder="說明（可不填），例如：「帶」是陪同、引領的意思。"
        onChange={(e) => setNote(e.target.value)}
        className="w-full rounded-lg border border-border-strong bg-card px-2 py-1.5 text-body text-text-primary placeholder:text-text-muted"
      />
      <div className="flex gap-2">
        <button id={`${idPrefix}-submit`} type="submit" disabled={!trimmed || busy} className={strongButton}>{submitLabel}</button>
        <button type="button" onClick={onCancel} className={plainButton}>取消</button>
      </div>
    </form>
  );
};

/** 重新評分的提醒：改了錯字或格式，分數可能就不對了 */
export const RegradeReminder: React.FC<{ message: string; busy: boolean; onRegrade: () => void }> = ({ message, busy, onRegrade }) => (
  <div id="gradingeditor-regrade-reminder" role="status" className="flex flex-wrap items-start gap-3 rounded-xl border border-warning-200 bg-warning-100 px-4 py-3">
    <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning-700" aria-hidden="true" />
    <p className="min-w-0 flex-1 text-caption text-warning-800">{message}</p>
    <button
      id="gradingeditor-btn-regrade"
      type="button"
      onClick={onRegrade}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-lg border border-warning-300 bg-card px-3 py-1.5 text-caption text-warning-800 hover:bg-warning-50 disabled:opacity-60"
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
      重新評分
    </button>
  </div>
);

export interface AddTypoTarget { cellKey: string; text: string }

interface ManuscriptNotesProps {
  notes: ManuscriptNote[];
  selectedNoteId: string | null;
  onSelect: (noteId: string) => void;
  pendingCount: number;
  locked: boolean;
  busy: boolean;
  /** 老師的一個決定；成功回傳 true */
  onDecision: (input: ManuscriptDecisionInput, noteId: string | null) => Promise<boolean>;
  addTarget: AddTypoTarget | null;
  onCancelAdd: () => void;
  removals: CardRemoval[];
  mentions: string[];
  /** 還沒批改：先提醒確認待確認的錯字 */
  beforeGrading: boolean;
  /** 上一個動作失敗的原因（畫面保留，老師可以再按一次） */
  error: string | null;
}

const typoHeadline = (note: ManuscriptNote) => {
  const t = note.typo;
  if (!t) return '';
  const correct = t.correct || '（沒有建議的字）';
  return t.source === 'teacher' && t.wrong === t.correct ? `→ ${correct}` : `${t.wrong} → ${correct}`;
};

export const ManuscriptNotes: React.FC<ManuscriptNotesProps> = ({
  notes, selectedNoteId, onSelect, pendingCount, locked, busy, onDecision, addTarget, onCancelAdd,
  removals, mentions, beforeGrading, error,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const itemRefs = useRef(new Map<string, HTMLLIElement>());
  const registerItem = (id: string, el: HTMLLIElement | null) => {
    if (el) itemRefs.current.set(id, el); else itemRefs.current.delete(id);
  };

  useEffect(() => {
    const el = selectedNoteId ? itemRefs.current.get(selectedNoteId) : undefined;
    el?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [selectedNoteId]);

  const decide = async (note: ManuscriptNote, action: ManuscriptDecisionInput['action'], extra: Partial<ManuscriptDecisionInput> = {}) => {
    const target = note.typo ? 'typo' : 'format';
    const cellKey = (note.typo ?? note.format)?.cellKey;
    if (!cellKey) return;
    if (await onDecision({ target, cellKey, action, ...extra }, note.id)) setEditingId(null);
  };

  const actionsOf = (note: ManuscriptNote) => {
    if (locked) return null;
    const correctButton = (
      <button type="button" className={plainButton} disabled={busy} onClick={() => setEditingId(editingId === note.id ? null : note.id)}>改正確的字</button>
    );
    switch (note.kind) {
      case 'pending':
        return (
          <>
            <button type="button" className={strongButton} disabled={busy} onClick={() => decide(note, 'confirm')}>是錯字</button>
            {correctButton}
            <button type="button" className={plainButton} disabled={busy} onClick={() => decide(note, 'veto')}>不是錯字</button>
          </>
        );
      case 'typo':
        return (
          <>
            {correctButton}
            <button type="button" className={plainButton} disabled={busy} onClick={() => decide(note, 'veto')}>不是錯字</button>
            {note.typo?.decided && <button type="button" className={plainButton} disabled={busy} onClick={() => decide(note, 'undo')}>復原</button>}
          </>
        );
      case 'teacherTypo':
        return (
          <>
            {correctButton}
            <button type="button" className={plainButton} disabled={busy} onClick={() => decide(note, 'delete')}>刪掉這個錯字</button>
          </>
        );
      case 'vetoedTypo':
      case 'vetoedFormat':
        return <button type="button" className={plainButton} disabled={busy} onClick={() => decide(note, 'undo')}>復原</button>;
      case 'format':
        return <button type="button" className={plainButton} disabled={busy} onClick={() => decide(note, 'veto')}>不是格式問題</button>;
      default:
        return null;
    }
  };

  const bodyOf = (note: ManuscriptNote) => {
    const tag = (label: string) => <span className="rounded-full bg-surface-soft px-2 py-0.5 text-caption text-text-secondary">{label}</span>;
    if (note.typo) {
      const t = note.typo;
      const vetoed = note.kind === 'vetoedTypo';
      return (
        <>
          <p className="flex flex-wrap items-center gap-2">
            <span className={`font-essay text-title ${vetoed ? 'text-text-muted line-through' : ''}`} style={{ color: vetoed ? undefined : NOTE_COLORS[note.kind] }}>
              {typoHeadline(note)}
            </span>
            {note.kind !== 'typo' && tag(KIND_LABELS[note.kind])}
            {t.corrected && tag('老師改過')}
          </p>
          {t.reason && (
            <p className={`mt-1 text-caption ${note.kind === 'pending' ? 'rounded-lg bg-mauve-100 px-2 py-1 text-mauve-800' : 'text-text-secondary'}`}>{t.reason}</p>
          )}
          {note.kind === 'pending' && <p className="mt-1 text-caption text-text-muted">老師確認以前，不算分、不送 AI，學生也看不到。</p>}
        </>
      );
    }
    if (note.format) {
      const vetoed = note.kind === 'vetoedFormat';
      return (
        <>
          <p className={`text-body ${vetoed ? 'text-text-muted line-through' : ''}`} style={{ color: vetoed ? undefined : NOTE_COLORS.format }}>
            {note.format.type === '段首空兩格' ? '段首沒有空兩格' : note.format.type === '標點在行首' ? '標點寫在一行的第一格' : note.format.type}
          </p>
          {note.format.why && <p className="mt-1 text-caption text-text-secondary">{note.format.why}</p>}
        </>
      );
    }
    if (note.idiom) {
      return (
        <p className="text-body">
          成語<span className="font-essay">「{note.idiom.item}」</span>
          {note.idiom.comment && <span className="ml-2 text-caption text-text-secondary">{note.idiom.comment}</span>}
        </p>
      );
    }
    if (note.card) {
      const c = note.card;
      return (
        <>
          <p className="flex flex-wrap items-center gap-2">
            {tag(c.type)}
            <span className="text-body text-text-primary">{c.title}</span>
          </p>
          {c.quote && <p className="mt-1 font-essay text-caption text-text-secondary">「{c.quote}」</p>}
          {c.comment && <p className="mt-1 text-caption text-text-primary">{c.comment}</p>}
        </>
      );
    }
    return null;
  };

  return (
    <section id="gradingeditor-manuscript-notes" aria-label="原稿紅筆" className="space-y-3 rounded-brand border border-border-card bg-card/40 px-4 py-3 sm:px-5 sm:py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-body text-text-primary">原稿紅筆</h4>
        <span id="gradingeditor-manuscript-note-count" className="text-caption text-text-secondary">
          {notes.length} 則・待確認 {pendingCount}
        </span>
      </div>
      <p className="text-caption text-text-secondary">
        編號和左邊原稿上的一樣，點一下互相跳過去。每按一下就存。
      </p>
      {beforeGrading && pendingCount > 0 && !locked && (
        <p id="gradingeditor-manuscript-before-grading" className="rounded-xl bg-mauve-100 px-3 py-2 text-caption text-mauve-800">
          建議先看完待確認的錯字再按「AI 批改」：確認過的才會算分、送給 AI。
        </p>
      )}
      {error && (
        <p id="gradingeditor-manuscript-error" role="alert" className="rounded-xl bg-danger-100 px-3 py-2 text-caption text-danger-700">{error}</p>
      )}

      {addTarget && !locked && (
        <div id="gradingeditor-manuscript-add" className="rounded-xl border-2 border-info-200 bg-info-50 p-3">
          <p className="text-body text-text-primary">
            在原稿上的<span className="font-essay">「{addTarget.text}」</span>加錯字
          </p>
          <CorrectForm
            key={addTarget.cellKey}
            idPrefix="gradingeditor-manuscript-add"
            initialCorrect=""
            submitLabel="加入"
            busy={busy}
            onSubmit={async (correct, note) => {
              if (await onDecision({ target: 'typo', cellKey: addTarget.cellKey, action: 'add', correct, note }, null)) onCancelAdd();
            }}
            onCancel={onCancelAdd}
          />
        </div>
      )}

      {removals.length > 0 && (
        <div id="gradingeditor-manuscript-removals" className="rounded-xl border border-warning-200 bg-warning-100 p-3 text-caption text-warning-800">
          <p>因為老師加的錯字落在引用上，原稿上先拿掉了：</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {removals.map((r) => <li key={r.label}>{r.label}{r.kind === 'card' ? '（整張）' : ''}</li>)}
          </ul>
          <p className="mt-1">刪掉那個錯字就會回來。</p>
          {mentions.length > 0 && (
            <p className="mt-1">評語裡也提到{mentions.map((q) => `「${q}」`).join('')}，請自己看一下要不要改。</p>
          )}
        </div>
      )}

      {notes.length === 0 ? (
        <p className="text-caption text-text-secondary">原稿上沒有錯字或格式提醒。</p>
      ) : (
        <ol className="space-y-2">
          {notes.map((note) => {
            const selected = note.id === selectedNoteId;
            const actions = actionsOf(note);
            return (
              <li
                key={note.id}
                id={`gradingeditor-manuscript-note-${note.number ?? note.id.replace(/[^\w-]/g, '_')}`}
                ref={(el) => registerItem(note.id, el)}
                onClick={() => onSelect(note.id)}
                className={`cursor-pointer rounded-xl border p-3 transition-colors ${
                  selected ? 'border-border-strong bg-card shadow-paper' : 'border-border-card bg-card/80 hover:border-primary/30'
                } ${note.kind === 'pending' ? 'border-dashed border-mauve-300' : ''}`}
              >
                <div className="flex gap-2">
                  {note.number !== null ? (
                    <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-caption text-on-solid" style={{ backgroundColor: NOTE_COLORS[note.kind] }}>
                      {note.number}
                    </span>
                  ) : (
                    <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-caption" style={{ borderColor: NOTE_COLORS[note.kind], color: NOTE_COLORS[note.kind] }} aria-hidden="true">
                      ·
                    </span>
                  )}
                  <div className="min-w-0 flex-1">{bodyOf(note)}</div>
                </div>
                {actions && (
                  <div className="mt-2 flex flex-wrap justify-end gap-2" onClick={(e) => e.stopPropagation()}>{actions}</div>
                )}
                {editingId === note.id && !locked && (
                  <div onClick={(e) => e.stopPropagation()}>
                    <CorrectForm
                      idPrefix={`gradingeditor-manuscript-correct-${note.number ?? 'x'}`}
                      initialCorrect={note.typo?.correct ?? ''}
                      submitLabel="儲存"
                      busy={busy}
                      onSubmit={(correct, text) => decide(note, 'correct', { correct, note: text })}
                      onCancel={() => setEditingId(null)}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
};
