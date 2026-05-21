'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useWorkspace } from '@/components/dashboard/workspace-context';
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
    }).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  useRegisterPageAction('startCrank', async () => {
    await api.createJob({ workspace, job_type: 'social_crank', title: 'C-Rank 소통', status: 'pending' });
    load();
  });

  const daily = Number(config.daily_limit_per_account ?? 30);
  const visitLimit = 200;
  const likeLimit = 150;
  const commentLimit = 50;
  const neighborLimit = 20;

  const saveCfg = async (patch: Record<string, unknown>) => {
    const next = { ...config, ...patch };
    setConfig(next);
    await api.updateSetting('social_crank', next);
  };

  return (
    <div className="animate-fadeIn">
      <MGrid cols={4}>
        <MProgressStat label="오늘 방문" current={143} max={visitLimit} />
        <MProgressStat label="공감" current={89} max={likeLimit} />
        <MProgressStat label="댓글" current={31} max={commentLimit} />
        <MProgressStat label="이웃 신청" current={12} max={neighborLimit} />
      </MGrid>
      <MGrid cols={2}>
        <MPanel title="소통 대상 목록">
          {targets.length === 0 ? (
            <>
              <MCrankRow icon="📝" title="2026년 연애운 총정리" sub="nahan_saju · 방문 3분 + 공감" status="완료" statusTone="ok" />
              <MCrankRow icon="📝" title="이직할 때 꼭 봐야 할 사주" sub="career_saju · 댓글 예정" status="대기" statusTone="idle" />
              <MCrankRow icon="🏛" title="점사모 카페 신규 게시물" sub="cafe.naver.com/jeomsamo" status="대기" statusTone="idle" onAction={() => api.crawlCafe().then(load)} />
            </>
          ) : targets.map((t, i) => (
            <MCrankRow
              key={String(t.id ?? i)}
              icon="📝"
              title={String(t.title ?? t.url ?? '대상')}
              sub={String(t.blog_id ?? t.url ?? '')}
              status={String(t.status ?? '대기')}
              statusTone={t.status === 'done' ? 'ok' : t.status === 'scheduled' ? 'warn' : 'idle'}
            />
          ))}
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
