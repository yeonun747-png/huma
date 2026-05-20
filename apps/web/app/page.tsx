import { AppShell } from '@/components/dashboard/app-shell';
import { DashboardHome } from '@/components/dashboard/dashboard-home';

export default function HomePage() {
  return (
    <AppShell title="대시보드">
      <DashboardHome />
    </AppShell>
  );
}
