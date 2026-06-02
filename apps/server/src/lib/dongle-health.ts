import { execSync } from 'child_process';

export function readInterfaceIp(interfaceName: string): string | null {
  try {
    const out = execSync(`ip -4 addr show ${interfaceName}`, { encoding: 'utf8' });
    const match = out.match(/inet\s+(\d+\.\d+\.\d+\.\d+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}
