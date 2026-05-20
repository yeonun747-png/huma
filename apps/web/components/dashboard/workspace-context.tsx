'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Workspace } from '@huma/shared';
import { getAccessibleWorkspaces, getDefaultWorkspace } from '@/lib/constants';
import { useAuth } from '@/lib/auth-context';

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
  const accessibleWorkspaces = useMemo(() => getAccessibleWorkspaces(admin), [admin]);
  const [workspace, setWorkspaceState] = useState<Workspace>('yeonun');

  useEffect(() => {
    const allowedIds = accessibleWorkspaces.map((ws) => ws.id);
    if (allowedIds.length === 0) return;

    setWorkspaceState((current) => {
      if (allowedIds.includes(current)) return current;
      return getDefaultWorkspace(admin);
    });
  }, [admin, accessibleWorkspaces]);

  useEffect(() => {
    document.documentElement.setAttribute('data-ws', workspace);
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
