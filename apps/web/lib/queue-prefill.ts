export type QueuePrefill = { title: string; source_url: string };

export function dispatchQueuePrefill(data: QueuePrefill) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('huma:queue-prefill', { detail: data }));
}
