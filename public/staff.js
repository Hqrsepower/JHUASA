import { api, esc, watch, toast, confirmAction } from './common.js'

const app = document.querySelector('#app')
const sections = [
  ['overview', 'Overview', 'grid'],
  ['players', 'Players', 'people'],
  ['missions', 'Missions', 'folder'],
  ['reports', 'Reports', 'flag'],
  ['game', 'Game control', 'game'],
  ['presentation', 'Presentation', 'screen'],
  ['activity', 'Activity log', 'activity'],
  ['settings', 'Settings', 'settings'],
]

const paths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  people: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/><circle cx="9" cy="7" r="4"/>',
  folder: '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/><path d="M3 9h18"/>',
  flag: '<path d="M5 21V4m0 1c4-5 9 4 14 0v10c-5 4-10-5-14 0"/>',
  game: '<rect x="3" y="7" width="18" height="12" rx="4"/><path d="M7 13h5m-2.5-2.5v5m6.5-3.5h.01m2 2h.01"/>',
  screen: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M10 3h4l.7 3 2 .9L19.5 6l2 3.5-2.1 2 .1 2.2 2 2-2 3.4-3-.9-1.9 1.1L14 22h-4l-.7-2.7-2-1.1-2.8.9-2-3.4 2-2v-2.2l-2-2L4.5 6l2.9.9 2-1L10 3Z"/>',
  clear: '<path d="m6 6 12 12M6 18 18 6"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6 8.5 7 8.5-7"/>',
  heart: '<path d="M12 20S3 14 3 8.5a4.5 4.5 0 0 1 9-1 4.5 4.5 0 0 1 9 1C21 14 12 20 12 20Z"/>',
  spark: '<path d="m12 2 2.3 7.7L22 12l-7.7 2.3L12 22l-2.3-7.7L2 12l7.7-2.3L12 2Z"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/>',
  exit: '<path d="M10 17H4V7h6m5-2 6 7-6 7m-6-7h12"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<path d="m5 12 4 4 10-10"/>',
  match: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>',
}
const symbol = name => `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.spark}</svg>`
const state = {
  data: null,
  current: getSection(),
  auth: 'loading',
  busy: false,
  offline: false,
  pendingCount: 0,
  playerSearch: '',
  playerStatus: 'all',
  playerSort: 'name',
  reportStatus: 'pending',
}
let stopWatch
const phaseName = {
  lobby: 'Lobby', live: 'Live', paused: 'Paused', ended: 'Ended',
}

function getSection() {
  const requested = location.hash.slice(1)
  return sections.some(([id]) => id === requested) ? requested : 'overview'
}

function label(text) {
  return text ? text[0].toUpperCase() + text.slice(1) : ''
}

function date(value, compact = false) {
  if (!value || Number.isNaN(new Date(value).valueOf())) return '—'
  const attrs = compact ? { hour: 'numeric', minute: '2-digit' } : {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }
  return new Intl.DateTimeFormat(undefined, attrs).format(new Date(value))
}

function badge(value, caption = label(value)) {
  return `<span class="ops-badge ops-badge--${esc(value)}">${esc(caption)}</span>`
}

function button(text, action, options = {}) {
  const { kind = 'secondary', icon, id, disabled = false } = options
  return `<button type="button" class="button ${kind}" data-action="${esc(action)}"
    ${id ? `data-id="${esc(id)}"` : ''} ${disabled ? 'disabled' : ''}>
    ${icon ? symbol(icon) : ''}${esc(text)}
  </button>`
}

function openProjector(kind = 'secondary') {
  return `<a class="button ${kind}" href="/screen" target="_blank" rel="noopener">${symbol('screen')}Open projector</a>`
}

function empty(title, detail, icon = 'folder') {
  return `<div class="ops-empty"><span>${symbol(icon)}</span><h3>${esc(title)}</h3><p>${esc(detail)}</p></div>`
}

function panelHeader(title, caption, controls = '') {
  return `<header class="ops-panel-head"><div><h2>${esc(title)}</h2>
    ${caption ? `<p>${esc(caption)}</p>` : ''}</div>${controls}</header>`
}

function pageHeader(title, caption, controls = '') {
  return `<header class="ops-page-head"><div><p class="ops-overline">Santa’s Secret Mission</p>
    <h1 tabindex="-1">${esc(title)}</h1><p>${esc(caption)}</p></div>${controls}</header>`
}

function stat(title, number, icon, tone = '') {
  return `<article class="ops-stat"><div class="ops-stat-icon ${tone}">${symbol(icon)}</div>
    <div><strong>${number}</strong><span>${esc(title)}</span></div></article>`
}

function signin() {
  app.innerHTML = `<main class="ops-login">
    <div class="ops-login-scene" aria-hidden="true"><div class="ops-login-art"><img src="/art/agent.svg" alt=""></div></div>
    <div class="ops-login-side">
      <a href="/" class="ops-login-home"><img src="/art/emblem.svg" alt=""> Santa’s Secret Mission</a>
      <section class="ops-login-content">
        <p class="ops-overline">${symbol('lock')} JHU ASA · Staff access</p>
        <h1>Mission control</h1>
        <p>Sign in to manage the game and run the live presentation.</p>
        <form data-form="login" class="ops-form">
          <label class="field ops-field"><span>Staff password</span>
            <input name="password" type="password" required autocomplete="current-password" maxlength="256" placeholder="Enter staff password">
          </label>
          <p class="ops-form-error" role="alert"></p>
          <button class="button primary" type="submit">Sign in</button>
        </form>
      </section>
      <a href="/" class="ops-login-back">Back to player sign-in</a>
    </div>
  </main>`
}

function loading() {
  app.innerHTML = `<main class="ops-loading"><img src="/art/emblem.svg" alt=""><h1>Mission control</h1>
    <p role="status">Connecting to Santa’s workshop…</p></main>`
}

function makeShell() {
  app.innerHTML = `<div class="ops-shell">
    <aside class="ops-sidebar" id="ops-sidebar" aria-label="Staff navigation">
      <a class="ops-brand" href="#overview"><img src="/art/emblem.svg" alt="">
        <span><b>Mission Control</b><small>JHU African Students Association</small></span>
      </a>
      <nav class="ops-nav">${sections.map(([id, title, icon]) => `<a href="#${id}" data-section="${id}">
        ${symbol(icon)}<span>${title}</span>${id === 'reports' ? '<span class="ops-nav-count" data-pending hidden>0</span>' : ''}
        ${id === 'players' ? '<span class="ops-nav-count" data-waiting hidden>0</span>' : ''}
      </a>`).join('')}</nav>
      <div class="ops-sidebar-foot">
        <a href="/screen" target="_blank" rel="noopener">${symbol('screen')}<span>Open projector</span></a>
        <button type="button" data-action="logout">${symbol('exit')}<span>Sign out</span></button>
      </div>
    </aside>
    <div class="ops-main">
      <div class="ops-topbar">
        <div>
          <button class="button ghost ops-menu" type="button" data-action="menu" aria-label="Toggle navigation" aria-controls="ops-sidebar" aria-expanded="false">${symbol('menu')}</button>
          <span class="ops-crumb">Staff console</span>
        </div>
        <div class="ops-top-status"><span data-network role="status" hidden>Reconnecting…</span><span data-phase></span></div>
      </div>
      <main class="ops-view" id="ops-view"></main>
    </div>
    <dialog class="ops-dialog" id="ops-dialog"></dialog>
  </div>`
}

function updateShell() {
  if (!state.data) return
  const pending = app.querySelector('[data-pending]')
  if (!pending) return

  pending.textContent = state.pendingCount
  pending.hidden = state.pendingCount === 0
  const waiting = app.querySelector('[data-waiting]')
  const waitingCount = waitingPlayers(state.data).length
  waiting.textContent = waitingCount
  waiting.hidden = waitingCount === 0
  waiting.setAttribute('aria-label', `${waitingCount} waiting for a mission`)
  app.querySelector('[data-phase]').innerHTML = badge(state.data.round.phase, phaseName[state.data.round.phase])
  app.querySelector('[data-network]').hidden = !state.offline

  for (const link of app.querySelectorAll('[data-section]')) {
    if (link.dataset.section === state.current) link.setAttribute('aria-current', 'page')
    else link.removeAttribute('aria-current')
  }
}

function count(data) {
  const { players, reports } = data
  const completed = players.filter(player => player.mission && player.progress >= player.mission.target).length
  const alive = players.filter(player => player.status === 'alive').length
  const approved = reports.filter(report => report.status === 'approved').length
  const rejected = reports.filter(report => report.status === 'rejected').length
  return { alive, completed, approved, rejected, eliminated: players.length - alive }
}

function auditRows(items) {
  return `<ul class="ops-feed">${items.map(item => `<li><span class="ops-feed-icon">${symbol('activity')}</span>
    <div><b>${esc(label(String(item.action).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ')))}</b>
    ${item.detail ? `<p>${esc(typeof item.detail === 'string' ? item.detail : Object.values(item.detail).filter(value => typeof value === 'string').join(' · '))}</p>` : ''}</div>
    <time datetime="${esc(new Date(item.createdAt).toISOString())}">${date(item.createdAt, true)}</time></li>`).join('')}</ul>`
}

function waitingPlayers(data) {
  if (!['live', 'paused'].includes(data?.round.phase)) return []
  return data.players.filter(player => player.status === 'alive' && !player.mission)
}

function availableMissions(data) {
  return data.missions.filter(mission => mission.active && (!data.round.uniqueMissions || !mission.assigned))
}

function canAssignMissions(data) {
  return data.round.phase !== 'ended' && availableMissions(data).length > 0 &&
    data.players.some(player => player.status === 'alive' && !player.mission)
}

function waitingPanel(data) {
  const waiting = waitingPlayers(data)
  if (!waiting.length) return ''
  const active = data.missions.some(mission => mission.active)
  const available = availableMissions(data).length > 0
  return `<section class="ops-panel ops-waiting">
    ${panelHeader(`${waiting.length} ${waiting.length === 1 ? 'agent' : 'agents'} waiting for a mission`,
      available ? 'Assign an available mission or write one for them.' : 'Create a mission or reuse one from the catalog.')}
    <ul class="ops-waiting-list">${waiting.map(player => `<li>
      <strong>${esc(player.name)}</strong>
      <div class="ops-actions">
        ${button('Create and assign', 'mission-for-player', { id: player.id, icon: 'plus', kind: 'primary' })}
        ${button(available ? 'Assign random mission' : 'Reuse a random mission', 'waiting-random', { id: player.id, icon: 'folder', disabled: !active })}
      </div></li>`).join('')}</ul>
  </section>`
}

function overview(data) {
  const { alive, completed, approved, rejected, eliminated } = count(data)
  const { phase } = data.round
  return `<section class="ops-hero">
      <div class="ops-hero-copy"><p class="ops-overline">JHU ASA · Christmas 2026</p>
        <h1 tabindex="-1">Mission Control</h1>
        <p>${{
          lobby: 'Get your agents registered and their missions ready.',
          live: 'The agents are undercover. Keep an eye on incoming reports.',
          paused: 'Gameplay is on hold. Agents keep their lives and mission progress.',
          ended: 'The round is over. Review the final results or prepare a new round.',
        }[phase] || ''}</p>
        <a class="button ops-hero-button" href="#game">${symbol('game')}Game controls</a>
      </div>
      <img src="/art/agent.svg" alt="" class="ops-hero-art">
    </section>
    ${waitingPanel(data)}
    <div class="ops-stat-grid">
      ${stat('Registered players', data.players.length, 'people')}
      ${stat('Alive', alive, 'heart', 'green')}
      ${stat('Missions complete', completed, 'check', 'gold')}
      ${stat('Pending reports', state.pendingCount, 'flag', 'red')}
    </div>
    <div class="ops-grid-two ops-overview-grid">
      <section class="ops-panel">
        ${panelHeader('Round activity', null, '<a href="#activity" class="ops-text-link">View activity log</a>')}
        ${data.audit.length ? auditRows(data.audit.slice(0, 5)) : empty('The workshop is quiet', 'Activity will appear here once the game is set up.', 'clock')}
      </section>
      <section class="ops-panel">
        ${panelHeader('Round snapshot')}
        <dl class="ops-brief"><div><dt>Eliminated agents</dt><dd>${eliminated}</dd></div>
          <div><dt>Unfinished missions</dt><dd>${data.players.length - completed}</dd></div>
          <div><dt>Approved reports</dt><dd>${approved}</dd></div>
          <div><dt>Rejected reports</dt><dd>${rejected}</dd></div></dl>
        <a href="#reports" class="button secondary">${symbol('flag')}Open reports inbox</a>
      </section>
    </div>`
}

function playerRows() {
  const filtered = state.data.players.filter(player => {
    const query = state.playerSearch.trim().toLowerCase()
    const found = !query || player.name.toLowerCase().includes(query) || player.mission?.title.toLowerCase().includes(query)
    const status = state.playerStatus
    return found && (status === 'all' || player.status === status ||
      (status === 'complete' && player.mission && player.progress >= player.mission.target))
  })
  const compareName = (a, b) => a.name.localeCompare(b.name)
  const compareCreatedAt = (a, b) => new Date(b.createdAt) - new Date(a.createdAt) || compareName(a, b)
  const compareRecent = (a, b) => new Date(b.lastActive || b.createdAt) - new Date(a.lastActive || a.createdAt) || compareName(a, b)
  filtered.sort({ name: compareName, recent: compareRecent, newest: compareCreatedAt }[state.playerSort])

  if (!filtered.length) return empty('No players found', 'Registered players appear here. Try changing the search or filters.', 'people')
  return `<div class="ops-table-wrap"><table class="ops-table">
    <thead><tr><th scope="col">Agent</th><th scope="col">Assigned mission</th><th scope="col">Progress</th><th scope="col">Lives</th>
      <th scope="col">Status</th><th scope="col">Registered</th><th scope="col">Last active</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
    <tbody>${filtered.map(player => `<tr>
      <th scope="row">${esc(player.name)}</th>
      <td>${esc(player.mission?.title || 'Unassigned')}</td>
      <td>${player.mission ? `${player.progress}/${player.mission.target}
        ${player.progress >= player.mission.target ? badge('approved', 'Complete') : ''}` : '—'}</td>
      <td><span class="ops-lives">${symbol('heart')}${player.lives}</span></td>
      <td>${badge(player.status)}</td>
      <td>${date(player.createdAt)}</td><td>${date(player.lastActive)}</td>
      <td>${button('Manage', 'player-open', { id: player.id })}</td>
    </tr>`).join('')}</tbody>
  </table></div>`
}

function players(data) {
  return `${pageHeader('Players', 'Manage registered agents, lives and assignments.', button('Assign unassigned players', 'assign-all', { icon: 'folder', disabled: !canAssignMissions(data) }))}
    <div data-waiting-panel>${waitingPanel(data)}</div>
    <section class="ops-panel">
      <div class="ops-filters">
        <label class="ops-search">${symbol('search')}<span class="sr-only">Search players</span>
          <input type="search" placeholder="Search name or mission" data-filter="playerSearch" value="${esc(state.playerSearch)}"></label>
        <label><span class="sr-only">Player status</span><select data-filter="playerStatus">
          ${[['all', 'All statuses'], ['alive', 'Alive'], ['eliminated', 'Eliminated'], ['complete', 'Mission complete']].map(([key, caption]) =>
            `<option value="${key}" ${key === state.playerStatus ? 'selected' : ''}>${caption}</option>`).join('')}
        </select></label>
        <label><span class="sr-only">Sort players</span><select data-filter="playerSort">
          ${[['name', 'Name (A–Z)'], ['newest', 'Newest registered'], ['recent', 'Recently active']].map(([key, caption]) =>
            `<option value="${key}" ${key === state.playerSort ? 'selected' : ''}>${caption}</option>`).join('')}
        </select></label>
      </div>
      <div data-player-rows>${playerRows()}</div>
    </section>`
}

function missions(data) {
  return `${pageHeader('Mission catalog', 'Manage the pool of assignments across rounds.', button('Add mission', 'mission-new', { icon: 'plus', kind: 'primary' }))}
    <section class="ops-panel">
      ${panelHeader('Mission assignment')}
      <form class="ops-form ops-mission-policy" data-form="mission-policy" data-preserve>
        <label class="ops-toggle"><input type="checkbox" name="uniqueMissions" ${data.round.uniqueMissions ? 'checked' : ''}>
          <span><b>Require unique missions</b><small>Assign each catalog mission once per round. Staff can choose to reuse one for a waiting player.</small></span></label>
        <p class="ops-form-error" role="alert"></p>
        <button type="submit" class="button secondary">Save mission settings</button>
      </form>
    </section>
    ${waitingPanel(data)}
    <section class="ops-panel">
      ${panelHeader('Saved missions', `${data.missions.filter(mission => mission.active).length} active · ${data.missions.length} total`)}
      ${data.missions.length ? `<div class="ops-table-wrap"><table class="ops-table">
        <thead><tr><th scope="col">Mission</th><th scope="col">Target</th><th scope="col">Assigned</th><th scope="col">Availability</th>
        <th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>${data.missions.map(mission => `<tr>
          <th scope="row"><div class="ops-mission-name">${esc(mission.title)}<span>${esc(mission.description)}</span></div></th>
          <td>${mission.target}</td><td>${mission.assigned}</td><td>${mission.active ? badge('active', 'Active') : badge('archived', 'Archived')}</td>
          <td><div class="ops-actions">${button('Edit', 'mission-open', { id: mission.id })}
            ${mission.active ? button('Archive', 'mission-archive', { id: mission.id, kind: 'ghost' }) : ''}</div></td>
        </tr>`).join('')}</tbody>
      </table></div>` : empty('The catalog is empty', 'Add a mission with a short title and a completion target.')}
    </section>`
}

function reportRows(data) {
  const rank = report => report.status === 'pending' ? 0 : 1
  const reports = data.reports.filter(report => state.reportStatus === 'all' || report.status === state.reportStatus)
    .sort((a, b) => rank(a) - rank(b) || new Date(b.createdAt) - new Date(a.createdAt))
  const mayReview = data.round.phase === 'live' || data.round.phase === 'paused'
  if (!reports.length) return empty('No reports here', 'Reports will appear here when agents submit their guesses.', 'flag')
  return `<div class="ops-report-grid">${reports.map(report => `<article class="ops-report">
    <header>
      <div><p class="ops-overline">Report ${esc(report.id.slice(0, 6))} · ${date(report.createdAt)}</p>
      <h3>${esc(report.reporterName)} reported ${esc(report.targetName)}</h3></div>
      ${badge(report.status)}
    </header>
    <dl class="ops-report-details"><div><dt>Suspected mission</dt><dd>${esc(report.guessedTitle || 'Unavailable')}${report.guessedDescription ? `<span>${esc(report.guessedDescription)}${report.guessedTarget ? ` · Goal of ${esc(report.guessedTarget)}` : ''}</span>` : ''}</dd></div>
      <div><dt>Actual mission</dt><dd>${esc(report.actualTitle || 'Unassigned')}${report.actualDescription ? `<span>${esc(report.actualDescription)}${report.actualTarget ? ` · Goal of ${esc(report.actualTarget)}` : ''}</span>` : ''}</dd></div></dl>
    ${report.reason || report.decisionNote ? `<p class="ops-reason">${esc(report.reason || report.decisionNote)}</p>` : ''}
    <footer>${typeof report.match === 'boolean' ? badge(report.match ? 'approved' : 'archived', report.match ? 'Mission match' : 'Different missions') : ''}
      ${report.status === 'pending' && mayReview ? `<div class="ops-actions">
        ${button('Reject', 'reject', { id: report.id, kind: 'secondary' })}
        ${button('Approve', 'approve', { id: report.id, kind: 'primary' })}
      </div>` : ''}</footer>
  </article>`).join('')}</div>`
}

function reports(data) {
  const filters = [['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['cancelled', 'Cancelled'], ['all', 'All reports']]
  return `${pageHeader('Reports inbox', 'Compare each guess with the actual assignment and record your verdict.')}
    <section class="ops-panel">
      <div class="ops-tabs" role="group" aria-label="Filter reports">
        ${filters.map(([id, caption]) => `<button type="button" data-action="report-filter" data-id="${id}" aria-pressed="${id === state.reportStatus}">
          ${caption}${id === 'pending' ? ` <span>${state.pendingCount}</span>` : ''}</button>`).join('')}
      </div>
      ${reportRows(data)}
    </section>`
}

function game(data) {
  const { phase, startedAt, endedAt } = data.round
  const activeMissions = data.missions.filter(mission => mission.active).length
  const assigned = data.players.filter(player => player.mission).length
  const cta = {
    lobby: button('Start game', 'start', { kind: 'primary', icon: 'game', disabled: !activeMissions }),
    live: button('Pause game', 'pause', { icon: 'clock' }),
    paused: button('Resume game', 'resume', { kind: 'primary', icon: 'game' }),
    ended: '',
  }
  return `${pageHeader('Game control', 'Start, pause or end the current round.')}
    <div class="ops-grid-two">
      <section class="ops-panel">
        ${panelHeader('Current round', null, badge(phase, phaseName[phase]))}
        <ol class="ops-round-steps" aria-label="Round phases">${Object.entries(phaseName).map(([id, caption]) =>
          `<li ${id === phase ? 'aria-current="step"' : ''}><span></span>${caption}</li>`).join('')}</ol>
        <dl class="ops-brief"><div><dt>Started</dt><dd>${date(startedAt)}</dd></div>
        <div><dt>Ended</dt><dd>${date(endedAt)}</dd></div></dl>
        <div class="ops-actions">${cta[phase]}
          ${['live', 'paused'].includes(phase) ? button('End game and reveal winners', 'end', { kind: 'danger' }) : ''}
        </div>
      </section>
      <section class="ops-panel">
        ${panelHeader('Round readiness')}
        <dl class="ops-brief"><div><dt>Registered players</dt><dd>${data.players.length}</dd></div>
          <div><dt>Players with assignments</dt><dd>${assigned}</dd></div>
          <div><dt>Active missions</dt><dd>${activeMissions}</dd></div>
          <div><dt>Late registration</dt><dd>${data.round.lateJoin ? 'Open' : 'Closed'}</dd></div></dl>
        ${activeMissions ? '' : '<p class="ops-notice">Add at least one active mission to start the game.</p>'}
      </section>
    </div>
    ${data.results ? `<section class="ops-panel">
      ${panelHeader('Final results', `${data.results.winners.length} eligible ${data.results.winners.length === 1 ? 'winner' : 'winners'}`)}
      ${data.results.winners.length ? `<ul class="ops-winner-list">${data.results.winners.map(winner =>
        `<li><b>${esc(winner.name)}</b><span>${esc(typeof winner.mission === 'string' ? winner.mission : winner.mission?.title || winner.mission?.description || '')}</span></li>`).join('')}</ul>` : '<p>No agents completed their mission and survived this round.</p>'}
    </section>` : ''}
    <section class="ops-panel ops-reset-panel">
      ${panelHeader('New round', 'Save the round summary and return to the lobby. The mission catalog carries forward.', button('Set up new round', 'reset-open', { icon: 'game' }))}
    </section>
    ${roundHistory(data.history)}`
}

function roundHistory(history) {
  if (!history?.length) return ''
  return `<section class="ops-panel">${panelHeader('Round history')}
    <div class="ops-table-wrap"><table class="ops-table">
      <thead><tr><th scope="col">Archived</th><th scope="col">Final phase</th><th scope="col">Winners</th><th scope="col">Reports settled</th></tr></thead>
      <tbody>${history.map(round => `<tr>
        <th scope="row">${date(round.archivedAt)}</th><td>${badge(round.phase)}</td>
        <td>${round.results ? esc(round.results.winners.map(winner => winner.name).join(', ') || 'No winners') : 'Round not finalized'}</td>
        <td>${round.reports.approved} approved · ${round.reports.rejected} rejected</td>
      </tr>`).join('')}</tbody>
    </table></div></section>`
}

function eventLabel(event) {
  if (event.title) return event.title
  return {
    compromised: 'Mission compromised', eliminated: 'Agent eliminated',
    announcement: 'Announcement', countdown: 'Countdown', winners: 'Winners', idle: 'Return to idle',
  }[event.type] || label(event.type)
}

function presentation(data) {
  return `${pageHeader('Presentation', 'Send announcements and manage the display queue.', openProjector('primary'))}
    <div class="ops-grid-two">
      <section class="ops-panel ops-presentation-controls">
        ${panelHeader('Send announcement')}
        <form class="ops-form" data-form="announcement" data-preserve>
          <label class="field ops-field"><span>Title</span><input name="title" maxlength="90" required placeholder="A message from Santa"></label>
          <label class="field ops-field"><span>Message</span><textarea name="message" maxlength="260" rows="3" placeholder="Optional"></textarea></label>
          <p class="ops-form-error" role="alert"></p>
          <button type="submit" class="button primary">${symbol('mail')}Queue announcement</button>
        </form>
      </section>
      <section class="ops-panel ops-presentation-controls">
        ${panelHeader('Screen controls')}
        <form class="ops-form ops-countdown-form" data-form="countdown" data-preserve>
          <label class="field ops-field"><span>Countdown in seconds</span><input name="seconds" type="number" min="1" max="600" required value="30"></label>
          <button type="submit" class="button secondary">${symbol('clock')}Queue countdown</button>
          <p class="ops-form-error" role="alert"></p>
        </form>
        <div class="ops-actions">
          ${button('Game paused screen', 'paused-screen', { icon: 'screen' })}
          ${button('Return to idle', 'screen-idle')}
          ${data.results ? button('Replay winner reveal', 'winners', { icon: 'spark' }) : ''}
        </div>
        <a href="#settings" class="ops-text-link">Adjust reveal delay and display time</a>
      </section>
    </div>
    <section class="ops-panel">
      ${panelHeader('Display history', 'Queued reveals play in order. Replay sends an event back to the queue.')}
      <div data-event-history>${eventHistory(data)}</div>
    </section>`
}

function eventHistory(data) {
  if (!data.events.length) return empty('Nothing queued yet', 'Announcements and eliminations will appear here.', 'screen')
  return `<div class="ops-table-wrap"><table class="ops-table">
    <thead><tr><th scope="col">Event</th><th scope="col">Reveal</th><th scope="col">Status</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
    <tbody>${[...data.events].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(event =>
      `<tr><th scope="row">${esc(eventLabel(event))}${event.name ? ` · ${esc(event.name)}` : ''}</th>
        <td>${date(event.startAt)}</td><td data-event-status="${esc(event.id)}">${badge(displayStatus(event))}</td>
        <td>${button('Replay', 'replay', { id: event.id })}</td></tr>`
    ).join('')}</tbody>
  </table></div>`
}

function displayStatus(event) {
  const now = Date.now()
  if (event.status === 'cancelled' || event.status === 'delivered') return event.status
  if (new Date(event.endAt).valueOf() <= now) return 'delivered'
  if (new Date(event.startAt).valueOf() <= now) return 'showing'
  return 'queued'
}

function activity(data) {
  return `${pageHeader('Activity log', 'Review staff changes and game events across rounds.')}
    <section class="ops-panel">
      ${panelHeader('Recent activity')}
      ${data.audit.length ? auditRows(data.audit) : empty('No activity yet', 'Staff actions will appear here.', 'activity')}
    </section>`
}

function settings(data) {
  return `${pageHeader('Settings', 'Set registration and reveal timing for the current round.')}
    <section class="ops-panel ops-settings">
      ${panelHeader('Round and presentation settings')}
      <form class="ops-form" data-form="settings" data-preserve>
        <label class="ops-toggle"><input name="lateJoin" type="checkbox" ${data.round.lateJoin ? 'checked' : ''}>
          <span><b>Allow late registration</b><small>New players can join after the round starts.</small></span></label>
        <label class="field ops-field"><span>Elimination reveal delay (seconds)</span>
          <input name="delay" type="number" min="0" max="60" value="${data.round.delay}" required></label>
        <label class="field ops-field"><span>Reveal display time (seconds)</span>
          <input name="duration" type="number" min="2" max="60" value="${data.round.duration}" required></label>
        <p class="ops-form-error" role="alert"></p>
        <button type="submit" class="button primary">${symbol('check')}Save settings</button>
      </form>
    </section>
    ${data.demoAllowed ? `<section class="ops-panel">${panelHeader('Demo data', 'Add simulated participants and sample missions to this environment.', button('Load demo data', 'seed', { icon: 'spark' }))}</section>` : ''}`
}

const views = { overview, players, missions, reports, game, presentation, activity, settings }

function renderSection({ force = false, focus = false } = {}) {
  const view = app.querySelector('#ops-view')
  if (!view || !state.data) return
  if (!force && view.dataset.section === state.current) {
    if (state.current === 'players') {
      const rows = view.querySelector('[data-player-rows]')
      const assign = view.querySelector('[data-action="assign-all"]')
      if (assign) assign.disabled = !canAssignMissions(state.data)
      const waiting = view.querySelector('[data-waiting-panel]')
      if (waiting) waiting.innerHTML = waitingPanel(state.data)
      if (rows) {
        const focusedId = rows.contains(document.activeElement) ? document.activeElement.dataset.id : null
        rows.innerHTML = playerRows()
        if (focusedId) [...rows.querySelectorAll('[data-id]')].find(el => el.dataset.id === focusedId)?.focus({ preventScroll: true })
      }
      return
    }
    if (view.querySelector('[data-preserve][data-dirty="true"]') || document.activeElement?.closest('[data-preserve]')) {
      const queue = view.querySelector('[data-event-history]')
      if (queue) queue.innerHTML = eventHistory(state.data)
      return
    }
  }
  const active = document.activeElement
  const restore = view.contains(active) && !focus ? active.dataset : null
  view.dataset.section = state.current
  view.innerHTML = views[state.current](state.data)
  for (const form of view.querySelectorAll('form')) form.dataset.roundId = state.data.round.id
  if (focus) view.querySelector('h1')?.focus()
  else if (restore?.action) {
    [...view.querySelectorAll('[data-action]')].find(el => el.dataset.action === restore.action && el.dataset.id === restore.id)?.focus({ preventScroll: true })
  }
}

function showData(data) {
  if (!data?.round) return
  if (state.data && typeof data.revision === 'number' && data.revision < state.data.revision) return

  const previous = state.pendingCount
  const previousWaiting = new Set(waitingPlayers(state.data).map(player => player.id))
  const initial = state.auth !== 'staff'
  const changed = initial || typeof data.revision !== 'number' || data.revision !== state.data?.revision
  state.data = data
  state.auth = 'staff'
  state.offline = false
  state.pendingCount = data.reports.filter(report => report.status === 'pending').length
  if (initial) makeShell()
  if (!initial && state.pendingCount > previous) toast(`${state.pendingCount - previous} new ${state.pendingCount - previous === 1 ? 'report' : 'reports'} to review.`)
  const newWaiting = waitingPlayers(data).filter(player => !previousWaiting.has(player.id))
  if (!initial && newWaiting.length) toast(newWaiting.length === 1 ? `${newWaiting[0].name} is waiting for a mission.` : `${newWaiting.length} agents are waiting for missions.`)
  updateShell()
  if (changed) renderSection()
}

const unauthorized = error => error?.status === 401 || error?.statusCode === 401

function showOffline(error) {
  if (unauthorized(error)) {
    stopWatch?.()
    stopWatch = undefined
    if (state.auth === 'login') return
    state.auth = 'login'
    state.data = null
    signin()
    return
  }
  state.offline = true
  if (state.auth === 'loading') {
    signin()
    const feedback = app.querySelector('.ops-form-error')
    feedback.textContent = 'Could not reach the game. Check your connection and try again.'
  }
  updateShell()
}

function startWatch() {
  stopWatch?.()
  stopWatch = watch('/api/staff', showData, showOffline)
}

function dialog(title, contents) {
  const el = app.querySelector('#ops-dialog')
  el.setAttribute('aria-label', title)
  el.innerHTML = `<div class="ops-dialog-head"><h2>${esc(title)}</h2>
    <button type="button" class="button ghost ops-icon-button" data-action="dialog-close" aria-label="Close dialog">${symbol('clear')}</button></div>
    <div class="ops-dialog-content">${contents}</div>`
  for (const form of el.querySelectorAll('form')) form.dataset.roundId = state.data.round.id
  if (!el.open) el.showModal()
}

function createMission(mission, player) {
  dialog(player ? `New mission for ${player.name}` : mission ? 'Edit mission' : 'Add mission', `
    <form data-form="mission" class="ops-form" data-id="${esc(mission?.id || '')}" data-player-id="${esc(player?.id || '')}">
      ${mission?.assigned ? `<p class="ops-notice">${mission.assigned} ${mission.assigned === 1 ? 'player has' : 'players have'} this mission. They’ll keep the version they received. Future assignments use the updated version.</p>` : ''}
      <label class="field ops-field"><span>Title</span><input name="title" minlength="2" maxlength="80" required value="${esc(mission?.title || '')}" placeholder="Christmas Carol Challenge"></label>
      <label class="field ops-field"><span>Description</span>
        <textarea name="description" minlength="5" maxlength="300" rows="3" required placeholder="Convince someone to sing a Christmas carol.">${esc(mission?.description || '')}</textarea></label>
      <label class="field ops-field"><span>Required completions</span><input name="target" type="number" min="1" max="50" value="${mission?.target || (player ? 1 : 3)}" required></label>
      ${player ? '' : `<label class="ops-toggle"><input name="active" type="checkbox" ${mission?.active !== false ? 'checked' : ''}><span><b>Available for random assignment</b></span></label>`}
      <p class="ops-form-error" role="alert"></p>
      <button type="submit" class="button primary">${symbol('check')}${player ? 'Create and assign' : 'Save mission catalog'}</button>
    </form>`)
}

function playerDialog(player) {
  const history = state.data.reports.filter(report => report.reporterId === player.id || report.targetId === player.id)
  const choices = availableMissions(state.data)
  dialog(player.name, `
    <div class="ops-player-line">${badge(player.status)}<span>${esc(player.mission?.title || 'Unassigned')}</span></div>
    ${state.data.round.phase === 'ended' ? '' : `<div class="ops-player-quick ops-actions">
      ${player.lives > 0 ? button('Remove life', 'life-remove', { id: player.id, kind: 'danger', icon: 'heart' }) : ''}
      ${player.lives === 0 ? button('Revive player', 'life-revive', { id: player.id, kind: 'primary', icon: 'heart' }) :
        button('Add life', 'life-add', { id: player.id, icon: 'heart', disabled: player.lives >= 2 })}
    </div>`}
    <form data-form="player" class="ops-form" data-id="${esc(player.id)}">
      <label class="field ops-field"><span>Player name</span><input name="name" value="${esc(player.name)}" minlength="2" maxlength="35" required></label>
      ${state.data.round.phase === 'ended' ? '' : `<div class="ops-form-grid">
        <label class="field ops-field"><span>Lives (0–2)</span><input name="lives" type="number" min="0" max="2" value="${player.lives}" required></label>
        ${player.mission ? `<label class="field ops-field"><span>Mission progress</span>
          <input name="progress" type="number" min="0" max="${player.mission.target}" value="${player.progress}" required></label>` : ''}
      </div>`}
      <label class="field ops-field"><span>Replacement PIN</span><input name="pin" type="password" inputmode="numeric" autocomplete="off"
        pattern="[0-9]{4}" maxlength="4" placeholder="Leave blank to keep the current PIN"></label>
      <p class="ops-form-error" role="alert"></p>
      <button type="submit" class="button primary">${symbol('check')}Save player</button>
    </form>
    ${state.data.round.phase === 'ended' ? '' : `<hr>
      <form data-form="assignment" data-id="${esc(player.id)}" class="ops-form">
        <label class="field ops-field"><span>Change assignment</span><select name="missionId">
          <option value="">Choose randomly</option>${choices.map(mission => `<option value="${esc(mission.id)}">${esc(mission.title)}</option>`).join('')}
        </select></label>
        <p class="ops-form-error" role="alert"></p>
        <button type="submit" class="button secondary" ${choices.length ? '' : 'disabled'}>Reassign mission</button>
      </form>`}
    <hr>
    <section class="ops-dialog-history"><h3>Report history</h3>
      ${history.length ? `<ul class="ops-feed">${history.map(report => `<li><b>${esc(report.reporterName)} → ${esc(report.targetName)}</b>
        ${badge(report.status)}</li>`).join('')}</ul>` : '<p>No reports involving this player.</p>'}
    </section>
    <hr>
    ${button('Remove participant', 'player-remove', { id: player.id, kind: 'danger' })}`)
}

function resetDialog() {
  dialog('Set up new round', `<p>Final results and report totals carry into the round history. The new lobby starts with 2 lives per player and zero mission progress.</p>
    <form data-form="reset" class="ops-form">
      <label class="ops-toggle"><input type="checkbox" name="keepPlayers" checked><span><b>Keep registered players</b><small>Players can continue using their existing PINs.</small></span></label>
      <label class="ops-toggle"><input type="checkbox" name="randomize" checked><span><b>Assign missions now</b><small>Otherwise, missions are assigned when the next round starts.</small></span></label>
      <p class="ops-form-error" role="alert"></p>
      <button type="submit" class="button danger">Create new round</button>
    </form>`)
}

async function action(actionName, payload = {}, done = '', form) {
  if (state.busy) return false
  state.busy = true
  const submit = form?.querySelector('button[type=submit]')
  const errorText = form?.querySelector('.ops-form-error')
  if (submit) submit.disabled = true
  if (errorText) errorText.textContent = ''

  try {
    await api('/api/staff/action', { action: actionName, roundId: form?.dataset.roundId || state.data.round.id, ...payload })
    if (form) delete form.dataset.dirty
    if (done) toast(done)
    try { showData(await api('/api/staff')) } catch (error) { showOffline(error) }
    renderSection({ force: Boolean(form?.isConnected && form.dataset.preserve !== undefined) })
    return true
  } catch (error) {
    if (errorText) errorText.textContent = error.message
    else toast(error.message, 'error')
    if (unauthorized(error)) showOffline(error)
    return false
  } finally {
    state.busy = false
    if (submit) submit.disabled = false
  }
}

async function confirmed(title, message, accept, danger = false) {
  return confirmAction({ title, message, accept, danger })
}

function reportDecision(id, approved) {
  const report = state.data.reports.find(item => item.id === id)
  if (!report) return
  const title = approved ? 'Approve this report?' : 'Reject this report?'
  const message = approved
    ? `${report.targetName} will be eliminated and their mission will be revealed on the projector.`
    : `${report.reporterName} will lose one life. If it was their last life, they will be eliminated.`
  return confirmed(title, message, approved ? 'Approve report' : 'Reject report', true).then(ok => {
    if (ok) return action('review', { id, decision: approved ? 'approved' : 'rejected' }, `Report ${approved ? 'approved' : 'rejected'}.`)
  })
}

async function changeLife(id, adjustment) {
  const player = state.data.players.find(item => item.id === id)
  if (!player || (adjustment === 1 && player.lives >= 2) || (adjustment === -1 && player.lives < 1)) return
  const lives = Math.max(0, Math.min(2, adjustment + player.lives))
  if (lives === 0 && !await confirmed('Eliminate this player?', `This will remove ${player.name}’s last life.`, 'Remove life', true)) return
  if (await action('playerEdit', { id, lives }, player.lives === 0 ? 'Player revived.' : 'Lives updated.')) {
    const updated = state.data.players.find(item => item.id === id)
    if (updated) playerDialog(updated)
  }
}

const clickHandlers = {
  menu() {
    const sidebar = app.querySelector('.ops-sidebar')
    const expanded = sidebar.classList.toggle('ops-sidebar--open')
    app.querySelector('.ops-menu').setAttribute('aria-expanded', String(expanded))
  },
  async logout() {
    try {
      await api('/api/staff/logout', {})
      stopWatch?.()
      stopWatch = undefined
      state.auth = 'login'
      state.data = null
      signin()
    } catch (error) {
      toast(error.message, 'error')
    }
  },
  'dialog-close'() { app.querySelector('#ops-dialog')?.close() },
  'mission-new'() { createMission() },
  'mission-for-player'(id) {
    const player = waitingPlayers(state.data).find(item => item.id === id)
    if (player) createMission(null, player)
  },
  async 'waiting-random'(id) {
    const { data } = state
    const player = waitingPlayers(data).find(item => item.id === id)
    if (!player) return
    const allowReuse = !availableMissions(data).length
    if (allowReuse && !await confirmed('Reuse an assigned mission?', `${player.name} will share a mission with another player.`, 'Reuse mission')) return
    await action('playerAssignWaiting', { id, allowReuse, roundId: data.round.id }, 'Mission assigned.')
  },
  'mission-open'(id) {
    const found = state.data.missions.find(item => item.id === id)
    if (found) createMission(found)
  },
  async 'mission-archive'(id) {
    if (await confirmed('Archive mission?', 'This mission will be removed from the assignment pool. Existing assignments and reports stay on record.', 'Archive mission')) {
      await action('missionArchive', { id }, 'Mission archived.')
    }
  },
  'player-open'(id) {
    const found = state.data.players.find(item => item.id === id)
    if (found) playerDialog(found)
  },
  'life-add'(id) { return changeLife(id, 1) },
  'life-remove'(id) { return changeLife(id, -1) },
  'life-revive'(id) { return changeLife(id, 2) },
  async 'player-remove'(id) {
    const player = state.data.players.find(item => item.id === id)
    if (player && await confirmed(`Remove ${player.name}?`, 'This player will be signed out and removed from the round. Existing reports stay on record.', 'Remove player', true)) {
      if (await action('playerRemove', { id }, 'Player removed.')) app.querySelector('#ops-dialog')?.close()
    }
  },
  async 'assign-all'() {
    if (await confirmed('Assign unassigned players?', state.data.round.uniqueMissions ? 'Players will receive unused missions while supplies last.' : 'Each unassigned player will receive a random active mission.', 'Assign missions')) {
      await action('assignAll', {}, 'Unassigned players updated.')
    }
  },
  'report-filter'(id) {
    state.reportStatus = id
    renderSection({ force: true })
    app.querySelector(`[data-action="report-filter"][data-id="${id}"]`)?.focus()
  },
  approve(id) { return reportDecision(id, true) },
  reject(id) { return reportDecision(id, false) },
  async start() {
    const roundId = state.data.round.id
    const players = state.data.players.length
    const missions = state.data.missions.filter(item => item.active).length
    if (await confirmed('Start the game?', `${players} registered · ${missions} active missions. Unassigned agents will receive their missions and gameplay will open.`, 'Start game')) {
      await action('phase', { phase: 'live', roundId }, 'The game is live.')
    }
  },
  async pause() {
    const roundId = state.data.round.id
    if (await confirmed('Pause the game?', 'Players will be unable to submit reports or update progress until you resume.', 'Pause game')) {
      await action('phase', { phase: 'paused', roundId }, 'Game paused.')
    }
  },
  resume() { return action('phase', { phase: 'live' }, 'Game resumed.') },
  async end() {
    const roundId = state.data.round.id
    if (await confirmed('End game and reveal winners?', 'The round’s results will be saved and the winner reveal will be queued on the projector.', 'End game', true)) {
      await action('phase', { phase: 'ended', roundId }, 'Game ended. Winner reveal queued.')
    }
  },
  'reset-open'() { resetDialog() },
  async 'screen-idle'() {
    if (await confirmed('Return projector to idle?', 'This clears the current slide and queued custom announcements. Queued eliminations will still play.', 'Return to idle')) {
      await action('screenIdle', {}, 'Idle screen restored.')
    }
  },
  'paused-screen'() { return action('announce', { title: 'Game paused', message: 'Please wait for Santa’s signal to resume.' }, 'Pause announcement queued.') },
  replay(id) { return action('replay', { id }, 'Replay queued.') },
  winners() { return action('revealWinners', {}, 'Winner replay queued.') },
  async seed() {
    if (await confirmed('Load demo data?', 'This adds sample missions and fictional players to the demo environment.', 'Load demo data')) {
      await action('seed', {}, 'Demo data loaded.')
    }
  },
}

async function login(form, fields) {
  const submit = form.querySelector('button[type=submit]')
  const feedback = form.querySelector('.ops-form-error')
  submit.disabled = true
  feedback.textContent = ''
  try {
    await api('/api/staff/login', { password: fields.password })
    showData(await api('/api/staff'))
    startWatch()
    app.querySelector('h1')?.focus()
  } catch (error) {
    feedback.textContent = error.message
  } finally {
    submit.disabled = false
  }
}

const formHandlers = {
  login,
  async mission(form, fields) {
    const playerId = form.dataset.playerId || undefined
    const saved = await action(playerId ? 'missionAssignNew' : 'missionSave', {
      id: form.dataset.id || undefined,
      playerId,
      title: fields.title,
      description: fields.description,
      target: Number(fields.target),
      active: fields.active === 'on',
    }, playerId ? 'New mission assigned.' : 'Mission catalog saved.', form)
    if (saved) {
      app.querySelector('#ops-dialog')?.close()
      renderSection({ force: true })
    }
  },
  'mission-policy'(form, fields) {
    return action('missionPolicy', { uniqueMissions: fields.uniqueMissions === 'on' }, 'Mission settings saved.', form)
  },
  async player(form, fields) {
    const patch = { id: form.dataset.id }
    if (fields.name !== form.elements.name.defaultValue) patch.name = fields.name
    if (fields.pin) patch.pin = fields.pin
    if (fields.progress !== undefined && fields.progress !== form.elements.progress.defaultValue) patch.progress = Number(fields.progress)
    if (fields.lives !== undefined && fields.lives !== form.elements.lives.defaultValue) patch.lives = Number(fields.lives)
    if (Object.keys(patch).length === 1) return app.querySelector('#ops-dialog')?.close()
    if (patch.lives === 0 && !await confirmed('Eliminate this player?', 'Setting lives to zero eliminates this player from the current round.', 'Eliminate player', true)) return
    if (patch.pin && !await confirmed('Reset this player’s PIN?', 'Existing sessions will be signed out. Share the replacement PIN privately with the player.', 'Reset PIN')) return
    if (await action('playerEdit', patch, 'Player updated.', form)) app.querySelector('#ops-dialog')?.close()
  },
  async assignment(form, fields) {
    const current = state.data.players.find(item => item.id === form.dataset.id)
    if (current?.mission && !await confirmed('Replace the current mission?', 'This will set their mission progress to zero. The player will see the new assignment immediately.', 'Replace assignment', true)) return
    if (await action('playerAssign', { id: form.dataset.id, missionId: fields.missionId || null }, 'Mission assigned.', form)) app.querySelector('#ops-dialog')?.close()
  },
  async reset(form, fields) {
    const keepPlayers = fields.keepPlayers === 'on'
    const randomize = keepPlayers && fields.randomize === 'on'
    const message = keepPlayers
      ? 'Registered players keep their accounts. Individual reports will be cleared. Final results and report totals will be saved.'
      : 'All participants will be signed out and removed from the roster. Final results and report totals will be saved.'
    if (!await confirmed(keepPlayers ? 'Create new round?' : 'Create new round and remove all participants?', message, 'Create round', true)) return
    if (await action('reset', { keepPlayers, randomize }, 'New round created.', form)) {
      app.querySelector('#ops-dialog')?.close()
      renderSection({ force: true })
    }
  },
  announcement(form, fields) { return action('announce', fields, 'Announcement queued.', form) },
  countdown(form, fields) { return action('countdown', { seconds: Number(fields.seconds) }, 'Countdown queued.', form) },
  settings(form, fields) {
    return action('settings', {
      lateJoin: fields.lateJoin === 'on', delay: Number(fields.delay), duration: Number(fields.duration),
    }, 'Settings saved.', form)
  },
}

app.addEventListener('click', async event => {
  if (event.target.closest('.ops-nav a')) {
    app.querySelector('.ops-sidebar')?.classList.remove('ops-sidebar--open')
    app.querySelector('.ops-menu')?.setAttribute('aria-expanded', 'false')
  }
  const target = event.target.closest('button[data-action]')
  if (!target || state.busy) return
  const handler = clickHandlers[target.dataset.action]
  if (!handler) return
  try { await handler(target.dataset.id) } catch (error) { toast(error.message, 'error') }
  updateShell()
  if (state.current !== 'reports' && target.dataset.action !== 'menu') renderSection()
})

app.addEventListener('submit', async event => {
  const form = event.target
  const handler = formHandlers[form.dataset.form]
  if (!handler) return
  event.preventDefault()
  if (state.busy) return
  try { await handler(form, Object.fromEntries(new FormData(form))) } catch (error) {
    form.querySelector('.ops-form-error').textContent = error.message
  }
  renderSection()
})

app.addEventListener('input', event => {
  const target = event.target
  const form = target.closest('[data-preserve]')
  if (form) form.dataset.dirty = 'true'
  if (!target.dataset.filter) return
  state[target.dataset.filter] = target.value
  const rows = app.querySelector('[data-player-rows]')
  if (rows) rows.innerHTML = playerRows()
})

window.addEventListener('hashchange', () => {
  state.current = getSection()
  app.querySelector('.ops-sidebar')?.classList.remove('ops-sidebar--open')
  app.querySelector('.ops-menu')?.setAttribute('aria-expanded', 'false')
  updateShell()
  renderSection({ force: true, focus: true })
  window.scrollTo({ top: 0 })
})

loading()
startWatch()
window.setInterval(() => {
  if (state.current !== 'presentation' || !state.data) return
  const statuses = new Map(state.data.events.map(event => [event.id, displayStatus(event)]))
  for (const cell of app.querySelectorAll('[data-event-status]')) {
    const status = statuses.get(cell.dataset.eventStatus)
    if (status && label(status) !== cell.textContent) cell.innerHTML = badge(status)
  }
}, 1000)
