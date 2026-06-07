import { getSetting, updateSetting } from './settings.js';

const KEY = 'system_paused';

export interface SystemPauseState {
  paused: boolean;
  reason?: string;
  paused_at?: string;
}

let systemPaused = false;

export async function initSystemPause(): Promise<void> {
  const state = await getSetting<SystemPauseState>(KEY, { paused: false });
  systemPaused = Boolean(state.paused);
}

export function getSystemPaused(): boolean {
  return systemPaused;
}

export async function setSystemPaused(paused: boolean, reason?: string): Promise<void> {
  systemPaused = paused;
  const value: SystemPauseState = paused
    ? {
        paused: true,
        reason: reason?.trim() || '운영자 전체 정지',
        paused_at: new Date().toISOString(),
      }
    : { paused: false };
  await updateSetting(KEY, value);
}
