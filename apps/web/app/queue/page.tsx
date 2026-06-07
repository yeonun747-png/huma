import { Suspense } from 'react';
import { QueueManager } from '@/components/queue/queue-manager';

export default function QueuePage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-huma-t3">큐 로딩…</div>}>
      <QueueManager />
    </Suspense>
  );
}
