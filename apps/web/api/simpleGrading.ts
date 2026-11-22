import { api } from './client';
import { parseSimpleGradingInfo, type SimpleGradingInfo } from '../lib/simpleGrading';

/**
 * 簡易批改的資訊（只給老師看）：會不會用簡易批改、辨識摘要、評分依據、請老師留意。
 * 學生端沒有對應的端點。見 lib/simpleGrading.ts。
 */
export async function fetchSimpleGrading(submissionId: string): Promise<SimpleGradingInfo> {
  return parseSimpleGradingInfo(await api.get(`/service/instructor/grading/${submissionId}/simple`));
}
