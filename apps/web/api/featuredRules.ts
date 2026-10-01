import { api } from './client';
import type {
  AssignmentRuleMode, AssignmentRules, MyFeaturedRule,
} from '../lib/featuredRule';

/**
 * 自動蓋佳作的標準（後端 dal/featured_rule_helper.ts）。
 * 資料庫列的 snake_case 只在這個檔案出現。
 */

export async function fetchMyFeaturedRule(): Promise<MyFeaturedRule> {
  const r = await api.get<{ enabled: boolean; min_score: number }>('/service/instructor/featured-rule');
  return { enabled: r.enabled, minScore: r.min_score };
}

export async function saveMyFeaturedRule(rule: MyFeaturedRule): Promise<void> {
  await api.put('/service/instructor/featured-rule', { enabled: rule.enabled, min_score: rule.minScore });
}

/** 只回傳另外調整過的作業；沒列出來的就是沿用批改者的標準 */
export async function fetchAssignmentFeaturedRules(): Promise<AssignmentRules> {
  const rows = await api.get<Array<{ assignment_id: string; min_score: number | null }>>(
    '/service/instructor/featured-rules/assignments',
  );
  const out: AssignmentRules = {};
  for (const r of rows) out[String(r.assignment_id)] = r.min_score;
  return out;
}

export async function saveAssignmentFeaturedRule(
  assignmentId: string, mode: AssignmentRuleMode, minScore: number | null,
): Promise<void> {
  await api.put(`/service/instructor/assignments/${assignmentId}/featured-rule`, {
    mode,
    ...(mode === 'custom' ? { min_score: minScore } : {}),
  });
}
