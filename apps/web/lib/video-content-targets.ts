import type { HumaAccount, Workspace } from '@huma/shared';
import { WORKSPACES } from '@/lib/constants';

/** 영상 페르소나가 워크스페이스 단위로 동일 — 계정별 선택 불필요 */
export const VIDEO_WORKSPACE_UNIFIED: Workspace[] = ['yeonun'];

export type ContiTargetOption = { value: string; label: string };

export function buildContiTargetOptions(
  accounts: HumaAccount[],
  filterWorkspace: string,
): ContiTargetOption[] {
  const posting = accounts.filter(
    (a) => a.account_type === 'posting' && (!filterWorkspace || a.workspace === filterWorkspace),
  );

  const byWorkspace = new Map<string, HumaAccount[]>();
  for (const acc of posting) {
    const list = byWorkspace.get(acc.workspace) ?? [];
    list.push(acc);
    byWorkspace.set(acc.workspace, list);
  }

  const options: ContiTargetOption[] = [];
  for (const ws of WORKSPACES.map((w) => w.id)) {
    const accs = byWorkspace.get(ws);
    if (!accs?.length) continue;

    if (VIDEO_WORKSPACE_UNIFIED.includes(ws as Workspace)) {
      const label = WORKSPACES.find((w) => w.id === ws)?.short ?? ws;
      options.push({ value: `ws:${ws}`, label });
      continue;
    }

    for (const acc of [...accs].sort((a, b) => a.name.localeCompare(b.name, 'ko'))) {
      options.push({ value: acc.id, label: acc.name });
    }
  }

  return options;
}

export function resolveContiGenerationAccountId(
  target: string,
  accounts: HumaAccount[],
): string | null {
  if (!target) return null;
  if (target.startsWith('ws:')) {
    const ws = target.slice(3);
    const candidates = accounts
      .filter((a) => a.workspace === ws && a.account_type === 'posting')
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    return candidates[0]?.id ?? null;
  }
  return target;
}

export function videoContentDisplayName(accountId: string, accounts: HumaAccount[]): string {
  const acc = accounts.find((a) => a.id === accountId);
  if (!acc) return accountId.slice(0, 6);
  if (VIDEO_WORKSPACE_UNIFIED.includes(acc.workspace as Workspace)) {
    return WORKSPACES.find((w) => w.id === acc.workspace)?.short ?? acc.workspace;
  }
  return acc.name;
}
