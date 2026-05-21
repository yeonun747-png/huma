'use client';

import { createContext, useCallback, useContext, useRef } from 'react';

type SaveFn = () => Promise<void>;

const HumanEngineSaveContext = createContext<{
  register: (fn: SaveFn) => () => void;
  save: () => Promise<void>;
} | null>(null);

export function HumanEngineSaveProvider({ children }: { children: React.ReactNode }) {
  const saveRef = useRef<SaveFn | null>(null);

  const register = useCallback((fn: SaveFn) => {
    saveRef.current = fn;
    return () => {
      if (saveRef.current === fn) saveRef.current = null;
    };
  }, []);

  const save = useCallback(async () => {
    if (saveRef.current) await saveRef.current();
  }, []);

  return (
    <HumanEngineSaveContext.Provider value={{ register, save }}>
      {children}
    </HumanEngineSaveContext.Provider>
  );
}

export function useHumanEngineSave() {
  return useContext(HumanEngineSaveContext);
}
