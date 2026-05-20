'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { AuthProvider, useAuth } from '@/lib/auth-context';

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { token, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !token && pathname !== '/login') {
      router.replace('/login');
    }
  }, [loading, token, pathname, router]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-huma-bg">
        <div className="font-mono text-sm text-huma-t3">로딩 중...</div>
      </div>
    );
  }

  if (!token && pathname !== '/login') return null;
  return <>{children}</>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <AuthGuard>{children}</AuthGuard>
    </AuthProvider>
  );
}
