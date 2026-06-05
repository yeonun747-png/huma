import { spawnSync } from 'child_process';
import { readdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const distDir = join(root, 'dist');

async function patchDistImports() {
  for (const file of await readdir(distDir)) {
    if (!file.endsWith('.js')) continue;
    const path = join(distDir, file);
    let content = await readFile(path, 'utf8');
    content = content.replace(/from '\.\/([^']+)';/g, (_match, spec) =>
      spec.endsWith('.js') ? `from './${spec}';` : `from './${spec}.js';`,
    );
    content = content.replace(/export \* from '\.\/([^']+)';/g, (_match, spec) =>
      spec.endsWith('.js') ? `export * from './${spec}';` : `export * from './${spec}.js';`,
    );
    await writeFile(path, content);
  }
}

const tsc = spawnSync('npx', ['tsc'], { cwd: root, stdio: 'inherit', shell: true });
if (tsc.status !== 0) process.exit(tsc.status ?? 1);

await patchDistImports();
