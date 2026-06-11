export function ShellPageSkeleton({ title }: { title: string }) {
  return (
    <div className="animate-pulse space-y-4 py-2">
      <div className="font-mono text-[11px] text-huma-t3">{title} 불러오는 중…</div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[72px] rounded-lg bg-huma-bg3" />
        ))}
      </div>
      <div className="h-[320px] rounded-lg bg-huma-bg3" />
    </div>
  );
}
