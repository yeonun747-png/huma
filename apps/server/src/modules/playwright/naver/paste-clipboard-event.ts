import type { Page } from 'playwright';
import { randomBetween, sleep } from '../../../lib/utils.js';

const PASTE_DELAY_MS: [number, number] = [100, 300];

function stripMarkdownBold(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, '$1');
}

async function pasteDelay(): Promise<void> {
  await sleep(randomBetween(PASTE_DELAY_MS[0], PASTE_DELAY_MS[1]));
}

async function measureActiveTextLength(page: Page): Promise<number> {
  return page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    if (!active) return 0;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
      return active.value.length;
    }
    return (active.innerText ?? active.textContent ?? '').length;
  });
}

async function dispatchClipboardPasteEvent(page: Page, plain: string): Promise<void> {
  await page.evaluate((t) => {
    const active = document.activeElement as HTMLElement | null;
    if (!active) return;
    const dt = new DataTransfer();
    dt.setData('text/plain', t);
    active.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  }, plain);
}

async function pasteViaOsClipboard(page: Page, plain: string): Promise<void> {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await page.evaluate(async (t) => {
    await navigator.clipboard.writeText(t);
  }, plain);
  await pasteDelay();
  await page.keyboard.press('Control+v');
}

/**
 * SE ONE·발행 태그 — ClipboardEvent paste (activeElement).
 * 에디터가 paste를 무시하면 OS clipboard + Ctrl+V. 복붙 전후 100~300ms.
 */
export async function pasteTextViaClipboardEvent(page: Page, text: string): Promise<void> {
  const plain = stripMarkdownBold(text);
  if (!plain) return;

  await pasteDelay();
  const beforeLen = await measureActiveTextLength(page);
  await dispatchClipboardPasteEvent(page, plain);
  await pasteDelay();
  const afterLen = await measureActiveTextLength(page);

  const grew = afterLen > beforeLen;
  const hasContent = afterLen >= Math.min(plain.replace(/\s+/g, '').length, 4);
  if (grew || hasContent) return;

  await pasteDelay();
  await pasteViaOsClipboard(page, plain);
  await pasteDelay();
}
