import { api } from './client';
import { UserRole } from '@udn/shared';

/** 後端的身分種類（docs/auth.md）。與前端的 UserRole 不是一對一。 */
export type IdentityType = 'instructor' | 'learner' | 'school_admin' | 'system_admin';

export interface IdentityOption {
  type: IdentityType;
  /** 同一種身分可能橫跨多校 */
  schools: string[];
}

/** `GET /auth/me` 的回應裡，前端真正會用到的部分。 */
export interface Session {
  /** `user.id`。學生端要拿它當 Submission.studentId */
  id: string;
  account: string;
  name: string;
  identities: IdentityOption[];
  activeIdentity: IdentityType | null;
}

interface RawMe {
  id: string;
  account: string;
  lastName?: string;
  firstName?: string;
  identities: IdentityOption[];
  activeIdentity: IdentityType | null;
}

/**
 * 後端身分 → 前端角色。
 *
 * `school_admin`（校務管理）刻意沒有對應 —— UI 不使用它（見 docs/auth.md）。
 * 對應收在這一支，不要在畫面裡各自判斷。
 */
export function toUserRole(identity: IdentityType | null): UserRole {
  switch (identity) {
    case 'system_admin': return UserRole.ADMIN;
    case 'learner': return UserRole.STUDENT;
    default: return UserRole.TEACHER;
  }
}

export async function fetchSession(): Promise<Session> {
  const raw = await api.get<RawMe>('/auth/me');
  return {
    id: String(raw.id ?? ''),
    account: raw.account,
    // 後端存的是姓與名兩欄，顯示時才合起來（auth/index.ts 的寫法一致）
    name: `${raw.lastName ?? ''}${raw.firstName ?? ''}`.trim() || raw.account,
    identities: raw.identities ?? [],
    activeIdentity: raw.activeIdentity ?? null,
  };
}

/** 切換目前身分。後端會驗這個人是不是真的擁有它。 */
export async function switchIdentity(type: IdentityType): Promise<IdentityType> {
  const res = await api.post<{ activeIdentity: IdentityType }>('/auth/identity', { type });
  return res.activeIdentity;
}

/** 導向 1Campus 登入。會離開這個頁面，所以不回傳。 */
export function goToLogin(): void {
  window.location.href = '/auth/login';
}

export async function logout(): Promise<void> {
  await api.post('/auth/logout');
}
