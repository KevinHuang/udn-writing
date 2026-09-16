import React from "react";
import { Link } from "react-router-dom";
import { Compass } from "lucide-react";
import { routes } from "../lib/routes";

/**
 * 找不到的頁面。
 *
 * 兩種情況都走這裡：網址本身不存在，以及網址存在但指向的東西找不到
 * （例如別人的班級 id）。刻意不區分 —— 「這個 id 存在但不是你的」
 * 本身就是一種資訊洩漏。
 */
export const NotFoundPage: React.FC<{ message?: string }> = ({
  message = "這個網址不存在，或是你沒有權限看它。",
}) => (
  <div className="flex flex-col items-center justify-center py-24 text-center">
    <Compass size={64} className="mb-4 text-text-muted" strokeWidth={1.5} />
    <h3 className="text-title font-bold text-text-primary">找不到這一頁</h3>
    <p className="mt-2 text-body text-text-secondary max-w-sm">{message}</p>
    <Link
      to={routes.dashboard()}
      className="mt-6 px-5 py-2.5 bg-primary hover:bg-primary/90 text-on-accent rounded-xl font-bold shadow-lg shadow-primary/20 transition-all active:scale-95"
    >
      回到首頁
    </Link>
  </div>
);
