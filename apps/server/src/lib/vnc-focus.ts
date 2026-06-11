import { listActiveVncTilePorts, getVncFocusPort, setVncFocusPort } from './vnc-tile-state.js';

/** F1~F5 고정 슬롯 (VNC 단축키) */
export const VNC_HOTKEY_SLOTS = [
  { id: 'f1', label: 'Crank1', proxyPort: 10006 },
  { id: 'f2', label: 'Crank2', proxyPort: 10007 },
  { id: 'f3', label: '연운1', proxyPort: 10001 },
  { id: 'f4', label: '연운2', proxyPort: 10002 },
  { id: 'f5', label: '연운3', proxyPort: 10003 },
] as const;

export type VncHotkeyId = (typeof VNC_HOTKEY_SLOTS)[number]['id'];

export function vncHotkeySlot(id: string) {
  return VNC_HOTKEY_SLOTS.find((s) => s.id === id.toLowerCase());
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
      return `${s.id.toUpperCase()}: ${s.label}${mark}`;
    }),
    'F10: 분할 복귀',
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
