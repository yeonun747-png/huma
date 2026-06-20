import { describe, expect, it, vi } from 'vitest';
import {
  normalizePananaApiResponse,
  pickWeightedByCounts,
} from './panana-characters.js';

describe('normalizePananaApiResponse', () => {
  it('parses flat array (HUMA contract)', () => {
    const out = normalizePananaApiResponse([
      { id: 'a1', name: '민지', description: '밝은 성격', status: 'active' },
      { id: 'a2', name: '서준', status: 'inactive' },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: 'a1', name: '민지', status: 'active' });
    expect(out[1]?.status).toBe('inactive');
  });

  it('parses { characters: [...] } wrapper', () => {
    const out = normalizePananaApiResponse({
      characters: [{ id: 'x', name: '캐릭터', tagline: '한줄소개' }],
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.description).toBe('한줄소개');
  });

  it('maps field aliases (slug, active boolean)', () => {
    const out = normalizePananaApiResponse([
      { slug: 'hero-1', title: '히어로', active: true },
      { character_id: 'c2', character_name: '빌런', active: false },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: 'hero-1', name: '히어로', status: 'active' });
    expect(out[1]).toMatchObject({ id: 'c2', name: '빌런', status: 'inactive' });
  });

  it('returns empty for null or unparseable', () => {
    expect(normalizePananaApiResponse(null)).toEqual([]);
    expect(normalizePananaApiResponse({ foo: 'bar' })).toEqual([]);
  });
});

describe('pickWeightedByCounts', () => {
  it('returns null for empty list', () => {
    expect(pickWeightedByCounts([], new Map())).toBeNull();
  });

  it('favors less-used characters', () => {
    const items = [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ];
    const counts = new Map([
      ['a', 5],
      ['b', 0],
    ]);
    vi.spyOn(Math, 'random').mockReturnValue(0.2);
    expect(pickWeightedByCounts(items, counts)?.id).toBe('b');
    vi.restoreAllMocks();
  });

  it('uniform when all counts equal', () => {
    const items = [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ];
    const counts = new Map([
      ['a', 2],
      ['b', 2],
    ]);
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    expect(pickWeightedByCounts(items, counts)?.id).toBe('b');
    vi.restoreAllMocks();
  });
});
