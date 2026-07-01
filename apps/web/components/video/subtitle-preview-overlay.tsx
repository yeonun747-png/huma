'use client';

const SPEAKER_TEXT: Record<'A' | 'B' | 'default', string> = {
  A: 'text-white',
  B: 'text-yellow-300',
  default: 'text-white',
};

export type SubtitlePreviewEvent = {
  shotNumber: number;
  startSec: number;
  endSec: number;
  text: string;
  speakerStyle: 'A' | 'B' | 'default';
};

export function SubtitlePreviewOverlay({
  events,
  currentTimeSec,
  active,
}: {
  events: SubtitlePreviewEvent[];
  currentTimeSec: number;
  active: boolean;
}) {
  if (!active) return null;

  const visible = events.filter((e) => currentTimeSec >= e.startSec && currentTimeSec < e.endSec);
  if (!visible.length) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-8 z-10 flex flex-col items-center gap-1 px-3">
      {visible.map((event) => (
        <p
          key={`${event.shotNumber}-${event.startSec}`}
          className={`max-w-[92%] rounded px-2 py-1 text-center text-[13px] font-bold leading-snug drop-shadow-[0_1px_3px_rgba(0,0,0,0.95)] ${SPEAKER_TEXT[event.speakerStyle]}`}
          style={{ textShadow: '0 0 4px #000, 0 0 8px #000' }}
        >
          {event.text}
        </p>
      ))}
    </div>
  );
}
