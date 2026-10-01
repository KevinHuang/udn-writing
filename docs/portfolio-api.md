# 數位作品集專用資料介面

給**數位作品集**（另一個獨立平台）的工程師看。程式在 `apps/api/src/routes/portfolio.ts`，
測試在 `apps/api/src/test/portfolio_api.test.ts`。

分工（2026-10-01 使用者決定）：

| 雲寫作教室（這個系統） | 數位作品集 |
|---|---|
| 老師的一切：批改、佳作／預選章、成果集 | 同校佳作觀摩（學生看） |
| 學生的「我的作品集」、佳作的**學生公開意願** | 家長：切換子女、**家長同意／拒絕公開** |

資料**單向**從這裡流到作品集：這組端點**全部唯讀**。

---

## 驗證：使用者自己的 1Campus access token

作品集的使用者在作品集那邊用 1Campus 登入（作品集自己的 OAuth client），
拿到 access token 後，**每個請求帶在標頭**：

```
Authorization: Bearer <1Campus access token>
```

這個系統拿 token 去問 1Campus 的 userinfo（`https://auth.ischool.com.tw/services/me.php`），
得到 mail，再對到這個系統的帳號（`"user".account`）。誰能看什麼由這個系統決定。

- token **只收標頭**，不收網址參數
- 驗過的 token 記憶體快取 5 分鐘
- ⚠️ **待 1Campus 確認**：作品集的 OAuth client 拿到的 token，這個系統去問 userinfo 能不能過

| 狀態碼 | 意思 |
|---|---|
| 401 `missing_token`／`invalid_token` | 沒帶 token，或 1Campus 說它無效 → 請使用者重新登入 |
| 403 `not_a_student` | 這個帳號在這個系統不是學生 |
| 502 `identity_provider_unavailable` | 連不上 1Campus。**不是**被登出，稍後重試 |

### 從瀏覽器直接呼叫（CORS）

這個系統的環境變數 `PORTFOLIO_ALLOWED_ORIGINS` 列出作品集的網域（逗號分隔），
只對 `/service/portfolio/*` 放行。不靠 cookie，所以不需要 `credentials`。

---

## 端點（前綴 `/service/portfolio/v1`）

### `GET /me`

```json
{
  "account": "alice@school.edu.tw",
  "name": "王小美",
  "roles": ["student"],
  "schools": [{ "id": "12", "name": "甲國中" }],
  "parent_links_available": false
}
```

不是學生時 `roles` 是空陣列、`schools` 空陣列。`parent_links_available` 見「家長」。

### `GET /me/works` — 自己的作品

只有**已發還**的，依學期由舊到新。

```json
[{
  "id": "554",
  "title": "給未來自己的一封信",
  "school": { "id": "12", "name": "甲國中" },
  "class_name": "國二1班",
  "semester": "114-2",
  "student_name": "王小美",
  "submitted_at": "2026-07-30T03:12:00.000Z",
  "word_count": 612,
  "seat_no": 5,
  "score": 6,
  "feedback": "（老師評語，markdown）",
  "content": "（作文全文）",
  "images": ["/service/portfolio/v1/images/554/0?exp=…&sig=…"],
  "featured": true,
  "publish_consent": true
}]
```

- `featured`：老師蓋了佳作章（預選永遠不會出現）
- `publish_consent`：學生對同校觀摩的意願。`true` 願意／`false` 不公開／`null` 還沒決定（＝不公開）。
  學生在**這個系統**設定，作品集不能改

### `GET /showcase?semester=114-2&school_id=12` — 同校佳作觀摩

觀看者所屬學校裡，**同時符合**下面條件的作品：

1. 老師蓋了佳作章
2. 已發還
3. 學生願意公開（`publish_consent = true`）
4. 作者與觀看者同校

**家長同意由作品集自己再篩一次**（家長的同意存在作品集）。

```json
[{
  "id": "554", "title": "…", "school": {…}, "class_name": "…", "semester": "114-2",
  "student_name": "王小美", "submitted_at": "…", "word_count": 612,
  "score": null,
  "image_count": 2,
  "excerpt": "前 80 個字…"
}]
```

- `score`：老師在班級頁打開「數位作品集：佳作觀摩顯示級分」才有值，預設 `null`
- 觀摩**不給**評語、座號、公開意願
- `school_id` 選填，必須是觀看者自己的學校（否則 403）；`semester` 選填，格式 `114-2`（否則 400）

### `GET /works/:id` — 一篇作品

- 自己的 → 與 `/me/works` 同樣的完整欄位
- 在同校觀摩裡的 → 觀摩版（`/showcase` 的欄位，加上 `content` 與 `images`）
- 其餘一律 **404**（不區分「沒有這篇」與「你不能看」）

### 原稿照片 `GET /images/:id/:index?exp=…&sig=…`

作品資料裡的 `images` 是**這個系統簽過的短效網址（15 分鐘）**，
**不需要 Authorization**，可以直接放進 `<img src>`（前面接這個系統的網域）。

- 照片由這個系統用自己的 GCS 權限讀出來轉送，作品集拿不到 GCS 的真實路徑
- 過期或簽章不對 → 403：重新呼叫作品資料端點拿新網址
- 代繳交（老師拍照）的作品，照片可能只在批次代繳交那一筆，這裡已經處理好了

### 家長 `GET /children`、`GET /children/:account/works` — **預留**

1Campus 會提供家長身分並已與子女綁定，但**還沒有接法的文件**
（哪一支 API、哪個 scope、回傳什麼）。在接上之前：

- 兩個端點一律 **501** `parent_links_not_available`
- `/me` 的 `parent_links_available` 是 `false`

接上之後（實作 `apps/api/src/lib/parent_links.ts` 的 `childrenOf`）：

- `/children` → `[{ "account": "...", "name": "...", "schools": [...] }]`
- `/children/:account/works` → 與 `/me/works` 同樣的欄位；不是自己的子女 → 404

---

## 上線前

1. 正式庫要先有 migration 001、008、009、010（見 `artifacts/action-items.md`）
2. 設定 `PORTFOLIO_ALLOWED_ORIGINS`（從瀏覽器直接呼叫時）
3. 向 1Campus 確認上面兩件事：跨 client 的 token 驗證、家長身分的接法
4. Cloud Run 的服務帳號要有 bucket `writing-classroom` 的讀取權限（照片轉送用）。
   確認轉送可用之後，就可以考慮把 bucket 改成不公開
