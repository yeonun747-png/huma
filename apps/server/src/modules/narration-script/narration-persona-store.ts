import { supabase } from '../../middleware/auth.js';
import type { NarrationScriptWorkspace } from '@huma/shared';
import { buildDefaultNarrationPersonaText } from '@huma/shared';

export async function ensureNarrationPersonaSeeded(workspace: NarrationScriptWorkspace): Promise<void> {
  const { data } = await supabase
    .from('huma_narration_persona')
    .select('workspace')
    .eq('workspace', workspace)
    .maybeSingle();
  if (data) return;

  await supabase.from('huma_narration_persona').insert({
    workspace,
    persona_text: buildDefaultNarrationPersonaText(workspace),
  });
}

export async function loadNarrationPersonaText(workspace: NarrationScriptWorkspace): Promise<string> {
  const fallback = buildDefaultNarrationPersonaText(workspace);
  try {
    await ensureNarrationPersonaSeeded(workspace);
    const { data, error } = await supabase
      .from('huma_narration_persona')
      .select('persona_text')
      .eq('workspace', workspace)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const text = String(data?.persona_text ?? '').trim();
    return text || fallback;
  } catch {
    return fallback;
  }
}

export async function saveNarrationPersonaText(
  workspace: NarrationScriptWorkspace,
  personaText: string,
): Promise<{ updatedAt: string }> {
  const updatedAt = new Date().toISOString();
  const { error } = await supabase.from('huma_narration_persona').upsert({
    workspace,
    persona_text: personaText,
    updated_at: updatedAt,
  });
  if (error) throw new Error(error.message);
  return { updatedAt };
}

export async function getNarrationPersonaMeta(workspace: NarrationScriptWorkspace): Promise<{
  workspace: NarrationScriptWorkspace;
  personaText: string;
  updatedAt: string | null;
  isDefault: boolean;
}> {
  await ensureNarrationPersonaSeeded(workspace);
  const { data, error } = await supabase
    .from('huma_narration_persona')
    .select('persona_text, updated_at')
    .eq('workspace', workspace)
    .maybeSingle();
  if (error) throw new Error(error.message);

  const personaText = String(data?.persona_text ?? '').trim();
  const defaultText = buildDefaultNarrationPersonaText(workspace);
  return {
    workspace,
    personaText: personaText || defaultText,
    updatedAt: data?.updated_at ? String(data.updated_at) : null,
    isDefault: !personaText || personaText === defaultText,
  };
}
