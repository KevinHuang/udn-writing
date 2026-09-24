import React from 'react';
import { X } from 'lucide-react';

export interface TrayPage {
  id: string;
  /** 240px 的縮圖 objectURL。撤銷由擁有它的 DocumentScannerModal 負責 */
  thumbUrl: string;
}

interface ScanTrayProps {
  pages: TrayPage[];
  onRemove: (id: string) => void;
}

/**
 * 已經拍好、還沒送去辨識的稿紙。
 *
 * 為什麼要有這一列：連拍三四張時，人需要看得到自己拍了什麼 ——
 * 哪一張拍歪了、是不是漏了一面。沒有這個就只能整批重來。
 *
 * 刪除**刻意不做二次確認**：這些都還沒送出、沒有任何後端成本，刪錯再拍一張就好；
 * 在手機上多一次點擊反而是負擔（ConfirmDialog 留給真的不可逆的動作）。
 * 刪掉之後由呼叫端在訊息列說一聲，才不會讓人以為按錯了。
 */
export const ScanTray: React.FC<ScanTrayProps> = ({ pages, onRemove }) => {
  if (!pages.length) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-caption text-text-secondary">
        已收 {pages.length} 張，點縮圖右上角的 × 可以刪掉重拍
      </p>
      {/*
        -mx-4 px-4：讓捲動區貼到畫面邊緣，最後一張才不會看起來被切掉半張。
      */}
      <div id="scanner-tray" className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 py-1">
        {pages.map((p, i) => (
          <div
            key={p.id}
            id={`scanner-tray-item-${i}`}
            /*
              手機 64px 而不是 56px：56px 的格子再壓一顆 24px 的刪除鈕，
              看得到的內容只剩一小塊，而且刪除鈕會吃到隔壁縮圖的可點範圍。
            */
            className="relative shrink-0 w-16 h-16 sm:w-24 sm:h-24 rounded-lg overflow-hidden border border-border bg-card"
          >
            <img src={p.thumbUrl} alt={`第 ${i + 1} 張`} className="w-full h-full object-cover" />
            <span className="absolute left-1 bottom-1 px-1.5 rounded bg-ink-900/60 text-on-solid text-caption tabular-nums">
              {i + 1}
            </span>
            <button
              id={`scanner-btn-tray-remove-${i}`}
              onClick={() => onRemove(p.id)}
              title={`刪掉第 ${i + 1} 張`}
              className="absolute right-1 top-1 w-6 h-6 rounded-full bg-ink-900/60 text-on-solid flex items-center justify-center hover:bg-danger-600 transition-colors"
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
