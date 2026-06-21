import { askClaudeWithModel } from '../../lib/anthropic-client.js';
import { getSubClaudeModel } from '../../lib/ai-engine.js';
import { hasDialogueDuplicate } from './dialogue-duplicate.js';
import type { VideoConti } from './types.js';
import { asContiShots } from './types.js';

export const MAX_HUMOR_REGENERATION_ATTEMPTS = 1;

export const HUMOR_REGENERATION_FEEDBACK =
  '이 콘티는 보고 나서 웃기거나 놀랍거나 흥미롭다는 느낌이 부족하다고 평가됐다. ' +
  '펀치라인 아이디어(punchline_idea)와 3a단계 이야기(storyDraft)는 고정 — 1~2단계·3a 재실행 금지. ' +
  '3b단계 형식 변환만 다시 하며, shots(action/dialogue)의 재미·펀치 강도를 높이되 3a 서술의 사건 순서·결말은 유지하라. ' +
  '앞 샷 setup은 최대한 유지하고 마지막 펀치라인·마지막 대사가 시청자 입에서 실제로 웃음이나 감탄이 나올 만큼 더 재미있고 의외의 방향으로 터지도록 다시 설계하라.';

export type SelfAssessedHumor = 'funny' | 'dull';

const HAIKU_FALLBACK = 'claude-haiku-4-5-20251001';

export function formatContiForHumorAssessment(conti: VideoConti): string {
  const lines: string[] = [`시나리오 요약: ${conti.scenarioSummary}`, ''];
  for (const shot of asContiShots(conti.shots)) {
    lines.push(`샷 ${shot.shotNumber} (${shot.startSec}-${shot.endSec}초)`);
    lines.push(`  카메라: ${shot.camera}`);
    lines.push(`  액션: ${shot.action}`);
    if (shot.dialogue?.trim()) lines.push(`  대사: ${shot.dialogue}`);
    lines.push('');
  }
  return lines.join('\n').trim();
}

function buildHumorAssessmentPrompt(contiText: string): string {
  return `다음은 11~15초짜리 짧은 영상 콘티 전체이다.
${contiText}

이 영상을 실제로 봤다고 가정하고 평가하라. dull은 "재미가 거의 없다"는 경우에만 쓴다. 기준은 관대하게 적용한다.

funny로 볼 수 있는 경우 (하나만 해당해도 funny):
- 피식·킥킥·미소 정도의 가벼운 웃음
- "헐" "오" "아 그렇구나" 같은 짧은 놀람·공감·의외성
- 친구에게 보낼 정도는 아니어도, 끝까지 보게 만드는 호기심·펀치가 있음
- 펀치라인/setup이 짧은 숏폼에 맞게 전달되면, 대작·바이럴급은 아니어도 funny

dull로 판정하는 경우 (아래에 해당할 때만):
- setup과 결말이 연결되지 않아 "그래서 뭐?"가 남음 (표정·동작만으로 끝나 반전 이유가 전혀 안 보일 때)
- 읽어야만 알 수 있는 화면·라벨·명찰에만 의존해 숏폼만으로는 이해 불가
- 전체가 설명·일상 나열처럼 흘러가고 펀치·반전·감정 반응이 거의 없음

주의:
- 미묘한 반전·여운·씁쓸한 유머도 funny 가능. "더 세게 웃겨야 한다"는 이유만으로 dull 금지.
- 샷·대사가 완벽하지 않아도 펀치라인 의도가 읽히면 funny.
- 애매하면 dull보다 funny를 선택한다.

funny 또는 dull 중 하나의 단어로만 답하라.`;
}

export function parseHumorVerdict(raw: string | null | undefined): SelfAssessedHumor {
  if (!raw?.trim()) return 'dull';
  const normalized = raw.trim().toLowerCase();
  const word = normalized.split(/\s+/)[0]?.replace(/[^a-z]/g, '') ?? '';
  if (word === 'funny') return 'funny';
  return 'dull';
}

export async function assessContiHumor(conti: VideoConti): Promise<SelfAssessedHumor> {
  if (hasDialogueDuplicate(conti)) return 'dull';

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
