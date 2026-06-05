'use client';

import { useEffect, useState } from 'react';
import type { HumaVideoQueue } from '@huma/shared';
import {
  DEFAULT_VIDEO_MODEL,
  normalizeVideoModel,
} from '@/lib/higgsfield-models';
import { api } from '@/lib/api';
import { useWorkspace } from '@/components/dashboard/workspace-context';
import { cn } from '@/lib/constants';

const STEPS = ['pending', 'image_generating', 'video_generating', 'finalizing', 'uploading', 'done'];

export function VideoPipelineList() {
  const { workspace } = useWorkspace();
  const [items, setItems] = useState<HumaVideoQueue[]>([]);

  useEffect(() => {
    api.videoQueue().then((all) => setItems(all.filter((v) => v.workspace === workspace))).catch(() => setItems([]));
  }, [workspace]);

  return (
    <div className="animate-fadeIn space-y-3">
      <div className="flex justify-between">
        <div className="panel-title mb-0">영상 파이프라인</div>
        <button type="button" className="btn-primary" onClick={async () => {
          const hg = await api.getSetting('higgsfield').catch(() => ({})) as Record<string, unknown>;
          await api.createVideo({
            workspace,
            image_prompt: 'mystical fortune teller, cinematic',
            video_prompt: 'slow camera zoom, ethereal glow',
            video_model: normalizeVideoModel(String(hg.default_video_model ?? DEFAULT_VIDEO_MODEL)),
            duration_sec: Number(hg.video_duration_sec) > 0 ? Number(hg.video_duration_sec) : 15,
            upload_platforms: ['tiktok', 'instagram', 'youtube'],
          });
          api.videoQueue().then(setItems);
        }}>+ 파이프라인 시작</button>
      </div>
      {items.map((v) => (
        <div key={v.id} className="panel">
          <div className="mb-2 flex justify-between text-xs">
            <span className="font-medium text-huma-t">{v.image_prompt?.slice(0, 40) ?? v.id.slice(0, 8)}</span>
            <span className={cn(v.status === 'done' ? 'tag-ok' : v.status === 'failed' ? 'tag-err' : 'tag-warn')}>{v.status}</span>
          </div>
          <div className="flex gap-1">
            {STEPS.map((s) => (
              <div key={s} className={cn('h-1 flex-1 rounded-full', STEPS.indexOf(s) <= STEPS.indexOf(v.current_step ?? v.status) ? 'bg-huma-acc' : 'bg-huma-bg4')} title={s} />
            ))}
          </div>
          {v.error_message && <p className="mt-2 text-[10px] text-huma-err">{v.error_message}</p>}
        </div>
      ))}
    </div>
  );
}
