import { rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const cacheDirs = [
  path.join(root, 'apps', 'web', '.next'),
  path.join(root, 'apps', 'web', 'node_modules', '.cache'),
  path.join(root, 'node_modules', '.cache'),
];

for (const dir of cacheDirs) {
  try {
    rmSync(dir, { recursive: true, force: true });
    console.log(`[dev:clean] removed ${path.relative(root, dir)}`);
  } catch (err) {
    console.warn(`[dev:clean] skip ${dir}:`, err.message);
  }
}

if (process.platform === 'win32') {
  try {
    execSync('taskkill /F /IM node.exe', { stdio: 'ignore' });
    console.log('[dev:clean] stopped node.exe processes');
  } catch {
    console.log('[dev:clean] no node.exe processes to stop');
  }
} else {
  try {
    execSync('pkill -f "next dev|tsx watch" || true', { stdio: 'ignore', shell: true });
    console.log('[dev:clean] stopped dev node processes');
  } catch {
    console.log('[dev:clean] no dev node processes to stop');
  }
}

console.log('[dev:clean] done — run: npm run dev:web');
process.exit(0);
