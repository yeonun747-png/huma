import type { Workspace } from './account.js';

/** 물리 동글 번호 = slot_number = 192.168.3.{slot} (관리·3proxy bind) */
export const POSTING_DONGLE_SLOTS = [
  { slot: 1, proxyPort: 10001, workspace: 'yeonun' as Workspace, label: '연운1' },
  { slot: 2, proxyPort: 10002, workspace: 'yeonun' as Workspace, label: '연운2' },
  { slot: 3, proxyPort: 10003, workspace: 'yeonun' as Workspace, label: '연운3' },
  { slot: 4, proxyPort: 10004, workspace: 'panana' as Workspace, label: '파나나' },
  { slot: 5, proxyPort: 10005, workspace: 'quizoasis' as Workspace, label: '퀴즈오아시스' },
] as const;

export const CRANK_DONGLE_SLOTS = [
  { slot: 6, proxyPort: 10006, label: 'C-Rank 6' },
  { slot: 7, proxyPort: 10007, label: 'C-Rank 7' },
] as const;

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
