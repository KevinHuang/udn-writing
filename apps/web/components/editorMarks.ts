import { Mark, mergeAttributes } from '@tiptap/core';
import {
  ALLOWED_MARK_CLASSES,
  highlightClass,
  textColorClass,
  type HighlightColor,
  type TextColor,
} from '../lib/feedbackMarks';

/**
 * 評語編輯器的標色（螢光筆、文字顏色）。
 *
 * 自己寫而不用 @tiptap/extension-highlight：那個套件把顏色存成
 * `style="background-color:…"`，學生端的白名單就得放行 style 屬性，
 * 等於開了一個任意 CSS 的洞，深色模式也換不了色。
 * 這裡輸出的是固定 class，白名單只要比對字串。
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    feedbackMarks: {
      setHighlightColor: (color: HighlightColor) => ReturnType;
      unsetHighlightColor: () => ReturnType;
      setTextColor: (color: TextColor) => ReturnType;
      unsetTextColor: () => ReturnType;
    };
  }
}

/** class 字串 → 顏色名。認不得的 class 一律當成沒有標色 */
const colorFromClass = (value: string | null, prefix: string): string | null => {
  if (!value) return null;
  const found = value
    .split(/\s+/)
    .find((c) => c.startsWith(prefix) && ALLOWED_MARK_CLASSES.includes(c));
  return found ? found.slice(prefix.length) : null;
};

/** 螢光筆：<mark class="hl-yellow"> */
export const HighlightMark = Mark.create({
  name: 'highlightColor',

  addAttributes() {
    return {
      color: {
        default: 'yellow' as HighlightColor,
        parseHTML: (element) => colorFromClass(element.getAttribute('class'), 'hl-'),
        renderHTML: (attributes) => ({ class: highlightClass(attributes.color as HighlightColor) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'mark[class]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['mark', mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setHighlightColor:
        (color) =>
        ({ commands }) =>
          commands.setMark(this.name, { color }),
      unsetHighlightColor:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});

/** 文字顏色：<span class="tx-red"> */
export const TextColorMark = Mark.create({
  name: 'textColor',

  addAttributes() {
    return {
      color: {
        default: 'red' as TextColor,
        parseHTML: (element) => colorFromClass(element.getAttribute('class'), 'tx-'),
        renderHTML: (attributes) => ({ class: textColorClass(attributes.color as TextColor) }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[class]',
        // 只認我們自己的 class，別的 span 交給其他擴充或直接丟掉
        getAttrs: (element) =>
          colorFromClass((element as HTMLElement).getAttribute('class'), 'tx-') ? null : false,
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setTextColor:
        (color) =>
        ({ commands }) =>
          commands.setMark(this.name, { color }),
      unsetTextColor:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});
