'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/dashboard/app-shell';
import { api } from '@/lib/api';
import { useWorkspace } from '@/components/dashboard/workspace-context';

function CrankContent() {
  const { workspace } = useWorkspace();
  const [config, setConfig] = useState<Record<string, unknown>>({});

  useEffect(() => {
    api.getSetting('social_crank').then(setConfig).catch(() => {});
  }, []);

  return (
    <div className="animate-fadeIn space-y-3">
      <div className="panel">
        <div className="panel-title">소통 설정 · {workspace}</div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="stat-card"><div className="stat-label">일일 한도</div><div className="stat-value text-base">{String(config.daily_limit_per_account ?? 30)}</div></div>
          <div className="stat-card"><div className="stat-label">방문 간격</div><div className="stat-value text-base">{String(config.min_visit_interval_days ?? 3)}일</div></div>
          <div className="stat-card"><div className="stat-label">우리 블로그 비율</div><div className="stat-value text-base">{String((Number(config.our_blog_ratio ?? 0.25) * 100).toFixed(0))}%</div></div>
          <div className="stat-card"><div className="stat-label">세션 방문 수</div><div className="stat-value text-base">{String(config.visits_per_session ?? 15)}</div></div>
        </div>
      </div>
      <button type="button" className="btn-primary" onClick={() => {
        api.createJob({ workspace, job_type: 'social_crank', title: 'C-Rank 소통', status: 'pending' });
      }}>C-Rank 세션 시작</button>
    </div>
  );
}

export default function CrankPage() {
  return (
    <AppShell title="C-Rank 소통 관리">
      <CrankContent />
    </AppShell>
  );
}
