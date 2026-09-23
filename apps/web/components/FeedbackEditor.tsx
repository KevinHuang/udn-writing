import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { TableKit } from '@tiptap/extension-table';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { marked } from 'marked';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { HighlightMark, TextColorMark } from './editorMarks';
import {
  HIGHLIGHT_COLORS, TEXT_COLORS,
  type HighlightColor, type TextColor,
} from '../lib/feedbackMarks';
import {
  Bold, Italic, Strikethrough, Heading2, Heading3, List, ListOrdered, ListChecks,
  Quote, Minus, Link as LinkIcon, RemoveFormatting, Undo2, Redo2, Code2,
  Table as TableIcon, IndentIncrease, IndentDecrease, Rows3, Columns3, Trash2,
  Highlighter, Palette, Ban,
} from 'lucide-react';

interface FeedbackEditorProps {
  id?: string;
  /** 評語的 markdown。資料庫存的就是這個格式 */
  value: string;
  onChange: (markdown: string) => void;
  /** 已發還之類的情況只給看 */
  readOnly?: boolean;
}

/**
 * markdown ⇄ HTML。
 *
 * **資料庫存的一律是 markdown**：AI 批改產出 markdown，學生端與預覽都用
 * components/Markdown.tsx（react-markdown）渲染。所見即所得只是編輯時的皮，
 * 進來先轉成 HTML 給編輯器，出去再轉回 markdown，格式不換。
 */
const turndown = new TurndownService({
  headingStyle: 'atx',        // ## 標題，與 AI 產出的一致
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
  hr: '---',
});
/*
  表格、刪除線、待辦清單是 GFM 的語法，turndown 預設不認得 ——
  沒有這個外掛，老師插入的表格存檔後會變成一串沒有格線的文字。
*/
turndown.use(gfm);
/*
  標色要原樣留成 HTML —— markdown 沒有螢光筆語法，turndown 預設會把標籤
  拆掉只留文字，老師標的顏色存檔就消失了。學生端由白名單過濾（見 Markdown.tsx）。
*/
turndown.addRule('feedbackMarks', {
  filter: (node) => {
    const el = node as HTMLElement;
    const cls = el.getAttribute?.('class') ?? '';
    return (
      (el.nodeName === 'MARK' && cls.includes('hl-')) ||
      (el.nodeName === 'SPAN' && cls.includes('tx-'))
    );
  },
  replacement: (content, node) => {
    const el = node as HTMLElement;
    const tag = el.nodeName.toLowerCase();
    const cls = (el.getAttribute('class') ?? '').trim();
    return content ? `<${tag} class="${cls}">${content}</${tag}>` : '';
  },
});
// 待辦清單：<li> 裡的核取方塊要寫成 GFM 的 - [ ] / - [x]
turndown.addRule('taskListItem', {
  filter: (node) =>
    node.nodeName === 'LI' && (node as HTMLElement).getAttribute('data-checked') !== null,
  replacement: (content, node) => {
    const checked = (node as HTMLElement).getAttribute('data-checked') === 'true';
    // 第二行以後要縮排兩格，否則會被當成新的一項
    const text = content.trimStart().split('\n').join('\n  ');
    return `- [${checked ? 'x' : ' '}] ${text}\n`;
  },
});

const toHtml = (markdown: string): string =>
  markdown ? (marked.parse(markdown, { async: false, gfm: true, breaks: false }) as string) : '';

/**
 * 送進 turndown 之前先把編輯器加的雜訊拿掉。
 *
 * TipTap 每個儲存格都會寫上 colspan="1" rowspan="1"，而 turndown 的 GFM 外掛
 * 看到 colspan／rowspan 就認定是合併儲存格、markdown 表達不了，於是整張表
 * 原封不動留成 HTML（實測存出來就是一堆 <table> 標籤）。欄寬的 <colgroup>
 * 也一樣沒有 markdown 對應。
 */
const stripEditorNoise = (html: string): string =>
  html
    .replace(/ (?:colspan|rowspan)="1"/g, '')
    .replace(/<colgroup>[\s\S]*?<\/colgroup>/g, '')
    .replace(/ colwidth="[^"]*"/g, '');

const toMarkdown = (html: string): string => {
  // 編輯器空的時候是 <p></p>，轉回去會變成一個孤零零的換行
  const text = stripEditorNoise(html).replace(/<p>\s*<\/p>/g, '').trim();
  return text ? turndown.turndown(text).trim() : '';
};

/** 工具列按鈕。isOn 會把圖示標成主色，老師才知道游標所在的段落是什麼格式 */
const ToolButton: React.FC<{
  id: string;
  title: string;
  onClick: () => void;
  isOn?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}> = ({ id, title, onClick, isOn = false, disabled = false, children }) => (
  <button
    id={id}
    type="button"
    title={title}
    aria-label={title}
    aria-pressed={isOn}
    disabled={disabled}
    onMouseDown={(e) => e.preventDefault()}  // 不要把游標從編輯器搶走，否則選取會消失
    onClick={onClick}
    className={`p-1.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
      isOn ? 'bg-primary/10 text-primary' : 'text-text-secondary hover:bg-surface-soft hover:text-text-primary'
    }`}
  >
    {children}
  </button>
);

const Divider = () => <span className="w-px h-5 bg-border shrink-0" aria-hidden="true" />;

/**
 * 色盤：點圖示展開幾個色塊，選了就套用、再點一次「無」清掉。
 * 色塊直接吃 index.css 的 --hl-* / --tx-* 變數，碑拓模式跟著換。
 */
const ColorPalette: React.FC<{
  id: string;
  title: string;
  icon: React.ReactNode;
  isOn: boolean;
  colors: { value: string; label: string }[];
  /** 色塊要畫成底色（螢光筆）還是文字色 */
  swatch: (value: string) => React.CSSProperties;
  onPick: (value: string) => void;
  onClear: () => void;
}> = ({ id, title, icon, isOn, colors, swatch, onPick, onClear }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (ev: MouseEvent) => {
      if (!ref.current?.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <ToolButton id={id} title={title} isOn={isOn || open} onClick={() => setOpen(!open)}>
        {icon}
      </ToolButton>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-30 flex items-center gap-1 p-1.5 rounded-xl bg-card border border-border shadow-xl animate-pop-in">
          {colors.map((c) => (
            <button
              key={c.value}
              id={`${id}-${c.value}`}
              type="button"
              title={c.label}
              aria-label={c.label}
              onMouseDown={(ev) => ev.preventDefault()}
              onClick={() => { onPick(c.value); setOpen(false); }}
              className="w-6 h-6 rounded-md border border-border-strong hover:scale-110 transition-transform flex items-center justify-center text-caption font-bold"
              style={swatch(c.value)}
            >
              {swatch(c.value).color ? '甲' : ''}
            </button>
          ))}
          <span className="w-px h-5 bg-border" aria-hidden="true" />
          <button
            id={`${id}-none`}
            type="button"
            title="清除標色"
            aria-label="清除標色"
            onMouseDown={(ev) => ev.preventDefault()}
            onClick={() => { onClear(); setOpen(false); }}
            className="w-6 h-6 rounded-md text-text-secondary hover:bg-surface-soft flex items-center justify-center"
          >
            <Ban size={14} />
          </button>
        </div>
      )}
    </div>
  );
};

/**
 * 評語編輯器：所見即所得（TipTap），存回去仍是 markdown。
 *
 * 先前是一個等寬字的 textarea，老師要自己寫 `###` 與 `**`——
 * AI 產的評語本來就有標題與條列，在原始碼裡改很容易破壞結構。
 *
 * 右上角保留「原始碼」切換：萬一轉換把 AI 的排版弄亂，老師有地方救回來，
 * 也方便整段貼上別處寫好的 markdown。
 */
export const FeedbackEditor: React.FC<FeedbackEditorProps> = ({
  id = 'feedback-editor',
  value,
  onChange,
  readOnly = false,
}) => {
  const [mode, setMode] = useState<'rich' | 'source'>('rich');
  /**
   * 最後一次「由這個元件送出去」的 markdown。
   *
   * 沒有它會打架：每打一個字就 onChange → 父層 setState → value 變 →
   * 把內容再塞回編輯器一次，游標會跳到最前面。
   */
  const lastEmitted = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * 內容載入編輯器之後的樣子（由編輯器自己轉回來的 markdown）。
   *
   * 編輯器會把內容正規化（`- ` 變成 `-   `、行首的 `==` 被跳脫…），
   * 那會觸發一次 onUpdate —— 老師什麼都還沒做，評語就被標成「教師修改」、
   * 存檔鈕也亮起來（實測如此）。
   *
   * 比對的基準一定要**也是編輯器產出的**：拿 marked 轉出來的 HTML 去比會對不上，
   * 因為兩邊的 HTML 本來就長得不一樣。
   */
  const baseline = useRef('');

  const emit = useCallback(
    (markdown: string) => {
      lastEmitted.current = markdown;
      onChange(markdown);
    },
    [onChange],
  );

  const editor = useEditor({
    editable: !readOnly,
    // StrictMode 會把元件掛載兩次，第一次的 editor 馬上被銷毀 ——
    // 先不要在 render 當下就建 view，否則銷毀後的 effect 會踩到空的 editor
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },   // 評語只需要兩層標題
      }),
      Link.configure({ openOnClick: false, autolink: true }),
      // 表格：老師常用來列「向度 × 評語」的對照
      TableKit.configure({ table: { resizable: true } }),
      // 待辦清單：給學生的改進項目，可以打勾
      TaskList,
      TaskItem.configure({ nested: true }),
      // 螢光筆與文字顏色（見 components/editorMarks.ts）
      HighlightMark,
      TextColorMark,
    ],
    content: toHtml(value),
    onCreate: ({ editor: e }) => { baseline.current = toMarkdown(e.getHTML()); },
    editorProps: {
      attributes: {
        id,
        class: 'prose prose-ink max-w-none min-h-[240px] px-5 py-4 focus:outline-none',
      },
    },
    onUpdate: ({ editor: e }) => {
      // 每個字都往上送會讓父層整頁重畫，打字會頓
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (e.isDestroyed) return;   // 換學生／離開頁面時剛好倒數結束
        const next = toMarkdown(e.getHTML());
        if (next === baseline.current) return;   // 只是載入時的正規化，不是老師改的
        baseline.current = next;
        emit(next);
      }, 300);
    },
  });

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // 外面換了一份評語（換學生、重新 AI 批改）才重塞內容
  useEffect(() => {
    if (!editor || editor.isDestroyed || value === lastEmitted.current) return;
    lastEmitted.current = value;
    editor.commands.setContent(toHtml(value), { emitUpdate: false });
    baseline.current = toMarkdown(editor.getHTML());
  }, [value, editor]);

  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);

  // 從「原始碼」切回排版：上面那個 effect 認得的是 value 變了，
  // 但原始碼模式的修改是自己送出去的（lastEmitted 已經同步），所以要在這裡補塞一次
  useEffect(() => {
    if (mode !== 'rich' || !editor || editor.isDestroyed) return;
    lastEmitted.current = value;
    editor.commands.setContent(toHtml(value), { emitUpdate: false });
    baseline.current = toMarkdown(editor.getHTML());
    // 只在切換模式時做；value 的變化交給上面那個 effect
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const addLink = useCallback(() => {
    if (!editor) return;
    const previous = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('連結網址', previous ?? 'https://');
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }, [editor]);

  const toolbar = useMemo(() => {
    if (!editor) return null;
    const e: Editor = editor;
    return (
      <>
        <ToolButton id={`${id}-btn-undo`} title="復原" onClick={() => e.chain().focus().undo().run()} disabled={!e.can().undo()}>
          <Undo2 size={16} />
        </ToolButton>
        <ToolButton id={`${id}-btn-redo`} title="重做" onClick={() => e.chain().focus().redo().run()} disabled={!e.can().redo()}>
          <Redo2 size={16} />
        </ToolButton>
        <Divider />
        <ToolButton id={`${id}-btn-bold`} title="粗體" isOn={e.isActive('bold')} onClick={() => e.chain().focus().toggleBold().run()}>
          <Bold size={16} />
        </ToolButton>
        <ToolButton id={`${id}-btn-italic`} title="斜體" isOn={e.isActive('italic')} onClick={() => e.chain().focus().toggleItalic().run()}>
          <Italic size={16} />
        </ToolButton>
        <ToolButton id={`${id}-btn-strike`} title="刪除線" isOn={e.isActive('strike')} onClick={() => e.chain().focus().toggleStrike().run()}>
          <Strikethrough size={16} />
        </ToolButton>
        <ColorPalette
          id={`${id}-btn-highlight`}
          title="螢光筆"
          icon={<Highlighter size={16} />}
          isOn={e.isActive('highlightColor')}
          colors={HIGHLIGHT_COLORS}
          swatch={(v) => ({ backgroundColor: `var(--hl-${v})` })}
          onPick={(v) => e.chain().focus().setHighlightColor(v as HighlightColor).run()}
          onClear={() => e.chain().focus().unsetHighlightColor().run()}
        />
        <ColorPalette
          id={`${id}-btn-textcolor`}
          title="文字顏色"
          icon={<Palette size={16} />}
          isOn={e.isActive('textColor')}
          colors={TEXT_COLORS}
          swatch={(v) => ({ color: `var(--tx-${v})`, backgroundColor: 'var(--color-card)' })}
          onPick={(v) => e.chain().focus().setTextColor(v as TextColor).run()}
          onClear={() => e.chain().focus().unsetTextColor().run()}
        />
        <Divider />
        <ToolButton id={`${id}-btn-h2`} title="大標題" isOn={e.isActive('heading', { level: 2 })} onClick={() => e.chain().focus().toggleHeading({ level: 2 }).run()}>
          <Heading2 size={16} />
        </ToolButton>
        <ToolButton id={`${id}-btn-h3`} title="小標題" isOn={e.isActive('heading', { level: 3 })} onClick={() => e.chain().focus().toggleHeading({ level: 3 }).run()}>
          <Heading3 size={16} />
        </ToolButton>
        <Divider />
        <ToolButton id={`${id}-btn-bullet`} title="項目清單" isOn={e.isActive('bulletList')} onClick={() => e.chain().focus().toggleBulletList().run()}>
          <List size={16} />
        </ToolButton>
        <ToolButton id={`${id}-btn-ordered`} title="編號清單" isOn={e.isActive('orderedList')} onClick={() => e.chain().focus().toggleOrderedList().run()}>
          <ListOrdered size={16} />
        </ToolButton>
        <ToolButton id={`${id}-btn-task`} title="待辦清單（學生可打勾）" isOn={e.isActive('taskList')} onClick={() => e.chain().focus().toggleTaskList().run()}>
          <ListChecks size={16} />
        </ToolButton>
        <ToolButton id={`${id}-btn-indent`} title="清單降一層" disabled={!e.can().sinkListItem('listItem') && !e.can().sinkListItem('taskItem')}
          onClick={() => e.chain().focus().sinkListItem(e.isActive('taskItem') ? 'taskItem' : 'listItem').run()}>
          <IndentIncrease size={16} />
        </ToolButton>
        <ToolButton id={`${id}-btn-outdent`} title="清單升一層" disabled={!e.can().liftListItem('listItem') && !e.can().liftListItem('taskItem')}
          onClick={() => e.chain().focus().liftListItem(e.isActive('taskItem') ? 'taskItem' : 'listItem').run()}>
          <IndentDecrease size={16} />
        </ToolButton>
        <ToolButton id={`${id}-btn-quote`} title="引言" isOn={e.isActive('blockquote')} onClick={() => e.chain().focus().toggleBlockquote().run()}>
          <Quote size={16} />
        </ToolButton>
        <Divider />
        <ToolButton id={`${id}-btn-link`} title="連結" isOn={e.isActive('link')} onClick={addLink}>
          <LinkIcon size={16} />
        </ToolButton>
        <ToolButton id={`${id}-btn-hr`} title="分隔線" onClick={() => e.chain().focus().setHorizontalRule().run()}>
          <Minus size={16} />
        </ToolButton>
        <ToolButton id={`${id}-btn-table`} title="插入表格（3×3）" isOn={e.isActive('table')}
          onClick={() => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
          <TableIcon size={16} />
        </ToolButton>
        {/* 游標在表格裡才需要這幾顆，平常不要佔位置 */}
        {e.isActive('table') && (
          <>
            <ToolButton id={`${id}-btn-table-row`} title="下方插入一列" onClick={() => e.chain().focus().addRowAfter().run()}>
              <Rows3 size={16} />
            </ToolButton>
            <ToolButton id={`${id}-btn-table-col`} title="右方插入一欄" onClick={() => e.chain().focus().addColumnAfter().run()}>
              <Columns3 size={16} />
            </ToolButton>
            <ToolButton id={`${id}-btn-table-delete`} title="刪除表格" onClick={() => e.chain().focus().deleteTable().run()}>
              <Trash2 size={16} />
            </ToolButton>
          </>
        )}
        <ToolButton id={`${id}-btn-clear`} title="清除格式" onClick={() => e.chain().focus().unsetAllMarks().clearNodes().run()}>
          <RemoveFormatting size={16} />
        </ToolButton>
      </>
    );
  }, [editor, addLink, id]);

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm">
      {/*
        工具列釘在捲動區的最上面 —— 評語很長，老師捲到下半段要改格式時
        工具列已經捲不見了（使用者回報）。
        ⚠️ 外框不能有 overflow-hidden，那會讓 sticky 失效。
      */}
      <div className="sticky top-0 z-20 flex items-center gap-0.5 flex-wrap px-2 py-1.5 border-b border-border bg-surface-soft rounded-t-2xl">
        {mode === 'rich' ? toolbar : (
          <span className="px-2 text-caption text-text-secondary">Markdown 原始碼</span>
        )}
        <button
          id={`${id}-btn-source`}
          type="button"
          title={mode === 'rich' ? '切換到 Markdown 原始碼' : '回到排版編輯'}
          onClick={() => setMode(mode === 'rich' ? 'source' : 'rich')}
          className={`ml-auto flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-caption transition-colors ${
            mode === 'source' ? 'bg-primary/10 text-primary' : 'text-text-secondary hover:bg-surface-soft hover:text-text-primary'
          }`}
        >
          <Code2 size={14} /> 原始碼
        </button>
      </div>

      {mode === 'rich' ? (
        <EditorContent editor={editor} />
      ) : (
        <textarea
          id={`${id}-source`}
          value={value}
          readOnly={readOnly}
          onChange={(ev) => emit(ev.target.value)}
          className="w-full min-h-[240px] px-5 py-4 text-body leading-relaxed font-mono text-text-primary bg-card focus:outline-none resize-y"
        />
      )}
    </div>
  );
};
