export * from './account';
export * from './job';
export * from './modem';
export * from './video';
export * from './dongle-slot';
export * from './crank-label';

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
