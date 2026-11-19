import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'public');
const destination = join(root, 'dist');
const required = ['common.css', 'common.js', 'theme.css', 'player.js', 'player.css', 'staff.js', 'staff.css', 'screen.js', 'screen.css', 'art/emblem.svg'];
for (const name of required) {
  if (!existsSync(join(source, name))) throw new Error(`Required browser asset is missing: ${name}`);
}
const assets = {};
for (const name of readdirSync(source, { recursive: true }).sort()) {
  if (!/\.(?:css|js|svg|png|webp|woff2)$/.test(name)) continue;
  const bytes = readFileSync(join(source, name));
  assets[name.replaceAll('\\', '/')] = {
    data: bytes.toString('base64'),
    tag: `"${createHash('sha256').update(bytes).digest('hex').slice(0, 24)}"`,
  };
}
const api = readFileSync(join(root, 'server', 'game.mjs'), 'utf8');
const worker = readFileSync(join(root, 'server', 'entry.mjs'), 'utf8')
  .replace("import { handleApi } from './game.mjs';", '');
const bundle = `${api}\n${worker}\n
const bundledAssets = ${JSON.stringify(assets)};
export default {
  fetch(request, env) {
    return serve(request, env, (name) => {
      const file = bundledAssets[name];
      return file && { tag: file.tag, bytes: Uint8Array.from(atob(file.data), (unit) => unit.charCodeAt(0)) };
    });
  }
};
`;
mkdirSync(join(destination, 'server'), { recursive: true });
mkdirSync(join(destination, '.openai'), { recursive: true });
writeFileSync(join(destination, 'server', 'index.js'), bundle);
cpSync(join(root, '.openai', 'hosting.json'), join(destination, '.openai', 'hosting.json'));

const hostedMigrations = join(destination, '.openai', 'drizzle');
mkdirSync(join(hostedMigrations, 'meta'), { recursive: true });
const schema = readFileSync(join(root, 'migrations', '0001_init.sql'), 'utf8');
writeFileSync(join(hostedMigrations, '0001_init.sql'), schema.trim().split(/;\s*\n+/).join(';\n--> statement-breakpoint\n') + '\n');
const journal = {
  version: '7',
  dialect: 'sqlite',
  entries: [{ idx: 0, version: '6', when: 1795055400000, tag: '0001_init', breakpoints: true }],
};
writeFileSync(join(hostedMigrations, 'meta', '_journal.json'), JSON.stringify(journal, null, 2) + '\n');
console.log(`Built Worker with ${Object.keys(assets).length} bundled browser assets.`);
