import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { esbuildServerSrc } from './esbuild-server.mjs';

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

try {
  await esbuildServerSrc({ serverRoot });
  console.log('[@huma/server] build OK');
} catch (err) {
  console.error('[@huma/server] build FAILED:', err);
  process.exit(1);
}
