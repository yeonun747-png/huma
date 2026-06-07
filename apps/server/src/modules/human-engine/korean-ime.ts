import type { Locator, Page } from 'playwright';

import { gaussianRandom, randomBetween, sleep, wpmToDelay } from '../../lib/utils.js';
import type { HumanEngineConfig } from '../../lib/settings.js';
import { hangulToJamoSequence, isHangul, recomposeHangul } from './hangul.js';
import { getAdjacentKey } from './typing-adjacent.js';
import { humanClickLocator } from './mouse.js';
import { resolveUseOsIme, typeHangulViaOsIme } from './os-ime.js';

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
