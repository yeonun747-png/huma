import type { Workspace } from '@huma/shared';
import { serializeVideoPersonaText } from '@huma/shared';
import { supabase } from '../../middleware/auth.js';
import { DEFAULT_VIDEO_PERSONAS } from './types.js';

const HOOK_SUBTYPES: Record<Workspace, string[]> = {
  yeonun: ['정체 반전', '영역 전환', '동시성 반전', '의미 전환', '시제 반전'],
  quizoasis: ['행동-성격 연결형', '폭로형', '역할 반전형', '동시성형'],
  panana: ['숨은 디테일 캐치', '톤 뒤집기', '캐릭터 특유 반응', '예상 밖 공감'],
};

/** v3.59 seed — DEFAULT + ## hook_subtype (§15 전문은 UI에서 교체 가능) */
export function buildSeedPersonaText(workspace: Workspace): string {
  const base = serializeVideoPersonaText(DEFAULT_VIDEO_PERSONAS[workspace], workspace);
  const subtypeBlock = ['## hook_subtype', ...HOOK_SUBTYPES[workspace].map((s) => `- ${s}`)].join('\n');
  if (base.includes('## hook_subtype')) return base;
  return base.replace('## 컷 구성', `${subtypeBlock}\n\n## 컷 구성`);
}

export async function ensureVideoPersonaSeeded(workspace: Workspace): Promise<void> {
  const { data } = await supabase.from('huma_video_persona').select('workspace').eq('workspace', workspace).maybeSingle();
  if (data) return;

  await supabase.from('huma_video_persona').insert({
    workspace,
    persona_text: buildSeedPersonaText(workspace),
  });
}

export async function loadVideoPersonaText(workspace: Workspace): Promise<string> {
  await ensureVideoPersonaSeeded(workspace);
  const { data, error } = await supabase
    .from('huma_video_persona')
    .select('persona_text')
    .eq('workspace', workspace)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data?.persona_text?.trim()) {
    return buildSeedPersonaText(workspace);
  }
  return String(data.persona_text);
}

export async function saveVideoPersonaText(workspace: Workspace, personaText: string): Promise<void> {
  const { error } = await supabase.from('huma_video_persona').upsert({
    workspace,
    persona_text: personaText,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}
