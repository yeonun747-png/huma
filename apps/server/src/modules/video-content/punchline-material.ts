import type { VideoContiShot } from './types.js';

export const MAX_CORE_MATERIAL_RETRIES = 2;

export interface CoreMaterialPlacement {
  material: string;
  shotNumber: number;
}

/** must_include에서 제외 — 읽어야 하는 화면/문서류 */
const UNFILMABLE_PROP_RE =
  /(?:결과\s*페이지|앱\s*화면|화면\s*텍스트|사주\s*결과|글자|문구|이름이\s*적|적힌|적혀|쓰여|표시|노출|확인서|증명서|문서\s*내용|페이지가\s*보|화면에\s*보)/u;

export function filterFilmableMustIncludeProps(props: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of props) {
    const label = raw.trim().replace(/\s+/g, ' ');
    if (label.length < 2 || label.length > 24) continue;
    if (UNFILMABLE_PROP_RE.test(label)) continue;
    const key = normalizeMaterialKey(label);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

export function normalizeMaterialKey(material: string): string {
  return material.trim().replace(/\s+/g, '').toLowerCase();
}

export function parseCoreMaterialTagLine(line: string): CoreMaterialPlacement[] {
  const match = line.match(/\[핵심소재:\s*([^\]]+)\]/u);
  if (!match) return [];

  const out: CoreMaterialPlacement[] = [];
  for (const part of match[1]!.split(',')) {
    const trimmed = part.trim();
    const item = trimmed.match(/^(.+?)\s*→\s*샷\s*(\d+)/u);
    if (!item) continue;
    out.push({ material: item[1]!.trim(), shotNumber: Number(item[2]) });
  }
  return out;
}

export function parseCoreMaterialTagsFromResponse(raw: string): CoreMaterialPlacement[] {
  const lines = raw.trim().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const placements = parseCoreMaterialTagLine(lines[i]!);
    if (placements.length) return placements;
  }
  return [];
}

export function materialAppearsInShotText(
  material: string,
  action: string | undefined | null,
  dialogue: string | undefined | null,
): boolean {
  const key = normalizeMaterialKey(material);
  if (key.length < 2) return false;

  const combined = normalizeMaterialKey(`${action ?? ''} ${dialogue ?? ''}`);
  if (combined.includes(key)) return true;

  const tokens = material.split(/\s+/).filter((t) => t.length >= 2);
  if (tokens.length >= 2) {
    return tokens.every((t) => combined.includes(normalizeMaterialKey(t)));
  }
  return false;
}

function propsMatchInTag(prop: string, placements: CoreMaterialPlacement[]): boolean {
  const key = normalizeMaterialKey(prop);
  return placements.some((p) => {
    const pk = normalizeMaterialKey(p.material);
    return pk === key || pk.includes(key) || key.includes(pk);
  });
}

export function buildMaterialMissingFeedback(material: string, kind: 'tag' | 'shot'): string {
  if (kind === 'tag') {
    return (
      `선택된 펀치라인의 핵심 소재 "${material}"이 [핵심소재: …] 태그에 누락되었다. ` +
      'must_include 소재마다 실제 배치 샷 번호와 함께 태그하라.'
    );
  }
  return (
    `선택된 펀치라인의 핵심 소재 "${material}"이 실제 샷 콘티 action/dialogue에 반영되지 않았다. ` +
    '이 소재를 반드시 샷 어딘가에 포함시켜 다시 작성하라.'
  );
}

export function validateCoreMaterials(params: {
  mustIncludeProps: string[];
  placements: CoreMaterialPlacement[];
  shots: VideoContiShot[];
}): { ok: true } | { ok: false; message: string; missingMaterials: string[] } {
  const { mustIncludeProps, placements, shots } = params;
  if (!mustIncludeProps.length) return { ok: true };

  if (!placements.length) {
    return {
      ok: false,
      message:
        '[핵심소재: … → 샷N] 태그가 없습니다. must_include 소재마다 실제 배치 샷 번호를 명시하라.',
      missingMaterials: [...mustIncludeProps],
    };
  }

  const missingFromTag = mustIncludeProps.filter((prop) => !propsMatchInTag(prop, placements));
  if (missingFromTag.length) {
    return {
      ok: false,
      message: buildMaterialMissingFeedback(missingFromTag[0]!, 'tag'),
      missingMaterials: missingFromTag,
    };
  }

  for (const placement of placements) {
    const shot =
      shots.find((s) => s.shotNumber === placement.shotNumber) ?? shots[placement.shotNumber - 1];
    if (!shot) {
      return {
        ok: false,
        message: `핵심소재 태그의 샷${placement.shotNumber}이 존재하지 않습니다.`,
        missingMaterials: [placement.material],
      };
    }
    if (!materialAppearsInShotText(placement.material, shot.action, shot.dialogue)) {
      return {
        ok: false,
        message: `핵심소재 "${placement.material}"이 샷${placement.shotNumber} action/dialogue에 실제로 등장하지 않습니다.`,
        missingMaterials: [placement.material],
      };
    }
  }

  const missingInShots = mustIncludeProps.filter(
    (prop) =>
      !shots.some((shot) => materialAppearsInShotText(prop, shot.action, shot.dialogue)),
  );
  if (missingInShots.length) {
    return {
      ok: false,
      message: buildMaterialMissingFeedback(missingInShots[0]!, 'shot'),
      missingMaterials: missingInShots,
    };
  }

  return { ok: true };
}

export function buildCoreMaterialShotsInstruction(mustIncludeProps: string[]): string {
  if (!mustIncludeProps.length) return '';

  const list = mustIncludeProps.map((p) => `- ${p}`).join('\n');
  return `
콘티 shots JSON 작성 전 필수:
1) 아래 must_include 소재(촬영 가능한 소품·동작)를 펀치라인에 맞게 각각 최소 1개 샷에 배치할 것을 먼저 정한다.
2) 소재를 다른 것으로 바꾸거나 빠뜨리지 않는다.
3) 앱 화면 글자·사주 결과 페이지·이름이 적힌 문서·"보이도록 각도를 잡음" 등 "읽어야 하는 화면"은 must_include가 아니다 — 스마트폰/종이 소품만 보이고 정보는 dialogue로.

must_include (고정):
${list}

JSON 뒤 메타 태그 줄에 must_include 소재마다 [핵심소재: 소재1 → 샷2, 소재2 → 샷4] 형식 추가 (JSON 밖).`;
}
