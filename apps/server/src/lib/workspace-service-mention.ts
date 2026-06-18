import {
  resolveWorkspaceServiceMention,
  workspaceServiceMentionPromptGuide,
  workspaceServiceMentionRuleLine,
  WORKSPACE_SERVICE_MENTIONS,
  type WorkspaceServiceMention,
} from '@huma/shared';

export {
  resolveWorkspaceServiceMention,
  workspaceServiceMentionPromptGuide,
  workspaceServiceMentionRuleLine,
  WORKSPACE_SERVICE_MENTIONS,
  type WorkspaceServiceMention,
};

/** @deprecated use resolveWorkspaceServiceMention('yeonun').withDomain */
export const YEONUN_BODY_LINK_LABEL = WORKSPACE_SERVICE_MENTIONS.yeonun.withDomain;

/** Claude가 bare URL/도메인을 쓴 경우 spaced 라벨로 정규화 (발행 strip 회피) */
export function normalizeServiceMentionsInPost(text: string, workspace: string): string {
  const m = resolveWorkspaceServiceMention(workspace);
  let out = text;

  for (const host of m.bareHosts) {
    const escaped = host.replace(/\./g, '\\.');
    out = out.replace(new RegExp(`https?:\\/\\/(www\\.)?${escaped}[^\\s\\n]*`, 'gi'), m.withDomain);
    out = out.replace(new RegExp(`\\bwww\\.${escaped}\\b`, 'gi'), m.withDomain.trim());
    out = out.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), m.withDomain.trim());
  }

  return out;
}
