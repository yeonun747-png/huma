import { config } from 'dotenv';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const serverRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
config({ path: join(serverRoot, '.env'), override: true });

const clientPath = join(serverRoot, 'dist/modules/adsense/client.js');
if (!existsSync(clientPath)) {
  console.log('⚠ dist 없음 — npm run build --workspace=@huma/server 먼저 실행');
  process.exit(1);
}

const { getMissingAdSenseEnvKeys, isAdSenseConfigured } = await import(clientPath);
const missing = getMissingAdSenseEnvKeys('quizoasis');
const configured = isAdSenseConfigured('quizoasis');

console.log(`configured: ${configured}`);
if (missing.length) {
  console.log('missing:');
  for (const key of missing) console.log(`  - ${key}`);
  process.exit(1);
}
console.log('✓ 런타임 process.env OK');
