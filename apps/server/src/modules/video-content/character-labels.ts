import type { VideoConti, VideoContiShot } from './types.js';
import { asContiCharacters, asContiShots } from './types.js';

function trimField(text: string | undefined | null): string {
  return (text ?? '').trim();
}

/** 시나리오·action에서 인물명 추론 시 제외 */
const CHARACTER_INFER_STOPWORDS = new Set([
  '남자',
  '여자',
  '사람',
  '팀장',
  '상사',
  '후배',
  '동료',
  '부모',
  '자녀',
  '형제',
  '연인',
  '친구',
  '이웃',
  '프로',
  '결과',
  '소문',
  '사무',
  '복도',
  '정수',
  '물을',
  '오늘',
  '이번',
  '저번',
  '막힌',
  '시기',
  '표정',
  '고개',
  '눈빛',
  '카메라',
  '장면',
  '대사',
  '행동',
  '카페',
  '공원',
  '창가',
  '벤치',
  '테이블',
  '의자',
  '전화',
  '휴대',
  '음료',
  '허공',
  '팔짱',
]);

const NAME_WITH_PARTICLE = /([가-힣]{2,4})(?:은|는|이|가|을|를|와|과|의|에게|한테)/g;

function extractNameCandidates(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(NAME_WITH_PARTICLE)) {
    const name = match[1];
    if (!name || CHARACTER_INFER_STOPWORDS.has(name)) continue;
    if (!found.includes(name)) found.push(name);
  }
  return found;
}

/** characters[].name + 시나리오·action 교차 등장 이름 → A/B 라벨 */
export function buildCharacterNameToLabelMap(conti: VideoConti): Map<string, string> {
  const map = new Map<string, string>();
  const characters = asContiCharacters(conti.characters);
  const labels = characters.map((ch) => trimField(ch.label)).filter(Boolean);

  for (const ch of characters) {
    const label = trimField(ch.label);
    const name = trimField(ch.name);
    if (label && name) map.set(name, label);
  }

  if (map.size >= labels.length) return map;

  const fromScenario = extractNameCandidates(conti.scenarioSummary);
  const actionText = asContiShots(conti.shots)
    .map((s) => trimField(s.action))
    .join('\n');
  const fromActions = extractNameCandidates(actionText);
  const confirmed = fromScenario.filter((name) => fromActions.includes(name));

  for (let i = 0; i < labels.length; i++) {
    const name = confirmed[i];
    const label = labels[i];
    if (!name || !label || map.has(name)) continue;
    map.set(name, label);
  }

  return map;
}

/** 샷 action·dialogue 본문의 실명 → A/B (EvoLink/Kling용) */
export function replaceCharacterNamesWithLabels(text: string, nameToLabel: Map<string, string>): string {
  if (!text || nameToLabel.size === 0) return text;

  let result = text;
  const names = [...nameToLabel.keys()].sort((a, b) => b.length - a.length);
  for (const name of names) {
    const label = nameToLabel.get(name)!;
    result = result.replaceAll(name, label);
  }
  return result;
}

export function normalizeDialogueForVideoPrompt(dialogue: string): string {
  return trimField(dialogue).replace(/[「」『』]/g, '');
}

export function formatEvoLinkCharacterBlock(conti: VideoConti, nameToLabel: Map<string, string>): string {
  const labelToName = new Map<string, string>();
  for (const [name, label] of nameToLabel) {
    if (!labelToName.has(label)) labelToName.set(label, name);
  }

  return asContiCharacters(conti.characters)
    .map((c) => {
      const label = trimField(c.label);
      const explicitName = trimField(c.name);
      const inferredName = labelToName.get(label);
      const name = explicitName || inferredName;
      const head = name ? `${label}(${name})` : label;
      return `${head}: ${c.age} ${c.gender}, ${c.hair}, ${c.outfit}, ${c.shoes}`;
    })
    .join('; ');
}

export function normalizeShotForEvoLinkPrompt(
  shot: VideoContiShot,
  nameToLabel: Map<string, string>,
): { action: string; dialogue?: string } {
  const action = replaceCharacterNamesWithLabels(trimField(shot.action), nameToLabel);
  const rawDialogue = trimField(shot.dialogue);
  if (!rawDialogue) return { action };

  return {
    action,
    dialogue: normalizeDialogueForVideoPrompt(replaceCharacterNamesWithLabels(rawDialogue, nameToLabel)),
  };
}

/** 샷 본문에 실명이 남아 있는지 — contentWarnings용 */
export function findRealNamesInShots(conti: VideoConti, nameToLabel: Map<string, string>): string[] {
  if (nameToLabel.size === 0) return [];
  const leaked = new Set<string>();
  for (const shot of asContiShots(conti.shots)) {
    for (const field of [shot.action, shot.dialogue]) {
      const text = trimField(field);
      if (!text) continue;
      for (const name of nameToLabel.keys()) {
        if (text.includes(name)) leaked.add(name);
      }
    }
  }
  return [...leaked];
}
