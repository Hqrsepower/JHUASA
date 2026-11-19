import { api, esc, watch, uid, time, toast } from '/common.js';
import { playerEntry } from '/player-entry.js';
import { ruleScenes, showTutorialSlide, tutorialTrack } from '/tutorial.js';

const app = document.querySelector('#app');
const routes = [
  ['mission', 'My Mission', 'folder'], ['report', 'Report', 'search'],
  ['rules', 'Rules', 'book'], ['account', 'Account', 'user'],
];
const phases = { lobby: 'Lobby', live: 'Game live', paused: 'Game paused', ended: 'Game ended' };
const icons = {
  folder: '<path d="M3 7V5h7l2 2h9v12H3Z"/><path d="M3 9h18"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  book: '<path d="M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1Zm0 0v14"/>',
  user: '<circle cx="12" cy="8" r="3.5"/><path d="M4.5 20v-1a5 5 0 0 1 5-5h5a5 5 0 0 1 5 5v1"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/>',
  lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v2"/>',
  heart: '<path d="M20.8 4.7a5.1 5.1 0 0 0-7.2 0L12 6.3l-1.6-1.6a5.1 5.1 0 1 0-7.2 7.2l1.6 1.6 7.2 7.2 7.2-7.2 1.6-1.6a5.1 5.1 0 0 0 0-7.2Z"/>',
  sparkle: '<path d="M12 2v20M2 12h20M5 5l14 14M19 5 5 19"/>',
  check: '<path d="m5 12 4 4 10-10"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  plus: '<path d="M5 12h14m-7-7v14"/>',
  minus: '<path d="M5 12h14"/>',
  exit: '<path d="M10 4H4v16h6m-1-8h11m-4-4 4 4-4 4"/>',
  present: '<path d="M4 10h16v10H4zM3 7h18v3H3zm9 0v13m0-13C6 7 6 2 9 3c2 0 3 4 3 4Zm0 0c6 0 6-5 3-4-2 0-3 4-3 4Z"/>',
};
let snapshot;
let view = 'mission';
let overlay = null;
let offline = false;
let saving = false;
let started = false;
let reportFlow = null;
let rosterTimer;
let rosterVersion = 0;
let latestOptionsVersion = 0;
let restoreFocus = null;
let progressRetry = null;
let touchStart = null;
let stopWatch;
let revealPending = false;

const lineIcon = (name, cls = '') => `<svg class="player-icon ${cls}" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${icons[name] || icons.sparkle}</svg>`;
const character = (name, cls = '') => `<img class="player-character ${cls}" src="/art/${name}.svg" alt="" draggable="false">`;
const phaseBadge = (round) => `<span class="player-phase" data-phase="${esc(round?.phase || 'lobby')}"><i></i>${esc(phases[round?.phase] || 'Lobby')}</span>`;
const blank = (icon, title, text) => `<section class="player-empty"><div class="player-empty-icon">${lineIcon(icon)}</div><h2>${esc(title)}</h2><p>${esc(text)}</p></section>`;
const getLocal = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const setLocal = (key, value) => { try { localStorage.setItem(key, value); } catch { /* Storage can be disabled. */ } };
const rememberRules = (id) => setLocal(`ssm-rules-${id}`, 'yes');

function header(inGame) {
  return `<header class="player-header"><div class="player-wrap player-header-inner">
    <a class="player-brand" href="/" aria-label="Santa’s Secret Mission home"><span class="player-brand-mark">${lineIcon('mail')}</span><span><strong>Santa’s Secret Mission</strong><small>JHU ASA</small></span></a>
    <button class="player-header-rules" type="button" data-act="rules">${lineIcon('book')} <span>${inGame ? 'Rules' : 'How to play'}</span></button>
  </div></header>`;
}

function footer() {
  return `<footer class="player-footer player-wrap"><span>Johns Hopkins African Students Association</span><span><a href="/staff">Staff access</a><a href="/screen">Projector</a></span></footer>`;
}

function registrationOpen() {
  const round = snapshot?.round;
  return !round || round.phase === 'lobby' || (round.lateJoin && round.phase !== 'ended');
}

function welcome() {
  return `<div class="player-workshop">${header(false)}<main class="player-wrap player-welcome">
    <section class="player-welcome-copy">
      <div class="player-edition"><span class="player-edition-icon">${lineIcon('sparkle')}</span> Christmas 2026 <span class="player-edition-divider"></span> JHU ASA presents</div>
      <h1>Santa’s <br class="player-title-desktop-break"><span>Secret</span><br> Mission<span class="player-title-period" aria-hidden="true">.</span></h1>
      <p class="player-welcome-sub">Complete your mission. Keep your secret. Survive Christmas.</p>
      <div class="player-signup">
        <form data-form="name" autocomplete="off">
          <label for="player-name">Enter your name</label>
          <div class="player-name-row"><input type="text" id="player-name" name="name" minlength="2" maxlength="35" placeholder="Your name" aria-describedby="player-name-error" required>
          <button type="submit" class="player-btn player-btn-red">Continue</button></div>
          <p class="player-form-error" id="player-name-error" role="alert">${registrationOpen() ? '' : 'Player registration is closed.'}</p>
        </form>
        <button class="player-btn player-return" type="button" data-act="return">${lineIcon('lock')} Already playing?</button>
      </div>
    </section>
    <div class="player-hero" aria-hidden="true">
      <div class="player-hero-outline"></div><div class="player-hero-orbit"></div>
      <span class="player-art-star player-art-star-a">✦</span><span class="player-art-star player-art-star-b">✧</span><span class="player-art-star player-art-star-c">✦</span><span class="player-art-star player-art-star-d">✷</span><span class="player-art-star player-art-star-e">✦</span>
      <div class="player-hero-snow"></div><div class="player-hero-floor"></div>
      ${character('agent', 'player-hero-elf')}
      <span class="player-art-corner top-left"></span><span class="player-art-corner top-right"></span><span class="player-art-corner bottom-left"></span><span class="player-art-corner bottom-right"></span>
    </div>
  </main>${footer()}</div>`;
}

function lifeCounter(me) {
  return `<div class="player-life-box" data-lives="${me.lives}"><div class="player-hearts" aria-hidden="true">${[1, 2].map(i => lineIcon('heart', i <= me.lives ? 'player-heart-active' : '')).join('')}</div><span>${me.lives === 1 ? '1 life left' : `${me.lives} lives left`}</span></div>`;
}

function missionCard(me, active) {
  if (!me.mission) {
    const { phase } = snapshot.round;
    const waiting = ['live', 'paused'].includes(phase) && me.lives > 0;
    const title = waiting ? 'Your challenge is coming' : phase === 'lobby' ? 'Waiting for Santa’s signal' : 'No mission assigned';
    const copy = waiting ? 'The organizers are preparing your mission. It’ll appear right here.' : phase === 'lobby' ? 'Your secret assignment will appear when the game begins.' : 'This round has no mission for you.';
    return `<section class="player-empty player-empty-mission" ${waiting ? 'role="status"' : ''}>${character('gift-agent')}
      <div><h2>${title}</h2><p>${copy}</p></div></section>`;
  }
  const { title, description, target } = me.mission;
  const done = me.progress >= target;
  const percent = Math.max(0, Math.min(100, 100 * me.progress / target));
  return `<section class="player-mission-card" data-mission-destination tabindex="-1">
    <div class="player-mission-head"><span>${lineIcon('lock')} Your secret mission</span><span class="player-dossier-decoration" aria-hidden="true">${lineIcon('sparkle')}</span></div>
    <h2>${esc(title)}</h2><p class="player-mission-description">${esc(description)}</p>
    <div class="player-progress">
      ${done ? `<div class="player-complete">${lineIcon('check')} Mission complete</div>` : ''}
      <div class="player-progress-header"><span>Progress</span><strong>${me.progress} / ${target}</strong></div>
      <div class="player-progress-bar" role="progressbar" aria-label="Mission progress" aria-valuemin="0" aria-valuemax="${target}" aria-valuenow="${me.progress}"><span style="width:${percent}%"></span></div>
      ${done && active ? '<p class="player-complete-caption">Stay undercover until the game ends.</p>' : ''}
      ${active ? `<div class="player-progress-actions">
        ${done ? '' : `<button type="button" data-act="progress" data-delta="1" class="player-btn player-btn-red" ${offline ? 'disabled' : ''}>${lineIcon('plus')} Task complete</button>`}
        <button type="button" data-act="progress" data-delta="-1" class="player-btn player-btn-outline" ${offline || !me.progress ? 'disabled' : ''}>${lineIcon('minus')} Undo completion</button>
      </div>` : ''}
    </div>
  </section>`;
}

function dashboardContent() {
  const { me, round, winner } = snapshot;
  const eliminated = me.status === 'eliminated' || me.lives === 0;
  const active = round.phase === 'live' && !eliminated;
  return `<div class="player-dash-top">
      <div class="player-agent-identity">${character('emblem', 'player-agent-avatar')}<div><div class="player-dash-status">${phaseBadge(round)}</div><h1>Agent ${esc(me.name)}</h1></div></div>
      ${lifeCounter(me)}
    </div>
    ${eliminated ? `<section class="player-out"><div><p class="player-overline">Eliminated</p><h2>You’ve been caught.</h2><p>Your mission file is now read-only.</p></div>${character('caught')}</section>` : ''}
    ${round.phase === 'ended' && !eliminated ? `<section class="player-result ${winner ? 'player-winner' : ''}">${lineIcon(winner ? 'present' : 'lock')}<div><h2>${winner ? 'Mission accomplished!' : 'This round has ended'}</h2><p>${winner ? 'You completed your mission and survived the round.' : 'Winning agents finished their whole mission and survived the round.'}</p></div></section>` : ''}
    ${round.phase === 'paused' && !eliminated ? `<div class="player-phase-note">${lineIcon('lock')} Mission progress and reports are paused.</div>` : ''}
    ${missionCard(me, active)}
    ${active ? `<button class="player-dash-report" data-act="nav" data-view="report" type="button"><span class="player-report-symbol">${lineIcon('search')}</span><span><strong>Report a suspect</strong><small>Choose an agent and guess their mission.</small></span></button>` : ''}`;
}

function reportHistory() {
  const reports = snapshot.reports || [];
  if (!reports.length) return '<p class="player-muted">You haven’t submitted a report this round.</p>';
  return `<ul class="player-report-history">${reports.map(report => `<li><div><strong>${esc(report.targetName)}</strong><span>${esc(report.guessedTitle || '')}</span></div><div><span class="player-report-status" data-status="${esc(report.status)}">${esc(report.status)}</span>${report.createdAt ? `<small>${esc(time(report.createdAt))}</small>` : ''}</div></li>`).join('')}</ul>`;
}

function reportList() {
  const flow = reportFlow;
  if (!flow || flow.loading) return '<p class="player-muted" role="status">Finding agents…</p>';
  if (flow.error) return `<p class="player-form-error" role="alert">${esc(flow.error)}</p><button class="player-btn player-btn-outline" type="button" data-act="reload-options">Try again</button>`;
  const items = flow.step === 1 ? flow.players : flow.missions;
  const query = flow.query.trim().toLocaleLowerCase();
  const filtered = items.filter(item => `${item.name || item.title} ${item.description || ''}`.toLocaleLowerCase().includes(query));
  if (!filtered.length) return `<p class="player-muted">${query ? 'No matches.' : flow.step === 1 ? 'There are no other eligible agents to report.' : 'There are no missions to choose from yet.'}</p>`;
  return filtered.map(item => `<button class="player-choice" type="button" data-act="${flow.step === 1 ? 'select-target' : 'select-mission'}" data-id="${esc(item.id)}" ${offline ? 'disabled' : ''}><span><strong>${esc(item.name || item.title)}</strong>${item.description ? `<small>${esc(item.description)}${item.target ? ` · ${item.target} required` : ''}</small>` : ''}</span>${lineIcon(flow.step === 1 ? 'user' : 'folder')}</button>`).join('');
}

function reportPanel() {
  const canReport = snapshot.me.lives > 0 && snapshot.me.status !== 'eliminated' && snapshot.round.phase === 'live';
  const flow = reportFlow;
  let builder = '';
  if (!canReport) {
    const info = snapshot.me.lives === 0 || snapshot.me.status === 'eliminated'
      ? 'Eliminated agents can review their reports.'
      : 'You can submit a report when the game is live.';
    builder = blank('lock', 'Reports are closed', info);
  } else if (flow?.step === 4) {
    builder = `<div class="player-report-success"><span>${lineIcon('check')}</span><h2>Report submitted</h2><p>Santa’s investigators are reviewing your claim.</p><button class="player-btn player-btn-red" data-act="nav" data-view="mission" type="button">Back to my mission</button></div>`;
  } else if (flow?.step === 3) {
    builder = `<section class="player-report-builder"><div class="player-step-label">Step 3 of 3</div><h2>Confirm your report</h2><p>Report <strong>${esc(flow.target.name)}</strong> for this mission?</p><blockquote><strong>${esc(flow.mission.title)}</strong><span>${esc(flow.mission.description)}${flow.mission.target ? ` · ${flow.mission.target} required` : ''}</span></blockquote><p class="player-penalty">${lineIcon('heart')} A wrong report costs one life.</p>
      <p class="player-form-error" data-report-error role="alert">${esc(flow.submitError)}</p>
      <div class="player-action-row"><button class="player-btn player-btn-outline" data-act="report-back" type="button">Back</button><button class="player-btn player-btn-red" data-act="report-submit" type="button" ${offline ? 'disabled' : ''}>Submit report</button></div></section>`;
  } else {
    const step = flow?.step || 1;
    const label = step === 1 ? 'Choose an agent' : 'Choose their suspected mission';
    builder = `<section class="player-report-builder"><div class="player-step-label">Step ${step} of 3</div><h2>${label}</h2>
      ${step === 2 ? `<p>Suspect <strong>${esc(flow.target.name)}</strong></p>` : ''}
      <label class="player-search"><span class="sr-only">${step === 1 ? 'Search agents' : 'Search missions'}</span>${lineIcon('search')}<input type="search" id="player-report-query" placeholder="${step === 1 ? 'Search agents' : 'Search missions'}" value="${esc(flow?.query || '')}"></label>
      <div class="player-choices" data-report-choices>${reportList()}</div>
      ${step === 2 ? '<button class="player-btn player-btn-outline" data-act="report-back" type="button">Back</button>' : ''}
    </section>`;
  }
  return `<div class="player-panel-heading"><p class="player-overline">Field reports</p><h1>Report a suspect</h1></div>${builder}<section class="player-history"><h2>Your reports</h2>${reportHistory()}</section>`;
}

function accountPanel() {
  return `<div class="player-panel-heading"><p class="player-overline">Private profile</p><h1>Account</h1></div>
    <section class="player-account-card"><div class="player-account-avatar">${lineIcon('user')}</div><h2>Agent ${esc(snapshot.me.name)}</h2><p>Use your name and secret PIN to sign back in from another device. Ask an event organizer to reset your PIN if you forget it.</p><button class="player-btn player-btn-outline" data-act="logout-dialog" type="button">${lineIcon('exit')} Sign out</button></section>`;
}

function dashboard() {
  return `${header(true)}<main class="player-dash ${snapshot.me.lives === 0 || snapshot.me.status === 'eliminated' ? 'player-desaturated' : ''}">
    <div class="player-dash-inner">${view === 'report' ? reportPanel() : view === 'account' ? accountPanel() : dashboardContent()}</div>
  </main><nav class="player-tabs" aria-label="Player dashboard">${routes.map(([id, label, image]) => `<button type="button" data-act="${id === 'rules' ? 'rules' : 'nav'}" data-view="${id}" ${view === id ? 'aria-current="page"' : ''}>${lineIcon(image)}<span>${label}</span></button>`).join('')}</nav>`;
}

function pinMarkup() {
  return `<fieldset class="player-pin-group"><legend class="sr-only">Four digit PIN</legend><div class="player-pin-field">
    <div class="player-pin-slots" aria-hidden="true">${[0, 1, 2, 3].map(i => `<span data-pin-digit="${i}" data-next="${i === 0}"></span>`).join('')}</div>
    <input type="password" name="pin" aria-label="Four digit PIN" autocomplete="off" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" required data-pin>
  </div><button type="button" class="player-link-button" data-act="show-pin" aria-pressed="false">Show PIN</button></fieldset>`;
}

function rulesOverlay() {
  const greeting = overlay.onboarding && snapshot?.me
    ? `<p class="player-tour-greeting">Welcome aboard, Agent ${esc(snapshot.me.name)}.</p>` : '';
  return `<span class="sr-only" id="player-dialog-title">How to play</span>
    ${tutorialTrack(([label, copy, art, symbol], index) => `
      <div class="player-dialog-hero"><span class="player-dialog-glyph">${lineIcon(symbol)}</span><img class="player-character" src="${art}" alt="" width="384" height="384" draggable="false"></div>
      <div class="player-tour-copy"><div class="player-step-label">${index + 1} of ${ruleScenes.length}</div>${index === 0 ? greeting : ''}<h2>${label}</h2><p>${copy}</p></div>`)}
    <div class="player-tour-dots" role="group" aria-label="Tutorial steps">${ruleScenes.map((scene, i) => `<button type="button" aria-label="${esc(scene[0])}" ${i === 0 ? 'aria-current="step"' : ''} data-act="tour-step" data-scene="${i}"></button>`).join('')}</div>
    <div class="player-action-row player-tour-actions"><button type="button" class="player-btn player-btn-outline" data-tour-back data-act="close-overlay">${overlay.onboarding ? 'Skip' : 'Close'}</button>
    <button type="button" class="player-btn player-btn-red" data-tour-next data-act="tour-next">Next</button></div>`;
}

function rosterMarkup() {
  const players = overlay.roster || [];
  if (overlay.searching) return '<p class="player-muted" role="status">Looking up agents…</p>';
  if (overlay.rosterError) return `<p class="player-form-error" role="alert">${esc(overlay.rosterError)}</p><button class="player-btn player-btn-outline" type="button" data-act="retry-roster">Try again</button>`;
  if (!players.length) return `<p class="player-muted">${overlay.query ? 'No matching names.' : 'No agents have registered yet.'}</p>`;
  return players.map(p => `<button type="button" class="player-choice" data-act="agent-pick" data-id="${esc(p.id)}"><span><strong>${esc(p.name)}</strong></span>${lineIcon('user')}</button>`).join('');
}

function missionRevealMarkup() {
  return `<span class="sr-only" id="player-dialog-title">Your secret mission</span>
    <div class="player-reveal-card" data-reveal-card>
      <button class="player-reveal-face player-reveal-front" type="button" data-act="reveal-mission">
        <span class="player-reveal-seal">${lineIcon('mail')}</span>
        <strong>Your secret mission</strong>
        <span class="player-reveal-prompt">Tap to reveal</span>
      </button>
      <div class="player-reveal-back" data-reveal-back aria-hidden="true" inert></div>
    </div>
    <div class="player-reveal-actions" inert>
      <button class="player-btn" data-act="close-overlay" type="button" data-reveal-okay>Okay</button>
    </div>`;
}

function copyMissionCard(target) {
  const copy = target.cloneNode(true);
  copy.removeAttribute('data-mission-destination');
  copy.removeAttribute('tabindex');
  copy.querySelector('.player-progress-actions')?.setAttribute('inert', '');
  return copy;
}

function syncMissionReveal() {
  const dialog = app.querySelector('.player-reveal-dialog');
  const target = app.querySelector('[data-mission-destination]');
  if (!dialog || !target) return;
  const back = dialog.querySelector('[data-reveal-back]');
  const copy = copyMissionCard(target);
  if (back.firstElementChild?.outerHTML !== copy.outerHTML) back.replaceChildren(copy);
  dialog.style.width = `${target.getBoundingClientRect().width}px`;
  dialog.classList.toggle('player-reveal-desaturated', Boolean(target.closest('.player-desaturated')));
}

function renderOverlay(focus = true) {
  const existing = app.querySelector('[data-player-overlay]');
  const isReveal = overlay?.type === 'mission-reveal';
  app.toggleAttribute('data-mission-covered', isReveal);
  if (!overlay) {
    existing?.remove();
    document.body.classList.remove('player-dialog-open');
    return;
  }
  let html;
  if (overlay.type === 'rules') html = rulesOverlay();
  if (isReveal) html = missionRevealMarkup();
  if (overlay.type === 'register') html = `<div class="player-dialog-badge">${lineIcon('lock')}</div><h2 id="player-dialog-title">Choose your secret PIN</h2><p>Agent ${esc(overlay.name)}, you’ll need this four-digit PIN to return to your mission.</p>
    <form data-form="register">${pinMarkup()}<p class="player-form-error" data-pin-error role="alert"></p>
    <div class="player-action-row"><button type="button" class="player-btn player-btn-outline" data-act="close-overlay">Back</button><button class="player-btn player-btn-red" type="submit">Join the game</button></div></form>`;
  if (overlay.type === 'return') html = `<div class="player-dialog-badge">${lineIcon('lock')}</div><h2 id="player-dialog-title">Welcome back, agent</h2><p>Find your name to unlock your mission.</p>
    <label class="player-search"><span class="sr-only">Search registered names</span>${lineIcon('search')}<input type="search" id="player-roster-query" placeholder="Search names" value="${esc(overlay.query || '')}"></label><div class="player-choices player-roster" data-roster>${rosterMarkup()}</div>`;
  if (overlay.type === 'login') html = `<div class="player-dialog-badge">${lineIcon('lock')}</div><h2 id="player-dialog-title">Agent ${esc(overlay.name)}</h2><p>Enter your secret PIN to access your mission.</p>
    <form data-form="login">${pinMarkup()}<p class="player-form-error" data-pin-error role="alert"></p>
    <div class="player-action-row"><button type="button" class="player-btn player-btn-outline" data-act="return">Back</button><button class="player-btn player-btn-red" type="submit">Sign in</button></div></form>
    <p class="player-pin-help">Forgot your PIN? Ask an event organizer to reset it.</p>`;
  if (overlay.type === 'logout') html = `<div class="player-dialog-badge">${lineIcon('exit')}</div><h2 id="player-dialog-title">Sign out?</h2><p>Your mission and progress will be here when you come back. You’ll need your PIN to sign in again.</p><p data-pin-error class="player-form-error" role="alert"></p><div class="player-action-row"><button class="player-btn player-btn-outline" type="button" data-act="close-overlay">Cancel</button><button class="player-btn player-btn-red" type="button" data-act="logout">Sign out</button></div>`;
  const dialogClass = isReveal ? 'player-reveal-dialog' : overlay.type === 'rules' ? 'player-tour' : '';
  const markup = `<div class="player-overlay" data-player-overlay><section class="player-dialog ${dialogClass}" role="dialog" aria-modal="true" aria-labelledby="player-dialog-title" tabindex="-1" data-player-dialog><button type="button" class="player-dialog-close" data-act="close-overlay" aria-label="Close">${lineIcon('close')}</button>${html}</section></div>`;
  if (existing) existing.outerHTML = markup;
  else app.insertAdjacentHTML('beforeend', markup);
  document.body.classList.add('player-dialog-open');
  if (isReveal) syncMissionReveal();
  if (focus) {
    const dialog = app.querySelector('[data-player-dialog]');
    (dialog.querySelector('[data-pin], #player-roster-query, [data-act="reveal-mission"]') || dialog).focus();
  }
}

function setOverlay(next) {
  if (!overlay) restoreFocus = document.activeElement;
  overlay = next;
  renderOverlay();
}

function dismiss() {
  if (saving) return;
  if (overlay?.type === 'mission-reveal') return landMissionCard();
  if (overlay?.onboarding && snapshot?.me) {
    rememberRules(snapshot.me.id);
    api('/api/player/tutorial', {}).catch(() => {});
  }
  overlay = null;
  renderOverlay();
  if (restoreFocus?.isConnected) restoreFocus.focus();
  restoreFocus = null;
  presentMission();
}

function presentMission() {
  if (!revealPending || overlay || !snapshot?.me?.mission) return;
  revealPending = false;
  if (view !== 'mission') {
    view = 'mission';
    render();
  }
  endIntro();
  window.scrollTo({ top: 0, behavior: 'auto' });
  setOverlay({ type: 'mission-reveal' });
}

function revealMission(button) {
  const card = button.closest('[data-reveal-card]');
  const dialog = button.closest('[data-player-dialog]');
  const back = card.querySelector('[data-reveal-back]');
  card.dataset.revealed = 'true';
  button.inert = true;
  button.setAttribute('aria-hidden', 'true');
  back.inert = false;
  back.removeAttribute('aria-hidden');
  const okay = dialog.querySelector('[data-reveal-okay]');
  okay.parentElement.inert = false;
  okay.focus();
}

function landMissionCard() {
  const card = app.querySelector('[data-reveal-card]');
  const target = app.querySelector('[data-mission-destination]');
  const face = card?.querySelector(card.hasAttribute('data-revealed') ? '[data-reveal-back]' : '.player-reveal-front');
  const start = face?.getBoundingClientRect();
  const animate = start?.width > 0 && start.height > 0 && typeof target?.animate === 'function' &&
    !matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (animate) app.setAttribute('data-mission-flight', '');
  overlay = null;
  renderOverlay();
  restoreFocus = null;
  const end = target?.getBoundingClientRect();
  let flight;
  const complete = () => {
    flight?.remove();
    app.removeAttribute('data-mission-flight');
    app.querySelector('[data-mission-destination]')?.focus({ preventScroll: true });
    presentMission();
  };
  if (!animate || !end?.width || !end.height) return complete();
  flight = copyMissionCard(target);
  flight.classList.add('player-mission-flight');
  flight.classList.toggle('player-reveal-desaturated', Boolean(target.closest('.player-desaturated')));
  flight.inert = true;
  flight.setAttribute('aria-hidden', 'true');
  Object.assign(flight.style, { left: `${end.left}px`, top: `${end.top}px`, width: `${end.width}px`, height: `${end.height}px` });
  app.append(flight);
  flight.animate([
    { transform: `translate(${start.left - end.left}px, ${start.top - end.top}px) scale(${start.width / end.width}, ${start.height / end.height})` },
    { transform: 'translate(0, 0) scale(1)' },
  ], { duration: 640, easing: 'cubic-bezier(.22,.72,.23,1)', fill: 'forwards' }).finished.then(complete, complete);
}

function statusMarkup() {
  return `<div class="player-offline" data-player-offline role="status" ${offline ? '' : 'hidden'}>Connection lost. Reconnecting…</div>`;
}

function render({ preserveInput = false } = {}) {
  const previous = document.activeElement;
  const priorId = previous?.id;
  const name = preserveInput && document.getElementById('player-name')?.value;
  const base = app.querySelector('[data-player-base]');
  const contents = snapshot?.me ? dashboard() : welcome();
  if (!base) app.innerHTML = `${statusMarkup()}<div data-player-base>${contents}</div>`;
  else base.innerHTML = contents;
  const banner = app.querySelector('[data-player-offline]');
  if (banner) banner.hidden = !offline;
  if (name && document.getElementById('player-name')) document.getElementById('player-name').value = name;
  if (overlay?.type === 'mission-reveal') syncMissionReveal();
  if (!overlay && priorId) {
    const next = document.getElementById(priorId);
    next?.focus();
  }
}

function snapshotsChanged(old, incoming) {
  return JSON.stringify([old?.round, old?.me, old?.reports, old?.winner]) !==
    JSON.stringify([incoming.round, incoming.me, incoming.reports, incoming.winner]);
}

function update(incoming) {
  if (!incoming?.round) return;
  if (snapshot && incoming.revision < snapshot.revision) return;
  const changed = snapshotsChanged(snapshot, incoming);
  const former = snapshot?.me;
  const oldReports = new Map((snapshot?.reports || []).map(report => [report.id, report.status]));
  const previousRound = snapshot?.round;
  const recovering = offline;
  snapshot = incoming;
  offline = false;
  const roundChanged = previousRound?.id !== incoming.round.id;
  const mission = incoming.me?.mission;
  if (!mission) {
    revealPending = false;
    if (overlay?.type === 'mission-reveal') {
      overlay = null;
      renderOverlay();
    }
  } else if (former?.id !== incoming.me.id || former?.mission?.id !== mission.id || roundChanged) {
    revealPending = true;
    if (overlay?.type === 'mission-reveal') {
      revealPending = false;
      renderOverlay();
    }
  }
  const resumed = previousRound?.phase !== 'live' && incoming.round.phase === 'live';
  const revived = former?.lives === 0 && incoming.me?.lives > 0;
  if (view === 'report' && (!reportFlow || roundChanged || resumed || revived)) {
    reportFlow = { step: 1, query: '', loading: true, players: [], missions: [] };
    if (incoming.round.phase === 'live' && incoming.me?.lives > 0) loadOptions();
  }
  if (incoming.me && former && incoming.round.phase === 'live' && former.lives > 0 && incoming.me.lives === 0) {
    toast('You’ve been eliminated.', 'error');
  }
  if (revived) toast('You’re back in the game.');
  if (incoming.me && former && incoming.round.phase === 'live' && former.lives > incoming.me.lives && incoming.me.lives > 0) toast('You have one life left.', 'error');
  if (incoming.reports?.some(report => report.status === 'approved' && oldReports.get(report.id) === 'pending')) toast('An organizer confirmed your report.');
  if (changed || recovering) render({ preserveInput: true });
  if (!former && incoming.me?.tutorialDone === false && !getLocal(`ssm-rules-${incoming.me.id}`) && !overlay) {
    setOverlay({ type: 'rules', scene: 0, onboarding: true });
  }
  presentMission();
}

async function refresh() {
  update(await api('/api/player'));
}

function connectionLost() {
  if (offline) return;
  offline = true;
  render({ preserveInput: true });
}

function setError(node, error) {
  if (node) node.textContent = error?.message || String(error || '');
}

function pinPaint(input) {
  input.value = input.value.replace(/\D/g, '').slice(0, 4);
  const slots = input.closest('.player-pin-field').querySelectorAll('[data-pin-digit]');
  slots.forEach((slot, i) => {
    slot.textContent = input.value[i] ? (input.type === 'password' ? '•' : input.value[i]) : '';
    slot.dataset.next = String(input.value.length === i);
  });
}

async function queryRoster(query) {
  const version = ++rosterVersion;
  try {
    const data = await api('/api/roster?q=' + encodeURIComponent(query));
    if (version !== rosterVersion || overlay?.type !== 'return') return;
    overlay.roster = data.players;
    overlay.searching = false;
    overlay.rosterError = '';
  } catch (error) {
    if (version !== rosterVersion || overlay?.type !== 'return') return;
    overlay.searching = false;
    overlay.rosterError = error.message;
  }
  const roster = app.querySelector('[data-roster]');
  if (roster) roster.innerHTML = rosterMarkup();
}

function openReturn() {
  clearTimeout(rosterTimer);
  setOverlay({ type: 'return', roster: [], query: '', searching: true });
  queryRoster('');
}

async function loadOptions() {
  const version = ++latestOptionsVersion;
  const flow = reportFlow;
  try {
    const data = await api('/api/options');
    if (version !== latestOptionsVersion || flow !== reportFlow) return;
    flow.players = data.players;
    flow.missions = data.missions;
    flow.loading = false;
    flow.error = '';
  } catch (error) {
    if (version !== latestOptionsVersion || flow !== reportFlow) return;
    flow.error = error.message;
    flow.loading = false;
  }
  const choices = app.querySelector('[data-report-choices]');
  if (choices && view === 'report') choices.innerHTML = reportList();
}

function nav(target) {
  if (view === target && (target !== 'report' || reportFlow?.step !== 4)) return;
  view = target;
  if (target === 'report') {
    reportFlow = { step: 1, query: '', loading: true, players: [], missions: [] };
    if (snapshot?.round?.phase === 'live' && snapshot.me.lives > 0) loadOptions();
  }
  if (target !== 'report') reportFlow = null;
  render();
  window.scrollTo({ top: 0, behavior: 'auto' });
  const heading = app.querySelector('main h1');
  if (heading) {
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
}

async function authenticate(form) {
  if (saving) return;
  const info = overlay;
  const submit = form.querySelector('[type=submit]');
  const errorNode = form.querySelector('[data-pin-error]');
  const pin = new FormData(form).get('pin');
  if (!/^\d{4}$/.test(pin)) return setError(errorNode, 'Enter all four digits of your PIN.');
  submit.disabled = true;
  saving = true;
  setError(errorNode, '');
  const register = info.type === 'register';
  try {
    await api(register ? '/api/register' : '/api/login', register ? { name: info.name, pin } : { id: info.id, pin });
    stopWatch?.();
    overlay = null;
    renderOverlay();
    view = 'mission';
    await refresh();
  } catch (error) {
    if (overlay) setError(errorNode, error);
    else { toast(error.message, 'error'); connectionLost(); }
  } finally {
    saving = false;
    submit.disabled = false;
    restartWatch();
  }
}

async function changeProgress(delta, button) {
  if (saving || offline) return;
  const before = snapshot.me.progress;
  const mission = snapshot.me.mission;
  const key = `${snapshot.round.id}:${mission?.id}:${delta}`;
  const requestId = progressRetry?.key === key ? progressRetry.id : uid();
  saving = true;
  const buttons = app.querySelectorAll('[data-act=progress]');
  buttons.forEach(item => { item.disabled = true; });
  try {
    await api('/api/progress', { delta, requestId, roundId: snapshot.round.id, missionId: mission?.id });
    progressRetry = null;
    await refresh();
    if (delta === 1 && mission && before < mission.target && snapshot.me.progress >= mission.target) toast('Mission complete! Stay undercover.');
  } catch (error) {
    progressRetry = error.status === 0 ? { key, id: requestId } : null;
    toast(error.message, 'error');
  } finally {
    saving = false;
    render();
    if (button.dataset.delta === '-1') app.querySelector('[data-act=progress][data-delta="-1"]')?.focus();
  }
}

async function submitReport(button) {
  const flow = reportFlow;
  if (saving || offline || !flow?.target || !flow?.mission) return;
  saving = true;
  button.disabled = true;
  flow.requestId ??= uid();
  flow.submitError = '';
  setError(app.querySelector('[data-report-error]'), '');
  try {
    await api('/api/report', { targetId: flow.target.id, missionId: flow.mission.id, requestId: flow.requestId, roundId: snapshot.round.id });
    flow.step = 4;
    render();
    await refresh();
  } catch (error) {
    flow.submitError = error.message;
    setError(app.querySelector('[data-report-error]'), error);
    if (flow.step === 4) connectionLost();
  } finally {
    saving = false;
    button.disabled = false;
  }
}

async function logout(button) {
  if (saving) return;
  saving = true;
  button.disabled = true;
  try {
    await api('/api/logout', {});
    stopWatch?.();
    snapshot = undefined;
    view = 'mission';
    reportFlow = null;
    progressRetry = null;
    revealPending = false;
    overlay = null;
    renderOverlay();
    render();
    await refresh();
  } catch (error) {
    setError(app.querySelector('[data-pin-error]'), error);
  } finally {
    saving = false;
    button.disabled = false;
    restartWatch();
  }
}

function gotoScene(scene) {
  if (overlay?.type !== 'rules' || scene < 0 || scene >= ruleScenes.length || scene === overlay.scene) return;
  const dialog = app.querySelector('[data-player-dialog]');
  const dots = dialog.querySelectorAll('[data-act="tour-step"]');
  dots[overlay.scene].removeAttribute('aria-current');
  dots[scene].setAttribute('aria-current', 'step');
  overlay.scene = scene;
  showTutorialSlide(dialog, scene);
  const back = dialog.querySelector('[data-tour-back]');
  back.dataset.act = scene ? 'tour-back' : 'close-overlay';
  back.textContent = scene ? 'Back' : overlay.onboarding ? 'Skip' : 'Close';
  const next = dialog.querySelector('[data-tour-next]');
  const last = scene === ruleScenes.length - 1;
  next.dataset.act = last ? 'close-overlay' : 'tour-next';
  next.textContent = last ? 'Let’s play' : 'Next';
}

app.addEventListener('submit', event => {
  const form = event.target.closest('[data-form]');
  if (!form) return;
  event.preventDefault();
  if (form.dataset.form !== 'name') { authenticate(form); return; }
  const entry = playerEntry(new FormData(form).get('name'), registrationOpen());
  if (entry.path) { location.assign(entry.path); return; }
  if (entry.error) { setError(form.querySelector('[role=alert]'), entry.error); return; }
  setOverlay({ type: 'register', name: entry.name });
});

app.addEventListener('input', event => {
  if (event.target.matches('[data-pin]')) pinPaint(event.target);
  if (event.target.id === 'player-roster-query' && overlay?.type === 'return') {
    const query = event.target.value;
    overlay.query = query;
    ++rosterVersion;
    clearTimeout(rosterTimer);
    rosterTimer = setTimeout(() => {
      if (overlay?.type === 'return' && overlay.query === query) queryRoster(query);
    }, 180);
  }
  if (event.target.id === 'player-report-query' && reportFlow) {
    reportFlow.query = event.target.value;
    app.querySelector('[data-report-choices]').innerHTML = reportList();
  }
});

app.addEventListener('click', event => {
  if (event.target.matches('[data-player-overlay]')) { dismiss(); return; }
  const btn = event.target.closest('[data-act]');
  if (!btn || btn.disabled) return;
  const { act, id, delta, scene, view: nextView } = btn.dataset;
  if (act === 'return') openReturn();
  if (act === 'retry-roster') queryRoster(overlay.query);
  if (act === 'close-overlay') dismiss();
  if (act === 'reveal-mission') revealMission(btn);
  if (act === 'rules') setOverlay({ type: 'rules', scene: 0 });
  if (act === 'tour-next') gotoScene(overlay.scene + 1);
  if (act === 'tour-back') gotoScene(overlay.scene - 1);
  if (act === 'tour-step') gotoScene(Number(scene));
  if (act === 'nav') nav(nextView);
  if (act === 'show-pin') {
    const input = btn.closest('fieldset').querySelector('input');
    input.type = input.type === 'password' ? 'text' : 'password';
    btn.textContent = input.type === 'password' ? 'Show PIN' : 'Hide PIN';
    btn.setAttribute('aria-pressed', String(input.type === 'text'));
    pinPaint(input);
    input.focus();
  }
  if (act === 'agent-pick') {
    const agent = overlay.roster.find(item => item.id === id);
    if (agent) setOverlay({ type: 'login', id, name: agent.name });
  }
  if (act === 'progress') changeProgress(Number(delta), btn);
  if (act === 'reload-options') loadOptions();
  if (act === 'select-target') {
    const choice = reportFlow.players.find(item => item.id === id);
    if (!choice) return;
    Object.assign(reportFlow, { target: choice, query: '', step: 2 });
    render();
  }
  if (act === 'select-mission') {
    const choice = reportFlow.missions.find(item => item.id === id);
    if (!choice) return;
    Object.assign(reportFlow, { mission: choice, requestId: null, submitError: '', step: 3 });
    render();
  }
  if (act === 'report-back') {
    Object.assign(reportFlow, { query: '', step: reportFlow.step - 1 });
    if (reportFlow.step === 1) loadOptions();
    render();
  }
  if (act === 'report-submit') submitReport(btn);
  if (act === 'logout-dialog') setOverlay({ type: 'logout' });
  if (act === 'logout') logout(btn);
  if (act === 'skip-intro') endIntro();
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    if (overlay) dismiss();
    else endIntro();
  }
  if (event.key !== 'Tab' || !overlay) return;
  const dialog = app.querySelector('[data-player-dialog]');
  const items = [...dialog.querySelectorAll('button:not([disabled]),input:not([disabled]),a[href]')].filter(item => !item.closest('[inert]'));
  if (event.shiftKey && (document.activeElement === items[0] || document.activeElement === dialog)) {
    event.preventDefault();
    items.at(-1)?.focus();
  } else if (!event.shiftKey && document.activeElement === items.at(-1)) {
    event.preventDefault();
    items[0]?.focus();
  }
});

app.addEventListener('touchstart', event => {
  if (overlay?.type === 'rules') touchStart = [event.changedTouches[0].clientX, event.changedTouches[0].clientY];
}, { passive: true });

app.addEventListener('touchend', event => {
  if (!touchStart || overlay?.type !== 'rules') return;
  const [x, y] = touchStart;
  touchStart = null;
  const dx = event.changedTouches[0].clientX - x;
  const dy = event.changedTouches[0].clientY - y;
  if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.6) gotoScene(overlay.scene + (dx < 0 ? 1 : -1));
}, { passive: true });

function endIntro() {
  app.querySelector('[data-player-intro]')?.remove();
}

function intro() {
  if (getLocal('ssm-intro') || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  setLocal('ssm-intro', 'yes');
  app.insertAdjacentHTML('beforeend', `<aside class="player-intro" data-player-intro aria-label="Welcome to Santa's Secret Mission"><div class="player-intro-glow"></div>${character('agent')}<span class="player-intro-envelope">${lineIcon('mail')}</span><strong>Santa’s Secret Mission</strong><button type="button" data-act="skip-intro">Skip intro</button></aside>`);
  setTimeout(endIntro, 1950);
}

function start() {
  if (started) return;
  started = true;
  document.body.classList.add('player-page');
  render();
  intro();
  restartWatch();
  window.addEventListener('offline', connectionLost);
}

function restartWatch() {
  stopWatch?.();
  stopWatch = watch('/api/player', update, connectionLost);
}

start();
