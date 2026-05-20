'use client';

import { AppShell } from '@/components/dashboard/app-shell';
import { LogViewer } from '@/components/charts/log-viewer';

export default function MonitorPage() {
  return (
    <AppShell title="발행 모니터">
      <div className="animate-fadeIn space-y-3">
        <div className="flex items-center gap-2">
          <span className="tag-live">LIVE</span>
          <span className="text-xs text-huma-t2">Playwright 세션 실시간 모니터</span>
        </div>
        <LogViewer tall />
      </div>
    </AppShell>
  );
}
