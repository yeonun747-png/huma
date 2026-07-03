import type { Workspace } from '@huma/shared';
import { askClaudeWithModel } from '../../lib/anthropic-client.js';
import { callClaudeJsonWithRetry } from '../../lib/llm-json.js';
import { getMainClaudeModel } from '../../lib/ai-engine.js';
import { SERVICE_URLS, type PlatformCaptions, type VideoConti } from './types.js';

function normalizePlatformCaptions(parsed: Record<string, unknown>): PlatformCaptions {
  const text = (key: string) => String(parsed[key] ?? '').trim();
  const nullable = (key: string): string | null => {
    const v = parsed[key];
    if (v == null || v === 'null') return null;
    const s = String(v).trim();
    return s || null;
  };

  let captionYoutubeTitle = text('captionYoutubeTitle') || text('youtubeTitle');
  let captionYoutubeDescription = text('captionYoutubeDescription') || text('youtubeDescription');
  if (!captionYoutubeTitle && !captionYoutubeDescription) {
    const legacy = text('captionYoutube');
    if (legacy) captionYoutubeDescription = legacy;
  }

  return {
    captionYoutubeTitle,
    captionYoutubeDescription,
    captionTiktok: text('captionTiktok'),
    captionInstagram: text('captionInstagram'),
    captionThreads: text('captionThreads'),
    captionX: text('captionX'),
    firstCommentThreads: nullable('firstCommentThreads'),
    firstCommentX: nullable('firstCommentX'),
  };
}

export function fallbackPlatformCaptions(workspace: Workspace, conti: VideoConti): PlatformCaptions {
  const summary = (conti.scenarioSummary ?? conti.fullText ?? '숏폼 영상').trim().slice(0, 280);
  const url = SERVICE_URLS[workspace];
  const linkComment = url ? `👉 ${url}` : null;
  const shortTitle = summary.slice(0, 70);
  return {
    captionYoutubeTitle: `${shortTitle} #Shorts`,
    captionYoutubeDescription: url ? `${summary}\n\n${url}` : summary,
    captionTiktok: summary,
    captionInstagram: summary,
    captionThreads: summary,
    captionX: summary,
    firstCommentThreads: linkComment,
    firstCommentX: linkComment,
  };
}

export async function generatePlatformCaptions(params: {
  workspace: Workspace;
  conti: VideoConti;
  hookType: string;
  recentCaptions?: string[];
}): Promise<PlatformCaptions> {
  const serviceUrl = SERVICE_URLS[params.workspace];
  const recentBlock =
    params.recentCaptions?.length ?
      `\n직전 캡션 (표현 겹치지 말 것):\n${params.recentCaptions.join('\n---\n')}\n`
    : '';

  const model = (await getMainClaudeModel()) || 'claude-sonnet-4-6';
  const prompt = `아래 영상 콘티를 바탕으로 5개 플랫폼용 캡션을 JSON으로 작성.

콘티 요약: ${params.conti.scenarioSummary}
펀치라인 유형: ${params.hookType}
서비스 URL: ${serviceUrl}
${recentBlock}

플랫폼별 규칙:
- youtube (YouTube Shorts — 제목·설명 입력란이 분리됨):
  - captionYoutubeTitle: 「제목」 입력란 — 1줄 짧은 제목 + 해시태그 3~5개 + #Shorts (100자 이내, URL·긴 설명 금지)
  - captionYoutubeDescription: 「설명」 입력란 — 2~4줄 긴 설명 + 서비스 URL (해시태그·#Shorts 금지)
- tiktok: 1~2줄 + 해시태그 3~5개, URL 본문 금지, 프로필 링크 유도(매번 다른 표현)
- instagram: tiktok과 동일
- threads: 1~2줄 + "첫 댓글에 링크" 유도, firstCommentThreads에 URL 포함 댓글
- x: 1~2줄 + firstCommentX에 URL 포함 댓글 (첫 댓글 유도 방식)

JSON 문자열 값 안의 큰따옴표(")는 반드시 \\" 로 이스케이프하거나 「」 따옴표를 쓴다.

JSON:
{
  "captionYoutubeTitle": "짧은 제목 #해시태그 #Shorts",
  "captionYoutubeDescription": "2~4줄 설명\\n\\n${serviceUrl}",
  "captionTiktok": "...",
  "captionInstagram": "...",
  "captionThreads": "...",
  "captionX": "...",
  "firstCommentThreads": "URL 포함 댓글 또는 null",
  "firstCommentX": "URL 포함 댓글 또는 null"
}`;

  const { parsed } = await callClaudeJsonWithRetry<Record<string, unknown>>({
    model,
    max_tokens: 2048,
    prompt,
    ask: (p) => askClaudeWithModel(p),
  });
  return normalizePlatformCaptions(parsed);
}
