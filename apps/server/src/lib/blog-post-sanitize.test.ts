import { describe, expect, it } from 'vitest';
import { stripInternalPostingMarkers } from './blog-post-sanitize.js';

describe('stripInternalPostingMarkers', () => {
  it('removes quiz cache prompt blocks from blog body', () => {
    const raw = `[참조 URL] https://myquizoasis.com/ko/test/love-language-test

[퀴즈오아시스 테스트]
slug: love-language-test
제목: 나의 1순위 사랑의 언어는?
소개: 당신의 사랑은 어떤 언어로 말하고 있나요?
(블로그 글은 이 테스트 주제·유형·공유 포인트 중심 — 결과 스포일러는 최소화)

[캐시 컨텍스트 적용 — 계정관리 동기화 데이터 기준, URL fetch 생략]

요즘 사랑의 언어 테스트 궁금해서 퀴즈오아시스에서 해봤어요.`;

    expect(stripInternalPostingMarkers(raw)).toBe(
      '요즘 사랑의 언어 테스트 궁금해서 퀴즈오아시스에서 해봤어요.',
    );
  });
});
