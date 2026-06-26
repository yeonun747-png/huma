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

/** Claude가 bare URL/도메인·괄호 도메인을 쓴 경우 서비스 한글명만 남김 */
export function normalizeServiceMentionsInPost(text: string, workspace: string): string {
  const m = resolveWorkspaceServiceMention(workspace);
  let out = text;

  for (const host of m.bareHosts) {
    const escaped = host.replace(/\./g, '\\.');
    out = out.replace(new RegExp(`https?:\\/\\/(www\\.)?${escaped}[^\\s\\n]*`, 'gi'), m.nameOnly);
    out = out.replace(new RegExp(`\\bwww\\.${escaped}\\b`, 'gi'), m.nameOnly);
    out = out.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), m.nameOnly);
  }

  const domainFlexible = m.domainLabel.replace(/\./g, '\\.').replace(/\s+/g, '\\s*');
  out = out.replace(
    new RegExp(`${m.name}\\s*\\(\\s*${domainFlexible}\\s*\\)`, 'gi'),
    m.nameOnly,
  );
  out = out.replace(new RegExp(`\\b${m.name}\\s*\\([^)]*${domainFlexible}[^)]*\\)`, 'gi'), m.nameOnly);

  const withTrim = m.withDomain.trim();
  if (withTrim) {
    const withEscaped = withTrim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(withEscaped, 'g'), m.nameOnly);
  }

  return out;
}
