import React from "react";
import { LogIn, Loader2 } from "lucide-react";
import { BrandMark } from "../components/BrandMark";
import { goToLogin } from "../api/auth";

/**
 * 未登入時的畫面。
 *
 * 刻意**不自動導向** 1Campus —— 自動跳轉會讓「後端沒起來」與
 * 「session 過期」看起來一模一樣（畫面一閃就離開，什麼都來不及看）。
 * 給一顆按鈕，使用者知道自己在哪裡、按下去會發生什麼事。
 */
export const LoginPage: React.FC = () => (
  <div className="min-h-screen flex flex-col items-center justify-center gap-8 p-6">
    <BrandMark />
    <div className="text-center max-w-sm">
      <h1 className="text-title font-bold text-text-primary">請先登入</h1>
      <p className="mt-2 text-body text-text-secondary leading-relaxed">
        這個系統使用 1Campus 帳號登入。按下去會離開這一頁，
        完成後會自動回來。
      </p>
    </div>
    <button
      id="login-btn"
      onClick={goToLogin}
      className="flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary/90 text-on-accent rounded-xl font-bold shadow-lg shadow-primary/20 transition-all active:scale-95"
    >
      <LogIn size={18} />
      使用 1Campus 帳號登入
    </button>
  </div>
);

/** 還在確認登入狀態。這段時間不要 render 畫面 —— 見 AppState 的說明。 */
export const SessionLoading: React.FC = () => (
  <div className="min-h-screen flex items-center justify-center">
    <Loader2 size={32} className="animate-spin text-primary" />
    <span className="sr-only">確認登入狀態中</span>
  </div>
);
