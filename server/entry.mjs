import { handleApi } from './game.mjs';

const pages = new Map([
  ['/', { view: 'player', title: 'Santa’s Secret Mission', color: '#fff7ec' }],
  ['/staff', { view: 'staff', title: 'Mission Control · Santa’s Secret Mission', color: '#102d24' }],
  ['/screen', { view: 'screen', title: 'Projector · Santa’s Secret Mission', color: '#102d24' }],
]);

const contentTypes = {
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  svg: 'image/svg+xml; charset=utf-8',
  png: 'image/png',
  webp: 'image/webp',
  woff2: 'font/woff2',
};

const pageHeaders = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-cache',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'; upgrade-insecure-requests",
  'Referrer-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
};

function shell({ view, title, color }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="description" content="JHU ASA presents Santa’s Secret Mission, a Christmas party game.">
  <meta name="theme-color" content="${color}">
  <title>${title}</title>
  <link rel="icon" type="image/svg+xml" href="/art/emblem.svg">
  <link rel="stylesheet" href="/theme.css">
  <link rel="stylesheet" href="/common.css">

  <link rel="stylesheet" href="/${view}.css">
  <script type="module" src="/${view}.js"></script>
</head>
<body>
  <div id="app" tabindex="-1">
    <div class="app-boot" role="status">
      <img src="/art/emblem.svg" width="64" height="64" alt="">
      <p>Connecting to the workshop…</p>
    </div>
  </div>
  <noscript>Enable JavaScript to join Santa’s Secret Mission.</noscript>
</body>
</html>`;
}

export async function serve(request, env, loadAsset) {
  const url = new URL(request.url);
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(request, env);
    const head = request.method === 'HEAD';
    if (request.method !== 'GET' && !head) {
      return new Response('Method unavailable', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }

    const pathname = url.pathname === '/' ? '/' : url.pathname.replace(/\/$/, '');
    const page = pages.get(pathname);
    if (page) {
      const headers = { ...pageHeaders };
      if (url.protocol === 'http:') {
        headers['Content-Security-Policy'] = headers['Content-Security-Policy'].replace('; upgrade-insecure-requests', '');
      }
      return new Response(head ? null : shell(page), { headers });
    }

    const file = pathname.match(/^\/((?:(?:art|fonts)\/)?[a-zA-Z0-9_.-]+)\.(css|js|svg|png|webp|woff2)$/);
    if (file) {
      const asset = await loadAsset(`${file[1]}.${file[2]}`);
      if (asset) {
        const headers = {
          'Content-Type': contentTypes[file[2]],
          'Cache-Control': 'public, max-age=0, must-revalidate',
          'X-Content-Type-Options': 'nosniff',
          ETag: asset.tag,
        };
        const cached = request.headers.get('If-None-Match') === asset.tag;
        return new Response(head || cached ? null : asset.bytes, { headers, status: cached ? 304 : 200 });
      }
    }

    return new Response('Mission file unavailable.', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' },
    });
  } catch (error) {
    console.error('Mission request failed', error.name, error.message);
    return Response.json({ error: 'Mission control hit a problem. Please try again.' }, {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
