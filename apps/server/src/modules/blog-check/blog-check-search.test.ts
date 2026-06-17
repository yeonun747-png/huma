import { describe, expect, it } from 'vitest';
import { parseBlogCheckSearchQuery } from '@huma/shared';

describe('parseBlogCheckSearchQuery', () => {
  it('accepts bare blogId only', () => {
    expect(parseBlogCheckSearchQuery('goricc')).toBe('goricc');
    expect(parseBlogCheckSearchQuery('  goricc  ')).toBe('goricc');
    expect(parseBlogCheckSearchQuery('@goricc')).toBe('goricc');
  });

  it('strips blog.naver.com prefix', () => {
    expect(parseBlogCheckSearchQuery('blog.naver.com/goricc')).toBe('goricc');
    expect(parseBlogCheckSearchQuery('https://blog.naver.com/goricc')).toBe('goricc');
    expect(parseBlogCheckSearchQuery('https://blog.naver.com/goricc/')).toBe('goricc');
  });

  it('extracts blogId from post URLs', () => {
    expect(parseBlogCheckSearchQuery('https://blog.naver.com/goricc/224212849946')).toBe('goricc');
  });

  it('rejects empty and reserved paths', () => {
    expect(parseBlogCheckSearchQuery('')).toBeNull();
    expect(parseBlogCheckSearchQuery('PostView')).toBeNull();
  });
});
