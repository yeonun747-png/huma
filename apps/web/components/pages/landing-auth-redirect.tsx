'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';

/** 로그인된 사용자만 대시보드로 이동. 비로그인·크롤러는 랜딩 페이지 유지 */
export function LandingAuthRedirect() {
  const { token, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && token) {
      router.replace('/dashboard');
    }
  }, [loading, token, router]);

  return null;
}
