import { AppShell } from '@/components/dashboard/app-shell';
import { LogViewer } from '@/components/charts/log-viewer';

export default function OplogPage() {
  return (
    <AppShell title="Operation Log">
      <div className="animate-fadeIn space-y-3">
        <div className="panel-title">실시간 Operation Log</div>
        <LogViewer tall />
      </div>
    </AppShell>
  );
}
