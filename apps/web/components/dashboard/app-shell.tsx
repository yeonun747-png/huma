'use client';

import { Sidebar } from '@/components/dashboard/sidebar';
import { Topbar } from '@/components/dashboard/topbar';
import { WorkspaceProvider } from '@/components/dashboard/workspace-context';

export function AppShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <WorkspaceProvider>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar title={title} />
          <main className="flex-1 overflow-y-auto bg-huma-bg p-4 transition-colors duration-300">
            {children}
          </main>
        </div>
      </div>
    </WorkspaceProvider>
  );
}
