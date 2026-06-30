import { supabase } from '../middleware/auth.js';
import { isPostingProxyPort } from './modem-ports.js';
import {
  POSTING_DONGLE_SLOTS,
  postingSlotByPort,
  postingSlotByWorkspace,
  slotNumberToProxyPort,
} from './dongle-slots.js';

export const MAX_ACCOUNTS_PER_DONGLE = 5;

export const YEONUN_POSTING_PORTS = POSTING_DONGLE_SLOTS.filter((s) => s.workspace === 'yeonun').map(
  (s) => s.proxyPort,
);
export const PANANA_POSTING_PORT = slotNumberToProxyPort(4);
export const QUIZOASIS_POSTING_PORT = slotNumberToProxyPort(5);

const WORKSPACE_LABEL: Record<string, string> = {
  yeonun: '연운',
  quizoasis: '퀴즈오아시스',
  panana: '파나나',
};

function excludeIdFilter(excludeAccountId?: string) {
  return excludeAccountId ?? '00000000-0000-0000-0000-000000000000';
}

export async function countPostingAccountsOnPort(
  proxyPort: number,
  excludeAccountId?: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('huma_accounts')
    .select('id', { count: 'exact', head: true })
    .eq('proxy_port', proxyPort)
    .eq('account_type', 'posting')
    .neq('id', excludeIdFilter(excludeAccountId));
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function assertDongleCapacity(
  proxyPort: number,
  excludeAccountId?: string,
): Promise<void> {
  const slot = postingSlotByPort(proxyPort);
  const label = slot?.label ?? `:${proxyPort}`;
  const count = await countPostingAccountsOnPort(proxyPort, excludeAccountId);
  if (count >= MAX_ACCOUNTS_PER_DONGLE) {
    throw new Error(
      `${label} 동글(:${proxyPort})은 포스팅 계정 최대 ${MAX_ACCOUNTS_PER_DONGLE}개까지 등록할 수 있습니다.`,
    );
  }
}

/** 동글·순번 기반 slot_label 자동 생성 — 예: 연운1-2, 파나나-1 */
export async function generateAutoSlotLabel(proxyPort: number): Promise<string> {
  const slot = postingSlotByPort(proxyPort);
  const base = slot?.label ?? `동글${proxyPort - 10000}`;
  const count = await countPostingAccountsOnPort(proxyPort);
  return `${base}-${count + 1}`;
}

/** 포스팅 계정 생성 — proxy_port 지정 또는 여유 슬롯 자동 선택 */
export async function resolvePostingProxyPortForCreate(
  workspace: string,
  requestedPort?: number,
  excludeAccountId?: string,
): Promise<number> {
  const slot = postingSlotByWorkspace(workspace);
  if (!slot) throw new Error(`포스팅 workspace 미지원: ${workspace}`);

  if (requestedPort != null) {
    assertPostingProxyPortMatchesWorkspace(workspace, requestedPort);
    await assertDongleCapacity(requestedPort, excludeAccountId);
    return requestedPort;
  }

  if (workspace === 'yeonun') {
    for (const yeonunSlot of POSTING_DONGLE_SLOTS.filter((s) => s.workspace === 'yeonun')) {
      const count = await countPostingAccountsOnPort(yeonunSlot.proxyPort, excludeAccountId);
      if (count < MAX_ACCOUNTS_PER_DONGLE) return yeonunSlot.proxyPort;
    }
    throw new Error(
      `연운 포스팅 동글(1~3) 모두 계정 ${MAX_ACCOUNTS_PER_DONGLE}개 한도에 도달했습니다.`,
    );
  }

  await assertDongleCapacity(slot.proxyPort, excludeAccountId);
  return slot.proxyPort;
}

export function assertPostingProxyPortMatchesWorkspace(workspace: string, proxyPort: number): void {
  const slot = postingSlotByWorkspace(workspace);
  if (!slot) throw new Error(`포스팅 workspace 미지원: ${workspace}`);

  if (workspace === 'yeonun') {
    const ok = (YEONUN_POSTING_PORTS as readonly number[]).includes(proxyPort);
    if (!ok) throw new Error('연운 포스팅은 물리 동글 1~3 (:10001~10003)만 사용할 수 있습니다.');
    return;
  }

  if (proxyPort !== slot.proxyPort) {
    throw new Error(
      `${WORKSPACE_LABEL[workspace]} 포스팅은 물리 동글 ${slot.slot}(:${slot.proxyPort})만 사용할 수 있습니다.`,
    );
  }
  if (!isPostingProxyPort(proxyPort)) {
    throw new Error('포스팅 proxy_port는 10001~10005만 사용할 수 있습니다.');
  }
}
