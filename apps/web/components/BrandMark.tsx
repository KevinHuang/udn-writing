import React from 'react';

/**
 * 系統識別：聯合報雲寫作教室
 *
 * ⚠ 關於「聯合報」字樣
 * ────────────────────────────────────────────────────────────
 * 「聯合報」是聯合報系的註冊字標，有固定的字形與比例。
 * 這裡用的是**文字佔位版**：朱紅、楷體、字距收緊，取其神韻，
 * 但刻意不去描摹真正的字標 —— 手工仿造的商標不該當成正式識別出貨。
 *
 * 正式版請向聯合報取得官方 logo 檔（SVG 尤佳），放到 public/ 後
 * 把下面 <span className="wordmark"> 那段換成：
 *
 *     <img src="/udn-logo.svg" alt="聯合報" className="h-5 sm:h-6 w-auto shrink-0" />
 *
 * 其餘版面不必動。深色模式若官方檔是深色版，記得補一張淺色版並用
 * `dark:hidden` / `hidden dark:block` 切換。
 */

interface BrandMarkProps {
  /** 副標右側的額外內容（例如學生端的學期標籤） */
  trailing?: React.ReactNode;
}

export const BrandMark: React.FC<BrandMarkProps> = ({ trailing }) => (
  <div className="block min-w-0">
    <h1 className="flex items-baseline gap-1.5 leading-none whitespace-nowrap">
      {/* 佔位字標 —— 取得官方檔後換成 <img> */}
      <span
        className="text-title font-bold text-secondary tracking-[0.08em]"
        style={{ fontFamily: '"LXGW WenKai TC", "KaiTi", "DFKai-SB", serif' }}
      >
        聯合報
      </span>
      <span className="text-title font-bold text-text-primary tracking-tight group-hover:text-primary transition-colors">
        雲寫作教室
      </span>
    </h1>
    <div className="flex items-center gap-2 mt-0.5 sm:mt-1">
      <span className="text-caption text-text-secondary tracking-widest uppercase">
        UDN Writing Classroom
      </span>
      {trailing}
    </div>
  </div>
);
