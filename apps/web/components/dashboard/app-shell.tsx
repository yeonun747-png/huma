'use client';

import { Sidebar } from '@/components/dashboard/sidebar';
import { Topbar } from '@/components/dashboard/topbar';
import { PageActionProvider } from '@/components/dashboard/page-action-context';
import { HumanEngineSaveProvider } from '@/components/dashboard/human-engine-save-context';
import { DashboardPeriodProvider } from '@/components/dashboard/dashboard-period-context';
import { WorkspaceRouteGuard } from '@/components/dashboard/workspace-route-guard';
import { ShellNavProvider, useShellNav } from '@/components/dashboard/shell-nav-context';
import { ShellContent } from '@/components/dashboard/shell-content';
import { getPageMeta } from '@/lib/page-config';
import { isShellRoute } from '@/lib/shell-routes';

function AppShellInner({ children }: { children: React.ReactNode }) {
  const { shellPath } = useShellNav();
  const meta = getPageMeta(shellPath);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar title={meta.title} />
        <main
          key={shellPath}
          className={`flex-1 overflow-y-auto bg-huma-bg px-[18px] py-4 ${meta.contentClass ?? ''}`}
        >
          {isShellRoute(shellPath) ? <ShellContent /> : children}
        </main>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <ShellNavProvider>
      <PageActionProvider>
        <HumanEngineSaveProvider>
          <DashboardPeriodProvider>
            <WorkspaceRouteGuard>
              <AppShellInner>{children}</AppShellInner>
            </WorkspaceRouteGuard>
          </DashboardPeriodProvider>
        </HumanEngineSaveProvider>
      </PageActionProvider>
    </ShellNavProvider>
  );
}
