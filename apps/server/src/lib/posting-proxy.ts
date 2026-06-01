import { supabase } from '../middleware/auth.js';
import { isPostingProxyPort } from './modem-ports.js';
import {
  POSTING_DONGLE_SLOTS,
  postingSlotByWorkspace,
  slotNumberToProxyPort,
} from './dongle-slots.js';

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

/** 포스팅 계정 생성 — 물리 동글 번호·포트 자동 매핑 */
export async function resolvePostingProxyPortForCreate(
  workspace: string,
  excludeAccountId?: string,
): Promise<number> {
  const slot = postingSlotByWorkspace(workspace);
  if (!slot) throw new Error(`포스팅 workspace 미지원: ${workspace}`);

  if (slot.workspace === 'yeonun') {
    for (const yeonunSlot of POSTING_DONGLE_SLOTS.filter((s) => s.workspace === 'yeonun')) {
      const { data: occupant } = await supabase
        .from('huma_accounts')
        .select('id')
        .eq('proxy_port', yeonunSlot.proxyPort)
        .eq('account_type', 'posting')
        .neq('id', excludeIdFilter(excludeAccountId))
        .maybeSingle();
      if (!occupant) return yeonunSlot.proxyPort;
    }
    throw new Error('연운 포스팅 동글(물리 1~3 · :10001~10003)이 모두 사용 중입니다.');
  }

  const { data: occupant } = await supabase
    .from('huma_accounts')
    .select('id, name')
    .eq('workspace', workspace)
    .eq('account_type', 'posting')
    .neq('id', excludeIdFilter(excludeAccountId))
    .maybeSingle();
  if (occupant) {
    throw new Error(
      `${WORKSPACE_LABEL[workspace]} 포스팅은 물리 동글 ${slot.slot}(:${slot.proxyPort})·계정 1개만 등록할 수 있습니다.`,
    );
  }
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
