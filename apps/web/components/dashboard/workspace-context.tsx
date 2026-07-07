'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import type { Workspace } from '@huma/shared';
import { WORKSPACES, getAccessibleWorkspaces } from '@/lib/constants';
import {
  BUSINESS_UNITS,
  getAccessibleBusinessUnits,
  workspaceToBusinessUnit,
  type BusinessUnit,
} from '@/lib/admin-scope';
import { useAuth } from '@/lib/auth-context';

const STORAGE_KEY = 'huma_workspace';

const WS_ROUTE_MAP: Partial<Record<string, Workspace>> = {
  '/adsense': 'quizoasis',
  '/cafe-viral': 'yeonun',
};

function readStoredUnit(): BusinessUnit | null {
  if (typeof window === 'undefined') return null;
  const value = localStorage.getItem(STORAGE_KEY);
  if (
    value === 'yeonun' ||
    value === 'fortune82' ||
    value === 'quizoasis' ||
    value === 'panana'
  ) {
    return value;
  }
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

  const [businessUnit, setBusinessUnitState] = useState<BusinessUnit>(
    () => readStoredUnit() ?? 'yeonun',
  );

  const workspace = (businessUnit === 'fortune82' ? 'yeonun' : businessUnit) as Workspace;

  const accessibleSubWorkspaces = useMemo(
    () => WORKSPACES.filter((ws) => accessibleWorkspaces.some((a) => a.id === ws.id)),
    [accessibleWorkspaces],
  );

  useEffect(() => {
    if (accessibleBusinessUnitIds.length === 0) return;

    setBusinessUnitState((current) => {
      const stored = readStoredUnit();
      const candidate = stored && accessibleBusinessUnitIds.includes(stored) ? stored : current;
      if (accessibleBusinessUnitIds.includes(candidate)) return candidate;
      return accessibleBusinessUnitIds[0] ?? 'yeonun';
    });
  }, [admin, accessibleBusinessUnitIds]);

  useEffect(() => {
    const routeWs = WS_ROUTE_MAP[pathname];
    if (!routeWs) return;
    if (!accessibleWorkspaces.some((ws) => ws.id === routeWs)) return;
    setBusinessUnitState(routeWs);
    localStorage.setItem(STORAGE_KEY, routeWs);
  }, [pathname, accessibleWorkspaces]);

  useEffect(() => {
    document.documentElement.setAttribute('data-ws', businessUnit);
    localStorage.setItem(STORAGE_KEY, businessUnit);
  }, [businessUnit]);

  const setBusinessUnit = (unit: BusinessUnit) => {
    if (!accessibleBusinessUnitIds.includes(unit)) return;
    setBusinessUnitState(unit);
  };

  const setSubWorkspace = (ws: Workspace) => {
    if (!accessibleWorkspaces.some((a) => a.id === ws)) return;
    setBusinessUnitState(ws);
  };

  const setWorkspace = (ws: Workspace) => {
    if (!accessibleWorkspaces.some((item) => item.id === ws)) return;
    setBusinessUnitState(ws);
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
