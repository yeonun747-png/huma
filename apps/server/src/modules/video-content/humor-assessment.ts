import { askClaudeWithModel } from '../../lib/anthropic-client.js';
import { getSubClaudeModel } from '../../lib/ai-engine.js';
import { hasDialogueDuplicate } from './dialogue-duplicate.js';
import type { VideoConti } from './types.js';
import { asContiShots } from './types.js';

export const MAX_HUMOR_REGENERATION_ATTEMPTS = 1;

export const HUMOR_REGENERATION_FEEDBACK =
  '이 콘티는 보고 나서 웃기거나 놀랍거나 흥미롭다는 느낌이 부족하거나, 끝까지 봐도 "그래서 뭐?"가 남는다고 평가됐다. ' +
  '펀치라인 아이디어(punchline_idea)와 3a단계 이야기(storyDraft)는 고정 — 1~2단계·3a 재실행 금지. ' +
  '3b단계 형식 변환만 다시 하며, shots(action/dialogue)만 고쳐라. 3a 서술의 사건 순서·결말은 유지한다.\n\n' +
  '필수 보완 (이해·펀치 전달):\n' +
  '- 펀치라인·말장난·반전은 **대사만으로도** 시청자가 즉시 이해할 수 있게. action에 번호표·스케치북 숫자·라벨 글자를 적어 두고 대사로는 힌트만 주면 안 된다.\n' +
  '- 말장난(예: 전화번호 vs 대기번호)이면 **양쪽 의미가 대사에 드러나야** 한다. 앞 샷 setup 없이 펀치 샷에서만 숫자·소품을 꺼내지 말 것.\n' +
  '- 마지막 1~2샷 대사로 "왜 웃기거나 놀라운지" 한 문장에 정리되게. 표정·동작·화면 속 글자에만 의존하지 말 것.\n' +
  '- ❌ 스케치북 47·번호표 48처럼 action 숫자만으로 반전 설명 / 대사 "…48번이요?"만으로는 dull\n' +
  '- ✅ A: "번호 그려도 돼요?" → B: "그거 줄 서서 받은 대기표예요. 나 밥 먹으러 앉은 건데."처럼 대사로 오해·반전 완결';

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

이 영상을 실제로 봤다고 가정하고 평가하라. 핵심 질문: **끝까지 본 일반 시청자가 "아, 그래서 웃긴/놀라운 거구나"를 즉시 말할 수 있는가?** 못 하면 dull.

funny (하나만 해당해도 funny):
- 피식·킥킥·미소·짧은 "헐/오" 정도의 반응
- setup→펀치가 대사·행동만으로 연결되어 이해 가능
- 말장난·오해·반전이 **대사에 의미가 드러나** 숫자·라벨·화면 글자를 읽지 않아도 통함

dull (아래 중 하나라도 해당하면 dull):
- 끝까지 봐도 "그래서 뭐?" "뭔 소리?"가 남음 — 작가 의도는 있어도 **전달 실패**면 dull
- 펀치·말장난이 번호표·스케치북 숫자·명찰·문서 글자 등 **action의 시각 정보**에만 의존하고, 대사만으로는 반전이 안 잡힘
- 말장난(동음·이의·오해)인데 **한쪽 의미만** 대사에 있고 다른 쪽은 action·숫자·소품에만 있음 (예: "번호" flirt인데 상대 반응이 "48번" 숫자만)
- 펀치에 필요한 정보(숫자·물건 의미)가 **앞 샷 setup 없이** 펀치 샷에서 갑자기 등장
- setup과 결말이 끊기거나, 표정·동작·여운만으로 끝나 반전 이유가 전혀 안 보임
- 전체가 일상 나열·설명처럼 흘러가고 펀치·감정 반응이 거의 없음

주의:
- 미묘한 반전·씁쓸한 유머도 **이해 가능하면** funny.
- "더 세게 웃겨야 한다"만으로 dull 판정하지 말 것.
- **이해 불가 vs 약한 유머**를 구분: 약해도 이해되면 funny, 이해 안 되면 dull.

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
