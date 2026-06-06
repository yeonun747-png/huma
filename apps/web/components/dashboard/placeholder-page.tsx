export function PlaceholderPage({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="panel animate-fadeIn">
      <div className="panel-title">{title}</div>
      <p className="text-sm text-huma-t2">{description}</p>
      <p className="mt-3 font-mono text-[10px] text-huma-t3">
        Phase 8에서 상세 UI가 구현됩니다.
      </p>
    </div>
  );
}
