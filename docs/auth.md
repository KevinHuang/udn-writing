# 認證與授權

依據 `legacy-server/` 的實際程式碼整理（`src/auth/index.ts`、`src/config.ts`、
`src/dal/user_helper.ts`、`src/dal/session_store.ts`、`src/middleware/oauth.ts`、
`src/dal/devapi/`）。

**這份文件描述的是既有系統目前真正在做的事**，不是推測。標 ⚠️ 的段落是
既有實作的缺陷或未完成處，新系統要修掉。

---

## 這是 OAuth 2.0，不是 OIDC

沒有 discovery 文件、沒有 id_token、沒有 `/.well-known/`。
endpoint 是**寫死在 `src/config.ts` 裡的**，不是環境變數：

| 用途 | URL |
|---|---|
| 授權頁面 | `https://auth.ischool.com.tw/oauth/authorize.php` |
| 換 token | `https://auth.ischool.com.tw/oauth/token.php` |
| 使用者資訊 | `https://auth.ischool.com.tw/services/me.php` |
| DevAPI | `https://devapi.1campus.net`（可被 `DEVAPI_HOST` 覆寫） |

```
scope        = User.Mail,User.BasicInfo,User.Application
responseType = code
grantType    = authorization_code
```

不要導入 `openid-client` 之類的 OIDC 函式庫去自動發現設定，會找不到東西。
既有實作是直接 `fetch`，照做即可。

**同一組 `client_id` / `client_secret` 給兩個流程共用**（同一個 authorization server）：

| 流程 | Grant type | 用途 |
|---|---|---|
| A | Authorization Code | 使用者登入 |
| B | Client Credentials | 校務資料同步（server-to-server） |

---

## A. 使用者登入

路徑前綴是 **`/auth`**（不是 `/api/auth`）。

| # | 動作 |
|---|---|
| 1 | `GET /auth/login`：已登入則直接導回首頁。否則產生 `state`（`randomBytes(16).toString('hex')`）存 HttpOnly cookie，導向授權頁 |
| 2 | 使用者登入後被導回 `OAUTH_REDIRECT_URI`，帶 `code` 與 `state` |
| 3 | `GET /auth/callback`：**先比對 `state`**，不符回 400 |
| 4 | `POST` token endpoint（`application/x-www-form-urlencoded`）→ 拿 `access_token` |
| 5 | `GET {userInfoUrl}?access_token=xxx` → 拿 userInfo |
| 6 | upsert `user`、判定身分、寫 `login_history`、存 session |
| 7 | 導回 `CLIENT_HOME_PAGE`（留空則用請求的 `Origin`） |

`GET /auth/me` 回傳 `ctx.session.userInfo`；`GET /auth/logout` 清 session。

### userInfo 的形狀

1Campus 的 userinfo endpoint 實際回傳的只有這些：

```json
{
  "mail": "113207@ynhs.ylc.edu.tw",
  "uuid": "701f0d1c-792e-4022-9625-cdfce6b496d1",
  "language": "zh-Hant-TW",
  "lastName": "丁",
  "firstName": "貝佳"
}
```

`isSchoolAdmin` / `isInstructor` / `isLearner` / `isSystemAdmin` / `id` /
`account` / `clientIP` / `roles` / `ref_school_id` **都是 callback 自己補上去的**，
不是 1Campus 給的。`src/types.ts` 的 `UserInfo` 介面把兩者混在一起，看型別會誤會。

### `UserHelper.add()` 實際寫了什麼

**只寫 `user` 表的兩個欄位。**

| 情況 | 行為 |
|---|---|
| 帳號不存在 | `INSERT INTO "user" (account, name)`，`name` = `lastName + firstName` |
| 帳號已存在 | 只 `UPDATE last_signin = now()` |

⚠️ 以下全部**沒有**被寫入，儘管 SQL 的 `raw_data` CTE 把它們都準備好了：

- **`user.auth_uuid` 沒有寫。** userInfo 的 `uuid` 被丟掉。
- **`user_role` 表沒有被寫入。** 呼叫 `sync_role()` 的那行是註解掉的。
- `sso_detail`、`dsns`、`school_name`、`school_year`、`semester`、`school_system_id`
  在 CTE 裡準備了但沒有任何 INSERT 用到。
- 已存在的使用者**改名不會同步**（`-- name = r.name` 是註解掉的）。

⚠️ **`recUser.ref_school_id` 永遠是 `undefined`。** 查詢最後 `SELECT target_user.*`
只包含 `temp_user.id` 與 `raw_data.*`，而 `raw_data` 沒有 `ref_school_id` 欄位。
所以 `auth/index.ts` 的 `userInfo.ref_school_id = recUser.ref_school_id` 寫入的是
undefined。（`user` 表本來就沒有這個欄位，有的是 `user_role.ref_school_id`。）

### 角色判定

**`getIdentity()` 不讀 `user_role` 表。** 它用三段 UNION 現算：

| identity_type | 來源 |
|---|---|
| `instructor` | `uc_instructor` JOIN `course` JOIN `school`，有資料列就算 |
| `learner` | `uc_learner` JOIN `course` JOIN `school`，同上 |
| `school_admin` | `school_admin` 表，用 **`account`** 比對 |

`isSystemAdmin` 另外查 `system_admin` 表，用 **`mail`** 比對 `account` 欄位。

⚠️ **`org_admin` 表在整個 legacy-server 裡從未被使用。**

**身分刻意不依學期篩選**（已決定）：只要 `uc_instructor` / `uc_learner` 有過任何
一列，不論哪個學年期，身分就成立——過去學期帶過班的人仍然是教師，才進得去看
自己批改過的作品。

原本那個 `current_semester` CTE 與兩行註解掉的 JOIN 已經刪除，理由寫在
`user_helper.ts` 的註解裡：它是 INNER JOIN，寒暑假期間 `semesters` 若沒有任何一列
涵蓋今天，**所有人都會失去所有身分**。要做「只顯示本學期課程」請改課程查詢。

### 前端角色的對應

| 前端 `UserRole` | 來源 | 狀態 |
|---|---|---|
| `STUDENT` | `isLearner` | 確定 |
| `TEACHER` | `isInstructor` | 確定 |
| `ADMIN`（聯合報管理人員） | `isSystemAdmin`（`system_admin` 表） | 唯一候選，`org_admin` 沒人用 |
| （不使用） | `isSchoolAdmin`（`school_admin` 表） | **UI 不使用，前端過濾掉**。`getIdentity()` 照樣回傳 |

**已決定：做身分切換 UI。** 大頭貼下拉列出這個人所有的身分，選了之後畫面
顯示該角色的功能。因此不需要優先序規則，但需要「目前身分」這個概念——
既有的中介層沒有它（`isLearner` / `isInstructor` 只各自檢查旗標）。

實作上「目前身分」存在 session，而守衛要**同時**檢查「有這個身分」與
「目前選的是這個身分」。只檢查前者，切換只是畫面效果；只檢查後者，
等於讓前端決定自己的權限。

### Session

`koa-session` + 自訂的 postgres store（`src/dal/session_store.ts`）。

| 項目 | 值 |
|---|---|
| cookie 名稱 | `@1campus_writing_classroom` |
| maxAge | 8 小時 |
| 簽章金鑰 | ⚠️ **寫死在 `src/index.ts`**：`app.keys = ['@writing_classroom_secret_key']` |
| SameSite | production `none` + `secure`；開發 `lax` |

⚠️ **production 必須用 `SameSite=none`**，因為前端與後端在 Cloud Run 上是
不同網域。這一點會影響整個部署架構——若新架構讓前後端同源，才能用 `lax`。

store 的 `set()` 是一段 CTE：upsert 加上順手刪除過期紀錄（`auto_clean`，
清掉 `expiry_date` 早於 5 分鐘前的）。`expiry_date` 是 epoch 毫秒的 bigint。
**這段已經解決過 `session` 表那個非標準的欄位形狀，直接沿用，不要重寫。**

---

## B. 校務資料同步 DevAPI

### 取 token

```
GET {DEVAPI_HOST}/oauth/token
    ?grant_type=client_credentials&client_id=...&client_secret=...&scope=jasmine
```

回應 `{ token_type, access_token, expires_in }`。

**行程內快取，並提前 300 秒視為過期**（`now + (expires_in - 300) * 1000`），
避免在失效瞬間發請求。新實作要保留這個緩衝。

### 讀資料

`GET {DEVAPI_HOST}/api/jasmine/{schoolDsns}/...`，帶 `Authorization: Bearer <token>`。
回應是**文字**，要自己 `JSON.parse`。

| endpoint | 回傳 | 取用 |
|---|---|---|
| `getClass` | `{ class: [...] }` | `.class` |
| `getClassStudent` | 陣列 | 直接用 |
| `getTeacher` | `{ teacher: [...] }` | `?teacherAcc=` 查單一，取 `.teacher[0]` |
| `getCourse` | `{ course: [...] }` | 每筆有 `schoolYear` / `semester` / `class` |
| `getCourseStudent?courseID=` | `{ course: [{ student: [...] }] }` | `.course[0].student`，沒有回 `[]` |

`schoolDsns` 對應 `school.dsns`。

`getCourse` 的結果要做兩層篩選，**第二層不能漏**：

```
.filter(crs => crs.schoolYear === schoolYear && crs.semester === semester)
.filter(crs => crs.class)     // 只留掛在班級底下的課程
```

---

## ⚠️ 安全問題（新系統必須修）

按嚴重程度排序：

1. **`/service/admin/*` 完全沒有驗證。** `src/routes/admin.ts` 有 import
   `OAuthMiddleware`，但**從頭到尾沒有使用它**——沒有 `router.use()`，
   個別路由也沒帶守衛。對照 `student.ts` 與 `instructor.ts` 都有。
   目前任何人都能打：
   - `GET /service/admin/sync/school`（觸發校務同步）
   - `GET /service/admin/import`（寫入課程資料，學校 id 寫死 22）
   - `GET /service/admin/gen_final_report`（呼叫 AI、產生成績）
   - `GET /service/admin/instructors/:key/courses`（讀任意教師的課程）
2. **GCP service account 私鑰在檔案系統裡**：`legacy-server/writing-classroom-gcs-key.json`
   （`save-to-cs@writing-classroom-672f8`）。`legacy-server/` 沒有 `.gitignore`。
   已在根目錄的 `.gitignore` 擋掉，但**這把金鑰應該輪替**。
3. **session 簽章金鑰寫死在原始碼**（`src/index.ts`）。要改成環境變數並輪替。
4. **admin 的寫入操作用 `GET`**（import / sync / gen_final_report）。
   可被任何一張 `<img>` 觸發。要改 POST。
5. **`client_secret` 在 DevAPI token 請求的 query string。** 這是 1Campus 的規格，
   但該 URL 會進 access log。永遠不要 log 它；並確認有沒有 POST 版本。
6. **userinfo 的 token 也在 query string。** 同上，不要 log 完整 URL。
7. **`state` cookie 用完沒清。** 清除那行在 `auth/index.ts` 是註解掉的。
8. **登出用 `GET`。** 應改 POST。
9. **錯誤訊息原樣回前端**：callback 的 catch 直接回 `error.message`，
   token endpoint 的錯誤可能含設定細節。

---

## 仍待確認

1. ~~身分要不要依學期篩選？~~ **不篩選**（見上）。
2. ~~`isSchoolAdmin` 在前端要有對應角色嗎？~~ **不用，UI 忽略它。**
3. ~~一人多重身分時顯示哪一個？~~ **已決定做切換 UI**（見上）。
   剩下兩個子問題：下拉要不要細到「學校」這一層（同一人可能在兩校都是教師），
   以及登入後的預設身分。
4. **`user_role` 表由誰維護？** 登入流程不寫它，但 schema 裡有，且 `updateSchoolSystemID()`
   會更新它。是別的流程在寫嗎？
5. **`targetDSNS` 是什麼？** userInfo 有這個欄位但值是空字串，沒有被使用。
