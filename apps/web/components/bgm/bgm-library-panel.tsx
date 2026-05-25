'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BgmPixabayItem } from '@huma/shared';
import { api } from '@/lib/api';
import { BGM_MOOD_CATEGORIES } from '@/lib/bgm-moods';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function BgmLibraryPanel() {
  const [category, setCategory] = useState('upbeat');
  const [items, setItems] = useState<BgmPixabayItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [nowPlaying, setNowPlaying] = useState<BgmPixabayItem | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api.bgmList(category)
      .then((res) => setItems(res.items))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [category]);

  useEffect(() => { load(); }, [load]);

  const stopAudio = useCallback(() => {
    audioRef.current?.pause();
    if (audioRef.current) audioRef.current.currentTime = 0;
  }, []);

  const handlePlay = (track: BgmPixabayItem) => {
    if (nowPlaying?.id === track.id) {
      stopAudio();
      setNowPlaying(null);
      return;
    }
    stopAudio();
    setNowPlaying(track);
    const audio = new Audio(track.previewUrl);
    audioRef.current = audio;
    audio.play().catch(() => {});
  };

  useEffect(() => () => stopAudio(), [stopAudio]);

  return (
    <div className="animate-fadeIn space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>BGM 라이브러리 · Pixabay</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-1">
          {BGM_MOOD_CATEGORIES.map((cat) => (
            <Button
              key={cat.id}
              size="sm"
              variant={category === cat.id ? 'default' : 'outline'}
              onClick={() => setCategory(cat.id)}
            >
              {cat.label} · {cat.titleKo}
            </Button>
          ))}
        </CardContent>
      </Card>

      <div className="panel">
        <div className="panel-title">인기순 20곡 · {category}</div>
        {loading ? (
          <div className="py-8 text-center text-huma-t3">불러오는 중…</div>
        ) : items.length === 0 ? (
          <div className="py-8 text-center text-huma-t3">검색 결과 없음</div>
        ) : (
          <div className="space-y-2">
            {items.map((track) => (
              <div key={track.id} className="flex items-center gap-2 rounded border border-huma-bdr2 px-3 py-2">
                <button type="button" className="text-sm" onClick={() => handlePlay(track)} aria-label="미리듣기">
                  {nowPlaying?.id === track.id ? '⏸' : '▶'}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-huma-t">{track.title}</div>
                  <div className="text-[10px] text-huma-t3">
                    {formatDuration(track.duration)} · ♥ {track.likes} · {track.tags.slice(0, 3).join(', ')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
