import { AppShell } from '@/components/dashboard/app-shell';
import { ModemPanel } from '@/components/dashboard/modem-panel';

export default function ModemsPage() {
  return (
    <AppShell title="프록시 관리">
      <ModemPanel />
    </AppShell>
  );
}
