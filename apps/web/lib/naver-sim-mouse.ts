import { randomBetween } from '@/lib/human-typing-sim';

function bezierPoint(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

async function sleepMs(ms: number, cancelled: () => boolean): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve) => {
    const id = window.setTimeout(() => resolve(), ms);
    const check = window.setInterval(() => {
      if (cancelled()) {
        window.clearTimeout(id);
        window.clearInterval(check);
        resolve();
      }
    }, 40);
    window.setTimeout(() => window.clearInterval(check), ms + 20);
  });
}

/** server humanMouseMove + humanClickLocator 와 동일 개념 — DOM bbox 중심 + 지터 */
export async function simHumanClickTarget(
  target: HTMLElement,
  mouse: { x: number; y: number },
  options: {
    onMouseMove: (x: number, y: number) => void;
    onMouseClick?: () => void;
    cancelled?: () => boolean;
    jitterPx?: number;
    preClickDelayMs?: [number, number];
  },
): Promise<{ x: number; y: number }> {
  const cancelled = options.cancelled ?? (() => false);
  target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' as ScrollBehavior });
  await sleepMs(80, cancelled);

  const rect = target.getBoundingClientRect();
  const jitter = options.jitterPx ?? 3;
  const cx = rect.left + rect.width / 2 + randomBetween(-jitter, jitter);
  const cy = rect.top + rect.height / 2 + randomBetween(-jitter, jitter);

  const steps = randomBetween(15, 28);
  const cp1 = {
    x: mouse.x + (cx - mouse.x) * 0.25 + randomBetween(-40, 40),
    y: mouse.y + (cy - mouse.y) * 0.15 + randomBetween(-30, 30),
  };
  const cp2 = {
    x: mouse.x + (cx - mouse.x) * 0.75 + randomBetween(-40, 40),
    y: mouse.y + (cy - mouse.y) * 0.85 + randomBetween(-30, 30),
  };

  for (let i = 1; i <= steps; i++) {
    if (cancelled()) return mouse;
    const t = easeInOut(i / steps);
    options.onMouseMove(
      bezierPoint(t, mouse.x, cp1.x, cp2.x, cx),
      bezierPoint(t, mouse.y, cp1.y, cp2.y, cy),
    );
    await sleepMs(randomBetween(8, 22), cancelled);
  }

  if (Math.random() < 0.12) {
    const ox = cx + randomBetween(-10, 10);
    const oy = cy + randomBetween(-8, 8);
    options.onMouseMove(ox, oy);
    await sleepMs(randomBetween(18, 48), cancelled);
    options.onMouseMove(cx, cy);
    await sleepMs(randomBetween(10, 24), cancelled);
  }

  const delay = options.preClickDelayMs ?? [100, 400];
  await sleepMs(randomBetween(delay[0], delay[1]), cancelled);
  options.onMouseClick?.();
  return { x: cx, y: cy };
}
