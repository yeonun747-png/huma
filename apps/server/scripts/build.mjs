import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

if (process.env.VERCEL) {
  console.log('Skipping @huma/server build on Vercel');
  process.exit(0);
}

const sharedRoot = join(__dirname, '../../../packages/shared');
const sharedBuild = spawnSync('npm', ['run', 'build'], { stdio: 'inherit', shell: true, cwd: sharedRoot });
if (sharedBuild.status !== 0) process.exit(sharedBuild.status ?? 1);

const result = spawnSync('npx', ['tsc'], { stdio: 'inherit', shell: true, cwd: join(__dirname, '..') });
process.exit(result.status ?? 1);
