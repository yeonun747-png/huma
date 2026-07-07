/** 브루(Vrew) 나레이션 대본 — 연운·포춘82 */
export type NarrationScriptWorkspace = 'yeonun' | 'fortune82';

export type NarrationFormatType = 'full_cover' | 'ranked';

export type NarrationAxisType = 'zodiac' | 'constellation' | 'generation';

export type NarrationScriptStatus = 'script_generating' | 'script_ready' | 'failed';

export interface HumaNarrationScriptHistory {
  id: string;
  workspace: NarrationScriptWorkspace;
  format_type: NarrationFormatType;
  axis_type: NarrationAxisType;
  topic_key: string;
  topic_label: string;
  title: string;
  script_body: string;
  status: NarrationScriptStatus;
  error_message?: string | null;
  source_meta?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export const NARRATION_FORMAT_LABEL: Record<NarrationFormatType, string> = {
  full_cover: '전체커버형',
  ranked: '순위특집형',
};

export const NARRATION_AXIS_LABEL: Record<NarrationAxisType, string> = {
  zodiac: '띠',
  constellation: '별자리',
  generation: '연령대',
};

export const NARRATION_WORKSPACE_LABEL: Record<NarrationScriptWorkspace, string> = {
  yeonun: '연운',
  fortune82: '포춘82',
};

export const NARRATION_SCRIPT_STATUS_LABEL: Record<NarrationScriptStatus, string> = {
  script_generating: '생성 중',
  script_ready: '검토 대기',
  failed: '실패',
};
