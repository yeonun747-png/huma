import type { Workspace } from '@huma/shared';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import {
  getAccessibleWorkspaces as resolveAccessibleWorkspaces,
  type AdminScope,
} from '@/lib/admin-scope';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const WORKSPACES: {
  id: Workspace;
  label: string;
  short: string;
  dotClass: string;
}[] = [
  { id: 'yeonun', label: '연운 緣運', short: '연운', dotClass: 'bg-[#c0506e]' },
  { id: 'quizoasis', label: '퀴즈오아시스', short: '퀴즈', dotClass: 'bg-[#5b7fff]' },
  { id: 'panana', label: '파나나', short: '파나나', dotClass: 'bg-[#00d4ff]' },
];

export function getAccessibleWorkspaces(admin: AdminScope & { name?: string } | null) {
  const ids = resolveAccessibleWorkspaces(admin);
  return WORKSPACES.filter((ws) => ids.includes(ws.id));
}

export function getDefaultWorkspace(admin: AdminScope & { name?: string } | null): Workspace {
  const allowed = getAccessibleWorkspaces(admin);
  return allowed[0]?.id ?? 'yeonun';
}

export const NAV_ITEMS = [
  { href: '/', label: '대시보드', icon: '⬡', group: 'common' },
  { href: '/queue', label: '큐 관리', icon: '⊞', badgeKey: 'queue', group: 'common' },
  { href: '/calendar', label: '스케줄 캘린더', icon: '▦', group: 'common' },
  { href: '/monitor', label: '발행 모니터', icon: '▣', live: true, group: 'common' },
  { href: '/oplog', label: 'Operation Log', icon: '📋', group: 'common' },
  { href: '/accounts', label: '계정 관리', icon: '◉', group: 'common' },
  { href: '/video-pipeline', label: '영상 파이프라인', icon: '▷', badgeKey: 'video', group: 'common' },
  { href: '/watcher', label: 'Layer4 Watcher', icon: '⚠', badgeKey: 'watcher', badgeErr: true, group: 'common' },
  { href: '/human-engine', label: '휴먼 엔진 설정', icon: '⚙', group: 'common' },
  { href: '/bgm-library', label: 'BGM 라이브러리', icon: '🎵', group: 'common' },
  { href: '/crank', label: 'C-Rank 소통 관리', icon: '🔗', group: 'common' },
  { href: '/modems', label: '프록시 관리', icon: '⊕', group: 'system' },
  { href: '/settings', label: '환경 설정', icon: '◈', group: 'system' },
];

export const SPEC_NAV_ITEMS: Record<string, { href: string; label: string; icon: string; badgeKey?: string }[]> = {
  yeonun: [{ href: '/seo-keywords', label: 'SEO 키워드', icon: '🔍', badgeKey: 'seo' }],
  quizoasis: [
    { href: '/adsense', label: '애드센스 수익', icon: '💰' },
    { href: '/languages', label: '다국어 번역 관리', icon: '🌐', badgeKey: 'langs' },
  ],
  panana: [
    { href: '/scenario', label: '영상 시나리오', icon: '🎬', badgeKey: 'scenario' },
    { href: '/social', label: '소셜 분석·DM 자동화', icon: '📱' },
  ],
};

export const WS_LABEL: Record<string, string> = {
  yeonun: '연운',
  quizoasis: '퀴즈오아시스',
  panana: '파나나',
};

export const MOCK_SERVICE_STATUS = [
  {
    id: 'yeonun' as Workspace,
    icon: '🔮',
    name: '연운 緣運',
    detail: 'LIVE 1 · IDLE 2 · 블로그 3계정',
    jobs: 16,
    status: 'ok' as const,
  },
  {
    id: 'quizoasis' as Workspace,
    icon: '🧠',
    name: '퀴즈오아시스',
    detail: 'IDLE · 번역 대기 2건',
    jobs: 6,
    status: 'warn' as const,
  },
  {
    id: 'panana' as Workspace,
    icon: '🎬',
    name: '파나나',
    detail: '⚠ ERR · sora 세션 만료',
    jobs: 2,
    status: 'err' as const,
  },
];

export const MOCK_CHART_DATA = [
  { day: '월', value: 18 },
  { day: '화', value: 22 },
  { day: '수', value: 15 },
  { day: '목', value: 28 },
  { day: '금', value: 24 },
  { day: '토', value: 12 },
  { day: '일', value: 24 },
];
