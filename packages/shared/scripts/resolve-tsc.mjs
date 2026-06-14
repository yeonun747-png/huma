import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

/** monorepo root까지 올라가며 typescript/bin/tsc 탐색 (npx 대기·무출력 hang 방지) */
export function resolveTscBin(startDir) {
  let dir = startDir;
  for (let i = 0; i < 10; i += 1) {
    const bin = join(dir, 'node_modules', 'typescript', 'bin', 'tsc');
    if (existsSync(bin)) return bin;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function runTsc(cwd, label = 'tsc') {
  const tscBin = resolveTscBin(cwd);
  if (!tscBin) {
    console.error(
      `[${label}] ERROR: typescript not found. repo root에서 npm install 실행: cd ~/huma && npm install`,
    );
    process.exit(1);
  }
  return { tscBin, cwd };
}
