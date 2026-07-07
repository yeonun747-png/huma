import { config } from 'dotenv';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const serverRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
config({ path: join(serverRoot, '.env') });
const localEnv = join(serverRoot, '.env.local');
if (existsSync(localEnv)) {
  config({ path: localEnv, override: true });
}
