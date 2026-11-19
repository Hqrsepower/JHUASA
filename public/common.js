export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (letter) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[letter]);
}

export async function api(path, body, { signal } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    const unavailable = new Error('Connection lost. Reconnecting to the workshop…');
    unavailable.cause = error;
    unavailable.status = 0;
    throw unavailable;
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || result === null) {
    const error = new Error(result?.error ?? 'The workshop is briefly unavailable. Try again.');
    error.status = response.status;
    throw error;
  }
  return result;
}

export function watch(path, onData, onError = () => {}) {
  let stopped = false;
  let timer;
  let controller;
  let failures = 0;
  let changedDuringRequest = false;

  function schedule(delay) {
    clearTimeout(timer);
    if (!stopped) timer = setTimeout(tick, delay);
  }

  async function tick() {
    if (stopped || controller) return;
    if (document.hidden) return schedule(5000);
    controller = new AbortController();
    const timeout = setTimeout(() => controller?.abort(), 9000);
    try {
      const data = await api(path, undefined, { signal: controller.signal });
      failures = 0;
      if (!stopped) onData(data);
    } catch (error) {
      if (!stopped) {
        if (error.name === 'AbortError') {
          const slow = new Error('Connection delayed. Reconnecting to the workshop…');
          slow.status = 0;
          error = slow;
        }
        failures = error.status === 401 ? 1 : Math.min(failures + 1, 4);
        onError(error);
      }
    } finally {
      clearTimeout(timeout);
      controller = null;
      const interval = path === '/api/screen' ? 850 : (path === '/api/player' ? 1800 : 1350);
      schedule(changedDuringRequest ? 0 : interval * (failures || 1));
      changedDuringRequest = false;
    }
  }

  function wake() {
    if (document.hidden) return;
    if (controller) changedDuringRequest = true;
    else schedule(0);
  }

  document.addEventListener('visibilitychange', wake);
  window.addEventListener('online', wake);
  void tick();
  return () => {
    stopped = true;
    clearTimeout(timer);
    controller?.abort();
    document.removeEventListener('visibilitychange', wake);
    window.removeEventListener('online', wake);
  };
}

export function uid() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // LAN testing can use HTTP, where randomUUID may be unavailable.
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (part) => part.toString(16).padStart(2, '0')).join('');
}

export function time(value) {
  if (value == null || value === '') return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
}

const paths = {
  arrowRight: '<path d="M5 12h14m-7-7 7 7-7 7"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  back: '<path d="M19 12H5m7 7-7-7 7-7"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  home: '<path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 21v-7h6v7"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4m-4 4v2"/>',
  heart: '<path d="M20.8 8.5c0 4.2-8.8 10.2-8.8 10.2S3.2 12.7 3.2 8.5A4.4 4.4 0 0 1 12 8a4.4 4.4 0 0 1 8.8.5Z"/>',
  user: '<circle cx="12" cy="7" r="3.5"/><path d="M5 21v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M2.5 20v-2a4.5 4.5 0 0 1 4.5-4.5h4a4.5 4.5 0 0 1 4.5 4.5v2m1-15a3 3 0 0 1 0 6m5 9v-2a4.5 4.5 0 0 0-3-4.25"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  snow: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M8 4l4 4 4-4m-8 16 4-4 4 4"/>',
  star: '<path d="m12 2 3 6 7 .9-5 4.9 1.2 7.1-6.2-3.4-6.2 3.4 1.2-7.1-5-4.9 7-.9z"/>',
  sparkles: '<path d="M10 3c0 4.4 2.6 7 7 7-4.4 0-7 2.6-7 7 0-4.4-2.6-7-7-7 4.4 0 7-2.6 7-7Zm9 10v6m-3-3h6"/>',
  eye: '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="2.5"/>',
  eyeOff: '<path d="m3 3 18 18M11 6a11 11 0 0 1 11 6 11 11 0 0 1-3.3 3.5M6.1 7.1A15 15 0 0 0 2 12s3.6 6 10 6a11 11 0 0 0 3.4-.5"/>',
  flag: '<path d="M5 22V3h12l-2 4 2 4H5"/>',
  alert: '<path d="m10.3 4-8 14a1.7 1.7 0 0 0 1.5 2.5h16.4a1.7 1.7 0 0 0 1.5-2.5l-8-14a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4m0 3v.1"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .6-1.5 1.1-1.5 2m0 3v.1"/>',
  screen: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/><circle cx="12" cy="12" r="7"/>',
  clipboard: '<rect x="5" y="5" width="14" height="16" rx="2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6m-6 4h6"/>',
  activity: '<path d="M3 12h4l3-6 4 12 3-6h4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  logout: '<path d="M10 4H5v16h5m1-8h10m-4-4 4 4-4 4"/>',
  fullscreen: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="m8 5 12 7-12 7z"/>',
  edit: '<path d="m5 16-1 4 4-1L20 7l-3-3L5 16Zm10-10 3 3"/>',
  refresh: '<path d="M20 8a8 8 0 1 0 .3 7M20 3v5h-5"/>',
  bell: '<path d="M6 10a6 6 0 1 1 12 0v4l2 3H4l2-3v-4m4 10a2 2 0 0 0 4 0"/>',
  gift: '<rect x="4" y="10" width="16" height="11" rx="1"/><path d="M3 7h18v4H3zM12 7v14m0-14H9a2 2 0 1 1 2-2zm0 0h3a2 2 0 1 0-2-2z"/>',
};

export function icon(name) {
  const aliases = {
    arrow: 'arrowRight', arrowLeft: 'back', x: 'close', report: 'flag', rules: 'help',
    mission: 'mail', account: 'user', warning: 'alert', monitor: 'screen', inbox: 'mail',
    overview: 'home', players: 'users', missions: 'clipboard', reports: 'flag',
    game: 'play', presentation: 'screen', audit: 'activity', history: 'clock',
  };
  const shape = paths[aliases[name] ?? name] ?? paths.star;
  return `<svg class="ui-icon" aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${shape}</svg>`;
}

export function toast(message, kind = 'good') {
  let stack = document.querySelector('.ui-toasts');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'ui-toasts';
    stack.setAttribute('aria-live', 'polite');
    document.body.append(stack);
  }
  const piece = document.createElement('div');
  piece.className = 'ui-toast';
  if (kind === 'error' || kind === 'bad' || kind === 'danger') piece.classList.add('ui-toast-error');
  piece.innerHTML = `${icon(piece.classList.contains('ui-toast-error') ? 'alert' : 'check')} <span>${esc(message)}</span>`;
  stack.append(piece);
  while (stack.children.length > 3) stack.firstElementChild.remove();
  setTimeout(() => piece.remove(), 4200);
}

export function confirmAction({ title, message, accept = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    const id = `confirm-${uid()}`;
    dialog.className = 'ui-confirm';
    dialog.setAttribute('aria-labelledby', id);
    dialog.innerHTML = `<form method="dialog">
      <h2 id="${id}">${esc(title)}</h2>
      <p>${esc(message)}</p>
      <div class="ui-confirm-actions">
        <button class="button secondary" value="cancel" autofocus>Cancel</button>
        <button class="button ${danger ? 'danger' : 'primary'}" value="accept">${esc(accept)}</button>
      </div>
    </form>`;
    document.body.append(dialog);
    dialog.addEventListener('close', () => {
      const accepted = dialog.returnValue === 'accept';
      dialog.remove();
      resolve(accepted);
    }, { once: true });
    dialog.showModal();
  });
}
