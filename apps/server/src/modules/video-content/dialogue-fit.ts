import { askClaudeWithModel } from '../../lib/anthropic-client.js';
import { callClaudeJsonWithRetry } from '../../lib/llm-json.js';
import {
  buildDialogueBudgetBlockForConti,
  contiNeedsDialogueBudgetFit,
  countDialogueSpokenChars,
  DIALOGUE_MAX_CHARS_PER_SEC,
  enforceDialogueOnConti,
  maxDialogueCharsForDuration,
} from './dialogue-timing.js';
import { buildYeonunFortuneDialogueRule } from './screen-text-constraint.js';
import type { VideoConti } from './types.js';
import { asContiShots } from './types.js';

export const MAX_DIALOGUE_FIT_ATTEMPTS = 1;
const DIALOGUE_FIT_TIMEOUT_MS = 45_000;

function shotDurationSec(shot: { startSec: number; endSec: number }): number {
  const d = shot.endSec - shot.startSec;
  return d > 0 ? d : 0;
}

function buildDialogueFitPrompt(conti: VideoConti, workspace?: string): string {
  const shots = asContiShots(conti.shots);
  const shotLines = shots
    .map((shot) => {
      const dur = shotDurationSec(shot);
      const max = maxDialogueCharsForDuration(dur);
      const cur = countDialogueSpokenChars(shot.dialogue ?? '');
      return `샷${shot.shotNumber} (${shot.startSec}~${shot.endSec}s, 최대 ${max}자, 현재 ${cur}자)
  action: ${shot.action ?? ''}
  dialogue: ${shot.dialogue ?? '(없음)'}`;
    })
    .join('\n\n');

  const yeonunBlock = workspace === 'yeonun' ? `\n${buildYeonunFortuneDialogueRule()}\n` : '';

  return `한국어 숏폼 콘티 — 각 샷 dialogue를 **확정된 타임라인**에 맞게 압축하라.

규칙:
- 샷별 dialogue 본문(공백 제외) ≤ 샷 초×${DIALOGUE_MAX_CHARS_PER_SEC}자. 의미·펀치라인·반전은 유지.
- action·camera·startSec·endSec는 변경하지 않는다. dialogue만 수정.
- 연운·운세 경고 문구 **전문**은 최초 setup 샷 1곳에만. 다른 화자는 "똑같은 경고 봤어요"처럼 짧게 참조(전문 반복 금지).
- 한 샷에 A·B 두 대사가 필요하면 각각 예산 안에 들어가게 더 짧게.
- A/B 라벨·완결된 문장 유지. JSON 문자열 안 큰따옴표는 \\" 또는 「」.
${yeonunBlock}
${buildDialogueBudgetBlockForConti(conti)}

현재 샷:
${shotLines}

JSON만:
{
  "shots": [
    {"shotNumber": 1, "dialogue": "A: \\"...\\""},
    ...
  ]
}`;
}

export async function fitContiDialogueToBudget(params: {
  conti: VideoConti;
  model: string;
  workspace?: string;
}): Promise<{ conti: VideoConti; adjusted: boolean; warnings: string[] }> {
  const warnings: string[] = [];
  if (!contiNeedsDialogueBudgetFit(params.conti)) {
    return { conti: params.conti, adjusted: false, warnings };
  }

  let conti = params.conti;
  let adjusted = false;

  for (let attempt = 0; attempt < MAX_DIALOGUE_FIT_ATTEMPTS; attempt++) {
    if (!contiNeedsDialogueBudgetFit(conti)) break;

    try {
      const prompt = buildDialogueFitPrompt(conti, params.workspace);
      const { parsed } = await callClaudeJsonWithRetry<{ shots?: Array<{ shotNumber?: number; dialogue?: string }> }>({
        model: params.model,
        max_tokens: 2048,
        prompt,
        ask: (p) => askClaudeWithModel({ ...p, timeout_ms: DIALOGUE_FIT_TIMEOUT_MS }),
      });

      const patches = Array.isArray(parsed.shots) ? parsed.shots : [];
      if (!patches.length) break;

      const byNumber = new Map(patches.map((p) => [Number(p.shotNumber), p.dialogue]));
      const shots = asContiShots(conti.shots).map((shot) => {
        const num = shot.shotNumber ?? 0;
        const next = byNumber.get(num);
        if (next == null || !String(next).trim()) return shot;
        return { ...shot, dialogue: String(next).trim() };
      });
      conti = { ...conti, shots };
      adjusted = true;
    } catch (err) {
      warnings.push(`대사 예산 LLM 압축 실패: ${(err as Error).message.slice(0, 120)}`);
      break;
    }
  }

  if (contiNeedsDialogueBudgetFit(conti)) {
    const mechanical = enforceDialogueOnConti(conti);
    if (mechanical.adjusted) {
      conti = mechanical.conti;
      adjusted = true;
      warnings.push(`대사 예산 기계 축소 (${DIALOGUE_MAX_CHARS_PER_SEC}자/초)`);
    }
  }

  return { conti, adjusted, warnings };
}
