export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function gaussianRandom(mean: number, sigma: number): number {
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.max(20, mean + sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2));
}

export function wpmToDelay(wpm: number): number {
  return Math.round(60000 / (wpm * 5));
}

export function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export async function downloadBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`다운로드 실패: ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function downloadFile(url: string, destPath: string): Promise<string> {
  const fs = await import('fs/promises');
  const buf = await downloadBuffer(url);
  await fs.writeFile(destPath, buf);
  return destPath;
}
