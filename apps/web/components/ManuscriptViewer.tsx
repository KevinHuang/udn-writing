import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ZoomIn, ZoomOut } from 'lucide-react';
import {
  CORRECT_CHAR_BOLD_RATIO, CORRECT_CHAR_FONT, NOTE_COLORS, ZOOM_LEVELS,
  columnRuns, correctLabelLayout, readingOrder, rightNeighborKey, sideX, splitCellKey, toCellBox, wavyPath,
  type CellBox, type ManuscriptData, type ManuscriptNote, type NoteKind,
} from '../lib/manuscript';
import {
  layoutVerticalText, sheetGradingHints, sheetTypoColumns,
  type GradingZone, type SheetGrading, type SheetTypos, type VerticalLayout,
} from '../lib/gradingZone';

/**
 * 原稿紅筆的左邊（docs/manuscript.md）：拉正的原稿，紅筆畫在學生的字上；
 * 可以切換「原稿／辨識文字」；多頁時一頁接一頁往下排（不用換頁）；點字加錯字，點編號跳到右邊的便條。
 *
 * 搬自 1Campus Write 的 hosting/components/ManuscriptViewer.tsx。
 * 稿紙是照片：底色和紅筆的顏色不跟著深色模式翻（lib/manuscript.ts NOTE_COLORS）。
 */

// 放大後按住拖曳：滑鼠移動超過這麼多像素才算拖曳，不然還是點擊（點字加錯字、點編號）
const DRAG_THRESHOLD = 4;
// 正確的字四周描的白邊，佔字大小的比例（蓋在格線、筆跡上也看得清楚）
const HALO_RATIO = 0.22;

/*
  正確的字的楷書：第一次打開原稿才載入字型宣告（@font-face），字型檔切成一百多塊，
  瀏覽器只下載畫面上用到的字。載入失敗時先用退回的字體。
*/
let fontRequested = false;
const loadHandwritingFont = () => {
  if (fontRequested || typeof document === 'undefined') return;
  fontRequested = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/fonts/tw-kai/tw-kai.css';
  link.onerror = () => { fontRequested = false; link.remove(); };
  document.head.appendChild(link);
};

interface ScrollBox { left: number; top: number; clientWidth: number; clientHeight: number; scrollWidth: number; scrollHeight: number }
const scrollBoxOf = (el: HTMLElement): ScrollBox => ({
  left: el.scrollLeft, top: el.scrollTop, clientWidth: el.clientWidth, clientHeight: el.clientHeight,
  scrollWidth: el.scrollWidth, scrollHeight: el.scrollHeight,
});
/** 換倍率時，畫面正中間看的那一點不動 */
const keepCenter = (before: ScrollBox, after: ScrollBox) => {
  const along = (pos: number, client: number, content: number, nc: number, ncontent: number) => {
    const center = content > 0 ? (pos + client / 2) / content : 0.5;
    return Math.min(Math.max(0, center * ncontent - nc / 2), Math.max(0, ncontent - nc));
  };
  return {
    left: along(before.left, before.clientWidth, before.scrollWidth, after.clientWidth, after.scrollWidth),
    top: along(before.top, before.clientHeight, before.scrollHeight, after.clientHeight, after.scrollHeight),
  };
};

interface LegendItem { key: string; label: string; kinds: NoteKind[]; mark: React.ReactNode }
const symbol = (t: string, kind: NoteKind) => (
  <span className="w-3 text-center font-bold leading-none" style={{ color: NOTE_COLORS[kind] }}>{t}</span>
);
const LEGEND: LegendItem[] = [
  { key: 'typo', label: '錯字', kinds: ['typo', 'teacherTypo', 'vetoedTypo'], mark: <span className="inline-block h-3 w-3 rounded-full border-2" style={{ borderColor: NOTE_COLORS.typo }} /> },
  { key: 'pending', label: '待確認（老師確認後才算）', kinds: ['pending'], mark: <span className="inline-block h-3 w-3 rounded-full border-2 border-dashed" style={{ borderColor: NOTE_COLORS.pending }} /> },
  { key: 'highlight', label: '寫得好的句子', kinds: ['highlight'], mark: symbol('⌇', 'highlight') },
  { key: 'circle', label: '密圈', kinds: ['circle'], mark: <span className="inline-block h-2 w-2 rounded-full border-2" style={{ borderColor: NOTE_COLORS.circle }} /> },
  { key: 'format', label: '格式提醒', kinds: ['format', 'vetoedFormat'], mark: symbol('┐', 'format') },
  { key: 'suggestion', label: '可以再加強', kinds: ['suggestion'], mark: symbol('┆', 'suggestion') },
];
// 稿紙上的批改區不是便條（沒有 kinds）：有這一區的稿紙才出現在圖例裡，一樣可以暫時隱藏（看照片上原本寫了什麼）
const ZONE_LEGEND: LegendItem = { key: 'zone', label: '稿紙上的批改區', kinds: [], mark: symbol('✓', 'typo') };

/** 直寫的小字（正確的字、移上行、空兩格）：一個字一個字往下排 */
const VerticalLabel: React.FC<{ x: number; y: number; text: string; size: number; color: string; handwritten?: boolean }> = ({
  x, y, text, size, color, handwritten = false,
}) => (
  <>
    {[...text].map((ch, i) => {
      const pos = { x, y: y + size * (i + 0.85), fontSize: size, fill: color, textAnchor: 'middle' as const };
      if (!handwritten) return <text key={`${ch}-${i}`} {...pos} fontWeight={700}>{ch}</text>;
      const font = { fontFamily: CORRECT_CHAR_FONT.family, fontWeight: CORRECT_CHAR_FONT.weight };
      return (
        <React.Fragment key={`${ch}-${i}`}>
          <text {...pos} {...font} stroke="#fff" strokeWidth={size * HALO_RATIO} strokeLinejoin="round" paintOrder="stroke">{ch}</text>
          <text {...pos} {...font} stroke={color} strokeWidth={size * CORRECT_CHAR_BOLD_RATIO} strokeLinejoin="round" aria-hidden="true">{ch}</text>
        </React.Fragment>
      );
    })}
  </>
);

/** 一個便條在原稿上的筆跡（不含編號）：顏色和右邊便條的編號一樣 */
const NoteMark: React.FC<{ note: ManuscriptNote; boxes: Map<string, CellBox>; template: string | null }> = ({ note, boxes, template }) => {
  const color = NOTE_COLORS[note.kind];
  const keyBoxes = note.keys.map((k) => boxes.get(k)).filter((b): b is CellBox => Boolean(b));
  if (keyBoxes.length === 0) return null;
  const unit = keyBoxes[0].w;
  const stroke = Math.max(unit * 0.05, 2);

  switch (note.kind) {
    case 'typo':
    case 'teacherTypo':
    case 'pending':
    case 'vetoedTypo': {
      const dashed = note.kind !== 'typo' && note.kind !== 'teacherTypo';
      const correct = note.typo?.correct ?? '';
      const neighbor = rightNeighborKey(keyBoxes[0].key);
      const label = correct ? correctLabelLayout(keyBoxes[0], neighbor ? boxes.get(neighbor) : undefined, template, correct) : null;
      return (
        <g>
          {keyBoxes.map((b) => (
            <circle key={b.key} cx={b.cx} cy={b.cy} r={Math.min(b.w, b.h) * 0.5} fill="none" stroke={color} strokeWidth={stroke}
              strokeDasharray={dashed ? `${stroke * 2.2} ${stroke * 1.6}` : undefined} />
          ))}
          {note.kind === 'pending' && (
            <text x={keyBoxes[0].x1} y={keyBoxes[0].y0 + unit * 0.22} fontSize={unit * 0.34} fill={color} fontWeight={700} textAnchor="middle">?</text>
          )}
          {(note.kind === 'typo' || note.kind === 'teacherTypo') && label && (
            <VerticalLabel x={label.x} y={label.y} text={correct} size={label.size} color={color} handwritten />
          )}
        </g>
      );
    }
    case 'format':
    case 'vetoedFormat': {
      const b = keyBoxes[0];
      const vetoed = note.kind === 'vetoedFormat';
      const indent = note.format?.type === '段首空兩格';
      const dash = vetoed ? `${stroke * 2} ${stroke * 1.5}` : undefined;
      return (
        <g>
          {indent ? (
            <polyline points={`${b.x0},${b.y0 + b.h * 0.45} ${b.x0},${b.y0} ${b.x1},${b.y0}`} fill="none" stroke={color} strokeWidth={stroke * 1.2} strokeDasharray={dash} />
          ) : (
            <rect x={b.x0} y={b.y0} width={b.w} height={b.h} fill="none" stroke={color} strokeWidth={stroke} strokeDasharray={dash} />
          )}
          {!vetoed && <VerticalLabel x={sideX(b, template, 0.3)} y={b.y0} text={indent ? '空兩格' : '移上行'} size={unit * 0.24} color={color} />}
        </g>
      );
    }
    case 'highlight':
      return (
        <g>
          {columnRuns(note.keys, boxes).map((run) => (
            <path key={run[0].key} d={wavyPath(run, sideX(run[0], template, 0.14), unit * 0.07)} fill="none" stroke={color} strokeWidth={stroke} />
          ))}
        </g>
      );
    case 'circle':
      return (
        <g>
          {keyBoxes.map((b) => (
            <circle key={b.key} cx={sideX(b, template, 0.13)} cy={b.cy} r={unit * 0.07} fill="none" stroke={color} strokeWidth={stroke * 0.8} />
          ))}
        </g>
      );
    case 'suggestion':
      return (
        <g>
          {columnRuns(note.keys, boxes).map((run) => {
            const x = template === 'gsat' ? run[0].x0 + unit * 0.08 : run[0].x0 - unit * 0.12;
            return (
              <line key={run[0].key} x1={x} y1={run[0].y0 + run[0].h * 0.1} x2={x} y2={run[run.length - 1].y1 - run[run.length - 1].h * 0.1}
                stroke={color} strokeWidth={stroke} strokeDasharray={`${stroke * 2} ${stroke * 1.6}`} />
            );
          })}
        </g>
      );
    default:
      return null;
  }
};

/** 錯字訂正欄裡正確的字的大小：佔格子寬的幾成（和原稿上錯字旁的字一樣大） */
const ZONE_TYPO_SCALE = 0.8;

/**
 * 稿紙上的批改區（聯合報國中稿紙第二頁左側，lib/gradingZone.ts）：錯字訂正欄寫正確的字、
 * 寫作能力分析打勾、老師評語直寫。都用紅筆的顏色和楷書，像老師親手填的；不擋下面的點擊。
 */
const GradingZoneMarks: React.FC<{
  id: string; zone: GradingZone; typos: SheetTypos; levels: Array<number | null>; comment: VerticalLayout;
}> = ({ id, zone, typos, levels, comment }) => {
  const color = NOTE_COLORS.typo;
  const [cx0, , cx1] = zone.typoColumns[0][0];
  const unit = cx1 - cx0;
  const kai = (size: number) => ({
    fontSize: size, fontFamily: CORRECT_CHAR_FONT.family, fontWeight: CORRECT_CHAR_FONT.weight, textAnchor: 'middle' as const,
    fill: color, stroke: color, strokeWidth: size * CORRECT_CHAR_BOLD_RATIO, strokeLinejoin: 'round' as const,
  });
  // 字的基線：字框正中間往下 0.35 個字（和 VerticalLabel 一樣）
  const baseline = (cy: number, size: number) => cy + size * 0.35;
  return (
    <g id={id} pointerEvents="none">
      {typos.columns.map((chars, ci) => chars.map((ch, ri) => {
        const [x0, y0, x1, y1] = zone.typoColumns[ci][ri];
        const size = (x1 - x0) * ZONE_TYPO_SCALE;
        return <text key={`typo-${ci}-${ri}`} x={(x0 + x1) / 2} y={baseline((y0 + y1) / 2, size)} {...kai(size)}>{ch}</text>;
      }))}
      {levels.map((level, di) => {
        if (level === null) return null;
        const [x0, y0, x1, y1] = zone.levelCells[di][level];
        const cx = (x0 + x1) / 2;
        const cy = (y0 + y1) / 2;
        return (
          <polyline
            key={`level-${di}`}
            points={`${cx - unit * 0.26},${cy + unit * 0.02} ${cx - unit * 0.08},${cy + unit * 0.22} ${cx + unit * 0.3},${cy - unit * 0.26}`}
            fill="none" stroke={color} strokeWidth={Math.max(unit * 0.06, 2)} strokeLinecap="round" strokeLinejoin="round"
          />
        );
      })}
      {comment.glyphs.map((g, i) => (
        <text
          key={`comment-${i}`}
          x={g.x}
          y={baseline(g.y, comment.size)}
          transform={g.rotate ? `rotate(90 ${g.x} ${g.y})` : undefined}
          {...kai(comment.size)}
        >
          {g.ch}
        </text>
      ))}
    </g>
  );
};

interface ManuscriptViewerProps {
  data: ManuscriptData;
  notes: ManuscriptNote[];
  selectedNoteId: string | null;
  onSelectNote: (noteId: string) => void;
  /** 老師點了一格沒有錯字標記的字（要加錯字） */
  selectedCellKey?: string | null;
  view: 'manuscript' | 'text';
  onViewChange: (view: 'manuscript' | 'text') => void;
  onCellClick?: (cellKey: string) => void;
  /** 「辨識文字」：原本左邊的樣子 */
  textView: React.ReactNode;
  /** 畫面上當下的批改內容：有批改區的稿紙（聯合報國中稿紙第二頁）直接填進去 */
  sheetGrading?: SheetGrading | null;
}

/** 選到的標記不在看得到的範圍時，捲到正中間；已經看得到就不動 */
const revealOutside = (element: Element, root: HTMLElement | null) => {
  if (typeof (element as HTMLElement).scrollIntoView !== 'function') return;
  let parent = root?.parentElement ?? null;
  while (parent && !/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) parent = parent.parentElement;
  const view = parent ? parent.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
  const rect = element.getBoundingClientRect();
  if (rect.top >= view.top && rect.bottom <= view.bottom) return;
  element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
};

export const ManuscriptViewer: React.FC<ManuscriptViewerProps> = ({
  data, notes, selectedNoteId, onSelectNote, selectedCellKey = null, view, onViewChange, onCellClick, textView, sheetGrading = null,
}) => {
  const idPrefix = 'gradingeditor-manuscript';
  const multiPage = data.pages.length > 1;
  // 學生的照片有幾頁（補上的空白稿紙不算）
  const photoPages = data.pages.filter((p) => !p.blank).length;
  const rootRef = useRef<HTMLDivElement | null>(null);
  // 每頁圖的實際大小（格子位置是圖上的像素），用圖的網址記
  const [loaded, setLoaded] = useState<Record<string, { width: number; height: number }>>({});
  const [failed, setFailed] = useState<Record<string, true>>({});
  const selectedRef = useRef<SVGRectElement | null>(null);
  const viewportRefs = useRef(new Map<number, HTMLDivElement>());
  const [zoomIndex, setZoomIndex] = useState(0);
  const zoomFromRef = useRef<Map<number, ScrollBox> | null>(null);
  const dragRef = useRef<{ page: number; pointerId: number; x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const [draggingPage, setDraggingPage] = useState<number | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);
  const [hiddenLegend, setHiddenLegend] = useState<Set<string>>(() => new Set());
  const zoom = ZOOM_LEVELS[zoomIndex];
  const zoomed = zoomIndex > 0;

  const pageViews = useMemo(() => data.pages.map((page) => ({
    page,
    boxes: new Map(page.cells.map((c) => [c.key, toCellBox(c)])),
    notes: notes.filter((n) => n.keys.some((k) => splitCellKey(k).prefix === page.prefix)),
  })), [data.pages, notes]);

  const selectedNote = notes.find((n) => n.id === selectedNoteId) ?? null;
  const notePagePrefix = selectedNote?.anchorKey ? splitCellKey(selectedNote.anchorKey).prefix : null;
  const cellPagePrefix = !notePagePrefix && selectedCellKey ? splitCellKey(selectedCellKey).prefix : null;

  useEffect(loadHandwritingFont, []);

  // 選到標記：不換頁、不改倍率；放大時那一頁的框先捲到標記在正中間，再把原稿捲到看得見
  useEffect(() => {
    const el = selectedRef.current;
    if (!el) return;
    const frame = el.closest<HTMLElement>('[data-manuscript-viewport]');
    if (frame) {
      const r = frame.getBoundingClientRect();
      const t = el.getBoundingClientRect();
      const along = (s: number, size: number, vs: number, vsize: number) =>
        s >= vs && s + size <= vs + vsize ? 0 : s + size / 2 - (vs + vsize / 2);
      frame.scrollLeft += along(t.left, t.width, r.left + frame.clientLeft, frame.clientWidth);
      frame.scrollTop += along(t.top, t.height, r.top + frame.clientTop, frame.clientHeight);
    }
    revealOutside(el, rootRef.current);
  }, [selectedNoteId, selectedCellKey, loaded]);

  useLayoutEffect(() => {
    const before = zoomFromRef.current;
    zoomFromRef.current = null;
    if (!before) return;
    before.forEach((box, page) => {
      const vp = viewportRefs.current.get(page);
      if (!vp) return;
      const next = keepCenter(box, scrollBoxOf(vp));
      vp.scrollLeft = next.left;
      vp.scrollTop = next.top;
    });
  }, [zoomIndex]);

  const changeZoom = (next: number) => {
    const target = Math.min(ZOOM_LEVELS.length - 1, Math.max(0, next));
    if (target === zoomIndex) return;
    zoomFromRef.current = new Map([...viewportRefs.current].map(([p, vp]) => [p, scrollBoxOf(vp)]));
    setZoomIndex(target);
  };

  const onPointerDown = (page: number, e: React.PointerEvent<HTMLDivElement>) => {
    suppressClickRef.current = false;
    const vp = viewportRefs.current.get(page);
    // 觸控（平板、手機）用手指直接捲動
    if (!zoomed || !vp || e.button !== 0 || e.pointerType === 'touch') return;
    dragRef.current = { page, pointerId: e.pointerId, x: e.clientX, y: e.clientY, left: vp.scrollLeft, top: vp.scrollTop, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    const vp = d ? viewportRefs.current.get(d.page) : undefined;
    if (!d || !vp || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved) {
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      d.moved = true;
      setDraggingPage(d.page);
      vp.setPointerCapture?.(e.pointerId);
    }
    vp.scrollLeft = d.left - dx;
    vp.scrollTop = d.top - dy;
  };
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (!d.moved) return;
    suppressClickRef.current = true;
    setDraggingPage(null);
    const vp = viewportRefs.current.get(d.page);
    if (vp?.hasPointerCapture?.(e.pointerId)) vp.releasePointerCapture(e.pointerId);
  };
  // 拖曳放開時瀏覽器還會送出一次點擊：攔下來，不要變成點字或點編號
  const onClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!suppressClickRef.current) return;
    suppressClickRef.current = false;
    e.stopPropagation();
    e.preventDefault();
  };

  const hasZone = Boolean(sheetGrading) && data.pages.some((p) => p.gradingZone);
  const legend = hasZone ? [...LEGEND, ZONE_LEGEND] : LEGEND;
  const hiddenKinds = new Set(legend.filter((l) => hiddenLegend.has(l.key)).flatMap((l) => l.kinds));
  const hiddenCount = legend.filter((l) => hiddenLegend.has(l.key)).length;
  const cellOrder = useMemo(() => readingOrder(data.pages.map((p) => p.prefix)), [data.pages]);
  const toggleLegend = (key: string) => setHiddenLegend((cur) => {
    const next = new Set(cur);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const iconButton = 'rounded-lg border border-border-strong bg-card p-1.5 text-text-secondary hover:text-primary disabled:opacity-40';

  const renderPage = ({ page, boxes, notes: pageNotes }: (typeof pageViews)[number], index: number) => {
    const number = index + 1;
    const size = page.imageUrl ? loaded[page.imageUrl] : undefined;
    const imageFailed = Boolean(page.imageUrl && failed[page.imageUrl]);
    const shown = pageNotes.filter((n) => !hiddenKinds.has(n.kind));
    const selectedRuns = selectedNote ? columnRuns(selectedNote.keys, boxes) : [];
    const selectedCell = selectedCellKey ? boxes.get(selectedCellKey) : undefined;
    const dragging = draggingPage === index;
    const zone = sheetGrading && !hiddenLegend.has(ZONE_LEGEND.key) ? page.gradingZone : null;
    const zoneTypos = zone && sheetGrading ? sheetTypoColumns(sheetGrading.typos, cellOrder, zone) : null;
    const zoneComment = zone && sheetGrading
      ? layoutVerticalText(sheetGrading.comment, zone.commentBox, zone.typoColumns[0][0][2] - zone.typoColumns[0][0][0])
      : null;
    const zoneHints = zoneTypos && zoneComment ? sheetGradingHints(zoneTypos, zoneComment) : [];
    // 補上的空白稿紙只為了放批改區：批改區在圖例裡被隱藏時，整頁不出現（空白稿紙沒有東西可以看）
    if (page.blank && !zone) return null;
    return (
      <section key={page.prefix} id={`${idPrefix}-page-${number}`} className="space-y-1.5">
        {multiPage && (
          <p className="pl-0.5 text-caption text-text-secondary">
            {page.blank ? '批改區（這份作文沒有第二頁的照片，放在空白稿紙的第二頁上）' : `第 ${number} 頁`}
          </p>
        )}
        {/* 只用來讀圖的實際大小；畫面上的原稿和紅筆一起畫在下面的 SVG 裡 */}
        {page.imageUrl && !imageFailed && (
          <img
            src={page.imageUrl}
            alt=""
            className="hidden"
            onLoad={(e) => {
              const { naturalWidth: width, naturalHeight: height } = e.currentTarget;
              setLoaded((cur) => ({ ...cur, [page.imageUrl as string]: { width, height } }));
            }}
            onError={() => setFailed((cur) => ({ ...cur, [page.imageUrl as string]: true }))}
          />
        )}
        <div className="w-full overflow-hidden rounded-sm bg-sheet-paper shadow-paper">
          {!page.imageUrl || imageFailed ? (
            <p className="p-8 text-center text-caption text-text-secondary">
              {page.blank ? '空白稿紙的底圖讀不到，批改區暫時沒辦法顯示。' : '這一頁的原稿圖讀不到，可以改看「辨識文字」或上方的原始照片。'}
            </p>
          ) : (
            !size && <p className="p-8 text-center text-caption text-text-secondary">原稿載入中…</p>
          )}
          {size && (
            <div
              id={`${idPrefix}-viewport-${number}`}
              data-manuscript-viewport=""
              ref={(el) => { if (el) viewportRefs.current.set(index, el); else viewportRefs.current.delete(index); }}
              className={`w-full ${zoomed ? `overflow-auto ${dragging ? 'cursor-grabbing select-none' : 'cursor-grab'}` : 'overflow-hidden'}`}
              style={{ aspectRatio: `${size.width} / ${size.height}` }}
              onPointerDown={(e) => onPointerDown(index, e)}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onClickCapture={onClickCapture}
            >
              <svg
                id={`${idPrefix}-overlay-${number}`}
                className="block select-none"
                style={{ width: `${zoom * 100}%`, aspectRatio: `${size.width} / ${size.height}` }}
                viewBox={`0 0 ${size.width} ${size.height}`}
                role="img"
                aria-label={page.blank ? '空白稿紙第二頁上的批改區' : `拉正的原稿第 ${number} 頁與紅筆標記`}
              >
                <image href={page.imageUrl as string} x={0} y={0} width={size.width} height={size.height} preserveAspectRatio="none" />
                {selectedRuns.map((run, ri) => (
                  <rect
                    key={`${run[0].key}|${selectedNoteId}`}
                    ref={ri === 0 && page.prefix === notePagePrefix ? selectedRef : undefined}
                    className="motion-safe:animate-manuscript-flash"
                    x={run[0].x0 - run[0].w * 0.12}
                    y={run[0].y0 - run[0].h * 0.06}
                    width={run[0].w * 1.24}
                    height={run[run.length - 1].y1 - run[0].y0 + run[0].h * 0.12}
                    rx={run[0].w * 0.12}
                    fill="rgba(30, 41, 59, 0.10)"
                    stroke="rgba(30, 41, 59, 0.55)"
                    strokeWidth={Math.max(run[0].w * 0.03, 2)}
                  />
                ))}
                {selectedCell && (
                  <rect
                    ref={page.prefix === cellPagePrefix ? selectedRef : undefined}
                    x={selectedCell.x0} y={selectedCell.y0} width={selectedCell.w} height={selectedCell.h}
                    fill="rgba(37, 99, 235, 0.12)" stroke="#2563eb" strokeWidth={Math.max(selectedCell.w * 0.04, 2)}
                  />
                )}
                {shown.map((n) => <NoteMark key={n.id} note={n} boxes={boxes} template={data.template} />)}
                {zone && sheetGrading && zoneTypos && zoneComment && (
                  <GradingZoneMarks id={`${idPrefix}-zone-${number}`} zone={zone} typos={zoneTypos} levels={sheetGrading.levels} comment={zoneComment} />
                )}
                {onCellClick && page.cells.map((c) => {
                  const b = boxes.get(c.key) as CellBox;
                  return (
                    <rect key={c.key} data-cell={c.key} x={b.x0} y={b.y0} width={b.w} height={b.h} fill="transparent"
                      className="cursor-pointer" onClick={() => onCellClick(c.key)}>
                      <title>{c.text}</title>
                    </rect>
                  );
                })}
                {shown.map((n) => {
                  const anchor = n.anchorKey ? boxes.get(n.anchorKey) : undefined;
                  if (!anchor || n.number === null) return null;
                  const r = anchor.w * 0.2;
                  return (
                    <g key={`number-${n.id}`} id={`${idPrefix}-number-${n.number}`} className="cursor-pointer" onClick={() => onSelectNote(n.id)}>
                      <circle cx={anchor.x0} cy={anchor.y0 + r * 0.3} r={r} fill={NOTE_COLORS[n.kind]} />
                      <text x={anchor.x0} y={anchor.y0 + r * 0.3 + r * 0.42} fontSize={r * 1.2} fill="#fff" fontWeight={700} textAnchor="middle">{n.number}</text>
                    </g>
                  );
                })}
              </svg>
            </div>
          )}
        </div>
        {zoneHints.map((hint) => (
          <p key={hint} className="pl-0.5 text-caption text-text-secondary">{hint}</p>
        ))}
      </section>
    );
  };

  return (
    <div id={idPrefix} ref={rootRef} className="w-full space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" className="inline-flex rounded-xl border border-border-strong bg-card p-0.5 text-caption">
          {([['manuscript', '原稿'], ['text', '辨識文字']] as const).map(([value, label]) => (
            <button
              key={value}
              id={`${idPrefix}-view-${value}`}
              type="button"
              role="tab"
              aria-selected={view === value}
              onClick={() => onViewChange(value)}
              className={`rounded-lg px-3 py-1.5 transition-colors ${view === value ? 'bg-primary text-on-accent' : 'text-text-secondary hover:text-primary'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {view === 'manuscript' && (
          <button
            id={`${idPrefix}-legend-toggle`}
            type="button"
            aria-expanded={legendOpen}
            onClick={() => setLegendOpen((v) => !v)}
            className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-caption transition-colors ${
              hiddenCount > 0 ? 'border-warning-300 bg-warning-100 text-warning-800' : 'border-border-strong bg-card text-text-secondary hover:text-primary'
            }`}
          >
            {hiddenCount > 0 ? `圖例（隱藏 ${hiddenCount} 類）` : '圖例'}
            <ChevronDown size={14} className={`transition-transform ${legendOpen ? 'rotate-180' : ''}`} />
          </button>
        )}
        {view === 'manuscript' && data.locked && (
          <span className="text-caption text-text-secondary">已發還，只能看；要改請先收回發還。</span>
        )}
        {view === 'manuscript' && (
          <div className="ml-auto flex items-center gap-2">
            {multiPage && (
              <span className="text-caption text-text-secondary">
                {photoPages < data.pages.length ? `共 ${photoPages} 頁，批改區在最下面` : `共 ${data.pages.length} 頁，往下捲`}
              </span>
            )}
            {zoomed && <span className="text-caption text-text-secondary">按住原稿可以拖曳</span>}
            <div className="inline-flex items-center gap-1 text-caption text-text-secondary">
              <button id={`${idPrefix}-zoom-out`} type="button" aria-label="縮小原稿" disabled={zoomIndex === 0} onClick={() => changeZoom(zoomIndex - 1)} className={iconButton}>
                <ZoomOut size={14} />
              </button>
              <span className="w-10 text-center">{Math.round(zoom * 100)}%</span>
              <button id={`${idPrefix}-zoom-in`} type="button" aria-label="放大原稿" disabled={zoomIndex === ZOOM_LEVELS.length - 1} onClick={() => changeZoom(zoomIndex + 1)} className={iconButton}>
                <ZoomIn size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {view === 'text' ? textView : (
        <>
          {legendOpen && (
            <div id={`${idPrefix}-legend`} className="space-y-2 rounded-xl border border-border-card bg-card px-3 py-2.5 text-caption text-text-primary">
              <ul className="flex flex-wrap gap-2">
                {legend.map((item) => {
                  const hidden = hiddenLegend.has(item.key);
                  return (
                    <li key={item.key}>
                      <button
                        type="button"
                        aria-pressed={!hidden}
                        title={hidden ? '再按一次顯示' : '按一下暫時隱藏這一類'}
                        onClick={() => toggleLegend(item.key)}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 transition-colors ${
                          hidden ? 'border-dashed border-border bg-surface-soft text-text-muted line-through' : 'border-border bg-card hover:border-primary/40'
                        }`}
                      >
                        {item.mark}{item.label}
                      </button>
                    </li>
                  );
                })}
                {hiddenCount > 0 && (
                  <li>
                    <button type="button" onClick={() => setHiddenLegend(new Set())} className="rounded-lg px-2.5 py-1 text-primary hover:bg-primary/5">全部顯示</button>
                  </li>
                )}
              </ul>
              <p className="text-text-secondary">
                按一下圖例可以暫時隱藏那一類標記，再按一次顯示。{!data.locked && ' 點原稿上的字，可以自己加錯字。'}
              </p>
            </div>
          )}
          <div className="space-y-4">{pageViews.map(renderPage)}</div>
        </>
      )}
    </div>
  );
};
