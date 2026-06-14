import { spawnSync } from 'child_process';
import { readdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { resolveTscBin } from './resolve-tsc.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const distDir = join(root, 'dist');

function patchRelativeSpecifiers(content) {
  content = content.replace(/from '\.\/([^']+)';/g, (_match, spec) =>
    spec.endsWith('.js') ? `from './${spec}';` : `from './${spec}.js';`,
  );
  content = content.replace(/export \* from '\.\/([^']+)';/g, (_match, spec) =>
    spec.endsWith('.js') ? `export * from './${spec}';` : `export * from './${spec}.js';`,
  );
  content = content.replace(/import\('\.\/([^']+)'\)/g, (_match, spec) =>
    spec.endsWith('.js') ? `import('./${spec}')` : `import('./${spec}.js')`,
  );
  return content;
}

async function patchDistImports() {
  for (const file of await readdir(distDir)) {
    if (!file.endsWith('.js') && !file.endsWith('.d.ts')) continue;
    const path = join(distDir, file);
    const content = patchRelativeSpecifiers(await readFile(path, 'utf8'));
    await writeFile(path, content);
  }
}

const tscBin = resolveTscBin(root);
if (!tscBin) {
  console.error('[@huma/shared] ERROR: typescript not found — cd ~/huma && npm install');
  process.exit(1);
}

console.log('[@huma/shared] TypeScript compile...');
const tsc = spawnSync(process.execPath, [tscBin], { cwd: root, stdio: 'inherit' });
if (tsc.status !== 0) process.exit(tsc.status ?? 1);

console.log('[@huma/shared] patch dist imports...');
await patchDistImports();
console.log('[@huma/shared] build OK');
