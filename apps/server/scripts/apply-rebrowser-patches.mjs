#!/usr/bin/env node
/** rebrowser-patches — Playwright CDP Runtime.enable 누수 완화 (E 옵션, i7 Linux postinstall) */
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const patcher = join(root, 'node_modules', 'rebrowser-patches', 'scripts', 'patcher.js');

if (!existsSync(patcher)) {
  console.log('[rebrowser] rebrowser-patches 없음 — 스킵');
  process.exit(0);
}

if (process.platform === 'win32') {
  const probe = spawnSync('patch', ['--version'], { stdio: 'ignore', shell: true });
  if (probe.error || probe.status !== 0) {
    console.log('[rebrowser] Windows — patch 명령 없음, i7 Linux postinstall에서 적용');
    process.exit(0);
  }
}

const r = spawnSync(
  process.execPath,
  [patcher, 'patch', '--packageName=playwright-core'],
  { stdio: 'inherit', cwd: root, env: process.env },
);

if (r.status !== 0) {
  console.warn('[rebrowser] patch 실패 — vanilla playwright 사용');
}
process.exit(0);
