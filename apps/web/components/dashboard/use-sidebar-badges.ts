'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Workspace } from '@huma/shared';
import { api } from '@/lib/api';
import { getLogSocket } from '@/lib/socket';
import { NAV_BADGES_REFRESH } from '@/lib/nav-badge-events';

const BADGE_POLL_MS = 4_000;
const FAST_POLL_MS = 2_500;
const FAST_ROUTES = new Set(['/queue', '/video-content', '/monitor', '/watcher']);

export function useSidebarBadges(workspace: Workspace, activePath: string) {
  const [badges, setBadges] = useState({ queue: 0, video: 0, watcher: 0, seo: 0, scenario: 0 });
  const [pendingJobs, setPendingJobs] = useState(0);
  const [liveAccounts, setLiveAccounts] = useState(0);

  const refresh = useCallback(() => {
    const scope = { workspace };
    void api
      .navBadges(scope, { force: true })
      .then((b) => {
        setBadges((prev) => ({
          ...prev,
          queue: b.queue,
          video: b.video,
          watcher: b.watcher,
        }));
      })
      .catch(() => {});

    void api
      .status(scope, { force: true })
      .then((s) => {
        setPendingJobs(s.pendingJobs ?? 0);
        setLiveAccounts(s.liveAccounts ?? 0);
      })
      .catch(() => {});
  }, [workspace]);

  useEffect(() => {
    setBadges((prev) => ({ ...prev, queue: 0, video: 0, watcher: 0 }));
    setPendingJobs(0);
    setLiveAccounts(0);
    refresh();

    const pollMs = FAST_ROUTES.has(activePath) ? FAST_POLL_MS : BADGE_POLL_MS;
    const onRefresh = () => refresh();

    window.addEventListener('huma:queue-updated', onRefresh);
    window.addEventListener(NAV_BADGES_REFRESH, onRefresh);

    const poll = window.setInterval(refresh, pollMs);

    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearInterval(poll);
      window.removeEventListener('huma:queue-updated', onRefresh);
      window.removeEventListener(NAV_BADGES_REFRESH, onRefresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [workspace, activePath, refresh]);

  useEffect(() => {
    const socket = getLogSocket();
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(refresh, 350);
    };

    socket.connect();
    socket.on('log', scheduleRefresh);
    socket.on('connect', refresh);

    return () => {
      if (debounce) clearTimeout(debounce);
      socket.off('log', scheduleRefresh);
      socket.off('connect', refresh);
    };
  }, [refresh]);

  return { badges, pendingJobs, liveAccounts };
}
