'use client';

import { useState } from 'react';
import type { Workspace } from '@huma/shared';
import { AutoPublishButton } from './auto-publish-button';
import { YeonunPublishAccountsStrip } from './yeonun-publish-accounts-strip';

interface AutoPublishPanelProps {
  workspace: Workspace;
  onDone: () => void;
  accountsRefresh?: number;
}

export function AutoPublishPanel({ workspace, onDone, accountsRefresh = 0 }: AutoPublishPanelProps) {
  const [refreshToken, setRefreshToken] = useState(0);

  const handleDone = () => {
    setRefreshToken((n) => n + 1);
    onDone();
  };

  const stripRefresh = refreshToken + accountsRefresh;

  if (workspace === 'yeonun') {
    return <YeonunPublishAccountsStrip refreshToken={stripRefresh} onDone={handleDone} />;
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <AutoPublishButton workspace={workspace} onDone={handleDone} />
    </div>
  );
}
