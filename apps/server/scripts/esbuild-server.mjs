import { build } from 'esbuild';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';

/** src 아래 .ts 파일을 dist로 transpile (test 제외). tsc 대비 RAM·시간 절약 */
export async function esbuildServerSrc({ serverRoot, label = '@huma/server' }) {
  const srcRoot = join(serverRoot, 'src');
  const distRoot = join(serverRoot, 'dist');

  function collectTsFiles(dir) {
    const out = [];
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        out.push(...collectTsFiles(full));
        continue;
      }
      if (!name.endsWith('.ts')) continue;
      if (name.endsWith('.test.ts') || name.endsWith('.spec.ts')) continue;
      out.push(full);
    }
    return out;
  }

  const entryPoints = collectTsFiles(srcRoot);
  console.log(`[${label}] esbuild transpile (${entryPoints.length} files)...`);

  await build({
    entryPoints,
    outdir: distRoot,
    outbase: srcRoot,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    packages: 'external',
    logLevel: 'info',
    sourcemap: false,
  });
}
