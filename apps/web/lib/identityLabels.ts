import type { IdentityType } from '../api/auth';

/**
 * 身分的顯示名稱。
 *
 * 取代原本 types.ts 的 ROLE_LABEL —— 那份的鍵是前端的 UserRole（三個值），
 * 但後端的身分有四種，而且 `system_admin` 與 `instructor` 都會對應到
 * UserRole.TEACHER 以外的東西，用 UserRole 當鍵就分不出來了。
 *
 * **畫面上不要自己寫「授課教師」四個字**，一律從這裡取。
 */
export const IDENTITY_LABEL: Record<IdentityType, string> = {
  system_admin: '聯合報管理人員',
  instructor: '授課教師',
  learner: '學生',
  school_admin: '校務管理',
};
