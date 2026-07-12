import { describe, expect, it } from 'vitest';
import {
  buildQuizOasisBrandSafetyBlock,
  contiTextForBrandCheck,
  filterQuizOasisSafeIdeas,
  isQuizOasisBrandViolation,
  QUIZOASIS_BRAND_SAFETY_RULES,
  QUIZOASIS_SAFE_IDEA_EXAMPLES,
} from './quiz-brand-safety.js';

describe('buildQuizOasisBrandSafetyBlock', () => {
  it('injects mandatory rules only for quizoasis', () => {
    expect(buildQuizOasisBrandSafetyBlock('quizoasis')).toContain('필수 규약');
    expect(buildQuizOasisBrandSafetyBlock('quizoasis')).toContain('권고 아님');
    expect(buildQuizOasisBrandSafetyBlock('yeonun')).toBe('');
  });

  it('uses mandatory language not soft recommendations', () => {
    expect(QUIZOASIS_BRAND_SAFETY_RULES).toMatch(/필수:/);
    expect(QUIZOASIS_BRAND_SAFETY_RULES).toMatch(/절대 금지/);
    expect(QUIZOASIS_BRAND_SAFETY_RULES).not.toMatch(/권장:/);
    expect(QUIZOASIS_SAFE_IDEA_EXAMPLES).toMatch(/필수 형식/);
  });
});

describe('isQuizOasisBrandViolation', () => {
  it('flags marketing schedule dunk conti', () => {
    const text =
      '마케터 지호가 퀴즈오아시스 좌뇌형·우뇌형 테스트에서 우뇌형(창의형)을 받고 팀장 은주에게 즉흥적이고 감각적인 사람이라며 자랑한다. ' +
      '은주가 지호의 월간 일정표와 룩북처럼 쌓인 발표 자료 출력본을 말없이 펼쳐 놓자, 모든 회의가 12개월째 같은 요일·같은 시각에 고정되고 발표 포맷도 전부 동일하다는 사실이 드러난다. ' +
      '지호는 「창의성은 틀 안에서 나오는 거잖아요」라는 궤변을 쥐어짜다가 결국 폰을 책상에 뒤집어 엎으며 완전히 무너진다.';
    expect(isQuizOasisBrandViolation(text)).toBe(true);
  });

  it('flags cup-ramen dunk conti', () => {
    const text =
      "프로덕션 PD 태현이 퀴즈오아시스 혼술 유형 테스트에서 '치유 명상형'을 받고 후배 수민에게 술로 마음을 정화하는 유형이라며 자랑한다. " +
      '수민이 거실 쓰레기통에서 편의점 컵 라면 용기 아홉 개를 꺼내 테이블에 쭉 펼쳐 놓고, 태현은 명상하면서 먹은 거라며 시선을 돌린다. ' +
      "수민의 '나트륨으로 내면 정화한 거냐'는 마지막 한마디에 태현이 폰을 뒤집어 엎으며 완전히 무너진다.";
    expect(isQuizOasisBrandViolation(text)).toBe(true);
  });

  it('allows result-affirming punchline', () => {
    const text =
      '친구 A가 퀴즈오아시스 정리왕 유형 결과를 보고, 서랍 속 라벨 스티커를 발견하자 B가 「아 그래서 네 폰 폴더가 저렇게 예뻤구나」라며 같이 웃는다.';
    expect(isQuizOasisBrandViolation(text)).toBe(false);
  });

  it('filters unsafe ideas from list', () => {
    const safe = '둘이 퀴즈 결과 유형이 같아서 카페에서 같은 주문을 외쳐 피식한다.';
    const unsafe =
      '퀴즈오아시스 창의형 결과를 자랑하자 상대가 동일 포맷 자료를 펼쳐 보여 폰을 엎으며 무너진다.';
    expect(filterQuizOasisSafeIdeas([safe, unsafe])).toEqual([safe]);
  });

  it('joins conti fields for check', () => {
    const joined = contiTextForBrandCheck({
      punchlineIdea: '아이디어',
      scenarioSummary: '요약',
      dialogues: ['A: "안녕"', 'B: "응"'],
    });
    expect(joined).toContain('아이디어');
    expect(joined).toContain('요약');
    expect(joined).toContain('안녕');
  });
});
