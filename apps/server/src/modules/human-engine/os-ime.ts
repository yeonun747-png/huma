import type { Page } from 'playwright';
import { execFile } from 'child_process';
import { promisify } from 'util';

import { gaussianRandom, randomBetween, sleep, wpmToDelay } from '../../lib/utils.js';
import type { HumanEngineConfig } from '../../lib/settings.js';
import { hangulToJamoSequence } from './hangul.js';
import { jamoToKeyPresses } from './dubeolsik-keymap.js';

const execFileAsync = promisify(execFile);

const hangulReadyPages = new WeakSet<Page>();

/** human_engine.use_os_ime · HUMA_USE_OS_IME */
export function resolveUseOsIme(config: HumanEngineConfig): boolean {
  if (process.env.HUMA_USE_OS_IME === 'false') return false;
  if (process.env.HUMA_USE_OS_IME === 'true') return true;
  if (config.use_os_ime === false) return false;
  if (config.use_os_ime === true) return true;
  return process.platform === 'linux';
}

export function fcitxBrowserEnv(base: Record<string, string>): Record<string, string> {
  return {
    ...base,
    GTK_IM_MODULE: 'fcitx',
    QT_IM_MODULE: 'fcitx',
    XMODIFIERS: '@im=fcitx',
    INPUT_METHOD: 'fcitx',
    LC_CTYPE: 'ko_KR.UTF-8',
  };
}

/** i7 — fcitx-hangul 한글 모드 활성 (페이지당 1회) */
export async function ensureOsHangulMode(page: Page): Promise<void> {
  if (hangulReadyPages.has(page)) return;

  if (process.platform === 'linux') {
    try {
      await execFileAsync('fcitx-remote', ['-s', 'hangul'], { timeout: 3000 });
    } catch {
      // fcitx 미설치 시 Ctrl+Space 토글 시도
      await page.keyboard.press('Control+Space');
      await sleep(200);
    }
  }

  hangulReadyPages.add(page);
}

async function pressKeyPress(page: Page, press: { key: string; shift?: boolean }): Promise<void> {
  if (press.shift) await page.keyboard.down('Shift');
  await page.keyboard.press(press.key);
  if (press.shift) await page.keyboard.up('Shift');
}

/** OS fcitx-hangul — 두벌식 물리키 → 진짜 IME composition */
export async function typeHangulViaOsIme(
  page: Page,
  char: string,
  config: HumanEngineConfig,
): Promise<void> {
  await ensureOsHangulMode(page);
  const jamos = hangulToJamoSequence(char);

  for (const jamo of jamos) {
    for (const press of jamoToKeyPresses(jamo)) {
      await pressKeyPress(page, press);
      await sleep(randomBetween(20, 55));
    }
    await sleep(wpmToDelay(gaussianRandom(config.wpm_mean, config.wpm_sigma)));
  }
}
