import { supabase } from '../middleware/auth.js';
import { isPostingProxyPort } from './modem-ports.js';

/** 연운 포스팅 2동글 · 퀴즈/파나나 각 1동글 전용 */
export const YEONUN_POSTING_PORTS = [10001, 10002] as const;
export const QUIZOASIS_POSTING_PORT = 10003;
export const PANANA_POSTING_PORT = 10004;

const DEDICATED_PORT_BY_WORKSPACE: Record<string, number> = {
  quizoasis: QUIZOASIS_POSTING_PORT,
  panana: PANANA_POSTING_PORT,
};

const WORKSPACE_LABEL: Record<string, string> = {
  yeonun: '연운',
  quizoasis: '퀴즈오아시스',
  panana: '파나나',
};

function excludeIdFilter(excludeAccountId?: string) {
  return excludeAccountId ?? '00000000-0000-0000-0000-000000000000';
}

/** 포스팅 계정 생성 시 workspace별 고정/가용 동글 포트 */
export async function resolvePostingProxyPortForCreate(
  workspace: string,
  excludeAccountId?: string,
): Promise<number> {
  const dedicated = DEDICATED_PORT_BY_WORKSPACE[workspace];
  if (dedicated) {
    const { data: occupant } = await supabase
      .from('huma_accounts')
      .select('id, name')
      .eq('workspace', workspace)
      .eq('account_type', 'posting')
      .neq('id', excludeIdFilter(excludeAccountId))
      .maybeSingle();
    if (occupant) {
      throw new Error(
        `${WORKSPACE_LABEL[workspace] ?? workspace} 포스팅은 동글 1개(:${dedicated})·계정 1개만 등록할 수 있습니다.`,
      );
    }
    return dedicated;
  }

  if (workspace === 'yeonun') {
    for (const port of YEONUN_POSTING_PORTS) {
      const { data: occupant } = await supabase
        .from('huma_accounts')
        .select('id')
        .eq('proxy_port', port)
        .eq('account_type', 'posting')
        .neq('id', excludeIdFilter(excludeAccountId))
        .maybeSingle();
      if (!occupant) return port;
    }
    throw new Error('연운 포스팅 동글(10001~10002)이 모두 사용 중입니다.');
  }

  throw new Error(`포스팅 workspace 미지원: ${workspace}`);
}

export function assertPostingProxyPortMatchesWorkspace(workspace: string, proxyPort: number): void {
  const dedicated = DEDICATED_PORT_BY_WORKSPACE[workspace];
  if (dedicated && proxyPort !== dedicated) {
    throw new Error(
      `${WORKSPACE_LABEL[workspace]} 포스팅은 SOCKS :${dedicated} 동글만 사용할 수 있습니다.`,
    );
  }
  if (workspace === 'yeonun' && !YEONUN_POSTING_PORTS.includes(proxyPort as (typeof YEONUN_POSTING_PORTS)[number])) {
    throw new Error('연운 포스팅은 10001~10002 동글만 사용할 수 있습니다.');
  }
  if (!isPostingProxyPort(proxyPort)) {
    throw new Error('포스팅 proxy_port는 10001~10004만 사용할 수 있습니다.');
  }
}
