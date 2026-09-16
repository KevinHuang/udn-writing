/**
 * 國中教育會考寫作測驗 —— 六級分制。全站評分的唯一來源。
 *
 * 重要：級分是「整體評定」，不是四項要素加總或平均。
 * ────────────────────────────────────────────────────────────
 * 會考的評分方式是閱卷者綜觀全文後給一個級分，四項評分要素
 * （立意取材、結構組織、遣詞造句、錯別字格式與標點符號）
 * 是判斷時的參考面向，不是各自打分再相加。
 * 所以 totalLevel 不可以寫成 (立意 + 結構 + 遣詞 + 錯字) / 4，
 * 那會產生 3.75 這種會考不存在的級分。
 *
 * 級分為整數 1–6，另有零級分（詩歌體、完全離題、抄題、空白）。
 * 班級平均可以有小數（例：4.2 級分），個人級分不行。
 */

/** 級分：0（零級分）到 6 */
export type ScoreLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const MAX_LEVEL = 6;
export const MIN_LEVEL = 0;

export interface LevelSpec {
  level: ScoreLevel;
  /** 中文級別名稱，例：四級分 */
  name: string;
  /** 一句話的整體描述 */
  summary: string;
  /** 完整評分規準（依會考四項要素） */
  criteria: {
    /** 立意取材 */
    content: string;
    /** 結構組織 */
    structure: string;
    /** 遣詞造句 */
    vocabulary: string;
    /** 錯別字、格式與標點符號 */
    grammar: string;
  };
}

const CN = ['零', '一', '二', '三', '四', '五', '六'];

export const LEVEL_SPECS: Record<ScoreLevel, LevelSpec> = {
  6: {
    level: 6,
    name: '六級分',
    summary: '十分優秀，取材切題且能深入闡述',
    criteria: {
      content: '能依據題目及主旨選取適當材料，並能進一步闡述說明，以凸顯文章主旨',
      structure: '結構完整，脈絡分明，內容前後連貫',
      vocabulary: '遣詞用字精確，語句流暢，並能有效運用修辭',
      grammar: '沒有錯別字，格式與標點符號運用正確',
    },
  },
  5: {
    level: 5,
    name: '五級分',
    summary: '在一般水準之上，取材適當但闡述稍淺',
    criteria: {
      content: '能選取適當材料，但闡述說明不夠深入',
      structure: '結構完整，但偶有轉折不順之處',
      vocabulary: '用字大致精確，語句通順',
      grammar: '少有錯別字，格式與標點符號大致正確',
    },
  },
  4: {
    level: 4,
    name: '四級分',
    summary: '中等，取材尚可但說明不足',
    criteria: {
      content: '尚能選取材料，但不能進一步說明',
      structure: '結構大致完整，但偶有不連貫、轉折不清之處',
      vocabulary: '用字大致正確，但語句偶有不通順',
      grammar: '有一些錯別字，格式與標點符號運用尚可',
    },
  },
  3: {
    level: 3,
    name: '三級分',
    summary: '稍嫌不足，取材未能切合主旨',
    criteria: {
      content: '嘗試選取材料，但與主旨關聯不夠緊密',
      structure: '結構鬆散，前後内容不連貫',
      vocabulary: '用字、語句常有錯誤',
      grammar: '錯別字較多，格式與標點符號運用不佳',
    },
  },
  2: {
    level: 2,
    name: '二級分',
    summary: '不足，材料與主旨關聯性低',
    criteria: {
      content: '雖有材料，但與主旨關聯性低',
      structure: '結構不完整，全文組織鬆散',
      vocabulary: '用字、語句錯誤多，影響文意表達',
      grammar: '錯別字極多，格式與標點符號運用明顯錯誤',
    },
  },
  1: {
    level: 1,
    name: '一級分',
    summary: '不合格，僅重複題意或語焉不詳',
    criteria: {
      content: '僅重複題目文字，或全文語焉不詳',
      structure: '沒有明顯的文章結構',
      vocabulary: '用字、語句嚴重錯誤',
      grammar: '錯別字極多，幾乎無法閱讀',
    },
  },
  0: {
    level: 0,
    name: '零級分',
    summary: '未依規定作答',
    criteria: {
      content: '使用詩歌體、完全離題、只抄寫題目，或為空白卷',
      structure: '—',
      vocabulary: '—',
      grammar: '—',
    },
  },
};

/** 會考的四項評分要素，順序即為官方公布的順序 */
export const CRITERIA_LABELS = {
  content: '立意取材',
  structure: '結構組織',
  vocabulary: '遣詞造句',
  grammar: '錯別字、格式與標點符號',
} as const;

/**
 * 圖表軸上用的短標籤。
 *
 * 只有「錯別字、格式與標點符號」需要縮 —— 官方全名 11 個字，
 * 放在雷達圖的軸上，容器窄於 1024px 就會被裁掉（實測 900px 起）。
 * 其餘三項本來就是四個字，直接沿用 CRITERIA_LABELS，不另外抄一份。
 */
export const CRITERIA_SHORT_LABELS = {
  ...CRITERIA_LABELS,
  grammar: '錯字與標點',
} as const;

/** 把任何數字夾回合法級分並取整（個人級分不能有小數） */
export function toLevel(value: number | undefined | null): ScoreLevel {
  if (value === undefined || value === null || Number.isNaN(value)) return 0;
  const n = Math.round(value);
  return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, n)) as ScoreLevel;
}

/** 顯示用文字，例：四級分 */
export function levelName(value: number | undefined | null): string {
  const l = toLevel(value);
  return `${CN[l]}級分`;
}

/** 只要數字的顯示，例：4 */
export function levelNumber(value: number | undefined | null): string {
  return String(toLevel(value));
}

/**
 * 平均級分。班級平均可以有小數，取到小數點後一位。
 * 沒有已評分的作品時回傳 null，呼叫端自行決定顯示「—」還是 0。
 */
export function averageLevel(levels: number[]): number | null {
  const valid = levels.filter((n) => typeof n === 'number' && !Number.isNaN(n));
  if (!valid.length) return null;
  return Math.round((valid.reduce((a, b) => a + b, 0) / valid.length) * 10) / 10;
}

/**
 * 級分對應的語意色。用礦物顏料，與狀態色同一套 token。
 *   5–6 石綠   優良
 *   4   花青   中等
 *   3   赭石   待加強
 *   0–2 朱砂   需補救
 */
export interface LevelStyle {
  text: string;
  badge: string;
  dot: string;
  /** 圖表用的實際色碼，Recharts 不吃 Tailwind class */
  hex: { light: string; dark: string };
}

export function levelStyle(value: number | undefined | null): LevelStyle {
  const l = toLevel(value);
  if (l >= 5)
    return {
      text: 'text-success-700',
      badge: 'bg-success-100 text-success-700 border border-success-200',
      dot: 'bg-success-500',
      hex: { light: '#5C7A63', dark: '#8AA891' },
    };
  if (l === 4)
    return {
      text: 'text-info-700',
      badge: 'bg-info-100 text-info-700 border border-info-200',
      dot: 'bg-info-500',
      hex: { light: '#3E5A78', dark: '#7E9DBF' },
    };
  if (l === 3)
    return {
      text: 'text-warning-700',
      badge: 'bg-warning-100 text-warning-700 border border-warning-200',
      dot: 'bg-warning-500',
      hex: { light: '#A66B3C', dark: '#C9945F' },
    };
  return {
    text: 'text-danger-700',
    badge: 'bg-danger-100 text-danger-700 border border-danger-200',
    dot: 'bg-danger-500',
    hex: { light: '#9E3D32', dark: '#C4685A' },
  };
}
