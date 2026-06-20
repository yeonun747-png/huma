import type { Workspace } from '@huma/shared';
import { askClaudeWithModel } from '../../lib/anthropic-client.js';
import { getMainClaudeModel } from '../../lib/ai-engine.js';
import { SERVICE_URLS, type PlatformCaptions, type VideoConti } from './types.js';

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
- youtube: 짧은 캡션 + 2~4줄 긴 설명(서비스 URL 포함) + 해시태그 3~5개
- tiktok: 1~2줄 + 해시태그 3~5개, URL 본문 금지, 프로필 링크 유도(매번 다른 표현)
- instagram: tiktok과 동일
- threads: 1~2줄 + "첫 댓글에 링크" 유도, firstCommentThreads에 URL 포함 댓글
- x: 1~2줄 + firstCommentX에 URL 포함 댓글 (첫 댓글 유도 방식)

JSON:
{
  "captionYoutube": "완성 텍스트",
  "captionTiktok": "...",
  "captionInstagram": "...",
  "captionThreads": "...",
  "captionX": "...",
  "firstCommentThreads": "URL 포함 댓글 또는 null",
  "firstCommentX": "URL 포함 댓글 또는 null"
}`;

  const raw = await askClaudeWithModel({ model, max_tokens: 2048, prompt });
  if (!raw) throw new Error('캡션 LLM 응답 없음');

  const trimmed = raw.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1]!.trim() : trimmed;
  const parsed = JSON.parse(body) as PlatformCaptions;
  return parsed;
}
