import { describe, expect, it, vi } from 'vitest';
import { normalizeQuizApiResponse } from './quiz-content-cache.js';

describe('normalizeQuizApiResponse', () => {
  it('parses array and nested quizzes field', () => {
    const fromArray = normalizeQuizApiResponse([
      { id: 'q1', title: 'MBTI 테스트', slug: 'mbti' },
    ]);
    expect(fromArray).toEqual([
      { id: 'q1', slug: 'mbti', title: 'MBTI 테스트', description: null, status: 'active' },
    ]);

    const fromNested = normalizeQuizApiResponse({
      quizzes: [{ quiz_id: 'q2', test_name: '연애 유형', test_slug: 'love' }],
    });
    expect(fromNested[0]?.id).toBe('q2');
    expect(fromNested[0]?.title).toBe('연애 유형');
    expect(fromNested[0]?.slug).toBe('love');
  });
});

describe('runPunchlineContiStage3Only contract', () => {
  it('requires punchlineIdea', async () => {
    const { runPunchlineContiStage3Only } = await import('./punchline-pipeline.js');
    await expect(
      runPunchlineContiStage3Only({
        workspace: 'yeonun',
        plan: {
          personaText: '## 관계축\n- 연인',
          conditions: {
            relationshipAxis: '연인',
            emotionCurve: '평온→충격',
            hookType: '반전',
            hookSubtype: '정체 반전',
            locationKeyword: '',
            timeOfDay: '',
            cutType: 'multi_shot',
            duration: 15,
          },
        },
        punchlineIdea: '   ',
        pastSummaries: [],
      }),
    ).rejects.toThrow(/punchlineIdea/);
  });

  it('does not invoke stage 1/2 when punchlineIdea is set', async () => {
    vi.resetModules();
    const stages: string[] = [];
    vi.doMock('../../lib/anthropic-client.js', () => ({
      askClaudeWithModel: vi.fn(async () =>
        JSON.stringify({
          shots: [
            {
              shotNumber: 1,
              startSec: 0,
              endSec: 15,
              camera: '와이드',
              action: 'A와 B가 카페에 앉아 대화를 나눈다. 표정과 제스처로 분위기를 전달한다.',
              dialogue: 'A: "오늘 운세 좋대!"',
            },
          ],
        }),
      ),
    }));
    vi.doMock('../../lib/ai-engine.js', () => ({
      getMainClaudeModel: vi.fn(async () => 'claude-test'),
      getSubClaudeModel: vi.fn(async () => 'claude-haiku-test'),
    }));
    vi.doMock('./conti-generator.js', () => ({
      generateContiFromPunchline: vi.fn(async (params: { onStage?: (s: string) => void; regenMode?: string }) => {
        await params.onStage?.('3b단계 형식 변환 (샷 분배)');
        return {
          characters: [],
          location: '카페',
          lighting: '따뜻',
          timeOfDay: '오후',
          cutType: 'multi_shot',
          duration: 15,
          scenarioSummary: '테스트',
          fullText: '테스트',
          shots: [],
          storyDraft: { narrativeProse: '고정 이야기', locationKeyword: '', timeOfDay: '오후', characters: [], location: '카페', lighting: '따뜻', timeOfDayVisual: '오후', scenarioSummary: '테스트' },
        };
      }),
    }));

    const { runPunchlineContiStage3Only } = await import('./punchline-pipeline.js');
    await runPunchlineContiStage3Only({
      workspace: 'yeonun',
      plan: {
        personaText: '## 관계축\n- 연인',
        conditions: {
          relationshipAxis: '연인',
          emotionCurve: '평온→충격',
          hookType: '반전',
          hookSubtype: '정체 반전',
          locationKeyword: '',
          timeOfDay: '',
          cutType: 'multi_shot',
          duration: 15,
        },
      },
      punchlineIdea: '고정 펀치라인',
      mustIncludeProps: ['머그컵'],
      onStage: (s) => stages.push(s),
    });

    expect(stages.some((s) => s.startsWith('1단계'))).toBe(false);
    expect(stages.some((s) => s.startsWith('2단계'))).toBe(false);
    expect(stages.some((s) => s.includes('3b') || s.includes('3단계'))).toBe(true);
  });
});
