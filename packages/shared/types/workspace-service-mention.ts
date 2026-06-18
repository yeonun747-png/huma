export type WorkspaceServiceMentionKey = 'yeonun' | 'quizoasis' | 'panana';

export interface WorkspaceServiceMention {
  /** 본문에 쓸 서비스 한글명 */
  name: string;
  /** 괄호 안 도메인 — 점 앞뒤 공백 유지 */
  domainLabel: string;
  /** 도메인 포함 형식 (앞뒤 공백 포함) */
  withDomain: string;
  /** 도메인 없이 서비스명만 */
  nameOnly: string;
  /** 정규화 시 치환할 bare host 패턴 */
  bareHosts: string[];
}

export const WORKSPACE_SERVICE_MENTIONS: Record<WorkspaceServiceMentionKey, WorkspaceServiceMention> = {
  yeonun: {
    name: '연운',
    domainLabel: 'yeonun . com',
    withDomain: ' 연운 (yeonun . com) ',
    nameOnly: '연운',
    bareHosts: ['yeonun.com', 'www.yeonun.com'],
  },
  quizoasis: {
    name: '퀴즈오아시스',
    domainLabel: 'quizoisis . com',
    withDomain: ' 퀴즈오아시스 (quizoisis . com) ',
    nameOnly: '퀴즈오아시스',
    bareHosts: ['quizoasis.com', 'www.quizoasis.com', 'quizoisis.com', 'www.quizoisis.com', 'myquizoasis.com', 'www.myquizoasis.com'],
  },
  panana: {
    name: '파나나',
    domainLabel: 'panana . kr',
    withDomain: ' 파나나 (panana . kr) ',
    nameOnly: '파나나',
    bareHosts: ['panana.kr', 'www.panana.kr', 'panana.com', 'www.panana.com'],
  },
};

export function resolveWorkspaceServiceMention(workspace: string): WorkspaceServiceMention {
  const key = workspace as WorkspaceServiceMentionKey;
  return WORKSPACE_SERVICE_MENTIONS[key] ?? WORKSPACE_SERVICE_MENTIONS.yeonun;
}

/** Claude 본문 생성용 — 도메인 포함 / 서비스명만 랜덤 */
export function workspaceServiceMentionPromptGuide(workspace: string): string {
  const m = resolveWorkspaceServiceMention(workspace);
  return `서비스 언급은 본문 1~2회. 글마다 아래 둘 중 하나를 랜덤 선택 (같은 글 안에서는 한 형식만 통일):
- 「${m.withDomain.trim()}」 (${m.domainLabel} 점 앞뒤 공백·서비스명 앞뒤 공백 유지)
- 「${m.nameOnly}」만 (도메인 없이 서비스명만)
https·${m.domainLabel.replace(/\s/g, '')}·전체 URL 금지`;
}

/** 계정 페르소나·시스템 프롬프트용 한 줄 요약 */
export function workspaceServiceMentionRuleLine(workspace: string): string {
  const m = resolveWorkspaceServiceMention(workspace);
  return `서비스 언급: 「${m.withDomain.trim()}」 또는 「${m.nameOnly}」만 — 글마다 둘 중 랜덤 (${m.domainLabel} 점 앞뒤 공백, https·bare URL 금지)`;
}
