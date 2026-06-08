import { execFileSync } from 'child_process';
import { accessSync, constants } from 'fs';
import { readInterfaceIp } from './dongle-health.js';

function resolveIpBin(): string {
  for (const candidate of ['/usr/sbin/ip', '/sbin/ip']) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      /* next */
    }
  }
  return 'ip';
}

const IP_BIN = resolveIpBin();

function ipRead(args: string[]): string {
  return execFileSync(IP_BIN, args, { encoding: 'utf8', timeout: 10_000 });
}

/** sudoers: NOPASSWD /usr/sbin/ip — PM2 비대화형에서 policy routing 적용 */
function sudoIp(args: string[]): void {
  execFileSync('sudo', ['-n', IP_BIN, ...args], { stdio: 'pipe', timeout: 15_000 });
}

function sudoIpOptional(args: string[]): boolean {
  try {
    sudoIp(args);
    return true;
  } catch {
    return false;
  }
}

function guessGateway(iface: string, ipOnly: string): string {
  try {
    const out = ipRead(['route', 'show', 'dev', iface]);
    const match = out.match(/^default via (\S+)/m);
    if (match?.[1]) return match[1];
  } catch {
    /* RNDIS fallback */
  }
  const parts = ipOnly.split('.');
  return `${parts[0]}.${parts[1]}.${parts[2]}.1`;
}

function linkRoutePrefix(iface: string, ipOnly: string): string {
  try {
    const out = ipRead(['-4', 'route', 'show', 'dev', iface, 'scope', 'link']);
    const prefix = out.split('\n')[0]?.trim().split(/\s+/)[0];
    if (prefix && prefix !== 'default') return prefix;
  } catch {
    /* /24 fallback */
  }
  return `${ipOnly.split('.').slice(0, 3).join('.')}.0/24`;
}

function addDefaultRoute(iface: string, table: number, gw: string): void {
  const tableArg = String(table);
  if (
    sudoIpOptional([
      'route',
      'add',
      'default',
      'via',
      gw,
      'dev',
      iface,
      'table',
      tableArg,
    ])
  ) {
    return;
  }
  if (
    sudoIpOptional([
      'route',
      'add',
      'default',
      'via',
      gw,
      'dev',
      iface,
      'onlink',
      'table',
      tableArg,
    ])
  ) {
    return;
  }
  if (sudoIpOptional(['route', 'add', 'default', 'dev', iface, 'table', tableArg])) {
    return;
  }
  throw new Error(`table ${table} default route 실패`);
}

/**
 * huma-dongle-routes.sh 단일 슬롯과 동일 — `sudo ip`만 사용 (PM2 + NOPASSWD ip).
 * ip link down/up 직후 호출.
 */
export function applyDonglePolicyRoute(iface: string, proxyPort: number): void {
  if (process.platform === 'win32') return;

  const ipOnly = readInterfaceIp(iface);
  if (!ipOnly) {
    throw new Error(`${iface} IP 없음`);
  }

  const table = proxyPort;
  const gw = guessGateway(iface, ipOnly);

  while (sudoIpOptional(['rule', 'del', 'from', `${ipOnly}/32`, 'table', String(table)])) {
    /* remove stale rules */
  }

  sudoIp(['rule', 'add', 'from', `${ipOnly}/32`, 'table', String(table)]);
  sudoIpOptional(['route', 'flush', 'table', String(table)]);

  const linkRoute = linkRoutePrefix(iface, ipOnly);
  sudoIp(['route', 'add', linkRoute, 'dev', iface, 'scope', 'link', 'table', String(table)]);
  addDefaultRoute(iface, table, gw);
}
