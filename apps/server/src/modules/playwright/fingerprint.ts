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
  useSoftwareGL: boolean;
  fontHint: string;
}

function seededRandom(seed: string, index: number): number {
  const hash = createHash('sha256').update(`${seed}-${index}`).digest('hex');
  return parseInt(hash.slice(0, 8), 16) / 0xffffffff;
}

export function generateFingerprint(accountId: string): AccountFingerprint {
  const r = (i: number) => seededRandom(accountId, i);

  const gpus = [
    { vendor: 'Intel Inc.', renderer: 'Intel Iris Plus Graphics 640' },
    { vendor: 'Intel Inc.', renderer: 'Intel HD Graphics 620' },
    { vendor: 'Google Inc.', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics)' },
  ];
  const screens = [
    { w: 1366, h: 768 },
    { w: 1440, h: 900 },
    { w: 1920, h: 1080 },
  ];
  const fontHints = ['none', 'slight', 'medium', 'full'];

  const gpu = gpus[Math.floor(r(0) * gpus.length)];
  const scr = screens[Math.floor(r(1) * screens.length)];
  const useSoftwareGL = r(2) < 0.25;

  return {
    canvasNoise: Math.floor(r(3) * 5) + 1,
    webglVendor: useSoftwareGL ? 'Google Inc.' : gpu.vendor,
    webglRenderer: useSoftwareGL ? 'Google SwiftShader' : gpu.renderer,
    screenWidth: scr.w,
    screenHeight: scr.h,
    userAgent: generateUA(accountId),
    audioNoise: r(4) * 0.0001,
    useSoftwareGL,
    fontHint: fontHints[Math.floor(r(5) * fontHints.length)],
  };
}

function generateUA(accountId: string): string {
  const r = (i: number) => seededRandom(accountId, 100 + i);
  const chromeVersions = ['120.0.6099.109', '121.0.6167.85', '122.0.6261.69'];
  const windowsVersions = ['10.0', '11.0'];
  const cv = chromeVersions[Math.floor(r(0) * chromeVersions.length)];
  const wv = windowsVersions[Math.floor(r(1) * windowsVersions.length)];
  return `Mozilla/5.0 (Windows NT ${wv}; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${cv} Safari/537.36`;
}

export async function injectFingerprint(
  context: BrowserContext,
  fp: AccountFingerprint,
  cfg: FingerprintRuntimeConfig = { canvas_spoof: true, webgl_spoof: true, audio_noise: true },
) {
  await context.addInitScript(({ fingerprint, config }) => {
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
    }

    if (config.audio_noise) {
      const origGetChannelData = AudioBuffer.prototype.getChannelData;
      AudioBuffer.prototype.getChannelData = function (channel: number) {
        const data = origGetChannelData.call(this, channel);
        if (data.length > 0) {
          data[0] += fingerprint.audioNoise;
        }
        return data;
      };
    }

    Object.defineProperty(screen, 'width', { get: () => fingerprint.screenWidth });
    Object.defineProperty(screen, 'height', { get: () => fingerprint.screenHeight });
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
        const cfg = configuration ?? {};
        if (typeof cfg === 'object' && cfg !== null) {
          (cfg as { iceServers?: unknown[] }).iceServers = [];
        }
        return new OrigRTC(cfg);
      } as unknown as typeof RTCPeerConnection;
      window.RTCPeerConnection = Patched;
    }
  }, { fingerprint: fp, config: cfg });
}
