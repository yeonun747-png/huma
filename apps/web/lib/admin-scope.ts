/** UI 계정 그룹: 연운 단독 / 퀴즈+파나나 통합 */
export type AccountGroup = 'yeonun' | 'quizoasis_panana';

/** 사이드바 1단 사업 단위 (AccountGroup과 동일) */
export type BusinessUnit = AccountGroup;

export interface AdminScope {
  email?: string;
  isSuper?: boolean;
  workspaces: string[];
}

const QP_WORKSPACES = ['quizoasis', 'panana'] as const;

export const BUSINESS_UNITS: {
  id: BusinessUnit;
  label: string;
  short: string;
  dotClass: string;
}[] = [
  { id: 'yeonun', label: '연운 緣運', short: '연운', dotClass: 'bg-[#c0506e]' },
  { id: 'quizoasis_panana', label: '퀴즈+파나나', short: '퀴즈+파나나', dotClass: 'bg-[#5b7fff]' },
];

function loginId(admin: AdminScope | null): string {
  return admin?.email?.trim().toLowerCase() ?? '';
}

/** 슈퍼어드민만 연운·퀴즈+파나나 2열 / 그 외 로그인 계정은 담당 1열만 */
export function getAccountGroups(admin: AdminScope | null): AccountGroup[] {
  return getAccessibleBusinessUnits(admin);
}

/** 사이드바 1단 — 연운 / 퀴즈+파나나 */
export function getAccessibleBusinessUnits(admin: AdminScope | null): BusinessUnit[] {
  if (!admin) return [];

  const id = loginId(admin);

  if (id === 'yeonun') return ['yeonun'];
  if (id === 'quiz_panana') return ['quizoasis_panana'];
  if (admin.isSuper === true || id === 'superadmin') {
    return ['yeonun', 'quizoasis_panana'];
  }

  const ws = admin.workspaces ?? [];
  const hasYeonun = ws.includes('yeonun');
  const hasQuizPanana = ws.includes('quizoasis') || ws.includes('panana');

  if (hasYeonun && !hasQuizPanana) return ['yeonun'];
  if (hasQuizPanana && !hasYeonun) return ['quizoasis_panana'];

  return [];
}

export function workspaceToBusinessUnit(workspace: string): BusinessUnit {
  return workspace === 'yeonun' ? 'yeonun' : 'quizoasis_panana';
}

/** 퀴즈+파나나 2단 — 퀴즈오아시스 / 파나나 */
export function getAccessibleSubWorkspaces(
  admin: AdminScope | null,
  unit: BusinessUnit = 'quizoasis_panana',
): string[] {
  if (unit !== 'quizoasis_panana') return [];
  if (!admin) return [];
  if (isSuperAdmin(admin)) return [...QP_WORKSPACES];
  return QP_WORKSPACES.filter((ws) => admin.workspaces.includes(ws));
}

/** API·잡 필터용 운영 워크스페이스 전체 */
export function getAccessibleWorkspaces(admin: AdminScope | null): string[] {
  const units = getAccessibleBusinessUnits(admin);
  const result: string[] = [];
  if (units.includes('yeonun')) result.push('yeonun');
  if (units.includes('quizoasis_panana')) {
    result.push(...getAccessibleSubWorkspaces(admin, 'quizoasis_panana'));
  }
  return result;
}

export function isSuperAdmin(admin: AdminScope | null): boolean {
  if (!admin) return false;
  const id = loginId(admin);
  if (id === 'yeonun' || id === 'quiz_panana') return false;
  return admin.isSuper === true || id === 'superadmin';
}

export function defaultAccountGroup(admin: AdminScope | null): AccountGroup {
  const groups = getAccountGroups(admin);
  return groups[0] ?? 'yeonun';
}

export function defaultWorkspaceForUnit(
  admin: AdminScope | null,
  unit: BusinessUnit,
  stored?: string | null,
): string {
  if (unit === 'yeonun') return 'yeonun';
  const allowed = getAccessibleSubWorkspaces(admin, unit);
  if (stored && allowed.includes(stored)) return stored;
  return allowed[0] ?? 'quizoasis';
}
