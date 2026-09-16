import React, { useMemo, useState } from 'react';
import { X, Search, FileText, AlertTriangle } from 'lucide-react';
import { Assignment, Question } from '../types';

interface QuestionPickerModalProps {
  /** 要換題的作業。null 時不顯示 */
  assignment: Assignment | null;
  questions: Question[];
  /** 這份作業目前有幾筆繳交紀錄（換題會全部刪除） */
  affectedSubmissions: number;
  onClose: () => void;
  onPick: (question: Question) => void;
}

/**
 * 更換作業題目的選擇器。
 *
 * 只在作業已關閉時進得來（見 lib/assignments.ts 的 canSwapQuestion）。
 * 這裡先把後果講清楚，實際的二次確認在 App 端的 confirmDialog。
 */
export const QuestionPickerModal: React.FC<QuestionPickerModalProps> = ({
  assignment,
  questions,
  affectedSubmissions,
  onClose,
  onPick,
}) => {
  const [keyword, setKeyword] = useState('');

  const results = useMemo(() => {
    const pool = questions.filter(
      (q) => !q.isArchived && q.id !== assignment?.questionId,
    );
    const k = keyword.trim().toLowerCase();
    if (!k) return pool;
    return pool.filter(
      (q) =>
        q.title.toLowerCase().includes(k) ||
        q.content.toLowerCase().includes(k),
    );
  }, [questions, keyword, assignment]);

  if (!assignment) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-2xl bg-surface rounded-2xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden border border-border">
        <div className="p-5 border-b border-border flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-title font-bold text-text-primary">更換題目</h3>
            <p className="text-caption text-text-secondary mt-1 line-clamp-1">
              目前題目：{assignment.title}
            </p>
          </div>
          <button
            id="questionpicker-btn-close"
            onClick={onClose}
            className="shrink-0 p-2 rounded-full text-text-secondary hover:bg-surface-soft transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {affectedSubmissions > 0 && (
          <div className="mx-5 mt-4 flex items-start gap-2 bg-danger-100 border border-danger-200 text-danger-700 rounded-lg px-3 py-2.5">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <p className="text-caption leading-relaxed">
              這份作業已有 {affectedSubmissions} 筆繳交紀錄（含已批改的）。
              換題後會全部刪除，無法復原。
            </p>
          </div>
        )}

        <div className="p-5 pb-3">
          <div className="relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary shrink-0"
            />
            <input
              id="questionpicker-input-search"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜尋題目…"
              className="w-full pl-9 pr-3 py-2 bg-card border border-border rounded-lg text-body text-text-primary outline-none focus:border-primary transition-colors"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-2">
          {results.length === 0 ? (
            <p className="text-caption text-text-secondary text-center py-8">
              找不到符合的題目。
            </p>
          ) : (
            results.map((q) => (
              <button
                key={q.id}
                id={`questionpicker-item-${q.id}`}
                onClick={() => onPick(q)}
                className="w-full text-left bg-card border border-border rounded-lg px-4 py-3 hover:border-primary transition-colors group"
              >
                <span className="flex items-center gap-2 text-body text-text-primary group-hover:text-primary transition-colors">
                  <FileText size={14} className="shrink-0" />
                  <span className="line-clamp-1">{q.title}</span>
                </span>
                <span className="mt-1 block text-caption text-text-secondary line-clamp-2">
                  {q.content}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
