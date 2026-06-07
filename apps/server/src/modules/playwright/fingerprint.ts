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

function generateUA(accountId: string): string {
  const r = (i: number) => seededRandom(accountId, 100 + i);
  const windowsVersions = ['10.0', '11.0'];
  const wv = windowsVersions[Math.floor(r(1) * windowsVersions.length)]!;
  return `Mozilla/5.0 (Windows NT ${wv}; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36`;
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
    if (config.canvas_spoof) {
      const orig = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function (...args: unknown[]) {
        const ctx = this.getContext('2d');
        if (ctx) {
          const d = ctx.getImageData(0, 0, 1, 1);
          d.data[0] = (d.data[0] + fingerprint.canvasNoise) % 256;
          ctx.putImageData(d, 0, 0);
        }
        return orig.apply(this, args as [string?, number?]);
      };
    }

    if (config.webgl_spoof) {
      const gp = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function (p: number) {
        if (p === 37445) return fingerprint.webglVendor;
        if (p === 37446) return fingerprint.webglRenderer;
        return gp.call(this, p);
      };
      if (typeof WebGL2RenderingContext !== 'undefined') {
        const gp2 = WebGL2RenderingContext.prototype.getParameter;
        WebGL2RenderingContext.prototype.getParameter = function (p: number) {
          if (p === 37445) return fingerprint.webglVendor;
          if (p === 37446) return fingerprint.webglRenderer;
          return gp2.call(this, p);
        };
      }
    }

    if (config.audio_noise) {
      const origGetChannelData = AudioBuffer.prototype.getChannelData;
      AudioBuffer.prototype.getChannelData = function (channel: number) {
        const data = origGetChannelData.call(this, channel);
        if (data.length > 0) data[0] += fingerprint.audioNoise;
        return data;
      };
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
