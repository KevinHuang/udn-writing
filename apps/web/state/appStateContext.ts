import { createContext, useContext } from "react";
import type { AppState } from "./AppState";

/**
 * context 與 hook 放在這裡、provider 放在 AppState.tsx，是為了讓
 * React Fast Refresh 正常運作 —— 一個檔案同時匯出元件與非元件時，
 * 改動會讓整頁重載而不是熱更新，開發時所有輸入到一半的東西都會被清掉。
 */
export const AppStateContext = createContext<AppState | null>(null);

export function useAppState(): AppState {
  const value = useContext(AppStateContext);
  if (!value) throw new Error("useAppState() 必須用在 <AppStateProvider> 底下");
  return value;
}
