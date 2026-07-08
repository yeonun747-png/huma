import type {
  NarrationAxisType,
  NarrationFormatType,
  NarrationPeriodType,
  NarrationScriptWorkspace,
} from '@huma/shared';
import { resolveNarrationFormatForPeriod } from '@huma/shared';
import { ALL_AXIS_TYPES } from './axis-instances.js';
import { buildNarrationDateContext, type NarrationDateContext } from './date-context.js';
import {
  getAxisUsageCounts,
  isComboBlocked,
  listRecentBlockedCombos,
  pickLeastUsedAxis,
  rotationCooldownDays,
  type NarrationComboKey,
} from './rotation.js';
import {
  getNarrationTopicUsageCounts,
  listNarrationTopics,
  pickWeightedTopic,
  type NarrationTopic,
} from './topic-pool.js';
import {
  inferNarrationAxisFromTopic,
  topicTextForAxisInference,
} from './axis-inference.js';
import { resolveMonthlySeriesEpisode } from './monthly-series.js';
import { deriveNarrationHookLabel } from './topic-hook.js';

function axisPickOrder(topic: NarrationTopic): NarrationAxisType[] {
  const inferred = inferNarrationAxisFromTopic(topicTextForAxisInference(topic));
  if (!inferred) return ALL_AXIS_TYPES;
  return [inferred, ...ALL_AXIS_TYPES.filter((a) => a !== inferred)];
}

function pickAxisForTopic(
  topic: NarrationTopic,
  openAxes: NarrationAxisType[],
  axisUsage: Map<NarrationAxisType, number>,
): NarrationAxisType {
  const preferred = axisPickOrder(topic).filter((axis) => openAxes.includes(axis));
  if (!preferred.length) return openAxes[0]!;
  return pickLeastUsedAxis(preferred, axisUsage);
}

export interface NarrationPickPlan {
  workspace: NarrationScriptWorkspace;
  formatType: NarrationFormatType;
  periodType: NarrationPeriodType;
  axisType: NarrationAxisType;
  topic: NarrationTopic;
  combo: NarrationComboKey;
  dateContext: NarrationDateContext;
  /** 월간 TOP N 시리즈 N편 (생성 시 채움) */
  seriesEpisode?: number;
}

export interface PlanNarrationPickInput {
  workspace: NarrationScriptWorkspace;
  formatType: NarrationFormatType;
  periodType?: NarrationPeriodType;
  axisType?: NarrationAxisType | 'auto';
  topicKey?: string | null;
}

function normalizePeriodType(periodType?: NarrationPeriodType): NarrationPeriodType {
  if (periodType === 'weekly' || periodType === 'monthly') return periodType;
  return 'daily';
}

function normalizeFormatType(
  periodType: NarrationPeriodType,
  formatType: NarrationFormatType,
): NarrationFormatType {
  return resolveNarrationFormatForPeriod(periodType, formatType);
}

export async function planNarrationPick(input: PlanNarrationPickInput): Promise<NarrationPickPlan> {
  const periodType = normalizePeriodType(input.periodType);
  const formatType = normalizeFormatType(periodType, input.formatType);
  const cooldownDays = rotationCooldownDays(periodType);
  const topics = await listNarrationTopics(input.workspace);
  if (!topics.length) {
    throw new Error(
      input.workspace === 'fortune82'
        ? '포춘82 상품 캐시가 비어 있습니다. sync 후 다시 시도하세요.'
        : '연운 상품 풀이 비어 있습니다.',
    );
  }

  const blocked = await listRecentBlockedCombos(input.workspace, periodType);
  const topicUsage = await getNarrationTopicUsageCounts(input.workspace);
  const axisUsage = await getAxisUsageCounts(input.workspace);

  const topicCandidates = input.topicKey?.trim()
    ? topics.filter((t) => t.key === input.topicKey.trim())
    : topics;

  if (!topicCandidates.length) {
    throw new Error(`주제를 찾을 수 없습니다: ${input.topicKey}`);
  }

  let topic: NarrationTopic;
  let resolvedAxis: NarrationAxisType;

  const makeCombo = (axis: NarrationAxisType, topicKey: string): NarrationComboKey => ({
    workspace: input.workspace,
    formatType,
    periodType,
    axisType: axis,
    topicKey,
  });

  if (input.topicKey?.trim()) {
    topic = topicCandidates[0]!;
    if (input.axisType && input.axisType !== 'auto') {
      resolvedAxis = input.axisType;
    } else {
      const openAxes = ALL_AXIS_TYPES.filter(
        (axis) => !isComboBlocked(makeCombo(axis, topic.key), blocked),
      );
      if (!openAxes.length) {
        throw new Error(
          `최근 ${cooldownDays}일 이내 「${topic.label}」 조합이 모두 사용되었습니다. 다른 주제·포맷을 선택하세요.`,
        );
      }
      resolvedAxis = pickAxisForTopic(topic, openAxes, axisUsage);
    }
  } else if (input.axisType && input.axisType !== 'auto') {
    resolvedAxis = input.axisType;
    const allowed = topics.filter(
      (t) => !isComboBlocked(makeCombo(resolvedAxis, t.key), blocked),
    );
    if (!allowed.length) {
      throw new Error(
        `최근 ${cooldownDays}일 이내 사용 가능한 주제·조합이 없습니다. 축·포맷·주기를 바꿔 보세요.`,
      );
    }
    topic = pickWeightedTopic(allowed, topicUsage);
  } else {
    const pairs: Array<{ topic: NarrationTopic; axis: NarrationAxisType }> = [];
    for (const t of topics) {
      for (const axis of axisPickOrder(t)) {
        if (!isComboBlocked(makeCombo(axis, t.key), blocked)) {
          pairs.push({ topic: t, axis });
          break;
        }
      }
    }
    if (!pairs.length) {
      throw new Error(
        `최근 ${cooldownDays}일 이내 사용 가능한 주제·조합이 없습니다. 축·포맷·주기를 바꿔 보세요.`,
      );
    }
    topic = pickWeightedTopic(
      pairs.map((p) => p.topic),
      topicUsage,
    );
    resolvedAxis = pairs.find((p) => p.topic.key === topic.key)!.axis;
  }

  const combo = makeCombo(resolvedAxis, topic.key);

  if (isComboBlocked(combo, blocked)) {
    throw new Error(
      `최근 ${cooldownDays}일 이내 동일 조합(포맷×주기×축×주제)이 사용되었습니다. 다른 조합을 선택하세요.`,
    );
  }

  return {
    workspace: input.workspace,
    formatType,
    periodType,
    axisType: resolvedAxis,
    topic,
    combo,
    dateContext: buildNarrationDateContext(periodType, new Date(), resolvedAxis),
  };
}

export async function planFromNarrationHistoryRow(row: {
  workspace: NarrationScriptWorkspace;
  format_type: NarrationFormatType;
  period_type?: NarrationPeriodType | string | null;
  axis_type: NarrationAxisType;
  topic_key: string;
  topic_label: string;
}): Promise<NarrationPickPlan> {
  const periodType = normalizePeriodType(row.period_type as NarrationPeriodType | undefined);
  const formatType = normalizeFormatType(periodType, row.format_type);
  const topics = await listNarrationTopics(row.workspace);
  let topic = topics.find((t) => t.key === row.topic_key);
  if (!topic) {
    topic = {
      key: row.topic_key,
      label: row.topic_label,
      hookLabel: deriveNarrationHookLabel(row.topic_label),
      categoryKey: null,
      contextText: `[주제]\n상품명: ${row.topic_label}`,
    };
  }

  return {
    workspace: row.workspace,
    formatType,
    periodType,
    axisType: row.axis_type,
    topic,
    combo: {
      workspace: row.workspace,
      formatType,
      periodType,
      axisType: row.axis_type,
      topicKey: row.topic_key,
    },
    dateContext: buildNarrationDateContext(periodType, new Date(), row.axis_type),
    seriesEpisode:
      periodType === 'monthly' ? await resolveMonthlySeriesEpisode({
          workspace: row.workspace,
          formatType,
          periodType,
          axisType: row.axis_type,
          topicKey: row.topic_key,
        }) : undefined,
  };
}

export async function previewNextNarrationPick(
  workspace: NarrationScriptWorkspace,
  formatType: NarrationFormatType = 'full_cover',
  periodType: NarrationPeriodType = 'daily',
): Promise<NarrationPickPlan> {
  return planNarrationPick({ workspace, formatType, periodType, axisType: 'auto' });
}
