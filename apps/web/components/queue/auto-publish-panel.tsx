'use client';

import { useState } from 'react';
import type { Workspace } from '@huma/shared';
import {
  isPostingStripWorkspace,
  WorkspacePublishAccountsStrip,
} from './yeonun-publish-accounts-strip';

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

  if (isPostingStripWorkspace(workspace)) {
    return (
      <div className="flex min-w-0 flex-1 items-stretch justify-end">
        <WorkspacePublishAccountsStrip
          workspace={workspace}
          refreshToken={stripRefresh}
          onDone={handleDone}
        />
      </div>
    );
  }

  return null;
}
