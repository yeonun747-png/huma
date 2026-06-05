'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import type { DashboardPeriod } from '@/lib/dashboard-mock-data';

const DashboardPeriodContext = createContext<{
  period: DashboardPeriod;
  setPeriod: (p: DashboardPeriod) => void;
} | null>(null);

export function DashboardPeriodProvider({ children }: { children: ReactNode }) {
  const [period, setPeriod] = useState<DashboardPeriod>('today');
  return (
    <DashboardPeriodContext.Provider value={{ period, setPeriod }}>
      {children}
    </DashboardPeriodContext.Provider>
  );
}

export function useDashboardPeriod() {
  const ctx = useContext(DashboardPeriodContext);
  if (!ctx) throw new Error('useDashboardPeriod must be used within DashboardPeriodProvider');
  return ctx;
}
