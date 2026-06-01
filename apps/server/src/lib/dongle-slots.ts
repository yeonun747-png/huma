/** 물리 동글 번호 = slot_number = 192.168.3.{slot} — 서버 런타임용 (@huma/shared .ts import 방지) */
export const POSTING_DONGLE_SLOTS = [
  { slot: 1, proxyPort: 10001, workspace: 'yeonun', label: '연운1' },
  { slot: 2, proxyPort: 10002, workspace: 'yeonun', label: '연운2' },
  { slot: 3, proxyPort: 10003, workspace: 'yeonun', label: '연운3' },
  { slot: 4, proxyPort: 10004, workspace: 'panana', label: '파나나' },
  { slot: 5, proxyPort: 10005, workspace: 'quizoasis', label: '퀴즈오아시스' },
] as const;

export type PostingWorkspace = (typeof POSTING_DONGLE_SLOTS)[number]['workspace'];

export function slotNumberToProxyPort(slotNumber: number): number {
  return 10000 + slotNumber;
}

export function postingSlotByWorkspace(workspace: string) {
  return POSTING_DONGLE_SLOTS.find((s) => s.workspace === workspace);
}

export function postingSlotByPort(proxyPort: number) {
  return POSTING_DONGLE_SLOTS.find((s) => s.proxyPort === proxyPort);
}
