import type { ContentType, Workspace } from '@huma/shared';
import { formatKstDateTime } from '@/lib/format-kst';
import { formatBlogLinkLabel, normalizeBlogLink, sanitizeBlogPostForNaver } from '@/lib/naver-post-sanitize';

export type PostViewerTemplate = {
  accent: string;
  gradient: string;
  lead: string;
  body: string;
  hashtags: string;
  imageLabel: string;
  videoLabel: string;
};

export type PostViewerOverrides = {
  title: string;
  workspace: string;
  content?: string | null;
  contentType?: ContentType;
  resultUrl?: string | null;
  completedAt?: string | null;
  imageUrl?: string | null;
  videoUrl?: string | null;
  hashtags?: string[] | null;
  linkUrl?: string | null;
};

const TEMPLATES: Record<Workspace, Omit<PostViewerTemplate, 'lead'>> = {
  yeonun: {
    accent: '#c0506e',
    gradient: 'linear-gradient(135deg, #c0506e22, #c0506e44)',
    body:
      '올해의 운세 흐름과 실천 포인트를 정리했습니다. 사주명리 관점에서 월별 기운 변화와 주의할 시기를 안내합니다.',
    hashtags: '#사주 #신년운세 #꿈해몽 #연운',
    imageLabel: 'Imagen 4 · 9:16 포스팅 이미지',
    videoLabel: 'Kling 3.0 · 15초 Shorts 미리보기',
  },
  quizoasis: {
    accent: '#5b7fff',
    gradient: 'linear-gradient(135deg, #5b7fff22, #5b7fff44)',
    body:
      'MBTI·연애·직업 적성 등 심리 테스트 결과 페이지입니다. 7개 언어 버전과 SNS 공유 카드가 함께 발행됩니다.',
    hashtags: '#MBTI #심리테스트 #퀴즈오아시스 #personality',
    imageLabel: 'Imagen 4 · 테스트 결과 카드',
    videoLabel: 'Seedance 2.0 · 릴스 미리보기',
  },
  panana: {
    accent: '#00d4ff',
    gradient: 'linear-gradient(135deg, #00d4ff22, #00d4ff44)',
    body:
      'AI 캐릭터와의 감성 대화·쇼츠 콘텐츠입니다. TikTok·Instagram·Threads 동시 발행 포맷으로 구성됩니다.',
    hashtags: '#AI캐릭터 #파나나 #감성AI #panana',
    imageLabel: 'Imagen 4 · 캐릭터 비주얼',
    videoLabel: 'Kling 3.0 · 쇼츠 미리보기',
  },
};

export function getPostViewerTemplate(workspace: string, title: string): PostViewerTemplate {
  const ws = (workspace in TEMPLATES ? workspace : 'yeonun') as Workspace;
  const base = TEMPLATES[ws];
  return { ...base, lead: title };
}

export function mergePostViewerTemplate(overrides: PostViewerOverrides): PostViewerTemplate {
  const base = getPostViewerTemplate(overrides.workspace, overrides.title);
  const tagStr =
    overrides.hashtags?.length
      ? overrides.hashtags.map((t) => (t.startsWith('#') ? t : `#${t}`)).join(' ')
      : base.hashtags;
  const blogLink = normalizeBlogLink(overrides.linkUrl, overrides.workspace);
  const rawBody = overrides.content?.trim();
  const displayBody = rawBody
    ? sanitizeBlogPostForNaver(rawBody, { contentType: overrides.contentType ?? 'A', linkUrl: blogLink })
    : base.body;
  return {
    ...base,
    lead: overrides.title,
    body: displayBody,
    hashtags: tagStr,
    imageLabel: overrides.imageUrl ? '생성 이미지' : base.imageLabel,
    videoLabel: overrides.videoUrl ? '생성 영상' : base.videoLabel,
  };
}

function PostViewerBlogLink({ label, workspace }: { label: string; workspace?: string | null }) {
  const text = formatBlogLinkLabel(label, workspace);
  const href = text === 'yeonun.com' ? 'https://yeonun.com' : label.startsWith('http') ? label : `https://${text}`;
  return (
    <p className="mb-3 text-[13px] leading-relaxed">
      <a href={href} target="_blank" rel="noreferrer" className="text-[#5b7fff] underline">
        {text}
      </a>
    </p>
  );
}

export function PostViewerArticle({
  template,
  isLive,
  overrides,
}: {
  template: PostViewerTemplate;
  isLive: boolean;
  overrides?: PostViewerOverrides;
}) {
  const imageUrl = overrides?.imageUrl ?? null;
  const videoUrl = overrides?.videoUrl ?? null;
  const resultUrl = overrides?.resultUrl ?? null;
  const published = overrides?.completedAt ? formatKstDateTime(overrides.completedAt) : null;
  const showVideo = overrides?.contentType === 'B' || Boolean(videoUrl);
  const blogLink = normalizeBlogLink(overrides?.linkUrl, overrides?.workspace);
  const liveBody = overrides?.content
    ? sanitizeBlogPostForNaver(overrides.content, {
        contentType: overrides.contentType ?? 'A',
        linkUrl: blogLink,
      })
    : null;

  return (
    <article className="leading-relaxed">
      <h3 className="mb-2 text-[15px] font-bold text-[#111]">{template.lead}</h3>
      {published && (
        <p className="mb-2 font-mono text-[10.5px] text-[#888]">발행 {published}</p>
      )}
      {resultUrl && (
        <p className="mb-2 break-all font-mono text-[10.5px] text-[#5b7fff]">
          <a href={resultUrl} target="_blank" rel="noreferrer" className="underline">
            {resultUrl.replace(/^https?:\/\//, '').slice(0, 64)} ↗
          </a>
        </p>
      )}
      <p className="mb-3 whitespace-pre-wrap text-[13px] text-[#333]">
        {isLive
          ? (liveBody?.slice(0, 400) ||
              '콘텐츠 생성이 진행 중입니다. 완료 후 실제 HTML이 이 영역에 채워집니다.')
          : template.body}
        {isLive && liveBody ? <span className="m-cursor-blink inline-block" /> : null}
      </p>
      {blogLink ? <PostViewerBlogLink label={blogLink} workspace={overrides?.workspace} /> : null}
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          className="mb-3 max-h-[180px] w-full rounded-md object-cover"
        />
      ) : (
        <div
          className="mb-3 flex h-[100px] items-center justify-center rounded-md text-[11px]"
          style={{ background: template.gradient, color: template.accent }}
        >
          {template.imageLabel}
        </div>
      )}
      {showVideo ? (
        videoUrl ? (
          <video
            src={videoUrl}
            controls
            className="mb-3 max-h-[200px] w-full rounded-md bg-black"
          />
        ) : (
          <div className="mb-3 flex h-20 items-center justify-center rounded-md bg-black text-[22px] text-white">
            ▶ {template.videoLabel}
          </div>
        )
      ) : null}
      <p className="text-[11.5px] text-[#888]">{template.hashtags}</p>
    </article>
  );
}
