'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import type { Workspace } from '@huma/shared';
import { WORKSPACES, getAccessibleWorkspaces } from '@/lib/constants';
import {
  BUSINESS_UNITS,
  defaultWorkspaceForUnit,
  getAccessibleBusinessUnits,
  getAccessibleSubWorkspaces,
  workspaceToBusinessUnit,
  type BusinessUnit,
} from '@/lib/admin-scope';
import { useAuth } from '@/lib/auth-context';

const STORAGE_KEY = 'huma_workspace';

const WS_ROUTE_MAP: Partial<Record<string, Workspace>> = {
  '/seo-keywords': 'yeonun',
  '/adsense': 'quizoasis',
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
  businessUnit: BusinessUnit;
  setBusinessUnit: (unit: BusinessUnit) => void;
  setSubWorkspace: (ws: Workspace) => void;
  /** @deprecated setSubWorkspace 또는 setBusinessUnit 사용 */
  setWorkspace: (ws: Workspace) => void;
  accessibleWorkspaces: ReturnType<typeof getAccessibleWorkspaces>;
  accessibleBusinessUnits: typeof BUSINESS_UNITS;
  accessibleSubWorkspaces: typeof WORKSPACES;
}

const WorkspaceContext = createContext<WorkspaceContextValue>({
  workspace: 'yeonun',
  businessUnit: 'yeonun',
  setBusinessUnit: () => {},
  setSubWorkspace: () => {},
  setWorkspace: () => {},
  accessibleWorkspaces: [],
  accessibleBusinessUnits: [],
  accessibleSubWorkspaces: [],
});

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { admin } = useAuth();
  const pathname = usePathname();

  const accessibleWorkspaces = useMemo(() => getAccessibleWorkspaces(admin), [admin]);
  const accessibleBusinessUnitIds = useMemo(() => getAccessibleBusinessUnits(admin), [admin]);
  const accessibleBusinessUnits = useMemo(
    () => BUSINESS_UNITS.filter((unit) => accessibleBusinessUnitIds.includes(unit.id)),
    [accessibleBusinessUnitIds],
  );

  const [workspace, setWorkspaceState] = useState<Workspace>(() => readStoredWorkspace() ?? 'yeonun');

  const businessUnit = workspaceToBusinessUnit(workspace);

  const accessibleSubWorkspaces = useMemo(() => {
    const ids = getAccessibleSubWorkspaces(admin, 'quizoasis_panana');
    return WORKSPACES.filter((ws) => ids.includes(ws.id));
  }, [admin]);

  useEffect(() => {
    const allowedIds = accessibleWorkspaces.map((ws) => ws.id);
    if (allowedIds.length === 0) return;

    setWorkspaceState((current) => {
      const stored = readStoredWorkspace();
      const candidate = stored && allowedIds.includes(stored) ? stored : current;
      if (allowedIds.includes(candidate)) return candidate;
      const defaultUnit = accessibleBusinessUnitIds[0] ?? 'yeonun';
      return defaultWorkspaceForUnit(admin, defaultUnit, stored) as Workspace;
    });
  }, [admin, accessibleWorkspaces, accessibleBusinessUnitIds]);

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

  const setBusinessUnit = (unit: BusinessUnit) => {
    if (!accessibleBusinessUnitIds.includes(unit)) return;
    const next = defaultWorkspaceForUnit(admin, unit, readStoredWorkspace()) as Workspace;
    setWorkspaceState(next);
  };

  const setSubWorkspace = (ws: Workspace) => {
    if (ws !== 'quizoasis' && ws !== 'panana') return;
    if (!accessibleSubWorkspaces.some((item) => item.id === ws)) return;
    setWorkspaceState(ws);
  };

  const setWorkspace = (ws: Workspace) => {
    if (!accessibleWorkspaces.some((item) => item.id === ws)) return;
    setWorkspaceState(ws);
  };

  return (
    <WorkspaceContext.Provider
      value={{
        workspace,
        businessUnit,
        setBusinessUnit,
        setSubWorkspace,
        setWorkspace,
        accessibleWorkspaces,
        accessibleBusinessUnits,
        accessibleSubWorkspaces,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  return useContext(WorkspaceContext);
}
