import type { Submission } from '@udn/shared';

/**
 * 繳交的「詳細欄位」：只有完整端點才給、摘要端點沒有的那幾欄（見 api/submissions.ts）。
 *
 * 摘要一重載就會把整份清單換掉。先前換掉時這幾欄跟著變空，於是：
 *   - 直接開批改頁網址：摘要比完整那支晚回來，作文就被蓋成空白
 *     （兩支同時發出，誰先回來看網路，所以有時好有時壞）
 *   - 存檔、AI 批改之後：重載摘要到補回完整之間，作文閃一下空白，
 *     「上一位／下一位」也跟著消失（佇列只收有作文的）
 *
 * 所以補過完整的那幾份，把詳細欄位記下來，摘要換清單時接回去。
 * 狀態與分數一律照摘要 —— 那是剛查的。詳細欄位只會因為存檔、批改、
 * 重新繳交而變，而那些動作做完都會再補一次完整，舊的接回去頂多留到那時候。
 */
export interface SubmissionDetail {
  content: string;
  picFiles?: string[];
  /** 評語本文。摘要的 result 只有分數 */
  feedback?: string;
}

export type DetailCache = Map<string, SubmissionDetail>;

/** 完整端點拿回來的那幾份，記進快取（以繳交 id 為鍵） */
export function rememberDetail(cache: DetailCache, full: Submission[]): void {
  for (const s of full) {
    cache.set(s.id, { content: s.content, picFiles: s.picFiles, feedback: s.result?.feedback });
  }
}

/** 摘要換清單時，把記得的詳細欄位接回去 */
export function withDetail(summary: Submission[], cache: DetailCache): Submission[] {
  return summary.map((s) => {
    const d = cache.get(s.id);
    if (!d) return s;
    return {
      ...s,
      content: d.content,
      picFiles: d.picFiles,
      // 摘要說沒有批改（例如剛重置）就是沒有，不要把舊評語接上去
      result: s.result && d.feedback !== undefined ? { ...s.result, feedback: d.feedback } : s.result,
    };
  });
}
