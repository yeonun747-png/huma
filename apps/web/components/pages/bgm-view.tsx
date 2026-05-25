'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BgmPixabayItem } from '@huma/shared';
import { api } from '@/lib/api';
import { BGM_MOOD_CATEGORIES } from '@/lib/bgm-moods';
import { MGrid, MPanel } from '@/components/mockup/primitives';

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function WaveformBars({ active }: { active: boolean }) {
  const bars = [3, 5, 8, 4, 7, 5, 9, 4, 6, 3, 7, 5, 8, 4, 6];
  return (
    <div className="flex h-12 items-end justify-center gap-0.5">
      {bars.map((h, i) => (
        <div
          key={i}
          className={`w-1 rounded-sm bg-huma-acc transition-all ${active ? 'animate-pulse' : 'opacity-40'}`}
          style={{
            height: `${h * 4}px`,
            animationDelay: active ? `${i * 0.07}s` : undefined,
            animationDuration: active ? `${0.4 + (i % 3) * 0.15}s` : undefined,
          }}
        />
      ))}
    </div>
  );
}

function BgmTrackCard({
  track,
  playing,
  onPlay,
}: {
  track: BgmPixabayItem;
  playing: boolean;
  onPlay: (track: BgmPixabayItem) => void;
}) {
  return (
    <div className="mb-2 flex items-start gap-2 rounded-md border border-huma-bdr2 bg-huma-bg3 px-3 py-2">
      <button
        type="button"
        className={`mt-0.5 shrink-0 text-sm ${playing ? 'text-huma-acc' : 'text-huma-t2 hover:text-huma-acc'}`}
        aria-label={playing ? '재생 중' : '미리듣기'}
        onClick={() => onPlay(track)}
      >
        {playing ? '⏸' : '▶'}
      </button>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-huma-t">{track.title}</div>
        <div className="mt-0.5 text-[10.5px] text-huma-t3">
          {formatDuration(track.duration)} · ♥ {track.likes.toLocaleString()}
        </div>
        {track.tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {track.tags.slice(0, 5).map((tag) => (
              <span key={tag} className="rounded bg-huma-bg2 px-1.5 py-0.5 text-[9px] text-huma-t3">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CategorySection({
  categoryId,
  playingId,
  onPlay,
}: {
  categoryId: string;
  playingId: number | null;
  onPlay: (track: BgmPixabayItem) => void;
}) {
  const cat = BGM_MOOD_CATEGORIES.find((c) => c.id === categoryId);
  const [items, setItems] = useState<BgmPixabayItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api.bgmList(categoryId)
      .then((res) => {
        if (!cancelled) setItems(res.items);
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setItems([]);
          setError(err.message);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [categoryId]);

  if (!cat) return null;

  return (
    <div>
      <div className="mb-2 border-b border-huma-bdr pb-1">
        <div className="text-xs font-medium text-huma-t">
          <span className="font-mono text-huma-acc">{cat.label}</span>
          <span className="mx-1.5 text-huma-t3">·</span>
          <span>{cat.titleKo}</span>
        </div>
        <div className="mt-0.5 text-[10px] text-huma-t3">{cat.hint}</div>
      </div>
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-6 text-[10px] text-huma-t3">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border border-huma-acc border-t-transparent" />
          Pixabay에서 불러오는 중…
        </div>
      ) : error ? (
        <div className="py-3 text-center text-[10px] text-red-400">{error}</div>
      ) : items.length === 0 ? (
        <div className="py-3 text-center text-[10px] text-huma-t3">검색 결과 없음</div>
      ) : (
        items.map((track) => (
          <BgmTrackCard
            key={track.id}
            track={track}
            playing={playingId === track.id}
            onPlay={onPlay}
          />
        ))
      )}
    </div>
  );
}

export function BgmLibraryView() {
  const [filter, setFilter] = useState('all');
  const [nowPlaying, setNowPlaying] = useState<BgmPixabayItem | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stopAudio = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    setIsPlaying(false);
  }, []);

  const handlePlay = useCallback((track: BgmPixabayItem) => {
    if (nowPlaying?.id === track.id && isPlaying) {
      stopAudio();
      return;
    }

    stopAudio();
    setNowPlaying(track);

    const audio = new Audio(track.previewUrl);
    audioRef.current = audio;
    audio.onended = () => setIsPlaying(false);
    audio.onpause = () => setIsPlaying(false);
    audio.onplay = () => setIsPlaying(true);
    audio.play().catch(() => setIsPlaying(false));
  }, [nowPlaying?.id, isPlaying, stopAudio]);

  useEffect(() => () => stopAudio(), [stopAudio]);

  const visibleCategories = filter === 'all'
    ? BGM_MOOD_CATEGORIES
    : BGM_MOOD_CATEGORIES.filter((c) => c.id === filter);

  return (
    <div className="animate-fadeIn">
      <MGrid cols={2}>
        <MPanel title="BGM 라이브러리 · Pixabay">
          <div className="mb-4 flex flex-wrap gap-1">
            <button
              type="button"
              className={`rounded px-2 py-1 text-[10px] ${filter === 'all' ? 'bg-huma-acc text-white' : 'bg-huma-bg3 text-huma-t2'}`}
              onClick={() => setFilter('all')}
            >
              전체
            </button>
            {BGM_MOOD_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                className={`rounded px-2 py-1 text-left text-[10px] leading-tight ${filter === cat.id ? 'bg-huma-acc text-white' : 'bg-huma-bg3 text-huma-t2'}`}
                onClick={() => setFilter(cat.id)}
              >
                <span className="font-mono">{cat.label}</span>
                <span className="mx-1">·</span>
                <span>{cat.titleKo}</span>
              </button>
            ))}
          </div>

          <div className="space-y-4">
            {visibleCategories.map((cat) => (
              <CategorySection
                key={cat.id}
                categoryId={cat.id}
                playingId={nowPlaying?.id ?? null}
                onPlay={handlePlay}
              />
            ))}
          </div>
        </MPanel>

        <MPanel title="미리듣기">
          {nowPlaying ? (
            <div className="space-y-4">
              <div className="rounded-md border border-huma-bdr2 bg-huma-bg3 p-4">
                <div className="mb-1 text-[10px] uppercase tracking-wide text-huma-acc">
                  {isPlaying ? '재생 중' : '일시정지'}
                </div>
                <div className="text-sm font-medium text-huma-t">{nowPlaying.title}</div>
                <div className="mt-1 text-[10.5px] text-huma-t3">
                  {formatDuration(nowPlaying.duration)} · ♥ {nowPlaying.likes.toLocaleString()}
                </div>
                <div className="mt-4">
                  <WaveformBars active={isPlaying} />
                </div>
                {nowPlaying.tags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {nowPlaying.tags.map((tag) => (
                      <span key={tag} className="rounded bg-huma-bg2 px-1.5 py-0.5 text-[9px] text-huma-t3">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <button type="button" className="btn-ghost w-full text-xs" onClick={stopAudio}>
                정지
              </button>
              <p className="text-[10px] text-huma-t3">
                Pixabay 인기순 20곡 · 영상 생성 시 선택된 음원만 서버에 다운로드됩니다.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-md border border-dashed border-huma-bdr py-8 text-center text-sm text-huma-t3">
                ▶ 버튼을 눌러 음원을 미리듣기
              </div>
              <div className="space-y-1.5 text-[10px] text-huma-t3">
                {BGM_MOOD_CATEGORIES.map((cat, i) => (
                  <div key={cat.id}>
                    {i + 1}. <span className="font-mono text-huma-t2">{cat.label}</span>
                    {' '}{cat.titleKo} ({cat.hint})
                  </div>
                ))}
              </div>
            </div>
          )}
        </MPanel>
      </MGrid>
    </div>
  );
}
