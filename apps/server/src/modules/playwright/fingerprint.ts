import { createHash } from 'crypto';
import type { BrowserContext } from 'playwright';
import type { FingerprintRuntimeConfig } from '../../lib/settings.js';

export interface AccountFingerprint {
  canvasNoise: number;
  webglVendor: string;
  webglRenderer: string;
  screenWidth: number;
  screenHeight: number;
  userAgent: string;
  audioNoise: number;
  /** @deprecated 런타임 항상 false — SwiftShader 탐지 회피 */
  useSoftwareGL: boolean;
  fontHint: string;
  hardwareConcurrency?: number;
  deviceMemory?: number;
  devicePixelRatio?: number;
}

function seededRandom(seed: string, index: number): number {
  const hash = createHash('sha256').update(`${seed}-${index}`).digest('hex');
  return parseInt(hash.slice(0, 8), 16) / 0xffffffff;
}

const GPU_POOL = [
  { vendor: 'Intel Inc.', renderer: 'Intel Iris Plus Graphics 640' },
  { vendor: 'Intel Inc.', renderer: 'Intel HD Graphics 620' },
  { vendor: 'Intel Inc.', renderer: 'Intel(R) UHD Graphics 630' },
  { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630, OpenGL 4.6)' },
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650, OpenGL 4.6)' },
  { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 580 Series, OpenGL 4.6)' },
];

const SCREENS = [
  { w: 1280, h: 720 },
  { w: 1366, h: 768 },
  { w: 1440, h: 900 },
  { w: 1536, h: 864 },
  { w: 1680, h: 1050 },
  { w: 1920, h: 1080 },
  { w: 2560, h: 1440 },
];

const FONT_HINTS = ['none', 'slight', 'medium', 'full'] as const;
const HW_CONCURRENCY = [4, 6, 8, 12] as const;
const DEVICE_MEMORY = [4, 8] as const;
const DPR_OPTIONS = [1, 1.25] as const;

export function generateFingerprint(accountId: string): AccountFingerprint {
  const r = (i: number) => seededRandom(accountId, i);
  const gpu = GPU_POOL[Math.floor(r(0) * GPU_POOL.length)]!;
  const scr = SCREENS[Math.floor(r(1) * SCREENS.length)]!;

  return {
    canvasNoise: Math.floor(r(3) * 5) + 1,
    webglVendor: gpu.vendor,
    webglRenderer: gpu.renderer,
    screenWidth: scr.w,
    screenHeight: scr.h,
    userAgent: generateUA(accountId),
    audioNoise: r(4) * 0.0001,
    useSoftwareGL: false,
    fontHint: FONT_HINTS[Math.floor(r(5) * FONT_HINTS.length)]!,
    hardwareConcurrency: HW_CONCURRENCY[Math.floor(r(6) * HW_CONCURRENCY.length)]!,
    deviceMemory: DEVICE_MEMORY[Math.floor(r(7) * DEVICE_MEMORY.length)]!,
    devicePixelRatio: DPR_OPTIONS[Math.floor(r(8) * DPR_OPTIONS.length)]!,
  };
}

function generateUA(_accountId: string): string {
  // 실제 Windows는 10·11 모두 UA가 항상 "Windows NT 10.0" (MS가 고정).
  // "NT 11.0"은 실존하지 않는 값이라 그 자체로 봇 신호 → 항상 10.0.
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36`;
}

/** 기존 계정에 저장된 비현실적 "Windows NT 11.0" UA를 런타임 보정 (DB는 건드리지 않음, 규칙⑲). */
export function normalizeUaPlatform(ua: string): string {
  return ua.replace('Windows NT 11.0', 'Windows NT 10.0');
}

/** DB fingerprint 유지(규칙⑲) — SwiftShader·누락 필드 런타임 보정 */
export function normalizeFingerprintForLaunch(fp: AccountFingerprint, accountId: string): AccountFingerprint {
  const regen = generateFingerprint(accountId);
  const fixed: AccountFingerprint = {
    ...regen,
    ...fp,
    useSoftwareGL: false,
    hardwareConcurrency: fp.hardwareConcurrency ?? regen.hardwareConcurrency,
    deviceMemory: fp.deviceMemory ?? regen.deviceMemory,
    devicePixelRatio: fp.devicePixelRatio ?? regen.devicePixelRatio,
  };

  if (fixed.webglRenderer?.includes('SwiftShader') || fixed.webglVendor?.includes('SwiftShader')) {
    return {
      ...fixed,
      webglVendor: regen.webglVendor,
      webglRenderer: regen.webglRenderer,
      useSoftwareGL: false,
    };
  }

  return fixed;
}

export async function injectFingerprint(
  context: BrowserContext,
  fp: AccountFingerprint,
  cfg: FingerprintRuntimeConfig = { canvas_spoof: true, webgl_spoof: true, audio_noise: true },
) {
  const hw = fp.hardwareConcurrency ?? 8;
  const mem = fp.deviceMemory ?? 8;
  const dpr = fp.devicePixelRatio ?? 1;

  await context.addInitScript(({ fingerprint, config, hwConcurrency, devMemory, pixelRatio }) => {
    // 패치한 함수의 .toString()을 native처럼 위장 (anti-bot의 fn.toString() 탐지 회피).
    // StealthPlugin이 먼저 Function.prototype.toString을 패치했어도 그 결과로 체이닝한다.
    const nativeNames = new WeakMap<object, string>();
    const origToString = Function.prototype.toString;
    const patchedToString = function (this: unknown) {
      const name = typeof this === 'function' ? nativeNames.get(this as object) : undefined;
      if (name) return `function ${name}() { [native code] }`;
      return origToString.call(this);
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Function.prototype.toString = patchedToString as any;
    nativeNames.set(patchedToString, 'toString');
    const masked = <T extends (...a: never[]) => unknown>(fn: T, name: string): T => {
      nativeNames.set(fn, name);
      return fn;
    };

    if (config.canvas_spoof) {
      const orig = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = masked(function (this: HTMLCanvasElement, ...args: unknown[]) {
        const ctx = this.getContext('2d');
        if (ctx) {
          const d = ctx.getImageData(0, 0, 1, 1);
          d.data[0] = (d.data[0] + fingerprint.canvasNoise) % 256;
          ctx.putImageData(d, 0, 0);
        }
        return orig.apply(this, args as [string?, number?]);
      }, 'toDataURL');
    }

    if (config.webgl_spoof) {
      const gp = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = masked(function (this: WebGLRenderingContext, p: number) {
        if (p === 37445) return fingerprint.webglVendor;
        if (p === 37446) return fingerprint.webglRenderer;
        return gp.call(this, p);
      }, 'getParameter');
      if (typeof WebGL2RenderingContext !== 'undefined') {
        const gp2 = WebGL2RenderingContext.prototype.getParameter;
        WebGL2RenderingContext.prototype.getParameter = masked(function (this: WebGL2RenderingContext, p: number) {
          if (p === 37445) return fingerprint.webglVendor;
          if (p === 37446) return fingerprint.webglRenderer;
          return gp2.call(this, p);
        }, 'getParameter');
      }
    }

    if (config.audio_noise) {
      const origGetChannelData = AudioBuffer.prototype.getChannelData;
      AudioBuffer.prototype.getChannelData = masked(function (this: AudioBuffer, channel: number) {
        const data = origGetChannelData.call(this, channel);
        if (data.length > 0) data[0] += fingerprint.audioNoise;
        return data;
      }, 'getChannelData');
    }

    // UA는 Windows인데 실행 OS는 Linux → navigator.platform/userAgentData가 Linux를 노출하면
    // "UA-OS 불일치"라는 강한 봇 신호가 된다. Windows로 정합시킨다.
    try {
      Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
    } catch {
      /* 일부 컨텍스트에서 redefine 불가 — 무시 */
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const uaData = (navigator as any).userAgentData;
    if (uaData) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const getHighEntropyValues = masked(function (this: unknown, hints: string[]) {
        return uaData.getHighEntropyValues(hints).then((v: Record<string, unknown>) => ({
          ...v,
          platform: 'Windows',
          platformVersion: '15.0.0',
        }));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }, 'getHighEntropyValues') as any;
      const spoofed = {
        brands: uaData.brands,
        mobile: false,
        platform: 'Windows',
        getHighEntropyValues,
        toJSON: () => ({ brands: uaData.brands, mobile: false, platform: 'Windows' }),
      };
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Object.defineProperty(navigator, 'userAgentData', { get: () => spoofed as any });
      } catch {
        /* ignore */
      }
    }

    const chromeBar = 88;
    Object.defineProperty(screen, 'width', { get: () => fingerprint.screenWidth });
    Object.defineProperty(screen, 'height', { get: () => fingerprint.screenHeight });
    Object.defineProperty(screen, 'availWidth', { get: () => fingerprint.screenWidth });
    Object.defineProperty(screen, 'availHeight', { get: () => fingerprint.screenHeight - 40 });
    Object.defineProperty(window, 'devicePixelRatio', { get: () => pixelRatio });
    Object.defineProperty(window, 'outerWidth', { get: () => fingerprint.screenWidth });
    Object.defineProperty(window, 'outerHeight', { get: () => fingerprint.screenHeight });
    Object.defineProperty(window, 'innerWidth', { get: () => fingerprint.screenWidth });
    Object.defineProperty(window, 'innerHeight', { get: () => fingerprint.screenHeight - chromeBar });

    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => hwConcurrency });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => devMemory });
    Object.defineProperty(navigator, 'languages', { get: () => ['ko-KR', 'ko', 'en-US', 'en'] });
    Object.defineProperty(navigator, 'language', { get: () => 'ko-KR' });

    Object.defineProperty(navigator, 'plugins', {
      get: () => [
        { name: 'Chrome PDF Plugin' },
        { name: 'Chrome PDF Viewer' },
        { name: 'Native Client' },
      ],
    });

    const OrigRTC = window.RTCPeerConnection;
    if (OrigRTC) {
      const Patched = function (this: RTCPeerConnection, configuration?: RTCConfiguration) {
        const rtcCfg = configuration ?? {};
        if (typeof rtcCfg === 'object' && rtcCfg !== null) {
          (rtcCfg as { iceServers?: unknown[] }).iceServers = [];
        }
        return new OrigRTC(rtcCfg);
      } as unknown as typeof RTCPeerConnection;
      window.RTCPeerConnection = Patched;
    }
  }, {
    fingerprint: fp,
    config: cfg,
    hwConcurrency: hw,
    devMemory: mem,
    pixelRatio: dpr,
  });
}
