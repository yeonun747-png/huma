import type { NarrationScriptWorkspace } from '@huma/shared';

export function buildNarrationCta(workspace: NarrationScriptWorkspace, productTitle: string): string {
  const name = productTitle.trim() || '운세';
  if (workspace === 'fortune82') {
    return (
      `더 자세한 내 ${name}이 궁금하다면, 포춘82에서 확인해보세요. ` +
      `결제하시면 코드와 인증번호로 60일 안에 다시 보실 수 있어요.`
    );
  }
  return (
    `더 정확한 내 ${name}이 궁금하다면, 연운에서 사주로 확인해보세요. ` +
    `가입하면 5천 원 크레딧 바로 드려요.`
  );
}

export function appendNarrationCta(
  body: string,
  workspace: NarrationScriptWorkspace,
  productTitle: string,
): string {
  const trimmed = body.trim();
  const cta = buildNarrationCta(workspace, productTitle);
  if (!trimmed) return cta;
  const last = trimmed.at(-1);
  const needsPeriod = last && !'".!?」』'.includes(last);
  return `${trimmed}${needsPeriod ? '.' : ''}\n${cta}`;
}
