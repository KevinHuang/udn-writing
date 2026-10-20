/**
 * 功能開關。
 *
 * 這裡放的是「暫時不顯示，但資料與後端邏輯都保留」的項目 ——
 * 用開關而不是直接刪程式碼，是為了之後要開回來時只改一行，
 * 不必從版本紀錄裡把 JSX 挖回來。
 */

/**
 * 四項評分要素（立意取材／結構組織／遣詞造句／錯別字格式與標點）
 * 是否顯示在教師端與學生端。
 *
 * 目前為 false —— 依需求先隱藏**單篇**的四向度（批改頁、學生端），但：
 *   - AI 批改會一併產生四向度，存在 submission_feedback.sub_scores
 *     （apps/api 的 lib/grading_result.ts；舊資料由管理員的批次補分補上）
 *   - 教師端的繳交資料有帶分數（GradingResult.categoryScores），學生端沒有
 *   - 成績管理的「全班寫作四向度平均」雷達圖**不受這個開關影響**，一直都顯示
 * 要恢復單篇顯示改成 true，學生端還得請後端多帶這四欄。
 *
 * 補充：會考的級分本來就是「整體評定」，四項要素是閱卷時的參考面向、
 * 不是各自打分再加總，所以不顯示它們並不違背評分邏輯。
 */
export const SHOW_CATEGORY_SCORES = false;

/**
 * 使用者能不能自己挑批改模型。
 *
 * 目前為 false —— 依需求先隱藏，但**機制整個保留**：
 *   - Course.aiModels、Question.preferredAiModel 欄位都還在
 *   - App 的 selectedAiModel 狀態、以及「題目有預選模型就自動帶入」的邏輯照舊
 *   - gradeEssayWithAI() 仍然收模型參數
 * 也就是系統照樣用某個模型去批改，只是使用者在任何地方都選不了。
 * 要開回來改成 true 即可，不必把 JSX 從版本紀錄挖回來。
 *
 * 影響的五個地方：
 *   1. 批改作業頁的「AI 批改模型設定」卡片（App.tsx）
 *   2. 批改面板標頭的模型下拉（GradingEditor）
 *   3. 建題表單的「預設批改模型」（QuestionBank）
 *   4. 題目預覽裡顯示的預選模型（QuestionPreviewModal，唯讀）
 *
 * （課程卡片上的「設定批改模型」與它專用的 EditCourseModal 已依需求移除 ——
 *   那個視窗除了挑模型之外只剩唯讀的課名，開關關掉後整個是空的。）
 */
export const SHOW_AI_MODEL_PICKER = false;
