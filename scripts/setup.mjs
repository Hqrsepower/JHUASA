import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const local = fileURLToPath(new URL('../.env', import.meta.url));
const secret = () => randomBytes(24).toString('base64url');
const values = {
  ADMIN_PASSWORD: secret(),
  PRESENTATION_PASSWORD: secret(),
  PIN_PEPPER: secret(),
  HOST: '127.0.0.1',
  PORT: 3000,
};
try {
  const configuration = Object.entries(values).map(([name, value]) => `${name}=${value}`).join('\n');
  writeFileSync(local, `${configuration}\n`, { flag: 'wx', mode: 0o600 });
  console.log('Created .env with separate credentials. Open it locally to copy the staff and projector passwords.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('An .env file already exists. Your existing credentials were preserved.');
}
