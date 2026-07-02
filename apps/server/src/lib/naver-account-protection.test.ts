import { describe, expect, it } from 'vitest';
import {
  bodyIndicatesNaverAccountProtection,
  isNaverAccountProtectionError,
  parseNaverAccountProtectionPhase,
  urlIndicatesNaverAccountProtection,
} from './naver-account-protection.js';

describe('bodyIndicatesNaverAccountProtection', () => {
  it('detects protection screen copy', () => {
    expect(
      bodyIndicatesNaverAccountProtection(
        '회원님의 아이디를 보호하고 있습니다. 보호조치 해제',
      ),
    ).toBe(true);
  });

  it('ignores normal login body', () => {
    expect(bodyIndicatesNaverAccountProtection('네이버 로그인')).toBe(false);
  });
});

describe('urlIndicatesNaverAccountProtection', () => {
  it('detects idSafetyRelease help URL', () => {
    expect(
      urlIndicatesNaverAccountProtection(
        'https://nid.naver.com/user2/help/idSafetyRelease?m=viewIdSafetyInfo&token_help=abc',
      ),
    ).toBe(true);
  });

  it('ignores nidlogin', () => {
    expect(urlIndicatesNaverAccountProtection('https://nid.naver.com/nidlogin.login')).toBe(false);
  });
});

describe('naver account protection error', () => {
  it('parses phase from error message', () => {
    expect(parseNaverAccountProtectionPhase(new Error('NAVER_ACCOUNT_PROTECTED:captcha'))).toBe(
      'captcha',
    );
    expect(isNaverAccountProtectionError(new Error('NAVER_ACCOUNT_PROTECTED:posting'))).toBe(true);
  });
});
