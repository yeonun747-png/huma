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
  { href: '/dashboard', label: '대시보드', icon: '⬡', group: 'common' },
  { href: '/queue', label: '포스팅 큐 관리', icon: '⊞', badgeKey: 'queue', group: 'common' },
  { href: '/calendar', label: '스케줄 캘린더', icon: '▦', group: 'common' },
  { href: '/monitor', label: '발행 모니터', icon: '▣', live: true, group: 'common' },
  { href: '/oplog', label: 'Operation Log', icon: '📋', group: 'common' },
  { href: '/accounts', label: '계정 관리', icon: '◉', group: 'common' },
  { href: '/video-content', label: '숏폼 영상 관리', icon: '🎬', badgeKey: 'video', group: 'common' },
  { href: '/seo-keywords', label: 'SEO 키워드', icon: '🔍', badgeKey: 'seo', group: 'common' },
  { href: '/blog-check', label: '블로그 지수 분석', icon: '📊', badgeKey: 'blogcheck', group: 'common' },
  { href: '/watcher', label: 'Layer4 Watcher', icon: '⚠', badgeKey: 'watcher', badgeErr: true, group: 'common' },
  { href: '/human-engine', label: '휴먼 엔진 설정', icon: '⚙', group: 'common' },
  { href: '/crank', label: 'C-Rank 소통 관리', icon: '🔗', group: 'common' },
  { href: '/modems', label: '프록시 관리', icon: '⊕', group: 'system' },
  { href: '/settings', label: '환경 설정', icon: '◈', group: 'system' },
];

export const SPEC_NAV_ITEMS: Record<string, { href: string; label: string; icon: string; badgeKey?: string }[]> = {
  yeonun: [{ href: '/cafe-viral', label: '카페 관리', icon: '🏛' }],
  quizoasis: [
    { href: '/adsense', label: '애드센스 수익', icon: '💰' },
    { href: '/quiz-image-gen', label: '퀴즈 이미지 생성', icon: '🖼️' },
  ],
  panana: [],
};

export const WS_LABEL: Record<string, string> = {
  yeonun: '연운',
  quizoasis: '퀴즈오아시스',
  panana: '파나나',
};
