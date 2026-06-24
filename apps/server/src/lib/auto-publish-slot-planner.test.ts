import { describe, expect, it } from 'vitest';
import { avoidCrossPostingCollision, CROSS_POSTING_STAGGER_MS } from './posting-cross-stagger.js';
import { AUTO_PUBLISH_PEER_STAGGER_MS } from './auto-publish-slot-planner.js';

describe('auto-publish slot vs post_blog CAPTCHA stagger', () => {
  const candidate = new Date('2026-06-25T08:01:00+09:00');
  const peerPostBlogAt = new Date('2026-06-25T08:08:00+09:00');

  it('post_blog 10min stagger pushes 8:01 to ~8:18 when peer post is 8:08', () => {
    const result = avoidCrossPostingCollision(candidate, [peerPostBlogAt], CROSS_POSTING_STAGGER_MS);
    expect(result.getTime()).toBeGreaterThanOrEqual(
      new Date('2026-06-25T08:18:00+09:00').getTime() - 2_000,
    );
  });

  it('auto-publish peer 2min stagger does not push 8:01 away from peer post at 8:08', () => {
    const result = avoidCrossPostingCollision(candidate, [peerPostBlogAt], AUTO_PUBLISH_PEER_STAGGER_MS);
    expect(result.getTime()).toBe(candidate.getTime());
  });
});
