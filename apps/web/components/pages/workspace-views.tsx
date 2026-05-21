'use client';

import { MGrid, MPanel, MStat, MSocRow, MTable, MTag } from '@/components/mockup/primitives';
import { useRegisterPageAction } from '@/components/dashboard/page-action-context';

const KEYWORDS = [
  ['#2', '사주풀이', '3,420/일', '▲1'],
  ['#4', '신년운세 2026', '2,890/일', '▲3'],
  ['#7', '꿈해몽', '2,140/일', '▼2'],
  ['#11', '자미두수', '1,230/일', '신규'],
];

export function SeoKeywordsView() {
  useRegisterPageAction('refreshSeo', async () => {});

  return (
    <div className="animate-fadeIn">
      <MGrid cols={2}>
        <MPanel title="검색 순위 추적">
          {KEYWORDS.map(([rank, word, vol, chg]) => (
            <div key={word} className="m-kw-row">
              <div className="m-kw-rank">{rank}</div>
              <div className="m-kw-word">{word}</div>
              <div className="m-kw-vol">{vol}</div>
              <div className={`m-kw-chg ${String(chg).startsWith('▼') ? 'err' : 'ok'}`}>{chg}</div>
            </div>
          ))}
        </MPanel>
        <MPanel title="17개 상품 ↔ 키워드 연결 맵">
          <MTable
            head={['상품 ID', '주력 키워드', '발행수', 'SEO']}
            rows={[
              ['dream-lastnight', '꿈해몽, 꿈의미', '24', <MTag key="1" tone="ok">최상</MTag>],
              ['reunion-maybe', '재회사주, 재회가능성', '12', <MTag key="2" tone="ok">양호</MTag>],
              ['career-timing', '이직사주, 승진운', '8', <MTag key="3" tone="warn">보강필요</MTag>],
              ['zimi-chart', '자미두수풀이', '5', <MTag key="4" tone="err">부족</MTag>],
            ]}
          />
        </MPanel>
      </MGrid>
    </div>
  );
}

export function AdsenseView() {
  useRegisterPageAction('refreshAdsense', async () => {});

  return (
    <div className="animate-fadeIn">
      <MGrid cols={2}>
        <MPanel title="이번달 수익">
          <div className="font-mono text-[39px] font-bold text-huma-t">$218.40</div>
          <div className="mt-2 font-mono text-[11px] text-huma-t3">목표 $400 · 54% 달성</div>
          <div className="mt-3"><div className="m-pb"><div className="m-pf" style={{ width: '54%' }} /></div></div>
          <div className="mt-4 space-y-2 text-xs text-huma-t2">
            <div className="flex justify-between"><span>PV</span><span className="font-mono">142K</span></div>
            <div className="flex justify-between"><span>CTR</span><span className="font-mono">2.8%</span></div>
            <div className="flex justify-between"><span>CPC</span><span className="font-mono">$0.42</span></div>
            <div className="flex justify-between"><span>RPM</span><span className="font-mono">$1.51</span></div>
          </div>
        </MPanel>
        <MPanel title="월별 수익 추이">
          <MTable head={['월', '수익', 'PV', 'RPM']} rows={[['5월', '$218', '142K', '$1.51'], ['4월', '$196', '128K', '$1.48'], ['3월', '$174', '115K', '$1.42']]} />
        </MPanel>
      </MGrid>
    </div>
  );
}

export function LanguagesView() {
  useRegisterPageAction('openLangForm', () => {});

  const langs = [
    ['🇰🇷', '한국어', 100, '완료'],
    ['🇺🇸', 'English', 92, '진행중'],
    ['🇯🇵', '日本語', 78, '진행중'],
    ['🇨🇳', '中文', 65, '대기'],
    ['🇪🇸', 'Español', 45, '대기'],
    ['🇫🇷', 'Français', 38, '대기'],
    ['🇩🇪', 'Deutsch', 30, '대기'],
  ];

  return (
    <div className="animate-fadeIn">
      <MPanel title="다국어 번역 현황">
        {langs.map(([flag, name, pct, status]) => (
          <div key={String(name)} className="flex items-center gap-2 border-b border-huma-bdr2 py-2 last:border-0">
            <span>{flag}</span>
            <span className="flex-1 text-xs text-huma-t">{name}</span>
            <div className="w-20"><div className="m-pb"><div className="m-pf" style={{ width: `${pct}%` }} /></div></div>
            <span className="w-8 text-right font-mono text-[10px] text-huma-t3">{pct}%</span>
            <MTag tone={status === '완료' ? 'ok' : status === '진행중' ? 'warn' : 'idle'}>{status}</MTag>
          </div>
        ))}
      </MPanel>
    </div>
  );
}

export function ScenarioView() {
  useRegisterPageAction('openScenarioForm', () => {});

  const items = [
    ['1', '새벽 3시, 혼자 듣는 위로', '하루 · 45초 · TikTok', ['완료', 'TTS OK']],
    ['2', '비 오는 카페에서의 대화', '민 · 60초 · Instagram', ['초안', '대기']],
    ['3', '야간 도시 산책', '레이 · 30초 · Threads', ['기획', '대기']],
  ];

  return (
    <div className="animate-fadeIn">
      <MPanel title="영상 시나리오">
        {items.map(([num, title, meta, tags]) => (
          <div key={String(num)} className="mb-2 flex gap-2.5 rounded-lg border border-huma-bdr2 bg-huma-bg3 p-3">
            <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded border border-huma-acc bg-[var(--glow)] font-mono text-[10px] font-semibold text-huma-acc">{num}</div>
            <div className="flex-1">
              <div className="text-xs font-semibold text-huma-t">{title}</div>
              <div className="font-mono text-[11px] text-huma-t3">{meta}</div>
              <div className="mt-1 flex gap-1">{(tags as string[]).map((t) => <MTag key={t} tone="idle">{t}</MTag>)}</div>
            </div>
          </div>
        ))}
      </MPanel>
    </div>
  );
}

export function SocialView() {
  useRegisterPageAction('refreshSocial', async () => {});

  return (
    <div className="animate-fadeIn">
      <MGrid cols={4}>
        <MStat label="총 팔로워" value="42K" sub="▲ 1.2K" />
        <MStat label="오늘 도달" value="28K" sub="4채널" />
        <MStat label="저장률" value="4.2%" sub="▲ 0.3%" />
        <MStat label="팔로우 전환" value="2.1%" sub="평균" />
      </MGrid>
      <MGrid cols={2}>
        <MPanel title="플랫폼별 성과">
          <MTable head={['플랫폼', '팔로워', '도달', '저장']} rows={[['TikTok', '24K', '18K', '1.2K'], ['Instagram', '12K', '8K', '640'], ['Threads', '6K', '2K', '210']]} />
        </MPanel>
        <MPanel title="Bot Social Activity">
          <MSocRow label="💬 자동 댓글 반응" value="47건" />
          <MSocRow label="📨 DM 자동 발송" value="12건" />
          <MSocRow label="❤ 좋아요 자동" value="188건" />
          <MSocRow label="👥 신규 팔로우 DM" value="8건" />
        </MPanel>
      </MGrid>
    </div>
  );
}
