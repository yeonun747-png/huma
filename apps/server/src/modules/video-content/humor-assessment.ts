import { askClaudeWithModel } from '../../lib/anthropic-client.js';
import { getSubClaudeModel } from '../../lib/ai-engine.js';
import type { VideoConti } from './types.js';

export const MAX_HUMOR_REGENERATION_ATTEMPTS = 2;

export const HUMOR_REGENERATION_FEEDBACK =
  '이 콘티는 보고 나서 웃기거나 놀랍거나 흥미롭다는 느낌이 부족하다고 평가됐다. 같은 시나리오 조건(관계축, 감정곡선, 장소)은 유지하되, 앞 샷 setup은 최대한 유지하고 마지막 펀치라인·마지막 대사가 시청자 입에서 실제로 웃음이나 감탄이 나올 만큼 더 재미있고 의외의 방향으로 터지도록 다시 설계하라. 단순히 반전 구조를 따르는 것보다 실제로 웃기거나 놀라운 내용 자체가 더 중요하다.';

export type SelfAssessedHumor = 'funny' | 'dull';

const HAIKU_FALLBACK = 'claude-haiku-4-5-20251001';

export function formatContiForHumorAssessment(conti: VideoConti): string {
  const lines: string[] = [`시나리오 요약: ${conti.scenarioSummary}`, ''];
  for (const shot of conti.shots) {
    lines.push(`샷 ${shot.shotNumber} (${shot.startSec}-${shot.endSec}초)`);
    lines.push(`  카메라: ${shot.camera}`);
    lines.push(`  액션: ${shot.action}`);
    if (shot.dialogue?.trim()) lines.push(`  대사: ${shot.dialogue}`);
    lines.push('');
  }
  return lines.join('\n').trim();
}

function buildHumorAssessmentPrompt(contiText: string): string {
  return `다음은 15초짜리 짧은 영상 콘티 전체이다.
${contiText}

이 영상을 실제로 봤다고 가정하고 평가하라. 다 보고 난 시청자가 아래 중 하나의 반응을 보일 만큼 재미있는가?
- 킥킥대며 웃을 만큼 웃긴가
- '헐, 대박' 하고 놀랄 만큼 흥미로운가
- '아 웃겨' 하면서 친구한테 캡처해서 보내고 싶을 만큼 재밌는가

위 세 가지 중 하나에도 해당하지 않고, 그냥 무난하게 흘러가다 끝나는 느낌이라면 funny 대신 dull로 판정한다.

추가 기준: 이 콘티의 펀치라인이 왜 재미있거나 놀라운지, 그 이유가 콘티 안의 정보만으로 명확히 설명되는가?
시청자가 "그래서 뭐가 반전이었다는 거지?"라고 헷갈릴 만한 부분(마지막 샷이 표정·동작만으로 끝나거나, 읽어야만 알 수 있는 라벨·스티커·명찰에만 의존하는 경우)이 있다면 dull로 판정한다.

funny 또는 dull 중 하나의 단어로만 답하라.`;
}

export function parseHumorVerdict(raw: string | null | undefined): SelfAssessedHumor {
  if (!raw) return 'dull';
  const normalized = raw.trim().toLowerCase();
  const word = normalized.split(/\s+/)[0]?.replace(/[^a-z]/g, '') ?? '';
  if (word === 'funny') return 'funny';
  return 'dull';
}

export async function assessContiHumor(conti: VideoConti): Promise<SelfAssessedHumor> {
  const model = (await getSubClaudeModel()) || HAIKU_FALLBACK;
  const prompt = buildHumorAssessmentPrompt(formatContiForHumorAssessment(conti));
  const raw = await askClaudeWithModel({
    model,
    max_tokens: 16,
    prompt,
    timeout_ms: 30_000,
  });
  return parseHumorVerdict(raw);
}
