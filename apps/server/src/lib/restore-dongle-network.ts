import { execSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const RESTORE_TIMEOUT_MS = 180_000;

/** i7 — DHCP + policy routing + 3proxy (restore-dongle-by-subnet.sh) */
export function runRestoreDongleNetwork(): { ok: boolean; output: string; error?: string } {
  if (process.platform === 'win32') {
    return { ok: false, output: '', error: '동글 네트워크 복구는 i7 Linux 서버에서만 실행됩니다.' };
  }

  const scriptPath = join(
    dirname(fileURLToPath(import.meta.url)),
    '../../scripts/restore-dongle-by-subnet.sh',
  );

  try {
    const output = execSync(`sudo bash "${scriptPath}"`, {
      encoding: 'utf8',
      timeout: RESTORE_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
    });
    const tail = output.length > 6000 ? output.slice(-6000) : output;
    return { ok: true, output: tail };
  } catch (err) {
    const e = err as { stdout?: string | Buffer; stderr?: string | Buffer; message?: string };
    const stdout = typeof e.stdout === 'string' ? e.stdout : e.stdout?.toString() ?? '';
    const stderr = typeof e.stderr === 'string' ? e.stderr : e.stderr?.toString() ?? '';
    const combined = `${stdout}\n${stderr}`.trim();
    const tail = combined.length > 6000 ? combined.slice(-6000) : combined;
    return {
      ok: false,
      output: tail,
      error: stderr.slice(-800) || e.message || 'restore-dongle-by-subnet.sh 실패',
    };
  }
}
