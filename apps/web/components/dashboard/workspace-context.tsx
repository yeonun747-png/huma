'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import type { Workspace } from '@huma/shared';
import { getAccessibleWorkspaces, getDefaultWorkspace } from '@/lib/constants';
import { useAuth } from '@/lib/auth-context';

const STORAGE_KEY = 'huma_workspace';

const WS_ROUTE_MAP: Partial<Record<string, Workspace>> = {
  '/seo-keywords': 'yeonun',
  '/adsense': 'quizoasis',
  '/languages': 'quizoasis',
  '/scenario': 'panana',
  '/social': 'panana',
};

function readStoredWorkspace(): Workspace | null {
  if (typeof window === 'undefined') return null;
  const value = localStorage.getItem(STORAGE_KEY);
  if (value === 'yeonun' || value === 'quizoasis' || value === 'panana') return value;
  return null;
}

interface WorkspaceContextValue {
  workspace: Workspace;
  setWorkspace: (ws: Workspace) => void;
  accessibleWorkspaces: ReturnType<typeof getAccessibleWorkspaces>;
}

const WorkspaceContext = createContext<WorkspaceContextValue>({
  workspace: 'yeonun',
  setWorkspace: () => {},
  accessibleWorkspaces: [],
});

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { admin } = useAuth();
  const pathname = usePathname();
  const accessibleWorkspaces = useMemo(() => getAccessibleWorkspaces(admin), [admin]);
  const [workspace, setWorkspaceState] = useState<Workspace>(() => readStoredWorkspace() ?? 'yeonun');

  useEffect(() => {
    const allowedIds = accessibleWorkspaces.map((ws) => ws.id);
    if (allowedIds.length === 0) return;

    setWorkspaceState((current) => {
      const stored = readStoredWorkspace();
      const candidate = stored && allowedIds.includes(stored) ? stored : current;
      if (allowedIds.includes(candidate)) return candidate;
      return getDefaultWorkspace(admin);
    });
  }, [admin, accessibleWorkspaces]);

  useEffect(() => {
    const routeWs = WS_ROUTE_MAP[pathname];
    if (!routeWs) return;
    if (!accessibleWorkspaces.some((ws) => ws.id === routeWs)) return;
    setWorkspaceState(routeWs);
    localStorage.setItem(STORAGE_KEY, routeWs);
  }, [pathname, accessibleWorkspaces]);

  useEffect(() => {
    document.documentElement.setAttribute('data-ws', workspace);
    localStorage.setItem(STORAGE_KEY, workspace);
  }, [workspace]);

  const setWorkspace = (ws: Workspace) => {
    if (accessibleWorkspaces.some((item) => item.id === ws)) {
      setWorkspaceState(ws);
    }
  };

  return (
    <WorkspaceContext.Provider value={{ workspace, setWorkspace, accessibleWorkspaces }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  return useContext(WorkspaceContext);
}
