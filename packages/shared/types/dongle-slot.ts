import type { Workspace } from './account';

/** 동글(proxy_port)당 최대 포스팅 계정 수 */
export const MAX_ACCOUNTS_PER_DONGLE = 5;

/** 물리 동글 번호 = slot_number = 192.168.3.{slot} (관리·3proxy bind) */
export const POSTING_DONGLE_SLOTS = [
  { slot: 1, proxyPort: 10001, workspace: 'yeonun' as Workspace, label: '연운1' },
  { slot: 2, proxyPort: 10002, workspace: 'yeonun' as Workspace, label: '연운2' },
  { slot: 3, proxyPort: 10003, workspace: 'yeonun' as Workspace, label: '연운3' },
  { slot: 4, proxyPort: 10004, workspace: 'panana' as Workspace, label: '파나나' },
  { slot: 5, proxyPort: 10005, workspace: 'quizoasis' as Workspace, label: '퀴즈오아시스' },
] as const;

/** i7 직결 실폰 — SOCKS :10006·:10007 (ADB 비행기모드 IP 교체) */
export const CRANK_PHONE_SLOTS = [
  { slot: 6, proxyPort: 10006, label: 'C-Rank 폰A' },
  { slot: 7, proxyPort: 10007, label: 'C-Rank 폰B' },
] as const;

/** @deprecated CRANK_PHONE_SLOTS */
export const CRANK_DONGLE_SLOTS = CRANK_PHONE_SLOTS;

export function dongleManagementIp(slotNumber: number): string {
  return `192.168.3.${slotNumber}`;
}

export function proxyPortToSlotNumber(proxyPort: number): number {
  return proxyPort - 10000;
}

export function slotNumberToProxyPort(slotNumber: number): number {
  return 10000 + slotNumber;
}

export function postingSlotByWorkspace(workspace: Workspace) {
  return POSTING_DONGLE_SLOTS.find((s) => s.workspace === workspace);
}

export function postingSlotByPort(proxyPort: number) {
  return POSTING_DONGLE_SLOTS.find((s) => s.proxyPort === proxyPort);
}
