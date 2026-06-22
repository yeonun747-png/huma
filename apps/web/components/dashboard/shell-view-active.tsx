'use client';

import { createContext, useContext } from 'react';
import { useShellNav } from './shell-nav-context';

const ShellViewPathContext = createContext('');

export function ShellViewPathProvider({
  path,
  children,
}: {
  path: string;
  children: React.ReactNode;
}) {
  return <ShellViewPathContext.Provider value={path}>{children}</ShellViewPathContext.Provider>;
}

/** 현재 사이드바에서 선택된 셸 뷰인지 — 숨겨진 keep-alive 뷰의 폴링·probe 억제용 */
export function useShellViewActive(): boolean {
  const viewPath = useContext(ShellViewPathContext);
  const { shellPath } = useShellNav();
  return viewPath === shellPath;
}
