import { AppShell } from '@/components/dashboard/app-shell';
import { QueueManager } from '@/components/queue/queue-manager';

export default function QueuePage() {
  return (
    <AppShell title="큐 관리">
      <QueueManager />
    </AppShell>
  );
}
