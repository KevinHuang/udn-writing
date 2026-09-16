import { Identity, UserInfo } from '../types';

/**
 * 目前身分。
 *
 * 一個人可以同時是教師、學生、校管理者與系統管理者 —— 四個旗標互不排斥。
 * 前端一次只呈現一種身分（大頭貼下拉可切換），所以 session 要記住
 * 「現在選的是哪一種」。
 */
export type IdentityType = 'instructor' | 'learner' | 'school_admin' | 'system_admin';

export const IDENTITY_TYPES: IdentityType[] = [
  'instructor', 'learner', 'school_admin', 'system_admin',
];

export const isIdentityType = (v: unknown): v is IdentityType =>
  typeof v === 'string' && (IDENTITY_TYPES as string[]).includes(v);

/**
 * 這個人實際擁有哪些身分。
 *
 * instructor / learner / school_admin 來自 getIdentity()（現算 uc_instructor、
 * uc_learner、school_admin 三張表），system_admin 另外查 system_admin 表。
 * 詳見 docs/auth.md。
 */
export function availableIdentities(user: UserInfo): IdentityType[] {
  const out: IdentityType[] = [];
  if (user.isInstructor) out.push('instructor');
  if (user.isLearner) out.push('learner');
  if (user.isSchoolAdmin) out.push('school_admin');
  if (user.isSystemAdmin) out.push('system_admin');
  return out;
}

/**
 * 登入後預設落在哪個身分。
 *
 * ⚠️ 這個優先序是**暫定的**（spec.md 的開放問題）。改的話只改這一個陣列。
 * 目前的想法：多數同時具有多重身分的人是老師（在別的學校也修課、
 * 或是被登記成學員），所以 instructor 優先。管理身分比較少見但更特殊，
 * 擁有的人知道自己要切過去。
 */
const DEFAULT_PRIORITY: IdentityType[] = [
  'instructor', 'system_admin', 'school_admin', 'learner',
];

export function defaultIdentity(user: UserInfo): IdentityType | null {
  const available = availableIdentities(user);
  return DEFAULT_PRIORITY.find((t) => available.includes(t)) ?? null;
}

/** 下拉選單要顯示的內容。同一種身分可能橫跨多校，所以帶學校名稱。 */
export function identityOptions(user: UserInfo): Array<{
  type: IdentityType;
  schools: string[];
}> {
  const roles: Identity[] = user.roles ?? [];
  return availableIdentities(user).map((type) => ({
    type,
    schools: [...new Set(
      roles.filter((r) => r.identity_type === type).map((r) => r.school_name).filter(Boolean),
    )],
  }));
}
