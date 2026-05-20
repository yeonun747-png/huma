const activeAccounts = new Set<string>();

export function acquireAccount(accountId: string): boolean {
  if (activeAccounts.has(accountId)) return false;
  activeAccounts.add(accountId);
  return true;
}

export function releaseAccount(accountId: string) {
  activeAccounts.delete(accountId);
}

export function isAccountBusy(accountId: string): boolean {
  return activeAccounts.has(accountId);
}
