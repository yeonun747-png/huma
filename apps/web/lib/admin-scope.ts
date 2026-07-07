/** 사이드바·계정 UI 사업 단위 — 연운 / 포춘82 / 퀴즈오아시스 / 파나나 */
export type BusinessUnit = 'yeonun' | 'fortune82' | 'quizoasis' | 'panana';

/** @deprecated BusinessUnit과 동일 */
export type AccountGroup = BusinessUnit;

export interface AdminScope {
  email?: string;
  isSuper?: boolean;
  workspaces: string[];
}

export const BUSINESS_UNITS: {
  id: BusinessUnit;
  label: string;
  short: string;
  dotClass: string;
}[] = [
  { id: 'yeonun', label: '연운 緣運', short: '연운', dotClass: 'bg-[#c0506e]' },
  { id: 'fortune82', label: '포춘82', short: '포춘82', dotClass: 'bg-[#e8a020]' },
  { id: 'quizoasis', label: '퀴즈오아시스', short: '퀴즈', dotClass: 'bg-[#5b7fff]' },
  { id: 'panana', label: '파나나', short: '파나나', dotClass: 'bg-[#9b6bff]' },
];

function loginId(admin: AdminScope | null): string {
  return admin?.email?.trim().toLowerCase() ?? '';
}

function unitsFromWorkspaces(workspaces: string[]): BusinessUnit[] {
  const units: BusinessUnit[] = [];
  if (workspaces.includes('yeonun')) units.push('yeonun');
  if (workspaces.includes('fortune82')) units.push('fortune82');
  if (workspaces.includes('quizoasis')) units.push('quizoasis');
  if (workspaces.includes('panana')) units.push('panana');
  return units;
}

/** 사이드바 1단 — 연운 / 퀴즈오아시스 / 파나나 (각각 독립) */
export function getAccessibleBusinessUnits(admin: AdminScope | null): BusinessUnit[] {
  if (!admin) return [];

  const id = loginId(admin);

  if (id === 'yeonun') return ['yeonun', 'fortune82'];
  if (id === 'quiz_panana') return ['quizoasis', 'panana'];
  if (admin.isSuper === true || id === 'superadmin') {
    return ['yeonun', 'fortune82', 'quizoasis', 'panana'];
  }

  return unitsFromWorkspaces(admin.workspaces ?? []);
}

export function getAccountGroups(admin: AdminScope | null): BusinessUnit[] {
  return getAccessibleBusinessUnits(admin);
}

export function workspaceToBusinessUnit(workspace: string): BusinessUnit {
  if (
    workspace === 'quizoasis' ||
    workspace === 'panana' ||
    workspace === 'yeonun' ||
    workspace === 'fortune82'
  ) {
    return workspace;
  }
  return 'yeonun';
}

/** @deprecated 사업 단위=workspace 1:1 — 하위 탭 없음 */
export function getAccessibleSubWorkspaces(
  admin: AdminScope | null,
  unit?: BusinessUnit,
): string[] {
  if (!admin || !unit) return [];
  if (unit === 'yeonun') return ['yeonun'];
  if (unit === 'fortune82') return ['fortune82'];
  if (unit === 'quizoasis' || unit === 'panana') {
    return admin.workspaces.includes(unit) || isSuperAdmin(admin) ? [unit] : [];
  }
  return [];
}

export function getAccessibleWorkspaces(admin: AdminScope | null): string[] {
  return getAccessibleBusinessUnits(admin);
}

export function isSuperAdmin(admin: AdminScope | null): boolean {
  if (!admin) return false;
  const id = loginId(admin);
  if (id === 'yeonun' || id === 'quiz_panana') return false;
  return admin.isSuper === true || id === 'superadmin';
}

export function defaultAccountGroup(admin: AdminScope | null): BusinessUnit {
  const groups = getAccountGroups(admin);
  return groups[0] ?? 'yeonun';
}

export function defaultWorkspaceForUnit(
  _admin: AdminScope | null,
  unit: BusinessUnit,
  _stored?: string | null,
): string {
  return unit;
}
