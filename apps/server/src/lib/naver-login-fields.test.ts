import { describe, expect, it } from 'vitest';

import { naverLoginSubmitStateChanged, type NaverLoginSubmitSnapshot } from './naver-login-fields.js';

function snap(partial: Partial<NaverLoginSubmitSnapshot> = {}): NaverLoginSubmitSnapshot {
  return {
    url: 'https://nid.naver.com/nidlogin.login',
    err: null,
    captchaVisible: true,
    captchaImg: 'https://captcha.naver.com/img/1.png',
    btnClass: 'btn_login next_step',
    ...partial,
  };
}

describe('naverLoginSubmitStateChanged', () => {
  it('캡cha만 보이는 상태는 제출 성공으로 보지 않는다', () => {
    const before = snap();
    const after = snap();
    expect(naverLoginSubmitStateChanged(before, after)).toBe(false);
  });

  it('URL 이탈은 제출 성공', () => {
    const before = snap();
    const after = snap({ url: 'https://www.naver.com/' });
    expect(naverLoginSubmitStateChanged(before, after)).toBe(true);
  });

  it('캡cha 이미지 변경은 제출 시도로 간주', () => {
    const before = snap();
    const after = snap({ captchaImg: 'https://captcha.naver.com/img/2.png' });
    expect(naverLoginSubmitStateChanged(before, after)).toBe(true);
  });

  it('오류 문구 갱신은 제출 시도로 간주', () => {
    const before = snap({ err: null });
    const after = snap({ err: '자동입력 방지 문자를 잘못 입력했습니다.' });
    expect(naverLoginSubmitStateChanged(before, after)).toBe(true);
  });

  it('캡cha 사라짐은 제출 성공', () => {
    const before = snap({ captchaVisible: true });
    const after = snap({ captchaVisible: false });
    expect(naverLoginSubmitStateChanged(before, after)).toBe(true);
  });
});
