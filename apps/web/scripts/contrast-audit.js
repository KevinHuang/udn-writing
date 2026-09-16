/**
 * WCAG 對比度稽核（開發用）。
 *
 * 用法：開發模式下打開瀏覽器主控台，貼上整份檔案，然後：
 *
 *     __contrast()            // 目前這一頁不合格的文字
 *     __contrast().length     // 只要數量
 *
 * 為什麼要用量的、不用看的 —— 這支腳本寫的過程中錯了三次，
 * 每一次都會讓結論完全相反：
 *
 *   1. 用 regex 解析顏色字串。Tailwind v4 輸出的是 oklab(...)，
 *      regex 把 0.95575 當成 R 值，整份報告都是錯的。
 *      → 改讓 canvas 轉換，瀏覽器自己算。
 *   2. alpha 合成時假設底層不透明。bg-secondary/5 疊 bg-secondary/5
 *      被算成純紅色，憑空生出一堆不存在的問題。
 *      → 改用正確的 source-over 公式。
 *   3. 沒有把祖先的 opacity 乘進來，隱藏中的 tooltip 被當成可見文字。
 *
 * 門檻採 WCAG AA：一般文字 4.5:1，大字（≥24px，或 ≥18.66px 且粗體）3:1。
 */
(() => {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1;
  const ctx = cv.getContext('2d', { willReadFrequently: true });

  /** 任何 CSS 顏色 → sRGB。交給 canvas，不要自己解析字串 */
  const C = (css) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
  };

  const lin = (v) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const L = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);

  /** source-over。底層可以是半透明的，不能假設 a=1 */
  const ov = (f, b) => {
    const a = f.a + b.a * (1 - f.a);
    if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
    return {
      r: (f.r * f.a + b.r * b.a * (1 - f.a)) / a,
      g: (f.g * f.a + b.g * b.a * (1 - f.a)) / a,
      b: (f.b * f.a + b.b * b.a * (1 - f.a)) / a,
      a,
    };
  };

  /** 往上找出這個元素實際疊出來的背景色 */
  const bgOf = (el) => {
    let cur = el;
    let acc = { r: 0, g: 0, b: 0, a: 0 };
    while (cur && cur !== document.documentElement) {
      const c = C(getComputedStyle(cur).backgroundColor);
      if (c.a > 0) {
        acc = ov(acc, c);
        if (acc.a >= 0.999) return acc;
      }
      cur = cur.parentElement;
    }
    return ov(acc, C(getComputedStyle(document.body).backgroundColor));
  };

  window.__contrast = () => {
    const out = [];
    document.querySelectorAll('*').forEach((el) => {
      const t = [...el.childNodes]
        .filter((n) => n.nodeType === 3 && n.textContent.trim())
        .map((n) => n.textContent.trim())
        .join(' ');
      if (!t) return;

      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') return;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;

      // 祖先的 opacity 會一路乘上來
      let op = 1;
      let p = el;
      while (p && p !== document.documentElement) {
        op *= +getComputedStyle(p).opacity;
        p = p.parentElement;
      }
      if (op < 0.15) return; // 幾乎透明：未展開的 tooltip 之類，不是現在要讀的

      const bg = bgOf(el);
      const fg = C(cs.color);
      fg.a *= op;
      const f = ov(fg, bg);
      const ratio =
        (Math.max(L(f), L(bg)) + 0.05) / (Math.min(L(f), L(bg)) + 0.05);

      const size = parseFloat(cs.fontSize);
      const weight = parseInt(cs.fontWeight) || 400;
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      const need = large ? 3 : 4.5;

      if (ratio < need) {
        out.push({
          text: t.slice(0, 20),
          ratio: +ratio.toFixed(2),
          need,
          size: Math.round(size),
          fg: `rgb(${Math.round(f.r)},${Math.round(f.g)},${Math.round(f.b)})`,
          bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`,
          el,
        });
      }
    });
    return out.sort((a, b) => a.ratio - b.ratio);
  };

  return `對比度稽核已載入。執行 __contrast() 看目前這一頁的結果。`;
})();
