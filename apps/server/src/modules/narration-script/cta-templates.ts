import type { NarrationAxisType, NarrationScriptWorkspace } from '@huma/shared';
import { buildNarrationCtaLead } from './topic-hook.js';

const NARRATION_CTA_SITE: Record<NarrationScriptWorkspace, { label: string; domain: string }> = {
  yeonun: { label: '연운', domain: 'yeonun.com' },
  fortune82: { label: '포춘82', domain: 'fortune82.com' },
};

/** LLM·재처리 시 CTA·면피·댓글 유도 줄 제거 */
export function stripNarrationFooterLines(body: string): string {
  const lines = body.split('\n');
  const kept: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (/같은\s*띠여도/.test(t)) continue;
    if (/연운\s*\(\s*yeonun\.com\s*\)/i.test(t)) continue;
    if (/포춘82\s*\(\s*fortune82\.com\s*\)/i.test(t)) continue;
    if (/yeonun\.com|fortune82\.com/i.test(t)) continue;
    if (/가입하면\s*5\s*천\s*원\s*크레딧|가입하면\s*5천\s*원\s*크레딧/.test(t)) continue;
    if (/결제하시면\s*코드와\s*인증번호/.test(t)) continue;
    if (/더\s*(정확한|자세한)\s*/.test(t) && /궁금|확인|풀이|사주\s*흐름/.test(t)) continue;
    if (/화면을\s*두\s*번?\s*터치|화면을\s*두번터치/i.test(t)) continue;
    kept.push(line);
  }
  return kept.join('\n').trim();
}

/** 띠 축 — CTA 직전 면피 (URL·가입 유도 없음) */
export function buildNarrationZodiacDisclaimer(_workspace: NarrationScriptWorkspace): string {
  return '같은 띠여도 태어난 해에 따라 흐름이 달라질 수 있어요.';
}

export function buildNarrationCta(workspace: NarrationScriptWorkspace, hookLabel: string): string {
  const lead = buildNarrationCtaLead(hookLabel);
  const site = NARRATION_CTA_SITE[workspace];
  const siteWithDomain = `${site.label}(${site.domain})`;

  if (workspace === 'fortune82') {
    return (
      `${lead}, ${siteWithDomain}에서 확인해보세요. ` +
      `결제하시면 코드와 인증번호로 60일 안에 다시 보실 수 있어요.`
    );
  }
  return (
    `${lead}, ${siteWithDomain}에서 사주로 확인해보세요. ` +
    `가입하면 5천 원 크레딧 바로 드려요.`
  );
}

export function appendNarrationScriptFooter(
  body: string,
  opts: {
    workspace: NarrationScriptWorkspace;
    hookLabel: string;
    axisType: NarrationAxisType;
  },
): string {
  const trimmed = stripNarrationFooterLines(body.trim());
  if (!trimmed) {
    return opts.axisType === 'zodiac'
      ? `${buildNarrationZodiacDisclaimer(opts.workspace)}\n${buildNarrationCta(opts.workspace, opts.hookLabel)}`
      : buildNarrationCta(opts.workspace, opts.hookLabel);
  }

  const last = trimmed.at(-1);
  const needsPeriod = last && !'".!?」』'.includes(last);
  let next = `${trimmed}${needsPeriod ? '.' : ''}`;

  if (opts.axisType === 'zodiac') {
    next = `${next}\n${buildNarrationZodiacDisclaimer(opts.workspace)}`;
  }

  const cta = buildNarrationCta(opts.workspace, opts.hookLabel);
  return `${next}\n${cta}`;
}

/** @deprecated appendNarrationScriptFooter 사용 */
export function appendNarrationCta(
  body: string,
  workspace: NarrationScriptWorkspace,
  hookLabel: string,
): string {
  return appendNarrationScriptFooter(body, {
    workspace,
    hookLabel,
    axisType: 'constellation',
  });
}
