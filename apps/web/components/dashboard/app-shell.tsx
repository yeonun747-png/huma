'use client';

import { Sidebar } from '@/components/dashboard/sidebar';
import { Topbar } from '@/components/dashboard/topbar';
import { PageActionProvider } from '@/components/dashboard/page-action-context';
import { HumanEngineSaveProvider } from '@/components/dashboard/human-engine-save-context';
import { DashboardPeriodProvider } from '@/components/dashboard/dashboard-period-context';
import { WorkspaceRouteGuard } from '@/components/dashboard/workspace-route-guard';
import { getPageMeta } from '@/lib/page-config';
import { usePathname } from 'next/navigation';

function AppShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const meta = getPageMeta(pathname);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar title={meta.title} />
        <main className={`flex-1 overflow-y-auto bg-huma-bg px-[18px] py-4 transition-colors duration-300 ${meta.contentClass ?? ''}`}>
          {children}
        </main>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <PageActionProvider>
      <HumanEngineSaveProvider>
        <DashboardPeriodProvider>
          <WorkspaceRouteGuard>
            <AppShellInner>{children}</AppShellInner>
          </WorkspaceRouteGuard>
        </DashboardPeriodProvider>
      </HumanEngineSaveProvider>
    </PageActionProvider>
  );
}
