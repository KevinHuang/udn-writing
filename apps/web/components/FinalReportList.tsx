import React, { useState } from 'react';
import { ArrowLeft, Sparkles, ChevronDown, Award, FileText, Loader2 } from 'lucide-react';
import type { FinalReport } from '@udn/shared';
import { levelStyle } from '../lib/scoring';
import { Markdown } from './Markdown';

interface FinalReportListProps {
  courseName: string;
  reports: FinalReport[];
  /** 這個班的學生總數。用來說明「還有幾位沒有總結」 */
  studentCount: number;
  isLoading: boolean;
  isGenerating: boolean;
  /** 產生完成後的結果。顯示一次就好，由呼叫端清掉 */
  lastResult?: { generated: number; skipped: number };
  onGenerate: () => void;
  onBack?: () => void;
  canGoBack?: boolean;
}

/**
 * 平均級分要顯示小數 —— 它是整學期的平均，不是單篇的級分。
 * null 代表沒有資料（四向度多半是空的），顯示破折號而不是 0。
 */
const fmt = (n: number | null) =>
  n == null ? '—' : Number.isInteger(n) ? String(n) : n.toFixed(1);

/**
 * 一位學生的總結。預設收合，只露出姓名、平均與四個面向的分數；
 * 展開才看得到 AI 寫的摘要與最高分作品。
 *
 * 為什麼預設收合：一個班四十幾個人，每份總結有四段摘要加一段總評，
 * 全部攤開會是幾千字的牆。老師多半是先掃一遍分數，再挑幾個人細看。
 */
const ReportCard: React.FC<{ report: FinalReport }> = ({ report }) => {
  const [isOpen, setIsOpen] = useState(false);
  const avg = levelStyle(report.avgScore);

  return (
    <div className="bg-card border border-border-card rounded-brand shadow-paper hover:border-border-strong hover:shadow-lift transition-all overflow-hidden">
      <button
        id={`finalreport-toggle-${report.studentId}`}
        onClick={() => setIsOpen((v) => !v)}
        className="w-full text-left px-4 sm:px-5 py-4 flex items-center gap-3 sm:gap-4 hover:bg-surface-soft transition-colors"
        aria-expanded={isOpen}
      >
        {report.seatNo != null && (
          <span className="shrink-0 w-9 text-center text-caption text-text-muted tabular-nums">
            {report.seatNo}
          </span>
        )}
        <span className="shrink-0 font-bold text-body text-text-primary min-w-[4.5rem]">
          {report.studentName}
        </span>

        <span className={`shrink-0 px-2.5 py-1 rounded-full text-caption tabular-nums ${avg.badge}`}>
          平均 {fmt(report.avgScore)}
        </span>

        {/* 四個面向的分數。窄畫面放不下就整組收起來，展開後仍看得到 */}
        <span className="hidden md:flex items-center gap-3 min-w-0">
          {report.dimensions.map((d) => (
            <span key={d.key} className="flex items-center gap-1.5 text-caption text-text-muted">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${levelStyle(d.score).dot}`} />
              <span className="whitespace-nowrap">{d.label}</span>
              <span className="tabular-nums text-text-secondary">{fmt(d.score)}</span>
            </span>
          ))}
        </span>

        <span className="ml-auto shrink-0 flex items-center gap-2 sm:gap-3">
          <span className="text-caption text-text-muted whitespace-nowrap tabular-nums">
            {report.articleCount} 篇
          </span>
          <ChevronDown
            size={18}
            className={`text-text-secondary transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        </span>
      </button>

      {isOpen && (
        <div className="px-4 sm:px-5 pb-5 pt-1 border-t border-border-card space-y-5">
          {/* 窄畫面在標頭看不到面向分數，展開時補回來 */}
          <div className="md:hidden grid grid-cols-2 gap-2">
            {report.dimensions.map((d) => (
              <div key={d.key} className="flex items-center justify-between gap-2 bg-surface rounded-lg px-3 py-2">
                <span className="text-caption text-text-secondary">{d.label}</span>
                <span className={`text-caption tabular-nums font-bold ${levelStyle(d.score).text}`}>
                  {fmt(d.score)}
                </span>
              </div>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {report.dimensions.map((d) => (
              <div key={d.key} className="bg-surface rounded-lg p-3.5">
                <div className="flex items-baseline justify-between gap-2 mb-1.5">
                  <span className="text-caption text-text-secondary font-bold">{d.label}</span>
                  <span className={`text-caption tabular-nums font-bold ${levelStyle(d.score).text}`}>
                    {fmt(d.score)}
                  </span>
                </div>
                <p className="text-body text-text-primary leading-relaxed">{d.summary}</p>
              </div>
            ))}
          </div>

          {report.finalSummary && (
            <div>
              <h4 className="flex items-center gap-2 text-caption text-text-secondary uppercase tracking-wider mb-2">
                <Sparkles size={13} className="text-primary shrink-0" /> 整體總評
              </h4>
              <p className="text-body text-text-primary leading-relaxed bg-surface rounded-lg p-3.5">
                {report.finalSummary}
              </p>
            </div>
          )}

          {report.best && (
            <div>
              <h4 className="flex items-center gap-2 text-caption text-text-secondary uppercase tracking-wider mb-2">
                <Award size={13} className="text-primary shrink-0" /> 本學期表現最好的一篇
              </h4>
              <div className="bg-surface rounded-lg p-3.5">
                <p className="text-body font-bold text-text-primary mb-2">{report.best.title}</p>
                {/*
                  當時那一篇的評語。它可能是 markdown（AI 產的批改報告都是），
                  所以走 Markdown 元件 —— 直接印會看到滿畫面的 ### 與 **。
                */}
                {report.best.remark && <Markdown>{report.best.remark}</Markdown>}
              </div>
            </div>
          )}

          <p className="text-caption text-text-muted">
            {report.createdAt ? new Date(report.createdAt).toLocaleDateString('zh-TW') : ''}
            {report.modelName ? ` · ${report.modelName}` : ''}
          </p>
        </div>
      )}
    </div>
  );
};

/**
 * 期末總結：一個班每位學生整學期的表現。
 *
 * 資料由後端的 `FinalReportHelper.calculate()` 彙整**已批改**的作品產生，
 * 所以一位學生要有批改過的作品才會出現在這裡 —— 這也是「尚未產生」
 * 與「還有幾位沒有」要分開說明的原因。
 */
export const FinalReportList: React.FC<FinalReportListProps> = ({
  courseName,
  reports,
  studentCount,
  isLoading,
  isGenerating,
  lastResult,
  onGenerate,
  onBack,
  canGoBack,
}) => {
  const missing = Math.max(0, studentCount - reports.length);

  return (
    <div className="max-w-5xl mx-auto space-y-5 pb-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 sm:gap-3">
            {canGoBack && onBack && (
              <button
                id="finalreport-btn-back"
                onClick={onBack}
                className="tap-target p-1.5 sm:p-2 -ml-1 sm:-ml-2 rounded-full hover:bg-surface/50 text-text-primary transition-colors shrink-0"
              >
                <ArrowLeft size={18} className="sm:size-6" />
              </button>
            )}
            <h2 className="text-display font-bold text-text-primary tracking-tight">期末總結</h2>
          </div>
          <p className="text-ui text-text-secondary mt-0.5 sm:mt-1 font-normal">{courseName}</p>
        </div>

        <button
          id="finalreport-btn-generate"
          onClick={onGenerate}
          disabled={isGenerating || isLoading}
          className="shrink-0 bg-primary hover:bg-primary/90 disabled:opacity-60 disabled:hover:bg-primary text-on-accent px-4 sm:px-5 py-2 sm:py-2.5 rounded-full text-body shadow-lg shadow-primary/20 transition-all flex items-center justify-center gap-2 enabled:hover:scale-[1.02]"
        >
          {isGenerating
            ? <><Loader2 size={16} className="shrink-0 animate-spin" /> 產生中…</>
            : <><Sparkles size={16} className="shrink-0" /> 產生期末總結</>}
        </button>
      </div>

      {/*
        按鈕只處理「還沒有總結」的學生，所以這句話要先講清楚，
        老師才不會以為按了會重算已經有的那些。
      */}
      <p className="text-caption text-text-muted">
        產生總結會彙整每位學生<span className="font-bold">已批改</span>的作品。
        已經有總結的學生不會重算，要重新產生請先聯絡管理者。
      </p>

      {lastResult && (
        <div className="bg-info-100 border border-info-200 text-info-700 rounded-brand px-4 py-3 text-body">
          已產生 {lastResult.generated} 份總結
          {lastResult.skipped > 0 && `，${lastResult.skipped} 位學生沒有已批改的作品因此略過`}。
        </div>
      )}

      {isLoading ? (
        <div className="py-16 text-center text-text-muted text-body">載入中…</div>
      ) : reports.length === 0 ? (
        <div className="bg-card border border-border-card rounded-brand shadow-paper py-16 px-6 text-center">
          <FileText size={32} className="mx-auto text-text-muted mb-3" />
          <p className="text-body text-text-primary font-bold mb-1">這個班還沒有期末總結</p>
          <p className="text-body text-text-muted">
            按右上角的「產生期末總結」，系統會彙整每位學生已批改的作品。
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-2.5">
            {reports.map((r) => <ReportCard key={r.id} report={r} />)}
          </div>
          {missing > 0 && (
            <p className="text-caption text-text-muted text-center">
              這個班共 {studentCount} 位學生，還有 {missing} 位沒有總結
              —— 多半是還沒有已批改的作品。
            </p>
          )}
        </>
      )}
    </div>
  );
};
