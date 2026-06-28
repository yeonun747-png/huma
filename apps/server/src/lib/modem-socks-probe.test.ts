import { describe, expect, it } from 'vitest';

import {
  isModemSocksNaverSuccessCode,
  parseModemSocksCurlResult,
} from './modem-socks-probe.js';

describe('parseModemSocksCurlResult', () => {
  it('accepts 200/301/302 with time_total', () => {
    expect(parseModemSocksCurlResult('200:12.345')).toEqual({ ok: true, ms: 12345 });
    expect(parseModemSocksCurlResult('301:0.512')).toEqual({ ok: true, ms: 512 });
    expect(parseModemSocksCurlResult('302:1.001')).toEqual({ ok: true, ms: 1001 });
  });

  it('rejects non-success codes', () => {
    expect(parseModemSocksCurlResult('403:1.2')).toEqual({ ok: false, ms: null });
    expect(parseModemSocksCurlResult('500:3.0')).toEqual({ ok: false, ms: null });
  });

  it('accepts code-only legacy output', () => {
    expect(parseModemSocksCurlResult('200')).toEqual({ ok: true, ms: null });
    expect(parseModemSocksCurlResult('404')).toEqual({ ok: false, ms: null });
  });
});

describe('isModemSocksNaverSuccessCode', () => {
  it('matches check-socks-proxy.sh', () => {
    expect(isModemSocksNaverSuccessCode(200)).toBe(true);
    expect(isModemSocksNaverSuccessCode(301)).toBe(true);
    expect(isModemSocksNaverSuccessCode(302)).toBe(true);
    expect(isModemSocksNaverSuccessCode(204)).toBe(false);
  });
});
