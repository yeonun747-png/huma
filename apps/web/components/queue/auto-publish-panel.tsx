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
    return (
      <div className="flex min-w-0 flex-1 items-stretch justify-end">
        <YeonunPublishAccountsStrip refreshToken={stripRefresh} onDone={handleDone} />
      </div>
    );
  }

  return <AutoPublishButton workspace={workspace} onDone={handleDone} refreshToken={stripRefresh} />;
}
