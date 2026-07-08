/** 브루(Vrew) 나레이션 대본 — 연운·포춘82 */
export type NarrationScriptWorkspace = 'yeonun' | 'fortune82';

export type NarrationFormatType = 'full_cover' | 'ranked';

export type NarrationPeriodType = 'daily' | 'weekly' | 'monthly';

export type NarrationAxisType = 'zodiac' | 'constellation' | 'generation';

export type NarrationScriptStatus = 'script_generating' | 'script_ready' | 'failed';

export interface HumaNarrationScriptHistory {
  id: string;
  workspace: NarrationScriptWorkspace;
  format_type: NarrationFormatType;
  period_type?: NarrationPeriodType;
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

export const NARRATION_PERIOD_LABEL: Record<NarrationPeriodType, string> = {
  daily: '데일리',
  weekly: '주간',
  monthly: '월간',
};

export const NARRATION_PERIOD_HINT: Record<NarrationPeriodType, string> = {
  daily: '오늘',
  weekly: '이번 주',
  monthly: '이달',
};

/** @deprecated 항상 TOP5 — resolveNarrationRankedTopN 사용 */
export const NARRATION_TOP_N = 5;

/** 순위특집 TOP N — 데일리·주간·월간 공통 TOP5 */
export function resolveNarrationRankedTopN(
  _periodType: NarrationPeriodType,
  _axisType: NarrationAxisType,
): number {
  return 5;
}

/** 주기별 형식 — 월간도 데일리·주간과 동일하게 선택 */
export function resolveNarrationFormatForPeriod(
  _periodType: NarrationPeriodType,
  formatType: NarrationFormatType,
): NarrationFormatType {
  return formatType;
}

/** 전체커버형-데일리 · 순위특집형-월간 등 표시 */
export function resolveNarrationVariantLabel(
  formatType: NarrationFormatType,
  periodType: NarrationPeriodType,
): string {
  return `${NARRATION_FORMAT_LABEL[formatType]}-${NARRATION_PERIOD_LABEL[periodType]}`;
}

export const NARRATION_PERIOD_TITLE_PREFIX: Record<NarrationPeriodType, string> = {
  daily: '오늘',
  weekly: '이번 주',
  monthly: '이번 달',
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

export interface NarrationScriptProgress {
  stage?: string;
  label: string;
  percent: number;
  sinceAt?: string;
  updatedAt?: string;
}

export function resolveNarrationScriptProgress(
  meta: Record<string, unknown> | null | undefined,
): NarrationScriptProgress | null {
  if (!meta) return null;
  const label = typeof meta.progress_label === 'string' ? meta.progress_label.trim() : '';
  const percent =
    typeof meta.progress_percent === 'number' && Number.isFinite(meta.progress_percent)
      ? Math.min(100, Math.max(0, Math.round(meta.progress_percent)))
      : null;
  if (!label && percent == null) return null;
  return {
    stage: typeof meta.progress_stage === 'string' ? meta.progress_stage : undefined,
    label: label || '대본 생성 중…',
    percent: percent ?? 5,
    sinceAt: typeof meta.progress_since_at === 'string' ? meta.progress_since_at : undefined,
    updatedAt: typeof meta.progress_updated_at === 'string' ? meta.progress_updated_at : undefined,
  };
}
