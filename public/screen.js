import { api, esc, icon, watch } from './common.js';
import { ruleScenes, showTutorialSlide, tutorialTrack } from './tutorial.js';

const app = document.querySelector('#app');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const screenIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 7h3v3M7 10V7h3m7 7v3h-3m-4 0H7v-3"/><rect x="3" y="3" width="18" height="18" rx="3"/></svg>';
const exitIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 5H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h7m-2-7h10m-4-4 4 4-4 4"/></svg>';
const arrowIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg>';
const ornamentIcon = '<svg viewBox="0 0 56 72" fill="none" aria-hidden="true"><path d="M28 1v22M22 25h12v8H22z"/><circle cx="28" cy="49" r="17"/><path d="M24 49h8m-4-4v8M12 44h8m16 0h8m-32 10h8m16 0h8"/></svg>';
const flakeIcon = '<svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M20 5v30M7 12.5l26 15m0-15-26 15M15 9l5 5 5-5m-10 22 5-5 5 5m8-14-7-2 2-7M7 23l7 2-2 7M7 17l7-2-2-7m21 15-7 2 2 7"/></svg>';

const phaseLabel = {
  lobby: 'Lobby open',
  live: 'Game live',
  paused: 'Game paused',
  ended: 'Game ended',
};

let snapshot;
let serverOffset = 0;
let lastClock = 0;
let phase;
let view = '';
let notice = '';
let stopWatching;
let stage;
let status;
let connection;
let countdown;
let winnerLayout;
let displayedPage = 0;
let pageCount = 1;
let lastWinnerActivity = 0;
let lastFinaleEvent;

function isUnauthorized(error) {
  return error?.status === 401 || error?.statusCode === 401;
}

function clock(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Date.parse(value);
  return NaN;
}

function getNow() {
  lastClock = Math.max(lastClock, Date.now() + serverOffset);
  return lastClock;
}

function fittings() {
  const lights = Array.from({ length: 23 }, (_, index) => (
    `<i style="--order:${index};--strand:${Math.sin(index / 22 * Math.PI) * 18}px"></i>`
  )).join('');
  const snow = Array.from({ length: 39 }, (_, index) => {
    const x = ((index * 227 + 31) % 997) / 10;
    const duration = 10 + ((index * 53) % 16);
    const delay = -((index * 87) % 191) / 10;
    const size = 2 + ((index * 5) % 7);
    return `<i style="--snow-x:${x}%;--snow-s:${size}px;--snow-d:${duration}s;--snow-delay:${delay}s"></i>`;
  }).join('');
  return `<div class="projection-fittings" aria-hidden="true">
    <div class="projection-lights">${lights}</div>
    <i class="projection-ornament projection-ornament-left">${ornamentIcon}</i>
    <i class="projection-ornament projection-ornament-right">${ornamentIcon}</i>
    <i class="projection-flake projection-flake-left">${flakeIcon}</i>
    <i class="projection-flake projection-flake-right">${flakeIcon}</i>
    <div class="projection-snow">${snow}</div>
    <div class="projection-frame"></div>
  </div>`;
}

function openGate(errorText = '') {
  stopWatching?.();
  stopWatching = undefined;
  snapshot = undefined;
  lastClock = 0;
  phase = undefined;
  stage = undefined;
  status = undefined;
  connection = undefined;
  countdown = undefined;
  lastFinaleEvent = undefined;
  view = 'gate';
  app.innerHTML = `<main class="projection projection-gate">
    ${fittings()}
    <section class="projection-gate-card">
      <img src="/art/emblem.svg" alt="" width="78" height="78">
      <p class="eyebrow">JHU ASA presents</p>
      <h1>Presentation<br>screen</h1>
      <p>Enter the presentation password from your event organizer.</p>
      <form id="projection-login">
        <label for="projection-password">Presentation password</label>
        <input id="projection-password" type="password" name="password" required autocomplete="current-password" aria-describedby="projection-auth-error">
        <p id="projection-auth-error" class="projection-auth-error" role="alert">${esc(errorText)}</p>
        <button class="button primary" type="submit">Open presentation</button>
      </form>
      <a href="/">Back to player entry</a>
    </section>
  </main>`;

  const form = document.querySelector('#projection-login');
  const errorNode = document.querySelector('#projection-auth-error');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button');
    errorNode.textContent = '';
    button.disabled = true;
    button.textContent = 'Opening presentation…';
    try {
      await api('/api/screen/login', { password: new FormData(form).get('password') });
      openProjection();
    } catch (error) {
      errorNode.textContent = error.message || 'The presentation could not be opened. Try again.';
      form.querySelector('input').focus();
    } finally {
      button.disabled = false;
      button.textContent = 'Open presentation';
    }
  });
}

function openProjection() {
  stopWatching?.();
  view = '';
  app.innerHTML = `<main class="projection projection-display">
    ${fittings()}
    <header class="projection-header">
      <span class="projection-brand">JHU ASA <span>presents</span></span>
      <div class="projection-controls">
        <span id="projection-connection" class="projection-connection" role="status"></span>
        <button class="projection-tool" id="projection-fullscreen" type="button" title="Enter full screen" aria-label="Enter full screen">${screenIcon}</button>
        <button class="projection-tool" id="projection-exit" type="button" title="Sign out of presentation" aria-label="Sign out of presentation">${exitIcon}</button>
        <button class="projection-tool" id="projection-help" type="button" title="How to play" aria-label="How to play" aria-haspopup="dialog">${icon('help')}</button>
      </div>
    </header>
    <div id="projection-stage" class="projection-stage" aria-live="polite" aria-atomic="false">
      <p class="projection-connecting" role="status">Connecting to Santa’s workshop…</p>
    </div>
    <footer class="projection-footer">
      <span class="projection-year">Christmas 2026</span>
      <span class="projection-status" id="projection-status" role="status"><i></i><span>Connecting</span></span>
    </footer>
  </main>`;

  stage = document.querySelector('#projection-stage');
  status = document.querySelector('#projection-status');
  connection = document.querySelector('#projection-connection');
  notice = '';

  const fullButton = document.querySelector('#projection-fullscreen');
  if (!document.documentElement.requestFullscreen && !document.documentElement.webkitRequestFullscreen) {
    fullButton.hidden = true;
  }
  fullButton.addEventListener('click', toggleFullscreen);
  document.querySelector('#projection-help').addEventListener('click', openRules);

  const exitButton = document.querySelector('#projection-exit');
  exitButton.addEventListener('click', async () => {
    exitButton.disabled = true;
    try {
      await api('/api/screen/logout', {});
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        try { await (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch {}
      }
      openGate();
    } catch (error) {
      if (isUnauthorized(error)) openGate();
      else setConnection(error.message || 'Sign-out failed. Try again.');
    } finally {
      exitButton.disabled = false;
    }
  });

  stopWatching = watch('/api/screen', update, (error) => {
    if (isUnauthorized(error)) openGate();
    else setConnection('Reconnecting to game…');
  });
}

function openRules() {
  const dialog = document.createElement('dialog');
  dialog.className = 'projection-rules';
  dialog.setAttribute('aria-label', 'How to play');
  dialog.innerHTML = `<button class="projection-tool projection-rules-close" type="button" aria-label="Close tutorial" autofocus>${icon('close')}</button>
    ${tutorialTrack(([title, description, art], index) => `<div class="projection-rules-slide">
      <img src="${art}" alt="" width="384" height="384" draggable="false">
      <div><p class="eyebrow">${index + 1} of ${ruleScenes.length}</p>
      <h2>${esc(title)}</h2><p>${esc(description)}</p></div></div>`)}
    <div class="projection-rules-nav">
      <button class="button secondary" type="button" data-rules-back disabled>Back</button>
      <button class="button primary" type="button" data-rules-next>Next</button>
    </div>`;

  const back = dialog.querySelector('[data-rules-back]');
  const next = dialog.querySelector('[data-rules-next]');
  let index = 0;
  function showStep() {
    showTutorialSlide(dialog, index);
    back.disabled = index === 0;
    next.textContent = index === ruleScenes.length - 1 ? 'Done' : 'Next';
  }

  dialog.querySelector('.projection-rules-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  back.addEventListener('click', () => { index -= 1; showStep(); });
  next.addEventListener('click', () => {
    if (index === ruleScenes.length - 1) dialog.close();
    else { index += 1; showStep(); }
  });
  app.append(dialog);
  dialog.showModal();
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else {
      const root = document.documentElement;
      await (root.requestFullscreen || root.webkitRequestFullscreen).call(root);
    }
  } catch {
    setConnection('Full screen is unavailable in this browser.');
  }
}

function updateFullscreenButton() {
  const button = document.querySelector('#projection-fullscreen');
  if (!button) return;
  const fullscreen = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
  const label = fullscreen ? 'Exit full screen' : 'Enter full screen';
  button.setAttribute('aria-label', label);
  button.title = label;
}

function setConnection(message) {
  if (message === notice || !connection) return;
  notice = message;
  connection.textContent = message;
}

function update(data) {
  if (!stage) return;
  snapshot = data;
  const serverTime = clock(data.serverTime);
  if (Number.isFinite(serverTime)) serverOffset = serverTime - Date.now();

  const currentPhase = data.round?.phase;
  if (currentPhase !== phase) {
    phase = currentPhase;
    status.dataset.phase = phase || '';
    status.lastElementChild.textContent = phaseLabel[phase] || 'Connected';
  }
  setConnection('');
  paint();
}

function logo() {
  return `<h1 class="projection-logo"><span class="projection-logo-first">Santa’s</span><span class="projection-logo-main">Secret</span><span class="projection-logo-last">Mission</span></h1>`;
}

function idle() {
  const label = phase === 'live' ? 'Who’s hiding a secret?' :
    phase === 'ended' ? 'This round has ended.' : 'Waiting for Santa’s signal';
  return `<section class="projection-idle projection-scene">
    <div class="projection-idle-copy">
      ${logo()}
      <p class="projection-subtitle"><i></i>${label}<i></i></p>
    </div>
    <img class="projection-idle-art" src="/art/agent.svg" alt="" width="680" height="610">
  </section>`;
}

function paused() {
  return `<section class="projection-message projection-scene">
    <img class="projection-message-icon" src="/art/emblem.svg" alt="" width="100" height="100">
    <h1>Game paused</h1>
    <p>Stay undercover. Your mission will resume soon.</p>
  </section>`;
}

function elapsedStyle(elapsed) {
  return `style="--elapsed:${-Math.min(180, Math.max(0, elapsed) / 1000)}s"`;
}

function elimination(event, age) {
  const compromised = event.type === 'compromised';
  const mission = typeof event.mission === 'object' ? event.mission?.description : event.mission;
  return `<section class="projection-elimination projection-scene" ${elapsedStyle(age)}>
    <div class="projection-envelope" aria-hidden="true">
      <div class="projection-envelope-back"></div>
      <div class="projection-envelope-letter"><span></span><span></span><span></span></div>
      <div class="projection-envelope-front"></div>
      <div class="projection-envelope-flap"></div>
      <span class="projection-envelope-seal">✦</span>
    </div>
    <div class="projection-elimination-copy">
      <p class="projection-stamp">${compromised ? 'Mission compromised' : 'Out of lives'}</p>
      <p class="projection-kicker">Agent eliminated</p>
      <h1>${esc(event.name || 'Agent')}</h1>
      ${compromised && mission ? `<div class="projection-revealed-mission"><span>Secret mission</span><p>${esc(mission)}</p></div>` : ''}
    </div>
    <img class="projection-caught-art" src="/art/caught.svg" alt="" width="440" height="440">
  </section>`;
}

function announcement(event, age) {
  return `<section class="projection-message projection-scene projection-announcement" ${elapsedStyle(age)}>
    <img class="projection-message-icon" src="/art/emblem.svg" alt="" width="100" height="100">
    <h1>${esc(event.title || 'Workshop announcement')}</h1>
    ${event.message ? `<p>${esc(event.message)}</p>` : ''}
  </section>`;
}

function countdownScene() {
  return `<section class="projection-message projection-scene projection-countdown">
    <h1>Countdown</h1><p id="projection-countdown" class="projection-countdown-number" role="timer" aria-live="off"></p>
  </section>`;
}

function confetti() {
  return `<div class="projection-confetti" aria-hidden="true">${Array.from({ length: 25 }, (_, index) => {
    const x = ((index * 277 + 12) % 1000) / 10;
    const delay = (index % 7) / 9;
    const rotate = (index * 137) % 360;
    return `<i style="--confetti-x:${x}%;--confetti-delay:${delay}s;--confetti-rotate:${rotate}deg"></i>`;
  }).join('')}</div>`;
}

function winnersScene(results, age) {
  const winners = Array.isArray(results?.winners) ? results.winners : [];
  return `<section class="projection-finale projection-scene" ${elapsedStyle(age)}>
    <div class="projection-finale-opening" aria-hidden="true">
      <div class="projection-gift"><i class="projection-gift-box"></i><i class="projection-gift-lid"></i><i class="projection-gift-bow"></i></div>
      <span>Mission complete</span>
    </div>
    ${confetti()}
    <div class="projection-finale-content">
      <p class="projection-kicker">Mission complete</p>
      <h1>${winners.length ? 'The undercover champions' : 'No winners this round'}</h1>
      <div id="projection-winner-layout" class="projection-winner-layout"></div>
      ${winners.length ? '' : '<p class="projection-no-winner">To win, an agent had to finish their mission and stay undercover until the end.</p>'}
      ${results ? `<div class="projection-result-summary">
        <span><b>${esc(results.players ?? 0)}</b> Players</span>
        <span><b>${esc(results.survivors ?? 0)}</b> Survivors</span>
        <span><b>${winners.length}</b> Winners</span>
      </div>` : ''}
    </div>
    <img class="projection-celebrate-art" src="/art/celebrate.svg" alt="" width="420" height="420">
  </section>`;
}

function winnersPerPage() {
  const longestMission = Math.max(0, ...(snapshot?.results?.winners ?? []).map((winner) => String(
    typeof winner.mission === 'object' ? winner.mission?.description ?? '' : winner.mission ?? '',
  ).length));
  if (window.innerWidth < 600) return window.innerHeight < 620 || longestMission > 145 ? 1 : 2;
  if (window.innerHeight < 540 || longestMission > 170) return 2;
  return 4;
}

function showWinnerPage(page) {
  if (!winnerLayout || !snapshot?.results) return;
  const winners = snapshot.results.winners || [];
  const size = winnersPerPage();
  pageCount = Math.max(1, Math.ceil(winners.length / size));
  displayedPage = (page + pageCount) % pageCount;
  const batch = winners.slice(displayedPage * size, (displayedPage + 1) * size);
  const cards = batch.map((winner) => {
    const mission = typeof winner.mission === 'object' ? winner.mission?.description : winner.mission;
    return `<li><strong>${esc(winner.name)}</strong>${mission ? `<span>${esc(mission)}</span>` : ''}</li>`;
  }).join('');
  const paging = pageCount > 1 ? `<nav class="projection-pages" aria-label="Winner pages">
    <button type="button" data-direction="-1" aria-label="Previous group of winners">${arrowIcon}</button>
    <span>Group ${displayedPage + 1} of ${pageCount}</span>
    <button type="button" data-direction="1" aria-label="Next group of winners">${arrowIcon}</button>
  </nav>` : '';
  const focusedDirection = winnerLayout.contains(document.activeElement) ? document.activeElement.dataset.direction : undefined;
  winnerLayout.innerHTML = `${cards ? `<ul class="projection-winners">${cards}</ul>` : ''}${paging}`;
  winnerLayout.querySelectorAll('button[data-direction]').forEach((button) => {
    button.addEventListener('click', () => {
      lastWinnerActivity = getNow();
      showWinnerPage(displayedPage + Number(button.dataset.direction));
    });
  });
  if (focusedDirection === '-1' || focusedDirection === '1') {
    winnerLayout.querySelector(`[data-direction="${focusedDirection}"]`)?.focus({ preventScroll: true });
  }
}

function paint() {
  if (!stage || !snapshot) return;
  const now = getNow();
  const event = snapshot.event;
  const start = clock(event?.startAt);
  const end = clock(event?.endAt);
  const active = Boolean(event && now >= start && (!Number.isFinite(end) || now < end));
  // Pending events intentionally carry only their schedule. Wait for the server to publish the active payload.
  const ready = Boolean(active && (event.type === 'winners' ? snapshot.results :
    event.type === 'countdown' || event.title || event.name || event.message));
  const type = ready ? event.type : snapshot.results ? 'winners' : phase === 'paused' ? 'paused' : 'idle';
  const round = snapshot.round?.id;
  if (!snapshot.results) lastFinaleEvent = undefined;
  if (ready && event.type === 'winners') lastFinaleEvent = event.id;
  const resultKey = lastFinaleEvent ?? snapshot.results?.endedAt ?? round;
  const key = type === 'winners' ? `winners/${resultKey}` : ready ? `event/${event.id}` : `round/${round}/${type}/${phase}`;

  if (key !== view) {
    view = key;
    countdown = undefined;
    winnerLayout = undefined;
    const age = ready ? now - start : Math.max(5000, now - (clock(snapshot.results?.endedAt) || now));
    if (type === 'winners') {
      stage.innerHTML = winnersScene(snapshot.results, age);
      winnerLayout = stage.querySelector('#projection-winner-layout');
      lastWinnerActivity = now + Math.max(0, 3500 - age);
      showWinnerPage(0);
    } else if (type === 'countdown') {
      stage.innerHTML = countdownScene();
      countdown = stage.querySelector('#projection-countdown');
    } else if (type === 'compromised' || type === 'eliminated') {
      stage.innerHTML = elimination(event, age);
    } else if (type === 'announcement') {
      stage.innerHTML = announcement(event, age);
    } else if (type === 'paused') {
      stage.innerHTML = paused();
    } else {
      stage.innerHTML = idle();
    }
  }

  if (countdown) {
    const remaining = Math.max(0, Math.ceil((end - now) / 1000));
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    const value = minutes ? `${minutes}:${String(seconds).padStart(2, '0')}` : String(seconds);
    if (countdown.textContent !== value) countdown.textContent = value;
  }
  if (winnerLayout && pageCount > 1 && !reducedMotion.matches &&
      !winnerLayout.contains(document.activeElement) && now - lastWinnerActivity >= 11000) {
    lastWinnerActivity = now;
    showWinnerPage(displayedPage + 1);
  }
}

document.addEventListener('fullscreenchange', updateFullscreenButton);
document.addEventListener('webkitfullscreenchange', updateFullscreenButton);
window.addEventListener('resize', () => {
  if (winnerLayout) showWinnerPage(Math.min(displayedPage, Math.ceil((snapshot.results?.winners?.length || 1) / winnersPerPage()) - 1));
});
window.setInterval(() => {
  if (!document.hidden) paint();
}, 200);
openProjection();
