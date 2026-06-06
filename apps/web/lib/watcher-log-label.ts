import { crankServiceLabelKo, type Workspace } from '@huma/shared';
import { formatJobErrorLabel } from './job-error-label';

export type WatcherLogRow = {
  message?: string | null;
  level?: string | null;
  workspace?: string | null;
  platform?: string | null;
  modem_id?: string | null;
  account_name?: string | null;
  created_at?: string | null;
};

const POSTING_SLOT_LABEL: Record<number, string> = {
  1: '연운1',
  2: '연운2',
  3: '연운3',
  4: '파나나',
  5: '퀴즈오아시스',
};

/** Fail-Safe 감지 이력 — Layer4 탐지·휴식 로그만 */
export function isLayer4FailSafeLog(log: WatcherLogRow): boolean {
  return /Layer4/i.test(String(log.message ?? ''));
}

export function classifyWatcherLogType(log: WatcherLogRow): string {
  const msg = String(log.message ?? '');
  if (/Layer4/.test(msg)) {
    if (msg.includes('3+/일') || msg.includes('1주 휴식')) return 'Layer4·휴식';
    if (msg.includes('429')) return 'Layer4·429';
    if (/CAPTCHA|captcha/i.test(msg)) return 'Layer4·CAPTCHA';
    return 'Layer4·탐지';
  }
  if (/모뎀 \d+ IP 변경 실패/.test(msg)) return '동글·IP실패';
  if (/NO_LINKS_FOUND.*warmup/i.test(msg) || msg.includes(':warmup:')) return '워밍업·링크없음';
  if (/page\.goto.*timeout/i.test(msg) || /Timeout \d+ms exceeded/i.test(msg)) return '페이지·타임아웃';
  if (/Imagen API/i.test(msg)) return 'Imagen·API';
  if (/NO_LINKS_FOUND/.test(msg)) return '링크·없음';
  if (/CAPTCHA|captcha/i.test(msg)) return 'CAPTCHA';
  if (/429/.test(msg)) return '429';
  return '기타 ERROR';
}

export function watcherLogTypeTagClass(type: string): string {
  if (type.startsWith('Layer4')) return 'm-tag-err';
  if (type.startsWith('동글')) return 'm-tag-warn';
  if (type.startsWith('워밍업') || type.startsWith('링크')) return 'm-tag-warn';
  if (type.startsWith('페이지')) return 'm-tag-warn';
  return 'm-tag-err';
}

export function resolveWatcherLogService(log: WatcherLogRow): string {
  const ws = log.workspace as Workspace | null | undefined;
  if (ws) return crankServiceLabelKo(ws);

  const platform = String(log.platform ?? '');
  if (platform === 'naver_crank') return 'C-Rank';
  if (platform.includes('post')) return '발행';

  const msg = String(log.message ?? '');
  const modemMatch = msg.match(/모뎀 (\d+)/);
  if (modemMatch) {
    const slot = Number(modemMatch[1]);
    if (slot >= 6) return `C-Rank ${slot}`;
    return POSTING_SLOT_LABEL[slot] ?? `동글 ${slot}`;
  }

  if (log.modem_id) return '동글';
  if (log.account_name) return String(log.account_name).slice(0, 16);
  return '—';
}

export function layer4ActionLabel(log: WatcherLogRow): string {
  const msg = String(log.message ?? '');
  if (msg.includes('3+/일') || msg.includes('1주 휴식')) return '1주 휴식';
  if (msg.includes('복구 완료')) return '복구 완료';
  return '즉시 중지';
}

export function formatWatcherLogMessage(log: WatcherLogRow): string {
  const msg = String(log.message ?? '');
  return formatJobErrorLabel(msg) || msg;
}
