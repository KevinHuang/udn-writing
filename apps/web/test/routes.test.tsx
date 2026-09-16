/**
 * 路由冒煙測試。
 *
 * 只問一件事：**每一條路由都渲染得出來、而且渲染出對的東西。**
 * typecheck 與 lint 抓不到「這一頁一打開就丟例外」——
 * 拆 App.tsx 的過程中，少傳一個 prop、少一個 null 檢查都是這個症狀。
 *
 * 用的是 App.tsx export 出來的 AppRoutes，不是另外抄一份路由表 ——
 * 抄一份的話它就會跟真的那份漂移，而漂移了測試還是綠的。
 *
 * ⚠️ 刻意**繞過 SessionGate**。這裡要問的是「每條路由渲染得出來嗎」，
 *    不是「登入流程對不對」—— 後者在 apps/api 有 13 個整合測試蓋著。
 *    繞過之後 sessionStatus 會停在 loading／anonymous，userRole 退回
 *    預設的授課教師，所以下面測的都是教師端的路由。
 */
import "./setup";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router-dom";
import { AppRoutes } from "../App";
import { AppStateProvider } from "../state/AppState";

const render = (url: string) =>
  renderToString(
    <StaticRouter location={url}>
      <AppStateProvider>
        <AppRoutes />
      </AppStateProvider>
    </StaticRouter>,
  );

describe("教師端路由", () => {
  // 預設身分是授課教師，所以這些都渲染得到內容
  const cases: Array<[string, string]> = [
    ["/", "批改作業"],
    ["/courses", "課程"],
    ["/questions", "題庫"],
    ["/grading", "批改作業"],
    ["/grades", "成績"],
    ["/concern", "關心"],
  ];
  for (const [url, expect] of cases) {
    test(`${url} 渲染得出「${expect}」`, () => {
      assert.match(render(url), new RegExp(expect));
    });
  }
});

describe("找不到的東西一律導到 404 畫面", () => {
  const cases = [
    ["/nonsense", "不存在的網址"],
    ["/courses/does-not-exist", "不存在的班級 id"],
    ["/courses/does-not-exist/assignments/new", "對不存在的班級派作業"],
    ["/grading/a1/does-not-exist", "不存在的繳交紀錄"],
  ];
  for (const [url, why] of cases) {
    test(`${url}（${why}）`, () => {
      assert.match(render(url), /找不到這一頁/);
    });
  }
});

describe("身分不符的路徑會被導走", () => {
  test("教師身分打學生端 → 不會渲染學生畫面", () => {
    // RequireRole 會 <Navigate> 到教師首頁，所以渲染結果不是學生端的內容
    const html = render("/student");
    assert.ok(!html.includes("學習概況"), "教師不該看到學生端的導覽");
  });
});
