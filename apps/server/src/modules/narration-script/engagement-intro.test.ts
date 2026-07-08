import { describe, expect, it } from 'vitest';
import {
  buildNarrationEngagementIntro,
  insertNarrationEngagementIntro,
} from './engagement-intro.js';

describe('narration engagement-intro', () => {
  it('재물 주제 → 재물복', () => {
    const intro = buildNarrationEngagementIntro({
      axisType: 'zodiac',
      topicLabel: '2026 재물운',
      workspace: 'fortune82',
    });
    expect(intro).toContain('화면을 두번터치하고');
    expect(intro).toContain('자신의 띠');
    expect(intro).toContain('재물복');
  });

  it('별자리 축 라벨', () => {
    const intro = buildNarrationEngagementIntro({
      axisType: 'constellation',
      topicLabel: '별의 흐름',
      workspace: 'yeonun',
    });
    expect(intro).toContain('자신의 별자리');
    expect(intro).toContain('행운이 찾아와요');
  });

  it('연령 축 라벨', () => {
    const intro = buildNarrationEngagementIntro({
      axisType: 'generation',
      topicLabel: '직장운',
      workspace: 'fortune82',
    });
    expect(intro).toContain('자신의 연령');
    expect(intro).toContain('성과가 찾아옵니다');
  });

  it('오프닝 뒤·5위 앞에 삽입 (순위형)', () => {
    const body =
      '오늘의 재물운 TOP5를 알려드립니다. 5위는 쥐띠입니다. 4위는 소띠입니다.';
    const out = insertNarrationEngagementIntro(body, {
      axisType: 'zodiac',
      formatType: 'ranked',
      topicLabel: '재물운',
      workspace: 'fortune82',
    });
    expect(out.indexOf('알려드립니다')).toBeLessThan(out.indexOf('화면을 두번터치'));
    expect(out.indexOf('화면을 두번터치')).toBeLessThan(out.indexOf('5위'));
  });

  it('오프닝 뒤·첫 띠 항목 앞에 삽입 (전체커버)', () => {
    const body = '오늘 띠별 운세입니다.\n쥐띠: 재물운이 좋습니다.\n소띠: 조심하세요.';
    const out = insertNarrationEngagementIntro(body, {
      axisType: 'zodiac',
      formatType: 'full_cover',
      topicLabel: '운세',
      workspace: 'yeonun',
    });
    expect(out.indexOf('운세입니다')).toBeLessThan(out.indexOf('화면을 두번터치'));
    expect(out.indexOf('화면을 두번터치')).toBeLessThan(out.indexOf('쥐띠:'));
  });

  it('이미 있으면 중복 삽입 안 함', () => {
    const body = '오프닝.\n화면을 두번터치하고 댓글에 자신의 띠와 소원을 적으시면 행운이.\n쥐띠: ...';
    const out = insertNarrationEngagementIntro(body, {
      axisType: 'zodiac',
      formatType: 'full_cover',
      topicLabel: '운세',
      workspace: 'fortune82',
    });
    expect(out.match(/화면을 두번터치/g)?.length).toBe(1);
  });
});
