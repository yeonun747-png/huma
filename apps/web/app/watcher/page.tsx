'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/dashboard/app-shell';
import { LogViewer } from '@/components/charts/log-viewer';
import { api } from '@/lib/api';

export default function WatcherPage() {
  const [watcher, setWatcher] = useState<Record<string, unknown>>({});

  useEffect(() => {
    api.getSetting('watcher').then(setWatcher).catch(() => {});
  }, []);

  return (
    <AppShell title="Layer4 Watcher">
      <div className="animate-fadeIn space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <div className="stat-card"><div className="stat-label">429 Cooldown</div><div className="stat-value text-base">{String(watcher.cooldown_429_min ?? 15)}분</div></div>
          <div className="stat-card"><div className="stat-label">자동 중지</div><div className="stat-value text-base">{watcher.auto_pause ? 'ON' : 'OFF'}</div></div>
          <div className="stat-card"><div className="stat-label">복구 단계</div><div className="font-mono text-xs text-huma-t2">{JSON.stringify(watcher.recovery_steps_min ?? [])}</div></div>
        </div>
        <div className="panel-title">감지 이벤트 로그</div>
        <LogViewer tall />
      </div>
    </AppShell>
  );
}
