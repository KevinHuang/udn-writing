import React from 'react';
import { Sparkles, PenLine, FileText } from 'lucide-react';
import { TargetGrade, QuestionSource } from '../types';
import { TARGET_GRADE_LABEL, QUESTION_SOURCE_LABEL } from '../lib/questionMeta';

export interface QuestionPreviewData {
  title: string;
  /** 題說 */
  content: string;
  teacherNotes: string;
  targetGrades: TargetGrade[];
  sources: QuestionSource[];
  imageUrl: string | null;
  /** 配圖替代文字。視障學生靠它理解題目 */
  imageAlt: string | null;
  imagePosition: 'before' | 'after';
  subject?: 'Chinese' | 'English';
}

/**
 * 學生端即時預覽。
 *
 * 老師在左欄填什麼，這裡就跟著變 —— 不做任何同步邏輯，
 * 直接讀同一份表單 state，所以不會有「預覽跟實際不一樣」的 bug。
 *
 * 排版刻意對齊 QuestionPreviewModal（派發流程的「查看完整題目」），
 * 讓老師在建題與選題兩個場合看到的是同一種東西。
 * 題說用 text-essay（17px／行高 2.0），因為那是要讀的長文，不是介面標籤。
 */
export const StudentQuestionPreview: React.FC<{ data: QuestionPreviewData }> = ({ data }) => {
  const isEnglish = data.subject === 'English';
  const hasAnything =
    data.title ||
    data.content ||
    data.teacherNotes ||
    data.imageUrl ||
    data.targetGrades.length ||
    data.sources.length;

  const image = data.imageUrl && (
    <img
      src={data.imageUrl}
      alt={data.imageAlt || '題目配圖'}
      referrerPolicy="no-referrer"
      className="w-full max-h-52 object-contain rounded-xl border border-border bg-surface-soft"
    />
  );

  return (
    <div id="questionbank-create-preview" className="lg:sticky lg:top-6">
      <div className="mb-2.5 flex items-center gap-2 text-caption text-text-secondary">
        <Sparkles size={13} className="shrink-0 text-primary" />
        學生端預覽
        <span className="ml-auto rounded-full bg-primary/10 text-primary px-2.5 py-0.5 whitespace-nowrap">
          即時同步
        </span>
      </div>

      <article
        className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm"
        aria-live="polite"
      >
        <div className="p-5 flex flex-col gap-3.5">
          {/* 標籤列 */}
          {(data.targetGrades.length > 0 || data.sources.length > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {data.targetGrades.map((g) => (
                <span
                  key={g}
                  className="rounded-lg bg-primary/10 text-primary px-2 py-0.5 text-caption whitespace-nowrap"
                >
                  {TARGET_GRADE_LABEL[g]}
                </span>
              ))}
              {data.sources.map((s) => (
                <span
                  key={s}
                  className="rounded-lg bg-surface-soft text-text-secondary border border-border px-2 py-0.5 text-caption whitespace-nowrap"
                >
                  {QUESTION_SOURCE_LABEL[s]}
                </span>
              ))}
            </div>
          )}

          <h3 className="text-title font-bold text-text-primary">
            {data.title || (
              <span className="text-text-muted font-normal">（尚未輸入題目名稱）</span>
            )}
          </h3>

          {data.imagePosition === 'before' && image}

          {data.content ? (
            <p className="text-essay font-essay text-text-primary whitespace-pre-wrap">{data.content}</p>
          ) : (
            <p className="text-body text-text-muted">（尚未輸入題說）</p>
          )}

          {data.imagePosition === 'after' && image}

          {/* 教師的話。評分規準不放進來 —— 那是給 AI 看的，不是給學生看的 */}
          {data.teacherNotes && (
            <div className="rounded-xl border-l-[3px] border-secondary bg-secondary/5 px-3.5 py-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-caption text-secondary">
                <PenLine size={12} className="shrink-0" />
                教師的話
              </div>
              <p className="text-body text-text-secondary whitespace-pre-wrap">
                {data.teacherNotes}
              </p>
            </div>
          )}

          <div className="mt-1 flex flex-wrap items-center gap-2 border-t border-border pt-3 text-caption text-text-secondary">
            <FileText size={12} className="shrink-0" />
            <span className="whitespace-nowrap">{isEnglish ? '橫線紙' : '方格稿紙'}</span>
            {/*
              這是**示意**用的，模擬學生看到的按鈕，點了不會有任何反應。
              先前它是實心主色，而整張預覽卡片是 sticky —— 老師捲動找儲存鈕時
              會把它當成主要動作（使用者回報「按了存不了檔」）。
              改成灰色虛線外框，一看就知道只是畫面示意。
            */}
            <span className="ml-auto rounded-lg border border-dashed border-border-strong text-text-muted px-3.5 py-1.5 whitespace-nowrap">
              開始寫作（學生端）
            </span>
          </div>
        </div>
      </article>

      {!hasAnything && (
        <p className="mt-2.5 text-center text-caption text-text-muted">
          左邊填什麼，這裡就跟著變。這是學生會看到的樣子。
        </p>
      )}
    </div>
  );
};
