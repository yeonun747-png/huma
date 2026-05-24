export function EmptyPanel({ message = '데이터가 없습니다' }: { message?: string }) {
  return <div className="py-8 text-center text-sm text-huma-t3">{message}</div>;
}
