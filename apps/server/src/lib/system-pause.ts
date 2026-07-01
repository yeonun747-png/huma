import { getSetting, updateSetting } from './settings.js';

const KEY = 'system_paused';

export interface SystemPauseState {
  paused: boolean;
  reason?: string;
  paused_at?: string;
  /** 전체 중지 직전 auto_publish ON 이었던 계정 — 재시작 시 복구 */
  auto_publish_snapshot?: Array<{ id: string; workspace: string }>;
}

let systemPaused = false;

export async function getSystemPauseState(): Promise<SystemPauseState> {
  return getSetting<SystemPauseState>(KEY, { paused: false });
}

export async function initSystemPause(): Promise<void> {
  const state = await getSystemPauseState();
  systemPaused = Boolean(state.paused);
}

export function getSystemPaused(): boolean {
  return systemPaused;
}

export async function setSystemPaused(
  paused: boolean,
  opts?: { reason?: string; autoPublishSnapshot?: Array<{ id: string; workspace: string }> },
): Promise<void> {
  systemPaused = paused;
  const value: SystemPauseState = paused
    ? {
        paused: true,
        reason: opts?.reason?.trim() || '운영자 전체 정지',
        paused_at: new Date().toISOString(),
        auto_publish_snapshot: opts?.autoPublishSnapshot ?? [],
      }
    : { paused: false };
  await updateSetting(KEY, value);
}
