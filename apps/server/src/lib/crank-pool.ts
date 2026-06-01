import { isCrankPoolAccount, type AccountType } from '@huma/shared';

export { isCrankPoolAccount, CRANK_POOL_ACCOUNT_TYPES, CRANK_POOL_WORKSPACE } from '@huma/shared';

export function isCrankPoolAccountType(accountType: string | undefined | null): boolean {
  return isCrankPoolAccount({ account_type: (accountType ?? 'posting') as AccountType });
}

/** GET /api/accounts — 담당 workspace + 공용 crank 풀 */
export function buildAccountsListOrFilter(allowedWorkspaces: string[]): string {
  const ws = allowedWorkspaces.join(',');
  return `workspace.in.(${ws}),account_type.in.(crank,cafe)`;
}
