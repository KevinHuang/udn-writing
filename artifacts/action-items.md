# 只有人能做的事

程式改好不等於事情做完。這一份列的是 **Claude Code 做不到、需要你去操作**的項目。
技術規格在 `artifacts/spec.md`，這裡只放待辦。

最後更新：2026-09-16

---

## 🔴 立刻

### 1. 把 admin 驗證的修補部署上去

`/service/admin/*` 先前**完全沒有驗證** —— 匿名的人就能觸發校務同步、寫入課程資料、
呼叫 AI 產生成績。程式已經修好並通過測試，但**線上跑的還是舊映像檔**。

```bash
cd apps/api
npm run dev        # 先在本機確認 system_admin 帳號進得去、非 admin 得到 403
npm run gcloud-build-test && npm run gcloud-deploy-test
```

⚠️ 不要用 `npm run to:test` —— 它第一步是 `npm run build --prefix ../client`，
而 `client/` 不在這個 repo 裡，會失敗。

⚠️ **部署前必須先設好 `SESSION_KEY`（見下一項），否則服務會啟動失敗。**

⬜ 待確認：這兩個 script 名字裡有 `test`，但部署的是 `writing-classroom-server`
（專案 `writing-classroom-672f8`，與 production 前端同一個）。
**請先確認這確實是 production 的部署路徑**，不然修補會上到錯的地方。

### 2. 在 Cloud Run 設定 `SESSION_KEY`

session 的簽章金鑰先前寫死在原始碼裡，現在改讀環境變數，而且**刻意不給預設值** ——
少設一個變數就靜默回退到一把大家都知道的金鑰，比啟動失敗糟得多。

```bash
gcloud run services update writing-classroom-server --region asia-east1 \
  --set-env-vars SESSION_KEY="$(openssl rand -base64 48)"
```

⚠️ 這會讓**所有人被登出**（換金鑰必然如此），挑離峰時間。

---

## 🟠 儘快

### 3. 輪替兩把憑證

| 憑證 | 位置 | 說明 |
|---|---|---|
| GCP service account 私鑰 | `apps/api/writing-classroom-gcs-key.json` | `save-to-cs@writing-classroom-672f8`。已被 `.gitignore` 擋下，但它在檔案系統裡放了一段時間。Cloud Run 上其實不需要這個檔，用附掛的 service account 即可 |
| session 簽章金鑰 | 先前寫死在 `src/index.ts` | 任何有 repo 存取權的人都看得過。第 2 項產生新的就等於輪替 |

DB 密碼要不要換由你判斷 —— `writing_mng` 對 production 有 `GRANT ALL`，
而密碼在兩份 `.env` 裡放了一段時間。

### 4. 檢查 production 有沒有被開發行為污染

`apps/api` 的 `.env` 與 `.env.development` **兩份原本都指向 production 資料庫**
（`writing_classroom`），也就是本機開發一直連著線上使用者正在用的庫。
已改指 `writing_classroom_test`，並在 `dal/database.ts` 加了啟動防護。

值得回頭確認有沒有測試資料混進去，最值得看的是 `/service/admin/import` ——
它把 `COURSE_DATA` 寫進 `school_id = 22`（永平中學），而且在修補之前
**不需要登入就能觸發**。

---

## 🟡 擋住後續開發

### 5. 審核 migration 草案

`docs/migrations/001-prototype-gaps.sql` —— 補齊原型有、schema 沒有的五項功能。
**還沒套用到任何資料庫。**

審核時特別看檔案末尾那段：**要不要對三張新表加外鍵？**
既有庫一個外鍵都沒有，所以草案也沒加，但 `CLAUDE.md` 有整整一節在講孤兒標記的坑。
我建議加 `ON DELETE CASCADE`，理由與風險都寫在裡面，**請 DBA 確認**。

⛔ 通過後**先套用到 `writing_classroom_test` 驗證**。production 的套用是另一件事，
要人決定與執行，不要自動化。

### 6. Phase 3 的瀏覽器驗證

路由重構有 11 個渲染測試，但那是在 Node 裡跑的 —— 證明「渲染不丟例外、內容對得上」，
**不涵蓋點擊、捲動、CSS，也不涵蓋實際的返回鍵行為**。

```bash
npm run dev     # 前端 3000、後端 3001
```

特別看：
- 批改頁按返回是否回到清單
- 從儀表板點作業卡片進批改頁，再返回
- 批改頁的「上一位／下一位」（刻意用 replace，不該灌爆返回鍵）
- 深色模式（碑拓）下各頁的對比度 —— 見 `apps/web/CLAUDE.md`

---

## ✅ 已完成

- 建立 `writing_classroom_autotest` 資料庫
- 提供 `docs/schema.sql`、`docs/auth.ts.md`、`docs/devapi_helper.ts.md`
- 填入 `.env` 的密鑰
