'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';

type ShellNavContextValue = {
  shellPath: string;
  navigate: (href: string) => void;
};

const ShellNavContext = createContext<ShellNavContextValue | null>(null);

export function ShellNavProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [shellPath, setShellPath] = useState(pathname);

  useEffect(() => {
    setShellPath(pathname);
  }, [pathname]);

  const navigate = useCallback(
    (href: string) => {
      if (href === shellPath) return;
      setShellPath(href);
      router.push(href);
    },
    [router, shellPath],
  );

  return (
    <ShellNavContext.Provider value={{ shellPath, navigate }}>{children}</ShellNavContext.Provider>
  );
}

export function useShellNav(): ShellNavContextValue {
  const ctx = useContext(ShellNavContext);
  if (!ctx) {
    throw new Error('useShellNav must be used within ShellNavProvider');
  }
  return ctx;
}
