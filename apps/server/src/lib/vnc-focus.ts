import { setVncFocusPort } from './vnc-tile-state.js';

/** Ctrl+Alt+1~5 — Chromium F1(도움말)과 충돌 방지 */
export const VNC_HOTKEY_SLOTS = [
  { id: '1', label: 'Crank1', proxyPort: 10006, hint: 'Ctrl+Alt+1' },
  { id: '2', label: 'Crank2', proxyPort: 10007, hint: 'Ctrl+Alt+2' },
  { id: '3', label: '연운1', proxyPort: 10001, hint: 'Ctrl+Alt+3' },
  { id: '4', label: '연운2', proxyPort: 10002, hint: 'Ctrl+Alt+4' },
  { id: '5', label: '연운3', proxyPort: 10003, hint: 'Ctrl+Alt+5' },
] as const;

export type VncHotkeyId = (typeof VNC_HOTKEY_SLOTS)[number]['id'];

export function vncHotkeySlot(id: string) {
  const key = id.toLowerCase().replace(/^f/, '');
  return VNC_HOTKEY_SLOTS.find((s) => s.id === key || s.id === id.toLowerCase());
}

export function vncLabelForProxyPort(proxyPort: number): string | null {
  return VNC_HOTKEY_SLOTS.find((s) => s.proxyPort === proxyPort)?.label ?? null;
}

export async function focusVncByHotkey(hotkeyId: string): Promise<{
  proxyPort: number;
  label: string;
} | null> {
  const slot = vncHotkeySlot(hotkeyId);
  if (!slot) return null;
  await setVncFocusPort(slot.proxyPort);
  return { proxyPort: slot.proxyPort, label: slot.label };
}

export async function clearVncFocus(): Promise<void> {
  await setVncFocusPort(null);
}
