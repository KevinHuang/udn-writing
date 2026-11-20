import React from 'react';
import { AlertTriangle, ScanText, ShieldAlert } from 'lucide-react';
import {
  completionPercent, sheetSummaryLine, teacherAlertText, type SimpleGradingInfo,
} from '../lib/simpleGrading';

/**
 * 批改面板裡的「簡易批改」區塊（只給老師看；docs/simple-grading.md）。
 *
 * 學生看得到的級分與評語照舊在下面的評語欄，老師可以改；這一塊放的是學生**看不到**的：
 * 請老師留意、評分依據、系統拿掉了哪些引用，以及辨識摘要。
 *
 * 示意圖裡原本還有四向度評語 —— 單篇的四向度目前依需求不顯示（lib/features.ts SHOW_CATEGORY_SCORES），
 * 照樣存在 sub_scores，這裡跟著不顯示。
 */
export const SimpleGradingPanel: React.FC<{ info: SimpleGradingInfo }> = ({ info }) => {
  const { sheet, detail } = info;
  const alert = detail ? teacherAlertText(detail.teacherAlert) : null;

  return (
    <section
      id="gradingeditor-simple"
      aria-label="簡易批改"
      className="rounded-brand border border-border-card bg-card/40 px-4 py-3 sm:px-5 sm:py-4 space-y-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-info-100 px-2.5 py-1 text-caption text-info-700">
          <ScanText size={14} className="shrink-0" />
          簡易批改・稿紙代繳交
        </span>
        <span className="text-caption text-text-muted">這一塊只有老師看得到</span>
      </div>

      {alert && (
        <div
          id="gradingeditor-simple-alert"
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-danger-200 bg-danger-100 px-3 py-2"
        >
          <ShieldAlert size={16} className="mt-0.5 shrink-0 text-danger-600" />
          <p className="text-caption text-danger-700">
            <span className="font-bold">請老師留意：</span>{alert}
          </p>
        </div>
      )}

      {sheet && (
        <p id="gradingeditor-simple-summary" className="text-caption text-text-secondary">
          {sheetSummaryLine(sheet)}
        </p>
      )}

      {sheet?.lowCompletion && sheet.completion !== null && (
        <div className="flex items-start gap-2 rounded-xl border border-warning-200 bg-warning-100 px-3 py-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning-700" />
          <p className="text-caption text-warning-800">
            辨識完成度只有 {completionPercent(sheet.completion)}%，有些字可能讀錯。批改前請對照原稿看一下。
          </p>
        </div>
      )}

      {!detail && info.eligible && (
        <p className="text-caption text-text-secondary">
          按「AI 批改」會用簡易批改：學生沒有校稿，辨識不確定的字不會被引用或批評。評分規準照這一題的批改規範。
        </p>
      )}

      {detail && info.reason === 'edited' && (
        <p className="text-caption text-text-secondary">
          作文的文字在批改之後被校對改過了。重新 AI 批改的話會改用一般批改。
        </p>
      )}

      {detail?.zeroReason && (
        <p className="text-caption text-text-primary">
          <span className="text-text-secondary">判 0 級分的原因：</span>{detail.zeroReason}
        </p>
      )}

      {detail?.scoreBasis && (
        <details id="gradingeditor-simple-basis" className="group">
          <summary className="cursor-pointer text-caption text-primary select-none">評分依據</summary>
          <p className="mt-2 whitespace-pre-wrap text-caption text-text-primary leading-relaxed">{detail.scoreBasis}</p>
        </details>
      )}

      {detail && detail.checks.length > 0 && (
        <details id="gradingeditor-simple-checks">
          <summary className="cursor-pointer text-caption text-primary select-none">
            系統處理了 {detail.checks.length} 件事
          </summary>
          <ul className="mt-2 list-disc pl-5 space-y-1 text-caption text-text-secondary">
            {detail.checks.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </details>
      )}
    </section>
  );
};
