import { api } from './client';
import { parseManuscript, parseMarks, type ManuscriptData, type ManuscriptDecisionInput, type ManuscriptMarks } from '../lib/manuscript';

/**
 * 原稿紅筆（docs/manuscript.md，只給老師）：
 *   讀    GET  /instructor/grading/:id/manuscript             拉正的原稿、格子、合併老師決定後的標記
 *   寫    POST /instructor/grading/:id/manuscript/decisions   老師的一個決定（每按一下就存），回傳更新後的標記
 *   重評  POST /instructor/grading/:id/regrade                用目前確定的錯字再跑一次簡易批改
 */

/** 沒有逐格辨識結果回 null：批改頁照舊 */
export async function fetchManuscript(submissionId: string): Promise<ManuscriptData | null> {
  return parseManuscript(await api.get(`/service/instructor/grading/${submissionId}/manuscript`));
}

export async function saveManuscriptDecision(submissionId: string, input: ManuscriptDecisionInput): Promise<ManuscriptMarks> {
  return parseMarks(await api.post(`/service/instructor/grading/${submissionId}/manuscript/decisions`, input));
}

export async function regradeWithAi(submissionId: string): Promise<void> {
  await api.post(`/service/instructor/grading/${submissionId}/regrade`);
}
