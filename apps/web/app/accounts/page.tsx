import { AppShell } from '@/components/dashboard/app-shell';
import { AccountList } from '@/components/queue/account-list';

export default function AccountsPage() {
  return (
    <AppShell title="계정 관리">
      <AccountList />
    </AppShell>
  );
}
