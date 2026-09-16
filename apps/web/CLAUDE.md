# 給後續開發者與 AI 的規則

這個檔案記的是**踩過的坑**，不是通用最佳實務。每一條都對應一個實際發生過、
而且編譯器與 ESLint 抓不到的問題。

---

## 顏色：只能用 `index.css` 的 `@theme` 裡定義過的名字

Tailwind v4 的顏色來自 `index.css` 的 `@theme`。用了沒有定義的名字**不會報錯**，
只是產生不出任何樣式。

實際發生過：`bg-brand-600 hover:bg-brand-700 text-white` 這顆「開始批改」按鈕，
`brand-*` 從來沒有定義過 —— 於是它是**白字印在米色卡片上**，幾乎看不見。
TypeScript、ESLint、vite build 全部通過，沒有任何東西會告訴你。

```bash
npm run check:tokens   # 掃出用到未定義色階的 class
npm run lint           # eslint + 上面這支，一起跑
```

**寫任何顏色 class 之前，先確認名字在 `@theme` 裡。**

---

## 深色模式：不要寫死 `text-white`

碑拓（深色）模式的色階是**反轉**的：

| token | 淺色 | 深色 |
|---|---|---|
| `primary` | `#3E5A78` 深花青 | `#7E9DBF` 亮花青 |
| `ink-800` | `#2E2A21` 濃墨 | `#DCD5C4` 亮 |

所以 `bg-primary text-white` 在深色模式會變成**亮底白字**，2.1:1，讀不到。
`bg-ink-800 text-white` 的提示氣泡也一樣。

用這些反而正確：

| 情境 | 用 |
|---|---|
| `bg-primary` / `bg-accent` / `bg-secondary` 上的文字 | `text-on-accent`（淺色白、深色焦墨，會跟著翻） |
| 永遠是深色實底（`bg-black/50`、深色漸層）上的文字 | `text-on-solid`（不翻） |
| `bg-ink-800` 這種會翻的底 | `text-ink-50`（一起翻，永遠有對比） |

---

## 作品標記（佳作／預選）：一份儲存，一支 `canMark()`

老師蓋在作文上的兩個章存在 `lib/submissionMarks.ts`，鍵是 `submission.id`，
內層才分 `featured` / `preselect`。

**不要為第二種章另開一支 lib。** 分成兩份的話，App.tsx 的三條清理路徑
（刪作業、清除繳交、換題）每一條都要呼叫兩次，漏一次就留下指向不存在
作品的孤兒標記。放同一份裡，`dropMarks()` 一次清乾淨，呼叫端也不需要
知道現在總共有幾種章。

**能不能蓋章一律問 `canMark(status)`** —— 已批改與已發還可以，其餘不行。
三個畫面（清單表格、手機卡片、個人批改頁）都問這一支；三個地方各寫一次
`status === 'Graded'` 就是下一個漂移 bug。已發還要算進去：它本來就是批改
完成之後才有的狀態，排除它的話老師一按發還，那篇的章就再也改不了。

其他幾條規則：

- 取消時把那個 key **整個刪掉**，內層清空後外層那筆也刪 —— 留 `false`
  會讓 `Object.keys()` 數到不存在的標記。
- **重置批改不清標記**：重置只是把分數退回「待批改」，作文還在，老師會重批。
  留著的章在重批完成前顯示為「已蓋但不能改」。**清除繳交與換題才清**，
  因為那兩個是把作品本身刪掉。
- 蓋章立即生效，**不進「存檔／已存檔」的未存判斷** —— 章不是 `GradingResult`
  的一部分，混進去會讓老師分不清那顆存檔鍵在管什麼。
- 未來要取用（展示、選文、匯出）一律走 `markedEntries()`，不要各自去拼
  submissions。
- 學生端完全不顯示。

---

## 作業順序：存排序鍵，序號用算的

老師在課程作業清單裡拖出來的順序，存在 `Assignment.order`（班級內、0 起算）。
**卡片上的 1、2、3 從來不存**，一律用位置現算（`lib/assignmentOrder.ts`）——
刪掉中間一份之後 order 會留下空號，但畫面上的序號照樣連續。
這是 `questionCount` / `submittedCount` / `studentCount` 那一家人教會的事。

順序不要另外存成 `Record<courseId, assignmentId[]>`：作業一被刪就要跟著清理，
漏一條就留下指向不存在作業的孤兒 id（作品標記踩過同一個坑）。鍵放在作業
自己身上，作業消失鍵就跟著消失。

讀順序一律走 `orderedAssignments()`，不要自己 sort。一個班的作業有**三個**
畫面會列出來，三個都走它：

| 畫面 | 位置 |
|---|---|
| 課程作業清單 | `components/CourseAssignmentList.tsx` |
| 成績管理（任務下拉＋表格欄位） | `components/GradeManagement.tsx` |
| 批改作業頁的「選擇任務」 | `App.tsx` 的 `switchableAssignments` |

成績管理與批改頁以前各自照 `createdAt` 或「進行中優先」排，但**建立時間不等於
教學順序**，同一個班在不同頁面呈現兩種順序，老師會覺得系統在跟他鬧。

**課程作業清單沒有排序模式。** 曾經有一個「排序」下拉（截止日、待批改最多…），
結果是同一份清單同時存在兩套順序，拖拉只好在其他排序底下被停用，畫面還得寫
「切回自訂順序才能調整」—— 那句提示就是設計出問題的癥狀。真正有用的
「待批改優先」在批改作業頁本來就有（`App.tsx` 的 `activeAssignments`），所以整個拿掉。

篩選晶片只收窄範圍、不改順序，所以篩選時照樣可以調整：拖曳是「放到滑鼠底下
那一列的位置」，上下鍵是「放到**看得到的**上／下一列的位置」，兩者都走同一支
`moveAssignment()`。上下鍵的鄰居一定要從**篩選後**的清單挑 —— 從完整順序挑的話，
鄰居可能沒顯示在畫面上，按了會看起來沒動。

「換班之後要落在哪一份」不要用順序取 `[0]`（很可能是空的草稿），走
`firstWorthGrading()`：有待批改的優先，其次是已開放的。

---

## 陰影的顏色一定要走 `--shadow-tint-*`

Tailwind 會在**編譯期**就把 `@theme` 裡的陰影展開成字面規則：

```css
/* @theme --shadow-paper: 0 1px 3px rgba(23,21,15,.05) 編出來長這樣 */
.shadow-paper { --tw-shadow: 0 1px 3px var(--tw-shadow-color, #17150f0d); }
```

utility 本身**不再是** `var(--shadow-paper)`。所以在 `html.dark` 底下重新宣告
`--shadow-paper` 是**完全沒有作用的** —— 深色模式會繼續套用淺色的墨色陰影，
在近黑的底上等於沒有陰影。（`--shadow-card`／`--shadow-glass` 都曾經這樣壞掉。）

解法是把**顏色**抽成內層的 var，展開後那個 var 還留在規則裡，執行期才解析：

```css
@theme { --shadow-paper: 0 1px 3px var(--shadow-tint-near), …; }
:root     { --shadow-tint-near: rgba(23, 21, 15, .05); }
html.dark { --shadow-tint-near: rgba(0, 0, 0, .55); }
```

同理，`hover:shadow-[0_10px_20px_-5px_rgba(0,0,0,0.05)]` 這種寫死顏色的
arbitrary 陰影在碑拓模式一定看不見。要抬起卡片就用 `hover:shadow-lift`。

---

## 卡片用陰影分層，不要用重邊框框起來

WCAG 1.4.11 的 3:1 是給**只能靠邊界辨識**的元件用的（空白輸入框、純圖示按鈕）。
一張本身就裝著標題、內文、標籤與按鈕的卡片，**它自己就說明了自己是一個物件**，
不需要一條足額的墨線把它框起來 —— 那看起來會很硬。

所以邊框分成兩個 token，**不要混用**：

| token | 淺色 / 深色 | 用在 |
|---|---|---|
| `border-border-strong` | `#8A8271` / `#6B6454` | 搜尋框、篩選鈕、tab 軌道 —— 只靠邊界辨識的控制項 |
| `border-border-card` | `#CFC6B0` / `#453E33` | 卡片、資料夾這種本身有內容的面 |

卡片是 `border-border-card` + `shadow-paper`，hover 時才升到
`hover:border-border-strong` + `hover:shadow-lift`。

---

## 次要文字：用 `text-text-muted`，不要用不透明度調

先前散落 51 處的 `text-text-secondary/40`、`/50`、`/60`…，實測最低只有 **1.99:1**
—— 看得到，但讀不動。而且五種不同的不透明度其實是同一個意思。

現在有第三層文字顏色：

```
text-text-primary    焦墨，本文
text-text-secondary  重墨，次要
text-text-muted      淡墨，說明／佔位／標籤   ← 用這個，不要再 /40
```

`text-text-muted` 在宣紙／卡片／紙陰上是 5.16 / 5.62 / 4.63，都過 WCAG AA。

---

## 會動的東西不要蓋在文字上

`animate-pulse` 會把不透明度壓到 **0.5**。套在有文字的徽章上，等於那段文字
有一半時間讀不到 —— 「缺繳」徽章實測谷底 2.65:1。

- 純圖形的小圓點、載入骨架：可以用 `animate-pulse`
- **帶文字的元素：不要用**。要強調就用顏色與邊框，不要用閃爍

`animate-pulse-subtle`（只降到 0.8）套文字沒問題。

---

## 對比度要用量的，不要用看的

```
scripts/contrast-audit.js   貼進瀏覽器主控台，然後 __contrast()
```

門檻是 WCAG AA：一般文字 4.5:1，大字（≥24px 或 ≥18.66px 粗體）3:1。
**淺色與深色都要跑。**

寫這支腳本的過程本身就是教訓 —— 錯了三次，每一次都會讓結論完全相反：

1. **用 regex 解析顏色字串。** Tailwind v4 輸出的是 `oklab(...)`，
   regex 把 `0.95575` 當成 R 值，整份報告都是錯的。
   → 交給 canvas 轉換，別自己解析。
2. **alpha 合成時假設底層不透明。** `bg-secondary/5` 疊 `bg-secondary/5`
   被算成純紅色，憑空生出一堆不存在的問題。
   → 用正確的 source-over 公式，底層也可能是半透明的。
3. **沒有把祖先的 `opacity` 乘進來。** 隱藏中的 tooltip 被當成可見文字。

4. **切換主題後馬上量。** 很多元件有 `transition-colors`，切換 `html.dark`
   之後顏色是「動」過去的。加了 class 就立刻量，會量到轉場途中的中間值 ——
   實測把一個兩邊都合格的「取消」鍵量成 2.08:1，差點去改一個本來就對的顏色。
   → **切換主題後至少等 1 秒再量**，並且順手印出 `getComputedStyle(el).color`
   對照一下是不是預期的那一端。

量測工具本身錯了，比不量還糟 —— 它會給你一份看起來很可信的錯誤清單。
**改任何顏色之前，先拿一個已知正確的組合驗證量測器。**

---

## 示範資料改了，記得升版本

`lib/usePersistentState.ts` 的 `SCHEMA_VERSION`。課程、題目、作業都存在
localStorage，改了 `mockData.ts` 的結構或代碼卻沒升版本，畫面會停在舊資料 ——
程式沒錯，但看起來像壞掉。**版本加一，所有人重新載入就自動拿到新資料。**

---

## 同一份資訊不要在多處各自解析

這個專案被這件事咬過四次：座號 `split('-')[2]`、學期代碼、學生 ID、
校務系統的課程名稱。

作法一律是：**在入口解析一次，把結果存起來**，其他地方讀存好的欄位。
校名解析在 `lib/schoolName.ts`，解析不到就標記 `parseConfidence: 'low'`
交給人工確認 —— **不要猜。留白看得見，猜錯看不見。**
