import React from 'react';
import {
  SHEET, studentLine,
  type AnthologyEntry, type AnthologyOptions, type BookPage, type TextBlock, type TocRow,
} from '../../lib/anthology';

export interface AnthologyCover {
  title: string;
  subtitle: string;
  /** 收錄範圍，例如「石牌國中、中山國中｜3 個班」 */
  scope: string;
  semester: string;
}

interface AnthologyBookProps {
  pages: BookPage[];
  entries: AnthologyEntry[];
  options: AnthologyOptions;
  cover: AnthologyCover;
}

const mm = (n: number) => `${n}mm`;

/** 頁尾頁碼。封面與目錄不印 */
const Folio: React.FC<{ pageNo: number }> = ({ pageNo }) => (
  <div
    className="absolute left-0 right-0 text-center text-sheet-muted tracking-[0.3em]"
    style={{ bottom: mm(7), fontSize: mm(2.8) }}
  >
    — {pageNo} —
  </div>
);

/** 版心：頁邊距用 SHEET 的數字，跟排版計算同一份 */
const Body: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    className="absolute flex flex-col"
    style={{
      top: mm(SHEET.padTop), bottom: mm(SHEET.padBottom),
      left: mm(SHEET.padX), right: mm(SHEET.padX),
    }}
  >
    {children}
  </div>
);

const dateText = (iso: string) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('zh-TW') : '';
};

const CoverSheet: React.FC<{ cover: AnthologyCover; count: number }> = ({ cover, count }) => (
  <section className="sheet">
    <div className="absolute border-sheet-ink" style={{ inset: mm(15), borderWidth: mm(0.8) }}>
      <div
        className="absolute border-sheet-ink flex flex-col items-center justify-between text-center"
        style={{ inset: mm(1.5), borderWidth: mm(0.25), padding: `${mm(40)} ${mm(16)}` }}
      >
        <div className="tracking-[0.5em] text-sheet-muted" style={{ fontSize: mm(4) }}>
          學生作品集
        </div>
        <div className="space-y-[8mm]">
          <h1 className="font-bold leading-tight tracking-[0.08em]" style={{ fontSize: mm(13) }}>
            {cover.title}
          </h1>
          <div className="mx-auto bg-sheet-seal" style={{ width: mm(18), height: mm(1) }} />
          {cover.subtitle && (
            <h2 className="tracking-[0.3em] text-sheet-muted" style={{ fontSize: mm(6) }}>
              {cover.subtitle}
            </h2>
          )}
        </div>
        <div className="space-y-[2mm] text-sheet-muted" style={{ fontSize: mm(3.6) }}>
          {cover.scope && <p>{cover.scope}</p>}
          <p>{cover.semester}｜共 {count} 篇</p>
          <p className="text-sheet-ink tracking-[0.3em] pt-[4mm]" style={{ fontSize: mm(4) }}>
            聯合報 雲寫作教室
          </p>
          <p style={{ fontSize: mm(2.8) }}>列印於 {new Date().toLocaleDateString('zh-TW')}</p>
        </div>
      </div>
    </div>
  </section>
);

const TocSheet: React.FC<{
  rows: TocRow[]; index: number; total: number; entries: AnthologyEntry[];
}> = ({ rows, index, total, entries }) => (
  <section className="sheet">
    <Body>
      <div className="flex items-center justify-center" style={{ height: mm(SHEET.tocHeader) }}>
        <h2 className="font-bold tracking-[0.8em] pl-[0.8em]" style={{ fontSize: mm(8) }}>目錄</h2>
      </div>
      {rows.map((r, i) =>
        r.type === 'group' ? (
          <div
            key={i}
            className="flex items-end font-bold"
            style={{ height: mm(SHEET.tocRow), fontSize: mm(4.2) }}
          >
            {r.title && (
              <span className="border-b border-sheet-ink pb-[0.5mm]">{r.title}</span>
            )}
          </div>
        ) : (
          <div
            key={i}
            className="flex items-end gap-[2mm]"
            style={{ height: mm(SHEET.tocRow), fontSize: mm(3.6), paddingLeft: mm(5) }}
          >
            <span className="whitespace-nowrap overflow-hidden text-ellipsis">
              {entries[r.entryIndex].tocLabel}
            </span>
            <span className="flex-1 border-b border-dotted border-sheet-rule mb-[1.2mm]" />
            <span className="text-sheet-seal font-bold tabular-nums">{r.pageNo}</span>
          </div>
        ),
      )}
      <div
        className="mt-auto text-center text-sheet-muted tracking-[0.3em]"
        style={{ fontSize: mm(2.6) }}
      >
        目錄 {index + 1}／{total}
      </div>
    </Body>
  </section>
);

const Block: React.FC<{
  block: TextBlock; entry: AnthologyEntry; options: AnthologyOptions;
}> = ({ block, entry, options }) => {
  switch (block.type) {
    case 'workHeader':
      return (
        <header
          className="flex flex-col justify-end border-b border-sheet-ink"
          style={{ height: mm(SHEET.workHeader), paddingBottom: mm(3) }}
        >
          <div className="flex items-center justify-between text-sheet-muted" style={{ fontSize: mm(2.8) }}>
            <span className="flex items-center gap-[3mm]">
              <span className="border border-sheet-ink text-sheet-ink rounded-[1mm] px-[2mm] py-[0.5mm]">
                {entry.semester}
              </span>
              {/* 佳作印章。朱砂、略為傾斜 —— 像老師真的蓋上去的一顆章 */}
              {options.showFeatured && entry.featured && (
                <span
                  className="inline-flex items-center justify-center border-sheet-seal text-sheet-seal font-bold tracking-[0.15em] rounded-[0.8mm]"
                  style={{
                    borderWidth: mm(0.5), fontSize: mm(3.4), padding: `${mm(0.6)} ${mm(1.8)}`,
                    transform: 'rotate(-6deg)',
                  }}
                >
                  佳作
                </span>
              )}
            </span>
            <span>{dateText(entry.submittedAt)}</span>
          </div>
          <div className="flex items-end justify-between gap-[4mm] mt-[4mm]">
            <h1 className="font-bold leading-tight min-w-0" style={{ fontSize: mm(7) }}>
              {entry.title}
            </h1>
            <div className="flex items-center shrink-0 gap-[2.5mm]">
              <span className="bg-sheet-seal rounded-full" style={{ width: mm(0.8), height: mm(8) }} />
              <div className="text-right leading-snug">
                {entry.schoolName && (
                  <div className="text-sheet-muted" style={{ fontSize: mm(2.8) }}>{entry.schoolName}</div>
                )}
                <div className="font-bold" style={{ fontSize: mm(3.8) }}>{studentLine(entry)}</div>
              </div>
            </div>
          </div>
        </header>
      );
    case 'runningHeader':
      return (
        <div
          className="flex items-start justify-end text-sheet-muted border-b border-sheet-rule"
          style={{ height: mm(SHEET.runningHeader), fontSize: mm(2.8) }}
        >
          {entry.title}・{studentLine(entry)}（續）
        </div>
      );
    case 'essayLine':
      return (
        <div
          className="sheet-line border-b border-sheet-rule"
          style={{
            height: mm(SHEET.essayLine), lineHeight: mm(SHEET.essayLine),
            fontSize: mm(SHEET.essayFont),
          }}
        >
          {block.text}
        </div>
      );
    case 'commentHead': {
      const showScore = options.showScore && entry.score !== undefined;
      return (
        <div style={{ paddingTop: mm(SHEET.commentGap) }}>
          <div
            className="flex items-center justify-between bg-sheet-tint border-t-2 border-sheet-ink"
            style={{ height: mm(SHEET.commentHead), padding: `0 ${mm(6)}` }}
          >
            <span className="flex items-center gap-[2mm] font-bold tracking-[0.2em]" style={{ fontSize: mm(3.2) }}>
              <span className="bg-sheet-ink" style={{ width: mm(0.8), height: mm(4) }} />
              {options.showComment && entry.feedback ? '老師評語' : '評量'}
            </span>
            {showScore && (
              <span className="text-sheet-seal font-bold" style={{ fontSize: mm(7) }}>
                {entry.score}
                <span style={{ fontSize: mm(3.2) }}> 級分</span>
              </span>
            )}
          </div>
        </div>
      );
    }
    case 'commentLine':
      return (
        <div
          className={`sheet-line bg-sheet-tint ${block.heading ? 'font-bold' : 'text-sheet-muted'}`}
          style={{
            height: mm(SHEET.commentLine), lineHeight: mm(SHEET.commentLine),
            fontSize: mm(SHEET.commentFont), padding: `0 ${mm(6)}`,
          }}
        >
          {block.text}
        </div>
      );
  }
};

/**
 * 成果集本體：一頁一個 `.sheet`（210×297mm）。
 *
 * 畫面上是預覽、列印時就是成品 —— 同一份 DOM，列印樣式在 index.css。
 * 版面的數字全部來自 lib/anthology.ts 的 SHEET，這裡不另外寫死高度，
 * 否則畫出來的行高與排版時算的不同，一頁就會多出或少掉幾行。
 */
export const AnthologyBook: React.FC<AnthologyBookProps> = ({ pages, entries, options, cover }) => {
  const count = new Set(
    pages.flatMap((p) => (p.kind === 'text' || p.kind === 'image' ? [p.entryIndex] : [])),
  ).size;

  return (
    <>
      {pages.map((page) => {
        switch (page.kind) {
          case 'cover':
            return <CoverSheet key="cover" cover={cover} count={count} />;
          case 'toc':
            return (
              <TocSheet
                key={`toc-${page.index}`}
                rows={page.rows} index={page.index} total={page.total} entries={entries}
              />
            );
          case 'text': {
            const entry = entries[page.entryIndex];
            return (
              <section key={`t-${page.pageNo}`} className="sheet">
                <Body>
                  {page.blocks.map((b, i) => (
                    <Block key={i} block={b} entry={entry} options={options} />
                  ))}
                </Body>
                <Folio pageNo={page.pageNo} />
              </section>
            );
          }
          case 'image': {
            const entry = entries[page.entryIndex];
            return (
              <section key={`i-${page.pageNo}`} className="sheet">
                <Body>
                  <div className="flex items-baseline justify-between gap-[4mm] pb-[3mm]" style={{ fontSize: mm(3.2) }}>
                    <span className="font-bold min-w-0 truncate">
                      {entry.title}
                      <span className="text-sheet-seal ml-[2mm]" style={{ fontSize: mm(2.8) }}>
                        原稿{page.total > 1 ? ` ${page.index + 1}／${page.total}` : ''}
                      </span>
                    </span>
                    <span className="text-sheet-muted shrink-0">{studentLine(entry)}</span>
                  </div>
                  <div className="flex-1 min-h-0 flex items-center justify-center">
                    {/* 原稿不能被裁掉，一律等比例縮到放得下 */}
                    <img
                      src={page.url}
                      alt={`${entry.studentName}〈${entry.title}〉原稿`}
                      loading="eager"
                      className="max-w-full max-h-full object-contain"
                    />
                  </div>
                </Body>
                <Folio pageNo={page.pageNo} />
              </section>
            );
          }
        }
      })}
    </>
  );
};
