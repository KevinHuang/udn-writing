/**
 * 前後端共用的型別與常數。
 *
 * 這裡只放「兩邊都要用」的東西。放進來之前先問：後端真的會用到嗎？
 * 只有前端用的東西留在 apps/web，只有後端用的留在 apps/api/src/types.ts。
 *
 * ⚠️ 目前這裡的內容還是原型時期的資料模型，與 docs/schema.sql 有落差
 *    （見 artifacts/spec.md 第 3 節）。Phase 4 會依 schema 調整。
 *
 * ⚠️ **相對 import 要寫 `.js` 副檔名**，即使檔案是 `.ts`。
 *    這個套件是 ESM，而 apps/api 是 `moduleResolution: nodenext` ——
 *    那個組合下 TypeScript 要求 ESM 的相對路徑帶副檔名，而且是輸出後的 `.js`。
 *    tsx 與 Vite 都會把 `./types.js` 解析回 `types.ts`，所以三邊都能吃。
 *
 *    試過拿掉 `type: module` 改走 CJS —— api 的 typecheck 過了，
 *    但 Node 的 ESM 在 `export *` 一個 CJS 模組時拿不到 enum 這類**執行期**
 *    匯出（`QuestionType` 就消失了），前端的路由測試整組掛掉。
 */
export * from './types.js';
export * from './derive.js';
