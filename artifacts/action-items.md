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
| **Gemini API 金鑰** | 曾經被 Vite 的 `define` 打進前端 bundle | **只要那份 bundle 曾經部署或分享出去，這把金鑰就等於公開的** —— 前端 JS 是明文，打開 devtools 就看得到。Phase 5 已經把 AI 呼叫整個移到後端（`apps/web` 不再有 `@google/genai`，也不再讀任何環境變數），但**已經外流的金鑰不會因為程式改好就失效**。請到 Google AI Studio／GCP 把它作廢。<br>後端走的是 Vertex AI + ADC，不需要這把金鑰，所以作廢它不會影響任何功能 |

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

### 4.5 ✅ 修 `semesters` 表的資料錯誤 —— **已完成**（2026-09-16）

118 學年度有**兩列 `118-2`**、沒有 `118-1`：

| id | 學年期 | 起 | 迄 | 應該是 |
|---|---|---|---|---|
| 4 | `118-2` | 2029-09-01 | 2030-02-28 | **`118-1`** |
| 3 | `118-2` | 2030-03-01 | 2030-08-31 | 正確 |

不影響現況（今天是 115-1，解析正確），但 2029 年 9 月之後
「目前學期」會算成 `118-2`。三年後才會咬人的那種 bug。

```sql
UPDATE semesters SET semester = 1 WHERE id = 4;
```

⚠️ 三個資料庫都要改（production 那個要另外決定）。

---

## 🟡 擋住後續開發

### 5. ✅ 套用 migration —— **已完成**

`docs/migrations/001-prototype-gaps.sql` 已套用到 `writing_classroom_test` 與
`writing_classroom_autotest`，三張新表、五個新欄位、三個外鍵都到位，
擁有者是 postgres。production 仍待決定。

<details><summary>原本的說明（保留給 production 那次）</summary>


`docs/migrations/001-prototype-gaps.sql` 已定案：外鍵依建議加上、學生草稿保留。

**為什麼要你來跑：** 應用程式用的 `writing_mng` 雖然有 `GRANT ALL`，
但 `assignment` / `task` / `submission` 三張表的**擁有者是 `postgres`**，
而 `ALTER TABLE` 需要的是擁有權不是權限。我實際跑過一次，停在
`must be owner of table assignment`，整個交易乾淨回滾（兩個資料庫都沒殘留）。

要以 **postgres 身分**對這兩個資料庫執行：

```
writing_classroom_test       開發用
writing_classroom_autotest   自動化測試
```

例如透過 Cloud SQL Studio，或：

```bash
gcloud sql connect <執行個體名稱> --user=postgres --database=writing_classroom_test
\i docs/migrations/001-prototype-gaps.sql
```

⛔ **production（`writing_classroom`）是另一件事**，要單獨決定與執行。

跑完把檔案末尾的「套用紀錄」打勾，我才知道第 8～10 號資源可以開工。

（若你希望之後的 migration 我能自己跑，可以考慮把這三張表的擁有權轉給
`writing_mng`，或另開一個有擁有權的 migration 專用角色 —— 那是 DBA 的決定。）
</details>

### 5.1 ✅ 套用 migration 002 —— **已完成**（2026-09-16）

`docs/migrations/002-task-fields.sql` —— 補齊 `task` 表缺的五個欄位
（封存、寫作類型、滿分、預選模型、配圖描述）。**已寫好、已驗證語法**
（在一張自己擁有的暫存複製表上整份跑過一次再回滾），但與 001 一樣
**需要 postgres 身分**才能套用。

```bash
gcloud sql connect <執行個體名稱> --user=postgres --database=writing_classroom_test
\i docs/migrations/002-task-fields.sql
# 再對 writing_classroom_autotest 跑一次
```

套用完跟我說，我就把題目（資源 4）接上去 —— 在那之前接等於讓老師存檔時
安靜掉資料。

### 6. ✅ 前端已能在瀏覽器執行 —— 剩下的驗證

`npm run dev` 起得來、登入頁看得到（2026-09-16）。啟動途中踩到並修掉的兩個坑
都寫進 `apps/web/vite.config.ts` 的註解了：Vite 靜靜換 port（已加 `strictPort`）、
proxy 的字串前綴把 `/services/*` 一起吃掉（已改正規式）。

**還沒有人實際點過的部分**（路由測試在 Node 裡跑，不涵蓋這些）：

- 批改頁按返回是否回到清單、從儀表板點作業卡片進去再返回
- 批改頁的「上一位／下一位」（刻意用 replace，不該灌爆返回鍵）
- 深色模式（碑拓）下各頁的對比度 —— 見 `apps/web/CLAUDE.md`
- 課程卡片的顯示名稱長度（我把「校名 + 班級」組起來，真實資料可能比 mock 長）

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
