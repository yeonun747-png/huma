'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef } from 'react';
import type { PageActionType } from '@/lib/page-config';

type ActionFn = () => void | Promise<void>;

const PageActionContext = createContext<{
  register: (type: PageActionType, fn: ActionFn) => () => void;
  run: (type: PageActionType) => Promise<void>;
} | null>(null);

export function PageActionProvider({ children }: { children: React.ReactNode }) {
  const handlers = useRef<Partial<Record<PageActionType, ActionFn>>>({});

  const register = useCallback((type: PageActionType, fn: ActionFn) => {
    handlers.current[type] = fn;
    return () => {
      if (handlers.current[type] === fn) delete handlers.current[type];
    };
  }, []);

  const run = useCallback(async (type: PageActionType) => {
    const fn = handlers.current[type];
    if (fn) await fn();
  }, []);

  return <PageActionContext.Provider value={{ register, run }}>{children}</PageActionContext.Provider>;
}

export function usePageAction() {
  return useContext(PageActionContext);
}

export function useRegisterPageAction(type: PageActionType, fn: ActionFn) {
  const ctx = usePageAction();
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!ctx) return;
    return ctx.register(type, () => fnRef.current());
  }, [ctx, type]);
}
