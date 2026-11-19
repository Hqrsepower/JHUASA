import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './server/entry.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const publicDir = join(root, 'public');

export function createApp({
  dbPath = join(root, 'data', 'game.sqlite'),
  adminPassword,
  presentationPassword,
  pinPepper = '',
  allowDemo = false,
} = {}) {
  if (dbPath !== ':memory:') mkdirSync(dirname(resolve(dbPath)), { recursive: true });
  const sqlite = new DatabaseSync(dbPath);
  sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 2500;');
  sqlite.exec(readFileSync(join(root, 'migrations', '0001_init.sql'), 'utf8'));

  const DB = {
    prepare(sql) {
      // The deployment uses D1. Keep its small prepared-statement interface in local tests.
      const statement = sqlite.prepare(sql);
      function bind(...params) {
        return {
          async first(column) {
            const row = statement.get(...params);
            return row ? (column == null ? row : row[column]) : null;
          },
          async run() {
            const { changes } = statement.run(...params);
            return { success: true, meta: { changes: Number(changes) } };
          },
          async all() {
            return { success: true, results: statement.all(...params) };
          },
          bind,
        };
      }
      return bind();
    },
  };
  const env = {
    DB,
    ADMIN_PASSWORD: adminPassword,
    PRESENTATION_PASSWORD: presentationPassword,
    PIN_PEPPER: pinPepper,
    ALLOW_DEMO: allowDemo ? 'true' : 'false',
  };

  function asset(path) {
    const filename = join(publicDir, path);
    try {
      const stat = statSync(filename);
      if (stat.isFile()) return { bytes: readFileSync(filename), tag: `"${stat.size}-${stat.mtimeMs}"` };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    return null;
  }

  return {
    fetch: (request) => serve(request, env, asset),
    close: () => sqlite.close(),
  };
}

export async function startServer({
  host = '127.0.0.1',
  port = 3000,
  trustProxy = false,
  ...options
} = {}) {
  const app = createApp(options);
  const server = createServer(async (incoming, outgoing) => {
    try {
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (value != null) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
      }
      const proxyScheme = headers.get('x-forwarded-proto')?.split(',')[0].trim();
      const scheme = trustProxy && proxyScheme === 'https' ? 'https' : 'http';
      const address = headers.get('host') ?? `${host}:${port}`;
      const url = new URL(String(incoming.url ?? '/'), `${scheme}://${address}`);
      // Behind one trusted proxy, its appended peer address is the last hop.
      const forwarded = trustProxy && headers.get('x-forwarded-for')?.split(',').at(-1)?.trim();
      headers.set('cf-connecting-ip', forwarded || incoming.socket.remoteAddress || 'local');

      const method = incoming.method ?? 'GET';
      const chunks = [];
      if (method !== 'GET' && method !== 'HEAD') {
        let length = 0;
        for await (const chunk of incoming) {
          length += chunk.length;
          if (length > 16_384) {
            outgoing.writeHead(413, { 'Content-Type': 'application/json' });
            outgoing.end(JSON.stringify({ error: 'That request was too large.' }));
            return;
          }
          chunks.push(chunk);
        }
      }
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const response = await app.fetch(new Request(url, { method, headers, body }));
      const responseHeaders = Object.fromEntries(response.headers);
      const cookies = response.headers.getSetCookie();
      if (cookies.length) responseHeaders['set-cookie'] = cookies;
      outgoing.writeHead(response.status, responseHeaders);
      outgoing.end(method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
    } catch {
      if (!outgoing.headersSent) outgoing.writeHead(500, { 'Content-Type': 'application/json' });
      outgoing.end(JSON.stringify({ error: 'Mission control hit a problem. Please try again.' }));
    }
  });

  try {
    await new Promise((ready, failed) => {
      server.once('error', failed);
      server.listen(port, host, ready);
    });
  } catch (error) {
    app.close();
    throw error;
  }
  const portNumber = server.address().port;
  return {
    origin: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${portNumber}`,
    close: () => new Promise((done, failed) => {
      server.close((error) => {
        if (error) return failed(error);
        app.close();
        done();
      });
      server.closeIdleConnections();
    }),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const demo = process.argv.includes('--demo');
  const host = process.env.HOST ?? '127.0.0.1';
  if (demo && host !== '127.0.0.1') throw new Error('Demo runs on localhost only.');

  const adminPassword = demo ? 'local-demo-staff-2026' : process.env.ADMIN_PASSWORD;
  const presentationPassword = demo ? 'local-demo-screen-2026' : process.env.PRESENTATION_PASSWORD;
  const pinPepper = demo ? 'local-demo-only-pepper-2026' : process.env.PIN_PEPPER;

  if (!demo && (
    (adminPassword?.length ?? 0) < 16 ||
    (presentationPassword?.length ?? 0) < 16 ||
    adminPassword === presentationPassword ||
    (pinPepper?.length ?? 0) < 24
  )) {
    throw new Error('Set separate staff and projector passwords (16+ characters) and PIN_PEPPER (24+). Run npm run setup to generate them.');
  }

  const local = await startServer({
    host,
    port: Number(process.env.PORT ?? (demo ? 3001 : 3000)),
    dbPath: demo ? join(root, 'data', 'demo.sqlite') : process.env.DB_PATH,
    adminPassword,
    presentationPassword,
    pinPepper,
    allowDemo: demo,
    trustProxy: process.env.TRUST_PROXY === 'true',
  });
  console.log(`Santa's Secret Mission is running at ${local.origin}`);
  if (demo) {
    console.log(`Staff  ${local.origin}/staff   Password  ${adminPassword}`);
    console.log(`Screen ${local.origin}/screen  Password  ${presentationPassword}`);
    console.log('Open Settings in Mission Control to load sample players and missions. Sample player PIN: 2468.');
  }
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => local.close().catch(console.error));
  }
}
