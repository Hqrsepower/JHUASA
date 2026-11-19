import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const roots = ['server', 'scripts', 'public', 'test'];
const files = roots.flatMap((dir) => readdirSync(dir, { recursive: true }).map((file) => resolve(dir, file)));
for (const file of [...files, 'dev.mjs'].filter((file) => /\.m?js$/.test(file))) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
}
