/** C-Rank·카페 공용 풀 — workspace와 무관하게 전체 admin 노출 */
export const CRANK_POOL_ACCOUNT_TYPES = ['crank', 'cafe'] as const;

export type CrankPoolAccountType = (typeof CRANK_POOL_ACCOUNT_TYPES)[number];

export const CRANK_POOL_WORKSPACE = 'yeonun';

export function isCrankPoolAccount(ac: { account_type: string }): boolean {
  return (CRANK_POOL_ACCOUNT_TYPES as readonly string[]).includes(ac.account_type);
}

export function isCrankPoolAccountType(accountType: string | undefined | null): boolean {
  return isCrankPoolAccount({ account_type: accountType ?? 'posting' });
}

/** GET /api/accounts — 담당 workspace + 공용 crank 풀 */
export function buildAccountsListOrFilter(allowedWorkspaces: string[]): string {
  const ws = allowedWorkspaces.join(',');
  return `workspace.in.(${ws}),account_type.in.(crank,cafe)`;
}
