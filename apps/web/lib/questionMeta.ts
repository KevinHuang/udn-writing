/**
 * 題目的標籤字彙、欄位上限與驗證規則。
 *
 * 移植自另一套系統的任務建置模組（taskbuilder/types.ts）。
 * 字串集中在這裡，是為了避免「國中」「junior」這種對照散落在
 * 表單、卡片、預覽三個地方各寫一份 —— 專案裡 lib/scoring.ts 與
 * lib/statusStyles.ts 都是同樣的理由。
 */

import { TargetGrade, QuestionSource } from '../types';

export const TARGET_GRADE_LABEL: Record<TargetGrade, string> = {
  elementary: '國小',
  junior: '國中',
  senior: '高中',
};

export const QUESTION_SOURCE_LABEL: Record<QuestionSource, string> = {
  exam_archive: '會考歷屆',
  udn: '聯合報',
  udn_cup: '聯合盃',
  original: '教師自編',
  textbook: '課本延伸',
};

/** 依宣告順序列出，供表單渲染選項 */
export const TARGET_GRADES = Object.keys(TARGET_GRADE_LABEL) as TargetGrade[];
export const QUESTION_SOURCES = Object.keys(QUESTION_SOURCE_LABEL) as QuestionSource[];

export const QUESTION_LIMITS = {
  title: { min: 2, max: 60 },
  /** 題說 */
  content: { max: 300 },
  teacherNotes: { max: 2000 },
  image: {
    maxBytes: 5 * 1024 * 1024,
    accept: ['image/jpeg', 'image/png', 'image/webp'] as readonly string[],
  },
} as const;

/** 表單會驗證到的欄位 */
export interface QuestionDraft {
  title: string;
  content: string;
  teacherNotes: string;
  targetGrades: TargetGrade[];
}

export type QuestionFieldError = Partial<Record<keyof QuestionDraft, string>>;

/**
 * 表單驗證。回傳空物件代表通過。
 * 刻意不依賴驗證函式庫，將來接後端時同一份規則可以直接搬過去共用。
 */
export function validateQuestion(draft: Partial<QuestionDraft>): QuestionFieldError {
  const errors: QuestionFieldError = {};
  const title = (draft.title ?? '').trim();

  if (!title) {
    errors.title = '請輸入題目名稱';
  } else if (title.length < QUESTION_LIMITS.title.min) {
    errors.title = `題目名稱至少 ${QUESTION_LIMITS.title.min} 個字`;
  } else if (title.length > QUESTION_LIMITS.title.max) {
    errors.title = `題目名稱最多 ${QUESTION_LIMITS.title.max} 個字，目前 ${title.length} 個`;
  }

  if (!(draft.content ?? '').trim()) {
    errors.content = '請輸入題說，學生要靠它知道這次要寫什麼';
  } else if ((draft.content ?? '').length > QUESTION_LIMITS.content.max) {
    errors.content = `題說最多 ${QUESTION_LIMITS.content.max} 個字`;
  }

  if (!draft.targetGrades?.length) {
    errors.targetGrades = '請至少選擇一個適用階段';
  }

  if ((draft.teacherNotes ?? '').length > QUESTION_LIMITS.teacherNotes.max) {
    errors.teacherNotes = `教師的話最多 ${QUESTION_LIMITS.teacherNotes.max} 個字`;
  }

  return errors;
}

export const isQuestionValid = (draft: Partial<QuestionDraft>): boolean =>
  Object.keys(validateQuestion(draft)).length === 0;

/** 圖片檔的前置檢查。通過回傳 null，否則回傳給使用者看的訊息 */
export function checkImageFile(file: File): string | null {
  if (!QUESTION_LIMITS.image.accept.includes(file.type)) {
    return '只接受 JPG、PNG 或 WebP';
  }
  if (file.size > QUESTION_LIMITS.image.maxBytes) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    return `檔案 ${mb} MB，超過 5 MB 上限。請先壓縮或裁切。`;
  }
  return null;
}
