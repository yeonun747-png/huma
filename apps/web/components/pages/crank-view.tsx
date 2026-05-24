'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useWorkspace } from '@/components/dashboard/workspace-context';
import { EmptyPanel } from '@/components/ui/empty-panel';
import { MCrankRow, MGrid, MPanel, MProgressStat, MToggle } from '@/components/mockup/primitives';
import { useRegisterPageAction } from '@/components/dashboard/page-action-context';

export function CrankView() {
  const { workspace } = useWorkspace();
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [targets, setTargets] = useState<Array<Record<string, unknown>>>([]);

  const load = useCallback(() => {
    Promise.all([api.getSetting('social_crank'), api.cafeTargets()]).then(([cfg, t]) => {
      setConfig(cfg);
      setTargets(t);
    }).catch(() => {
      setConfig({});
      setTargets([]);
    });
  }, []);

  useEffect(() => { load(); }, [load]);

  useRegisterPageAction('startCrank', async () => {
    await api.createJob({ workspace, job_type: 'social_crank', title: 'C-Rank 소통', status: 'pending' });
    load();
  });

  const daily = Number(config.daily_limit_per_account ?? 30);
  const visitLimit = Number(config.daily_visit_limit ?? 200);
  const likeLimit = Number(config.daily_like_limit ?? 150);
  const commentLimit = Number(config.daily_comment_limit ?? 50);
  const neighborLimit = Number(config.daily_neighbor_limit ?? 20);

  const saveCfg = async (patch: Record<string, unknown>) => {
    const next = { ...config, ...patch };
    setConfig(next);
    await api.updateSetting('social_crank', next);
  };

  return (
    <div className="animate-fadeIn">
      <MGrid cols={4}>
        <MProgressStat label="오늘 방문" current={0} max={visitLimit} />
        <MProgressStat label="공감" current={0} max={likeLimit} />
        <MProgressStat label="댓글" current={0} max={commentLimit} />
        <MProgressStat label="이웃 신청" current={0} max={neighborLimit} />
      </MGrid>
      <MGrid cols={2}>
        <MPanel title="소통 대상 목록">
          {targets.length === 0 ? (
            <EmptyPanel message="소통 대상이 없습니다. 카페 크롤링을 실행하세요." />
          ) : targets.map((t, i) => (
            <MCrankRow
              key={String(t.id ?? i)}
              icon={String(t.cafe_id ?? '') === 'jeomsamo' ? '🏛' : '📝'}
              title={String(t.post_title ?? t.post_url ?? '대상')}
              sub={String(t.post_url ?? '')}
              status={t.is_replied ? '완료' : '대기'}
              statusTone={t.is_replied ? 'ok' : 'idle'}
            />
          ))}
          <button type="button" className="btn-ghost mt-2 w-full py-2 text-xs" onClick={() => api.crawlCafe().then(load)}>
            점사모 신규글 크롤링
          </button>
        </MPanel>
        <MPanel title="소통 자동화 설정">
          <MToggle label="타 블로그 방문·공감" sub={`일 ${visitLimit}건 · 가우시안 딜레이`} value={Boolean(config.enabled ?? true)} onChange={(v) => saveCfg({ enabled: v })} />
          <MToggle label="AI 자동 댓글" sub="Claude API · 자연어 변형" value={Boolean(config.auto_comment ?? true)} onChange={(v) => saveCfg({ auto_comment: v })} />
          <MToggle label="이웃 자동 신청" sub="사주·운세 블로그 타겟" value={Boolean(config.auto_neighbor ?? true)} onChange={(v) => saveCfg({ auto_neighbor: v })} />
          <MToggle label="카페 소통" sub="점사모 카페 댓글·공감" value={Boolean(config.cafe_enabled ?? false)} onChange={(v) => saveCfg({ cafe_enabled: v })} />
          <div className="mt-2 font-mono text-[10.5px] text-huma-t3">일일 한도: {daily}건/계정</div>
        </MPanel>
      </MGrid>
    </div>
  );
}
