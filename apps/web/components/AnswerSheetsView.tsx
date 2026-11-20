import React, { useState } from 'react';
import { Download, ExternalLink, FileText, Info, Loader2, Printer } from 'lucide-react';
import {
  ANSWER_SHEETS,
  sheetDownloadName,
  sheetPdfUrl,
  sheetPreviewUrls,
  type AnswerSheet,
  type SheetPaper,
} from '../lib/answerSheets';
import { downloadBlob, fetchPdf, printPdfBlob } from '../lib/printPdf';

type Busy = 'print' | 'download' | null;

/**
 * 一種稿紙一張卡片：預覽、選紙張、列印或下載。
 *
 * 列印和下載都先把 PDF 抓下來（不是直接連結）：列印要放進隱藏框叫出列印視窗；
 * 下載要換成看得懂的中文檔名（網址上的是英文）。
 */
const SheetCard: React.FC<{ sheet: AnswerSheet }> = ({ sheet }) => {
  const [paper, setPaper] = useState<SheetPaper>(sheet.papers[0].paper);
  const [busy, setBusy] = useState<Busy>(null);
  const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const previews = sheetPreviewUrls(sheet, paper);
  const pdfUrl = sheetPdfUrl(sheet.id, paper);

  const run = async (action: Exclude<Busy, null>) => {
    setBusy(action);
    setMessage(null);
    try {
      const blob = await fetchPdf(pdfUrl);
      if (action === 'print') {
        try {
          await printPdfBlob(blob);
          return;
        } catch {
          // 手機、平板多半不能直接列印：改成下載，讓使用者用檔案自己的列印
          downloadBlob(blob, sheetDownloadName(sheet, paper));
          setMessage({ tone: 'info', text: '這個瀏覽器不能直接列印，已改成下載 PDF，請打開檔案再列印。' });
          return;
        }
      }
      downloadBlob(blob, sheetDownloadName(sheet, paper));
      setMessage({ tone: 'info', text: '稿紙已下載。' });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : '稿紙檔案下載失敗，請稍後再試' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <article
      id={`sheets-card-${sheet.id}`}
      className="bg-card rounded-2xl border border-border-card shadow-paper overflow-hidden flex flex-col"
    >
      {/* 預覽：兩頁並排，點一下開 PDF（瀏覽器自己的檢視器可以放大看） */}
      <a
        href={pdfUrl}
        target="_blank"
        rel="noopener"
        title="在新分頁開啟 PDF"
        className="group block bg-surface-soft p-3 border-b border-border-card"
      >
        <div className="grid grid-cols-2 gap-2">
          {previews.map((src, i) => (
            <figure key={src} className="space-y-1">
              <img
                src={src}
                alt={`${sheet.label}（${paper}）第 ${i + 1} 頁預覽`}
                loading="lazy"
                className="w-full aspect-[1.414] object-contain bg-white rounded-md border border-border-card group-hover:border-border-strong transition-colors"
              />
              <figcaption className="text-caption text-text-muted text-center">第 {i + 1} 頁</figcaption>
            </figure>
          ))}
        </div>
      </a>

      <div className="p-5 flex flex-col gap-4 flex-1">
        <div>
          <h3 className="text-title font-bold text-text-primary flex items-center gap-2">
            <FileText size={18} className="text-primary shrink-0" />
            {sheet.label}
          </h3>
          <p className="mt-1.5 text-body text-text-secondary">{sheet.description}</p>
        </div>

        {/* 紙張 */}
        <div role="radiogroup" aria-label="紙張大小" className="flex flex-wrap gap-2">
          {sheet.papers.map((option) => {
            const active = option.paper === paper;
            return (
              <button
                key={option.paper}
                id={`sheets-btn-paper-${sheet.id}-${option.paper}`}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => {
                  setPaper(option.paper);
                  setMessage(null);
                }}
                className={`px-3 py-1.5 rounded-full border text-caption transition-colors ${
                  active
                    ? 'bg-primary text-on-accent border-primary'
                    : 'bg-card text-text-secondary border-border-strong hover:bg-surface-soft'
                }`}
              >
                <span className="font-bold">{option.paper}</span>
                <span className={active ? '' : 'text-text-muted'}>・{option.note}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-auto flex flex-wrap gap-2">
          <button
            id={`sheets-btn-print-${sheet.id}`}
            type="button"
            onClick={() => void run('print')}
            disabled={busy !== null}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-on-accent text-body font-bold hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {busy === 'print' ? <Loader2 size={16} className="animate-spin" /> : <Printer size={16} />}
            列印
          </button>
          <button
            id={`sheets-btn-download-${sheet.id}`}
            type="button"
            onClick={() => void run('download')}
            disabled={busy !== null}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-card border border-border-strong text-text-primary text-body hover:bg-surface-soft disabled:opacity-50 transition-colors"
          >
            {busy === 'download' ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            下載 PDF
          </button>
          <a
            id={`sheets-link-open-${sheet.id}`}
            href={pdfUrl}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-body text-text-secondary hover:bg-surface-soft transition-colors"
          >
            <ExternalLink size={15} />
            開啟
          </a>
        </div>

        {message && (
          <p
            role="status"
            className={`text-caption rounded-lg px-3 py-2 ${
              message.tone === 'error'
                ? 'bg-danger-50 text-danger-700 border border-danger-200'
                : 'bg-surface-soft text-text-secondary border border-border-card'
            }`}
          >
            {message.text}
          </p>
        )}
      </div>
    </article>
  );
};

/** 《我的稿紙》：可以下載、列印的空白稿紙（靜態版，見 lib/answerSheets.ts） */
export const AnswerSheetsView: React.FC = () => (
  <div className="max-w-7xl mx-auto space-y-6 pb-10">
    <div>
      <h2 className="text-display font-serif font-bold text-text-primary tracking-tight flex items-center gap-3">
        <FileText size={30} className="text-primary" />
        我的稿紙
      </h2>
      <p className="mt-2 text-body text-text-secondary">選好稿紙和紙張，直接列印或下載 PDF，發給學生手寫。</p>
    </div>

    <section
      aria-label="列印前請看"
      className="rounded-2xl border border-border-card bg-card px-5 py-4 flex gap-3"
    >
      <Info size={18} className="text-primary shrink-0 mt-0.5" />
      <ul className="text-body text-text-secondary space-y-1.5 list-disc pl-5">
        <li>
          列印視窗的「縮放」請選<strong className="text-text-primary">實際大小</strong>（100%），不要選「符合頁面大小」。
        </li>
        <li>
          兩頁請<strong className="text-text-primary">雙面列印</strong>在同一張紙上，翻面方式選「短邊翻頁」。
        </li>
        <li>
          四角的黑色小方塊是<strong className="text-text-primary">定位標記</strong>，之後系統靠它辨識手寫稿，請不要裁掉或塗改。
        </li>
      </ul>
    </section>

    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
      {ANSWER_SHEETS.map((sheet) => (
        <SheetCard key={sheet.id} sheet={sheet} />
      ))}
    </div>
  </div>
);
