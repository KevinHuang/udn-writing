import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Loader2, Printer } from "lucide-react";
import { AnthologyBook, type AnthologyCover } from "./AnthologyBook";
import type { AnthologyEntry, AnthologyOptions, BookPage } from "../../lib/anthology";

/** 一張 A4 在畫面上的寬度（210mm ≒ 794px）。手機預覽要縮放 */
const SHEET_PX = 794;

/** 預覽要畫的整本書。由呼叫端用 lib/anthology.ts 的 buildBook() 排好 */
export interface AnthologyPreviewData {
  pages: BookPage[];
  entries: AnthologyEntry[];
  options: AnthologyOptions;
  cover: AnthologyCover;
}

/**
 * 成果集／作品集的預覽視窗（老師的成果集與學生的作品集共用）。
 *
 * **掛在 body 底下**（id="anthology-print"）——
 * index.css 的列印樣式靠這個位置，列印時把 body 底下其他的東西全部藏起來。
 */
export const AnthologyPreview: React.FC<{ preview: AnthologyPreviewData; onClose: () => void }> = ({ preview, onClose }) => {
  const [printing, setPrinting] = useState(false);
  const [zoom, setZoom] = useState(1);

  // 手機上一張 A4 放不下，整本等比例縮小（列印時 index.css 會把縮放拿掉）
  useEffect(() => {
    const fit = () => setZoom(Math.min(1, (window.innerWidth - 32) / SHEET_PX));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  // 開著預覽時，後面的頁面不要跟著捲
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const print = async () => {
    setPrinting(true);
    try {
      // 原稿還沒載完就叫出列印，那幾頁會是空白的
      const imgs = Array.from(document.querySelectorAll<HTMLImageElement>("#anthology-print img"));
      await Promise.all(imgs.map((img) => img.decode().catch(() => undefined)));
    } finally {
      setPrinting(false);
    }
    window.print();
  };

  const sheetCount = preview.pages.length;

  return createPortal(
    <div id="anthology-print" className="fixed inset-0 z-[1100] overflow-y-auto bg-ink-900/70 backdrop-blur-sm">
      <div className="anthology-chrome sticky top-0 z-10 bg-surface/95 backdrop-blur border-b border-border px-4 py-3 flex items-center justify-between gap-3">
        <button
          id="anthology-preview-btn-close"
          type="button"
          onClick={onClose}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-body text-text-secondary hover:bg-surface-soft transition-colors"
        >
          <ArrowLeft size={18} /> 回到設定
        </button>
        <span className="text-caption text-text-muted hidden sm:block">
          共 {sheetCount} 頁・列印時紙張選 A4、邊界選「無」
        </span>
        <button
          id="anthology-preview-btn-print"
          type="button"
          onClick={() => void print()}
          disabled={printing}
          className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-on-accent px-4 py-2 rounded-xl text-body font-bold shadow-lg shadow-primary/20 transition-all disabled:opacity-60"
        >
          {printing ? <Loader2 size={16} className="animate-spin" /> : <Printer size={16} />}
          列印／另存 PDF
        </button>
      </div>
      <div
        className="anthology-pages flex flex-col items-center gap-8 py-8"
        style={{ zoom }}
      >
        <AnthologyBook {...preview} />
      </div>
    </div>,
    document.body,
  );
};
