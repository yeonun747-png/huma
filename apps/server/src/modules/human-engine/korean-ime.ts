import type { Locator, Page } from 'playwright';

import { gaussianRandom, randomBetween, sleep, wpmToDelay } from '../../lib/utils.js';
import type { HumanEngineConfig } from '../../lib/settings.js';
import { hangulToJamoSequence, isHangul, recomposeHangul } from './hangul.js';
import { getAdjacentKey } from './typing-adjacent.js';
import { humanClickLocator } from './mouse.js';
import { ensureOsHangulMode, resolveUseOsIme, typeHangulViaOsIme } from './os-ime.js';

const IME_PROCESS_VK = 229;

async function dispatchImeProcessKey(page: Page): Promise<void> {
  const session = await page.context().newCDPSession(page);
  const payload = {
    key: 'Process',
    code: '',
    windowsVirtualKeyCode: IME_PROCESS_VK,
    nativeVirtualKeyCode: IME_PROCESS_VK,
  };
  await session.send('Input.dispatchKeyEvent', { type: 'keyDown', ...payload });
  await sleep(randomBetween(12, 35));
  await session.send('Input.dispatchKeyEvent', { type: 'keyUp', ...payload });
}

type ImeCommitPayload = { jamos: string[]; finalChar: string };

async function runCompositionUpdates(
  page: Page,
  element: Locator,
  jamos: string[],
  config: HumanEngineConfig,
): Promise<void> {
  await element.evaluate((el) => {
    (el as HTMLElement).dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true, cancelable: true, data: '' }),
    );
  });

  const built: string[] = [];
  for (const jamo of jamos) {
    built.push(jamo);
    await dispatchImeProcessKey(page);
    const partial = built.length >= 2 ? recomposeHangul(built) : built.join('');
    await element.evaluate(
      (el, data) => {
        (el as HTMLElement).dispatchEvent(
          new CompositionEvent('compositionupdate', { bubbles: true, cancelable: true, data }),
        );
      },
      partial,
    );
    await sleep(wpmToDelay(gaussianRandom(config.wpm_mean, config.wpm_sigma)));
  }
}

async function commitComposition(element: Locator, payload: ImeCommitPayload): Promise<void> {
  await element.evaluate((el, { jamos: _j, finalChar }) => {
    const target = el as HTMLElement;
    target.focus();

    target.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true, cancelable: true, data: finalChar }),
    );

    const beforeInput = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertCompositionText',
      data: finalChar,
    });
    const defaultPrevented = !target.dispatchEvent(beforeInput) || beforeInput.defaultPrevented;

    if (!defaultPrevented) {
      if (target.isContentEditable) {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          const node = document.createTextNode(finalChar);
          range.insertNode(node);
          range.setStartAfter(node);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        } else {
          target.appendChild(document.createTextNode(finalChar));
        }
      } else if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        const start = target.selectionStart ?? target.value.length;
        const end = target.selectionEnd ?? start;
        target.value = target.value.slice(0, start) + finalChar + target.value.slice(end);
        target.selectionStart = target.selectionEnd = start + finalChar.length;
      }
    }

    target.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        inputType: 'insertCompositionText',
        data: finalChar,
      }),
    );
  }, payload);
}

async function typeHangulChar(
  page: Page,
  element: Locator,
  char: string,
  config: HumanEngineConfig,
): Promise<void> {
  const jamos = hangulToJamoSequence(char);
  if (jamos.length < 2) {
    await typeLatinChar(page, char, config);
    return;
  }

  if (Math.random() < config.typo_rate) {
    const wrong = getAdjacentKey(char);
    if (wrong !== char && isHangul(wrong)) {
      if (resolveUseOsIme(config)) {
        await typeHangulViaOsIme(page, wrong, config);
      } else {
        const wrongJamos = hangulToJamoSequence(wrong);
        await runCompositionUpdates(page, element, wrongJamos, config);
        await commitComposition(element, { jamos: wrongJamos, finalChar: wrong });
      }
      await sleep(randomBetween(...config.backspace_delay_ms));
      await page.keyboard.press('Backspace');
      await sleep(randomBetween(120, 280));
    }
  }

  if (resolveUseOsIme(config)) {
    await typeHangulViaOsIme(page, char, config);
    return;
  }

  await runCompositionUpdates(page, element, jamos, config);
  await commitComposition(element, { jamos, finalChar: char });
}

async function typeLatinChar(page: Page, char: string, config: HumanEngineConfig): Promise<void> {
  if (Math.random() < config.typo_rate) {
    const wrong = getAdjacentKey(char);
    if (wrong !== char) {
      await page.keyboard.type(wrong, { delay: randomBetween(35, 90) });
      await sleep(randomBetween(180, 420));
      await page.keyboard.press('Backspace');
      await sleep(randomBetween(...config.backspace_delay_ms));
    }
  }
  await page.keyboard.type(char, { delay: randomBetween(35, 120) });
  await sleep(wpmToDelay(gaussianRandom(config.wpm_mean, config.wpm_sigma)));
}

export async function typeCharWithIme(
  page: Page,
  element: Locator,
  char: string,
  config: HumanEngineConfig,
): Promise<void> {
  if (char === '\n') {
    await page.keyboard.press('Enter');
    await sleep(randomBetween(120, 350));
    return;
  }
  if (isHangul(char)) {
    await typeHangulChar(page, element, char, config);
  } else {
    await typeLatinChar(page, char, config);
  }
}

export async function humanTypeIntoElement(
  page: Page,
  element: Locator,
  text: string,
  config: HumanEngineConfig,
  options?: { skipFocus?: boolean },
): Promise<void> {
  if (!options?.skipFocus) {
    await humanClickLocator(page, element);
    await sleep(randomBetween(80, 220));
  }

  for (const char of text) {
    await typeCharWithIme(page, element, char, config);
  }
}

/**
 * SE ONE 제목 — fcitx 두벌식 물리키.
 * 합성 composition은 SmartEditor 상태에 반영되지 않아 글자가 보이지 않을 수 있음.
 */
export async function humanTypeTitleIntoElement(
  page: Page,
  element: Locator,
  text: string,
  config: HumanEngineConfig,
  options?: { skipFocus?: boolean },
): Promise<void> {
  if (!options?.skipFocus) {
    await humanClickLocator(page, element);
    await sleep(randomBetween(80, 220));
  }

  await ensureOsHangulMode(page);

  for (const char of text) {
    if (char === '\n') {
      await page.keyboard.press('Enter');
      await sleep(randomBetween(120, 350));
      continue;
    }
    if (isHangul(char)) {
      await typeHangulViaOsIme(page, char, config);
    } else {
      await page.keyboard.type(char, { delay: randomBetween(35, 120) });
      await sleep(wpmToDelay(gaussianRandom(config.wpm_mean, config.wpm_sigma)));
    }
  }
}

export async function humanPasteIntoElement(
  page: Page,
  element: Locator,
  text: string,
): Promise<void> {
  await humanClickLocator(page, element);
  await sleep(randomBetween(100, 280));
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await page.evaluate(async (t) => {
    await navigator.clipboard.writeText(t);
  }, text);
  await sleep(randomBetween(80, 200));
  await page.keyboard.press('Control+V');
  await sleep(randomBetween(300, 800));
}

/** WPM 평균·편차 — 글자마다 gaussian delay (40~130ms) */
export function humanCharDelayMs(config: HumanEngineConfig): number {
  return Math.max(40, Math.min(130, Math.round(wpmToDelay(gaussianRandom(config.wpm_mean, config.wpm_sigma)))));
}

/** paragraph_pause_ms 비율 — 클릭·타이핑 직후 짧은 pause */
export function humanBriefPauseMs(
  config: HumanEngineConfig,
  minRatio = 0.08,
  maxRatio = 0.2,
): number {
  const [lo, hi] = config.paragraph_pause_ms;
  return randomBetween(Math.max(100, Math.floor(lo * minRatio)), Math.min(800, Math.floor(hi * maxRatio)));
}

/** SE ONE·발행 태그 — 유니코드 pressSequentially + 글자별 WPM (합성 IME·OS IME 미사용) */
export async function humanPressSequentially(
  page: Page,
  locator: Locator,
  text: string,
  config: HumanEngineConfig,
  options?: { typos?: boolean },
): Promise<void> {
  if (!text) return;
  const typos = options?.typos === true && config.typo_rate > 0;

  for (const char of text) {
    if (char === '\n') {
      await page.keyboard.press('Enter');
      await sleep(humanBriefPauseMs(config, 0.1, 0.22));
      continue;
    }

    if (typos && Math.random() < config.typo_rate) {
      const wrong = getAdjacentKey(char);
      if (wrong !== char) {
        await locator.pressSequentially(wrong, { delay: 0 });
        await sleep(randomBetween(80, 180));
        await sleep(randomBetween(...config.backspace_delay_ms));
        await page.keyboard.press('Backspace');
        await sleep(randomBetween(120, 280));
      }
    }

    await locator.pressSequentially(char, { delay: 0 });
    await sleep(humanCharDelayMs(config));
  }
  await sleep(humanBriefPauseMs(config, 0.1, 0.25));
}
