import type { Page, Locator } from 'playwright';
import { randomBetween, sleep } from '../../lib/utils.js';
import { humanTypeIntoElement, humanPasteIntoElement } from './korean-ime.js';

export async function humanSleep(minMs: number, maxMs: number) {
  await sleep(randomBetween(minMs, maxMs));
}

export { getAdjacentKey, getAdjacentKeyKorean } from './typing-adjacent.js';

/** @deprecated humanTypeIntoElement 사용 */
export async function humanType(
  page: Page,
  element: Locator,
  text: string,
  config: import('../../lib/settings.js').HumanEngineConfig,
) {
  await humanTypeIntoElement(page, element, text, config);
}

export {
  humanTypeIntoElement,
  humanTypeTitleIntoElement,
  humanPasteIntoElement,
} from './korean-ime.js';
