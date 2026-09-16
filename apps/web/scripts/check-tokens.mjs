/**
 * 色彩 token 稽核。
 *
 * Tailwind v4 的顏色來自 index.css 的 @theme。用了沒有定義的名字
 * （例如 bg-brand-600）不會報錯，只是**產生不出任何樣式** ——
 * 於是 `bg-brand-600 text-white` 就變成白字印在米色卡片上，看不見。
 * 這種錯誤編譯器、TypeScript、ESLint 全都抓不到，只能靠這支。
 *
 *   node scripts/check-tokens.mjs
 *
 * 有問題時以 exit code 1 結束，可以直接掛進 CI 或 pre-commit。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// 用 fileURLToPath 而不是 .pathname —— 路徑含空白或中文時
// pathname 會是 percent-encoded，fs 讀不到
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CSS = join(ROOT, 'index.css');
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'scripts']);

/** 會吃顏色 token 的 Tailwind 前綴 */
const PREFIXES = [
  'bg', 'text', 'border', 'ring', 'shadow', 'outline', 'divide', 'decoration',
  'fill', 'stroke', 'from', 'to', 'via', 'accent', 'caret', 'placeholder',
];

/** Tailwind 內建、不需要在 @theme 宣告的顏色關鍵字 */
const BUILTIN = new Set([
  'transparent', 'current', 'inherit', 'black', 'white', 'none', 'auto',
]);

// ── 1. 讀出 @theme 宣告了哪些顏色 ────────────────────────────
const css = readFileSync(CSS, 'utf8');
const declared = new Set();
for (const m of css.matchAll(/--color-([a-z0-9-]+)\s*:/g)) declared.add(m[1]);

// ── 2. 掃描原始碼裡用到的顏色 class ──────────────────────────
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx|ts|jsx|js|html)$/.test(name)) out.push(full);
  }
  return out;
}

/**
 * 比對顏色 class。
 * 刻意把數字含進名稱字元集 —— 之前寫成 [a-z-]+ 導致所有帶數字的色階
 * （danger-600 之類）根本沒被檢查到，稽核結論整個是錯的。
 */
const CLASS_RE = new RegExp(
  String.raw`\b(?:[a-z-]+:)*` +
    `(${PREFIXES.join('|')})` +
    // border-t-ink-800、divide-y-border 這種方向段要先吃掉，
    // 否則會把 "t-ink-800" 整段當成顏色名而誤報
    String.raw`(?:-(?:t|r|b|l|x|y|s|e))?-` +
    String.raw`([a-z][a-z0-9]*(?:-[a-z0-9]+)*)(?:\/[\d.]+)?\b`,
  'g',
);

const problems = [];
for (const file of walk(ROOT)) {
  const text = readFileSync(file, 'utf8');
  text.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(CLASS_RE)) {
      const [, prefix, name] = m;
      if (BUILTIN.has(name)) continue;
      // 尺寸／樣式關鍵字不是顏色，例如 shadow-md、border-2、text-body
      if (declared.has(name)) continue;
      // 只回報「看起來像色階」的（結尾是 50–950 的數字），
      // 其餘（text-body、shadow-lg、border-t…）不是顏色，略過
      if (!/-(?:50|\d{2,3})$/.test(name)) continue;
      problems.push({
        file: relative(ROOT, file).replace(/\\/g, '/'),
        line: i + 1,
        cls: `${prefix}-${name}`,
      });
    }
  });
}

// ── 3. 回報 ────────────────────────────────────────────────
if (problems.length === 0) {
  console.log(`色彩 token 稽核通過：${declared.size} 個已宣告的顏色，沒有用到未定義的色階。`);
  process.exit(0);
}

console.error('發現用到未定義的顏色 token —— 這些 class 產生不出任何樣式：\n');
const byClass = new Map();
for (const p of problems) {
  if (!byClass.has(p.cls)) byClass.set(p.cls, []);
  byClass.get(p.cls).push(`${p.file}:${p.line}`);
}
for (const [cls, where] of [...byClass].sort()) {
  console.error(`  ${cls}`);
  where.forEach((w) => console.error(`      ${w}`));
}
console.error(`\n共 ${problems.length} 處。可用的顏色定義在 index.css 的 @theme。`);
process.exit(1);
