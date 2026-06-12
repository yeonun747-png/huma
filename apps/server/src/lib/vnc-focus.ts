import { listActiveVncTilePorts, getVncFocusPort, setVncFocusPort } from './vnc-tile-state.js';

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

export interface VncHudState {
  mode: 'tile' | 'focus';
  splitCount: number;
  modeLabel: string;
  focusLabel: string | null;
  focusProxyPort: number | null;
  lines: string[];
  hotkeys: Array<{ id: string; label: string; proxyPort: number; active: boolean }>;
}

export async function buildVncHudState(): Promise<VncHudState> {
  const activePorts = await listActiveVncTilePorts();
  const focusPort = await getVncFocusPort();
  const splitCount = Math.max(1, activePorts.length);

  const hotkeys = VNC_HOTKEY_SLOTS.map((s) => ({
    id: s.id,
    label: s.label,
    proxyPort: s.proxyPort,
    active: activePorts.includes(s.proxyPort),
  }));

  const focusLabel = focusPort ? vncLabelForProxyPort(focusPort) : null;

  let modeLabel: string;
  if (focusPort) {
    modeLabel = `포커스 · ${focusLabel ?? `:${focusPort}`}`;
  } else if (splitCount <= 1) {
    modeLabel = '단일 화면';
  } else {
    modeLabel = `${splitCount}분할`;
  }

  const lines = [
    ...VNC_HOTKEY_SLOTS.map((s) => {
      const active = activePorts.includes(s.proxyPort);
      const mark = focusPort === s.proxyPort ? ' ◀' : active ? '' : ' (대기)';
      return `${s.hint}: ${s.label}${mark}`;
    }),
    'Ctrl+Alt+0: 분할 복귀 (HUD 「분할」 클릭 가능)',
    '슬롯 클릭 또는 Ctrl+Alt+1~5: 포커스 (RealVNC가 Ctrl+Alt를 먹으면 클릭 사용)',
    '한/영: VNC HUD 「한/영」 클릭',
  ];

  return {
    mode: focusPort ? 'focus' : 'tile',
    splitCount,
    modeLabel,
    focusLabel,
    focusProxyPort: focusPort,
    lines,
    hotkeys,
  };
}
