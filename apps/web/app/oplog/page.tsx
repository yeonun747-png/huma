import { AppShell } from '@/components/dashboard/app-shell';
import { OplogView } from '@/components/pages/oplog-view';

export default function OplogPage() {
  return (
    <AppShell>
      <OplogView />
    </AppShell>
  );
}
