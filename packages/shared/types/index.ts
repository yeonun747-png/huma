export * from './account';
export * from './job';
export * from './modem';
export * from './video';
export * from './dongle-slot';
export * from './crank-label';
export * from './crank-service';
export * from './paste-extract';
export * from './pipeline-job';
export * from './blog-link';
export * from './workspace-service-mention';
export * from './blog-check-search';
export * from './video-content';
export * from './video-persona-text';
export * from './watcher-log-filter';
export * from './quiz-image-prompt';
export * from './narration-script';
export * from './narration-persona';
export * from './korean-spoken-numbers';

export type Workspace = import('./account').Workspace;

export interface HumaAdmin {
  id: string;
  email: string;
  name: string;
  workspaces: Workspace[];
  is_super: boolean;
  is_active: boolean;
  last_login_at?: string;
}

export interface SystemStatus {
  healthy: boolean;
  queueActive: boolean;
  pendingJobs: number;
  activeAccounts: number;
  errors: number;
}
