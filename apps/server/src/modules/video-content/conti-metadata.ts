import type { GenerationConditions } from './types.js';

export interface ContiMetadataTags {
  relationshipAxis: string;
  emotionCurve: string;
  hookType: string;
  hookSubtype: string;
  cutType: 'multi_shot';
  duration: number;
  situationAxis?: string;
}

const METADATA_LINE_RE =
  /\[관계축:\s*([^\]]+?)\]\s*\[감정곡선:\s*([^\]]+?)\]\s*\[hook_type:\s*([^\]]+?)\]\s*\[hook_subtype:\s*([^\]]+?)\]\s*\[cut_type:\s*([^\]]+?)\]\s*\[duration:\s*(\d+)\]/;

const SITUATION_RE = /\[상황축:\s*([^\]]+?)\]/;

export function buildMetadataTagInstruction(expected: ContiMetadataTags): string {
  const situationPart = expected.situationAxis ? `[상황축: ${expected.situationAxis}] ` : '';
  return (
    `JSON 출력 뒤 마지막 줄에 아래 형식으로 사용한 조건을 그대로 명시하라 (JSON 밖 별도 한 줄):\n` +
    `${situationPart}[관계축: ${expected.relationshipAxis}] [감정곡선: ${expected.emotionCurve}] ` +
    `[hook_type: ${expected.hookType}] [hook_subtype: ${expected.hookSubtype}] ` +
    `[cut_type: multi_shot] [duration: ${expected.duration}]`
  );
}

export function parseContiMetadataTags(raw: string): ContiMetadataTags | null {
  const lines = raw.trim().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    const match = line.match(METADATA_LINE_RE);
    if (!match) continue;

    const situationMatch = line.match(SITUATION_RE);
    return {
      relationshipAxis: match[1]!.trim(),
      emotionCurve: match[2]!.trim(),
      hookType: match[3]!.trim(),
      hookSubtype: match[4]!.trim(),
      cutType: 'multi_shot',
      duration: Number(match[6]),
      situationAxis: situationMatch?.[1]?.trim(),
    };
  }
  return null;
}

export function validateContiMetadataTags(
  parsed: ContiMetadataTags,
  expected: ContiMetadataTags,
): { ok: true } | { ok: false; message: string } {
  const checks: Array<[string, string, string]> = [
    ['관계축', parsed.relationshipAxis, expected.relationshipAxis],
    ['감정곡선', parsed.emotionCurve, expected.emotionCurve],
    ['hook_type', parsed.hookType, expected.hookType],
    ['hook_subtype', parsed.hookSubtype, expected.hookSubtype],
  ];
  if (expected.situationAxis) {
    checks.push(['상황축', parsed.situationAxis ?? '', expected.situationAxis]);
  }

  for (const [label, got, want] of checks) {
    if (got !== want) {
      return { ok: false, message: `메타 태그 ${label} 불일치: 응답 "${got}", 기대 "${want}"` };
    }
  }

  if (parsed.cutType !== 'multi_shot') {
    return { ok: false, message: 'cut_type은 multi_shot만 허용' };
  }
  if (parsed.duration !== expected.duration) {
    return { ok: false, message: `duration 불일치: ${parsed.duration} ≠ ${expected.duration}` };
  }

  return { ok: true };
}

export function metadataTagsFromConditions(
  conditions: GenerationConditions & { hookSubtype: string },
): ContiMetadataTags {
  return {
    relationshipAxis: conditions.relationshipAxis,
    emotionCurve: conditions.emotionCurve,
    hookType: conditions.hookType,
    hookSubtype: conditions.hookSubtype,
    cutType: 'multi_shot',
    duration: conditions.duration,
    situationAxis: conditions.situationAxis,
  };
}
