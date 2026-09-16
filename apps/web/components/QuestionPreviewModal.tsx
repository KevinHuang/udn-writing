import React from 'react';
import { X, Check, Bot, ClipboardList, Image as ImageIcon, PenLine } from 'lucide-react';
import { Question } from '../types';
import { TARGET_GRADE_LABEL, QUESTION_SOURCE_LABEL } from '../lib/questionMeta';
import { SHOW_AI_MODEL_PICKER } from '../lib/features';

interface QuestionPreviewModalProps {
  /** 要預覽的題目。null 時不顯示 */
  question: Question | null;
  /** 這一題目前是否已被選取 */
  isSelected?: boolean;
  onClose: () => void;
  /** 按「選用這一題」。不提供時只當作純檢視 */
  onSelect?: (question: Question) => void;
}

/**
 * 題目的唯讀預覽。
 *
 * 派發流程的題目卡片只顯示標題與內容前兩行，老師無法確認
 * 「這是不是我要的那一題」—— 尤其是看圖寫作，圖片根本看不到。
 * 這裡把完整資訊攤開：題幹、參考圖片、評分規準、預設批改模型。
 *
 * 內文用 text-essay（17px／行高 2.0，定義在 index.css），
 * 因為題幹本身就是要讀的長文，不是介面標籤。
 */
export const QuestionPreviewModal: React.FC<QuestionPreviewModalProps> = ({
  question,
  isSelected = false,
  onClose,
  onSelect,
}) => {
  if (!question) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-ink-900/45 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-2xl bg-surface rounded-2xl shadow-2xl border border-border flex flex-col max-h-[88vh] overflow-hidden">
        {/* 標頭 */}
        <div className="p-5 border-b border-border flex items-start justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <div className="flex flex-wrap gap-1.5 mb-2">
              <span className="inline-block bg-surface-soft text-text-secondary px-2 py-0.5 rounded text-caption border border-border whitespace-nowrap">
                {question.gradeLevel}
              </span>
              {question.targetGrades?.map((g) => (
                <span key={g} className="inline-block bg-primary/10 text-primary px-2 py-0.5 rounded text-caption whitespace-nowrap">
                  {TARGET_GRADE_LABEL[g]}
                </span>
              ))}
              {question.sources?.map((src) => (
                <span key={src} className="inline-block bg-surface-soft text-text-secondary px-2 py-0.5 rounded text-caption border border-border whitespace-nowrap">
                  {QUESTION_SOURCE_LABEL[src]}
                </span>
              ))}
            </div>
            <h3 className="text-title font-bold text-text-primary">
              {question.title}
            </h3>
          </div>
          <button
            id="questionpreview-btn-close"
            onClick={onClose}
            className="tap-target shrink-0 p-2 rounded-full text-text-secondary hover:bg-surface-soft transition-colors"
            title="關閉"
          >
            <X size={18} />
          </button>
        </div>

        {/* 內容 */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* 題幹 */}
          <div>
            <p className="text-caption text-text-secondary uppercase tracking-widest mb-2">
              題目內容
            </p>
            <div className="bg-card border border-border rounded-xl p-4">
              <p className="text-essay text-text-primary whitespace-pre-wrap">
                {question.content}
              </p>
            </div>
          </div>

          {/* 教師的話：學生看得到的寫作引導，與下方只給 AI 的評分規準不同 */}
          {question.teacherNotes && (
            <div>
              <p className="text-caption text-text-secondary uppercase tracking-widest mb-2 flex items-center gap-1.5">
                <PenLine size={12} className="shrink-0" />
                教師的話
              </p>
              <div className="bg-card border-l-[3px] border-secondary rounded-xl px-4 py-3">
                <p className="text-body text-text-secondary whitespace-pre-wrap">
                  {question.teacherNotes}
                </p>
              </div>
            </div>
          )}

          {/* 參考圖片：看圖寫作的關鍵，卡片上完全看不到 */}
          {question.imageUrl && (
            <div>
              <p className="text-caption text-text-secondary uppercase tracking-widest mb-2 flex items-center gap-1.5">
                <ImageIcon size={12} className="shrink-0" />
                參考圖片
              </p>
              <div className="bg-card border border-border rounded-xl p-3 flex justify-center">
                <img
                  src={question.imageUrl}
                  alt="題目參考圖片"
                  referrerPolicy="no-referrer"
                  className="max-h-72 w-auto rounded-lg object-contain"
                />
              </div>
            </div>
          )}

          {/* 評分規準 */}
          {question.gradingCriteria && (
            <div>
              <p className="text-caption text-text-secondary uppercase tracking-widest mb-2 flex items-center gap-1.5">
                <ClipboardList size={12} className="shrink-0" />
                評分規準
              </p>
              <div className="bg-card border border-border rounded-xl p-4">
                <p className="text-body text-text-secondary whitespace-pre-wrap">
                  {question.gradingCriteria}
                </p>
              </div>
            </div>
          )}

          {/* 預設批改模型。使用者已經選不了，就不再顯示 —— 見 lib/features.ts */}
          {SHOW_AI_MODEL_PICKER && question.preferredAiModel && (
            <div className="flex items-center gap-2 text-caption text-text-secondary">
              <Bot size={13} className="shrink-0 text-primary" />
              預設批改模型：
              <span className="text-text-primary">{question.preferredAiModel}</span>
            </div>
          )}
        </div>

        {/* 動作 */}
        <div className="p-4 border-t border-border bg-surface-soft/40 flex justify-end gap-2 shrink-0">
          <button
            id="questionpreview-btn-cancel"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-body text-text-secondary hover:bg-surface-soft transition-colors whitespace-nowrap"
          >
            關閉
          </button>
          {onSelect && (
            <button
              id="questionpreview-btn-select"
              onClick={() => onSelect(question)}
              className={`inline-flex items-center gap-1.5 px-5 py-2 rounded-lg text-body whitespace-nowrap transition-all active:scale-95 ${
                isSelected
                  ? 'bg-ink-200 text-ink-700'
                  : 'bg-primary text-on-accent hover:opacity-90'
              }`}
            >
              <Check size={15} className="shrink-0" />
              {isSelected ? '取消選用' : '選用這一題'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
