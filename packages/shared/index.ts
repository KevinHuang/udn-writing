/**
 * 前後端共用的型別與常數。
 *
 * 這裡只放「兩邊都要用」的東西。放進來之前先問：後端真的會用到嗎？
 * 只有前端用的東西留在 apps/web，只有後端用的留在 apps/api/src/types.ts。
 *
 * ⚠️ 目前這裡的內容還是原型時期的資料模型，與 docs/schema.sql 有落差
 *    （見 artifacts/spec.md 第 3 節）。Phase 4 會依 schema 調整。
 */
export * from './types';
