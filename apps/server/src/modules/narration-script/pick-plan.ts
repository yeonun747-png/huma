import type {
  NarrationAxisType,
  NarrationFormatType,
  NarrationScriptWorkspace,
} from '@huma/shared';
import { ALL_AXIS_TYPES } from './axis-instances.js';
import {
  getAxisUsageCounts,
  isComboBlocked,
  listRecentBlockedCombos,
  pickLeastUsedAxis,
  type NarrationComboKey,
} from './rotation.js';
import {
  getNarrationTopicUsageCounts,
  listNarrationTopics,
  pickWeightedTopic,
  type NarrationTopic,
} from './topic-pool.js';

export interface NarrationPickPlan {
  workspace: NarrationScriptWorkspace;
  formatType: NarrationFormatType;
  axisType: NarrationAxisType;
  topic: NarrationTopic;
  combo: NarrationComboKey;
}

export interface PlanNarrationPickInput {
  workspace: NarrationScriptWorkspace;
  formatType: NarrationFormatType;
  axisType?: NarrationAxisType | 'auto';
  topicKey?: string | null;
}

export async function planNarrationPick(input: PlanNarrationPickInput): Promise<NarrationPickPlan> {
  const topics = await listNarrationTopics(input.workspace);
  if (!topics.length) {
    throw new Error(
      input.workspace === 'fortune82'
        ? '포춘82 상품 캐시가 비어 있습니다. sync 후 다시 시도하세요.'
        : '연운 상품 풀이 비어 있습니다.',
    );
  }

  const blocked = await listRecentBlockedCombos(input.workspace);
  const topicUsage = await getNarrationTopicUsageCounts(input.workspace);
  const axisUsage = await getAxisUsageCounts(input.workspace);

  const axisType =
    input.axisType && input.axisType !== 'auto'
      ? input.axisType
      : pickLeastUsedAxis(ALL_AXIS_TYPES, axisUsage);

  const topicCandidates = input.topicKey?.trim()
    ? topics.filter((t) => t.key === input.topicKey.trim())
    : topics;

  if (!topicCandidates.length) {
    throw new Error(`주제를 찾을 수 없습니다: ${input.topicKey}`);
  }

  let topic: NarrationTopic;
  let resolvedAxis = axisType;

  if (input.topicKey?.trim()) {
    topic = topicCandidates[0]!;
    if (input.axisType === 'auto' || !input.axisType) {
      const openAxes = ALL_AXIS_TYPES.filter((axis) => {
        const combo: NarrationComboKey = {
          workspace: input.workspace,
          formatType: input.formatType,
          axisType: axis,
          topicKey: topic.key,
        };
        return !isComboBlocked(combo, blocked);
      });
      if (!openAxes.length) {
        throw new Error(
          `최근 ${14}일 이내 「${topic.label}」 조합이 모두 사용되었습니다. 다른 주제를 선택하세요.`,
        );
      }
      resolvedAxis = pickLeastUsedAxis(openAxes, axisUsage);
    }
  } else {
    const allowed = topics.filter((t) => {
      const combo: NarrationComboKey = {
        workspace: input.workspace,
        formatType: input.formatType,
        axisType: resolvedAxis,
        topicKey: t.key,
      };
      return !isComboBlocked(combo, blocked);
    });
    if (!allowed.length) {
      throw new Error(
        `최근 ${14}일 이내 사용 가능한 주제·조합이 없습니다. 축 또는 포맷을 바꿔 보세요.`,
      );
    }
    topic = pickWeightedTopic(allowed, topicUsage);
  }

  const combo: NarrationComboKey = {
    workspace: input.workspace,
    formatType: input.formatType,
    axisType: resolvedAxis,
    topicKey: topic.key,
  };

  if (isComboBlocked(combo, blocked)) {
    throw new Error(
      `최근 ${14}일 이내 동일 조합(포맷×축×주제)이 사용되었습니다. 다른 주제·축을 선택하세요.`,
    );
  }

  return {
    workspace: input.workspace,
    formatType: input.formatType,
    axisType: resolvedAxis,
    topic,
    combo,
  };
}

/** 워커 — 이미 DB에 확정된 조합으로 plan 구성 (14일 순환 재검사 없음) */
export async function planFromNarrationHistoryRow(row: {
  workspace: NarrationScriptWorkspace;
  format_type: NarrationFormatType;
  axis_type: NarrationAxisType;
  topic_key: string;
  topic_label: string;
}): Promise<NarrationPickPlan> {
  const topics = await listNarrationTopics(row.workspace);
  let topic = topics.find((t) => t.key === row.topic_key);
  if (!topic) {
    topic = {
      key: row.topic_key,
      label: row.topic_label,
      categoryKey: null,
      contextText: `[주제]\n상품명: ${row.topic_label}`,
    };
  }

  return {
    workspace: row.workspace,
    formatType: row.format_type,
    axisType: row.axis_type,
    topic,
    combo: {
      workspace: row.workspace,
      formatType: row.format_type,
      axisType: row.axis_type,
      topicKey: row.topic_key,
    },
  };
}

export async function previewNextNarrationPick(
  workspace: NarrationScriptWorkspace,
  formatType: NarrationFormatType = 'full_cover',
): Promise<NarrationPickPlan> {
  return planNarrationPick({ workspace, formatType, axisType: 'auto' });
}
