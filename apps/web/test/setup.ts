/**
 * 給路由冒煙測試用的最小瀏覽器 shim。
 *
 * 這個前端只跑在瀏覽器裡，沒有 SSR 需求 —— 這裡補的東西只是為了讓
 * renderToString 跑得完，不代表這些 API 在產品裡是選用的。
 */
const store = new Map<string, string>();
const g = globalThis as Record<string, unknown>;

const localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};

g.localStorage = localStorage;
g.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
g.getComputedStyle = () => ({ getPropertyValue: () => "" });
g.window = {
  localStorage,
  matchMedia: g.matchMedia,
  getComputedStyle: g.getComputedStyle,
  // useGoBack 讀這個值判斷「有沒有上一頁」。0 代表這是第一頁。
  history: { state: { idx: 0 } },
  scrollTo() {},
};
g.document = {
  documentElement: { classList: { add() {}, remove() {}, contains: () => false } },
};
