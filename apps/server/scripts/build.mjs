import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { resolveTscBin } from '../../../packages/shared/scripts/resolve-tsc.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverRoot = join(__dirname, '..');

if (process.env.VERCEL) {
  console.log('Skipping @huma/server build on Vercel');
  process.exit(0);
}

const sharedRoot = join(__dirname, '../../../packages/shared');
console.log('[@huma/server] building @huma/shared...');
const sharedBuild = spawnSync('npm', ['run', 'build'], { stdio: 'inherit', shell: true, cwd: sharedRoot });
if (sharedBuild.status !== 0) process.exit(sharedBuild.status ?? 1);

const tscBin = resolveTscBin(serverRoot);
if (!tscBin) {
  console.error('[@huma/server] ERROR: typescript not found — cd ~/huma && npm install');
  process.exit(1);
}

console.log('[@huma/server] TypeScript compile...');
const result = spawnSync(process.execPath, [tscBin], { stdio: 'inherit', cwd: serverRoot });
if (result.status !== 0) process.exit(result.status ?? 1);

console.log('[@huma/server] build OK');
