import { AppShell } from '@/components/dashboard/app-shell';
import { DashboardHome } from '@/components/dashboard/dashboard-home';

export default function DashboardPage() {
  return (
    <AppShell>
      <DashboardHome />
    </AppShell>
  );
}
