import type { NarrationAxisType, NarrationScriptWorkspace } from '@huma/shared';

const NARRATION_CTA_SITE: Record<NarrationScriptWorkspace, { label: string; domain: string }> = {
  yeonun: { label: '연운', domain: 'yeonun.com' },
  fortune82: { label: '포춘82', domain: 'fortune82.com' },
};

/** 띠 축 — CTA 직전 면피 (A안) */
export function buildNarrationZodiacDisclaimer(workspace: NarrationScriptWorkspace): string {
  if (workspace === 'fortune82') {
    return (
      '같은 띠여도 태어난 해에 따라 흐름이 달라질 수 있어요.\n' +
      '더 자세한 풀이는 포춘82(fortune82.com)에서 확인해보세요.'
    );
  }
  return (
    '같은 띠여도 태어난 해에 따라 흐름이 달라질 수 있어요.\n' +
    '더 정확한 내 사주 흐름은 연운(yeonun.com)에서 확인해보세요.'
  );
}

export function buildNarrationCta(workspace: NarrationScriptWorkspace, productTitle: string): string {
  const name = productTitle.trim() || '운세';
  const site = NARRATION_CTA_SITE[workspace];
  const siteWithDomain = `${site.label}(${site.domain})`;

  if (workspace === 'fortune82') {
    return (
      `더 자세한 내 ${name}이 궁금하다면, ${siteWithDomain}에서 확인해보세요. ` +
      `결제하시면 코드와 인증번호로 60일 안에 다시 보실 수 있어요.`
    );
  }
  return (
    `더 정확한 내 ${name}이 궁금하다면, ${siteWithDomain}에서 사주로 확인해보세요. ` +
    `가입하면 5천 원 크레딧 바로 드려요.`
  );
}

export function appendNarrationScriptFooter(
  body: string,
  opts: {
    workspace: NarrationScriptWorkspace;
    productTitle: string;
    axisType: NarrationAxisType;
  },
): string {
  const trimmed = body.trim();
  if (!trimmed) {
    return opts.axisType === 'zodiac'
      ? `${buildNarrationZodiacDisclaimer(opts.workspace)}\n${buildNarrationCta(opts.workspace, opts.productTitle)}`
      : buildNarrationCta(opts.workspace, opts.productTitle);
  }

  const last = trimmed.at(-1);
  const needsPeriod = last && !'".!?」』'.includes(last);
  let next = `${trimmed}${needsPeriod ? '.' : ''}`;

  if (opts.axisType === 'zodiac') {
    next = `${next}\n${buildNarrationZodiacDisclaimer(opts.workspace)}`;
  }

  const cta = buildNarrationCta(opts.workspace, opts.productTitle);
  return `${next}\n${cta}`;
}

/** @deprecated appendNarrationScriptFooter 사용 */
export function appendNarrationCta(
  body: string,
  workspace: NarrationScriptWorkspace,
  productTitle: string,
): string {
  return appendNarrationScriptFooter(body, {
    workspace,
    productTitle,
    axisType: 'constellation',
  });
}
