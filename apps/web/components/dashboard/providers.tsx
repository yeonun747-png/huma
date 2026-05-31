'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { WorkspaceProvider } from '@/components/dashboard/workspace-context';
import { isPublicPath } from '@/lib/public-paths';

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { token, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const isPublic = isPublicPath(pathname);

  useEffect(() => {
    if (!loading && !token && !isPublic) {
      router.replace('/login');
    }
  }, [loading, token, isPublic, router]);

  if (isPublic) return <>{children}</>;

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-huma-bg">
        <div className="font-mono text-sm text-huma-t3">로딩 중...</div>
      </div>
    );
  }

  if (!token) return null;
  return <>{children}</>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPublic = isPublicPath(pathname);

  return (
    <AuthProvider>
      <AuthGuard>
        {isPublic ? children : <WorkspaceProvider>{children}</WorkspaceProvider>}
      </AuthGuard>
    </AuthProvider>
  );
}
