import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const serverRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
config({ path: join(serverRoot, '.env') });
