'use client';

import { useEffect } from 'react';
import { useShellNav } from '@/components/dashboard/shell-nav-context';

/** 레거시 /video-pipeline 북마크 → 숏폼 영상 관리 */
export function VideoPipelineRedirect() {
  const { navigate } = useShellNav();

  useEffect(() => {
    navigate('/video-content');
  }, [navigate]);

  return null;
}
