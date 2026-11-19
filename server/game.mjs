const HASH_ITERATIONS = 100_000;
const ABSOLUTE_MAX_PLAYERS = 180;
const MAX_STATE_BYTES = 1_800_000;
const ENCODER = new TextEncoder();
const SESSION_AGES = { player: 36 * 60 * 60, staff: 12 * 60 * 60, screen: 24 * 60 * 60 };
const COOKIE_NAMES = { player: 'santa_player', staff: 'santa_staff', screen: 'santa_screen' };
const DEMO_PIN = '2468';
const DEMO_PLAYERS = ['Jordan', 'Taylor', 'Alex', 'Maya', 'Chris'];
const DEMO_MISSIONS = [
  ['Christmas Carol Challenge', 'Convince a different person to sing a line from a holiday song.', 3],
  ['Secret High-Five', 'Get a different person to give you a high-five.', 5],
  ['Wish List Intercept', 'Ask a different person what they want for Christmas.', 4],
  ['Picture Perfect', 'Take a selfie with a different guest who agrees to be in it.', 2],
  ['Ugly Sweater Surveillance', 'Ask a different guest to describe their ideal ugly Christmas sweater.', 3],
  ['Operation Snow Day', 'Ask a different guest to name something they would do on a snow day.', 3],
];

class ApiError extends Error {
  constructor(status, message, headers = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

function fail(status, message) { throw new ApiError(status, message); }
function date(time = Date.now()) { return new Date(time).toISOString(); }
function id() { return crypto.randomUUID(); }
function randomIndex(length) {
  return crypto.getRandomValues(new Uint32Array(1))[0] % length;
}
function hex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
function unhex(value) {
  return Uint8Array.from(value.match(/../g) ?? [], byte => parseInt(byte, 16));
}
async function digest(value) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', ENCODER.encode(value))));
}
function equal(a, b) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let position = 0; position < a.length; position += 1) {
    difference |= a.charCodeAt(position) ^ b.charCodeAt(position);
  }
  return difference === 0;
}
async function pinHash(pin, pepper, salt = hex(crypto.getRandomValues(new Uint8Array(16)))) {
  const buffer = ENCODER.encode(`${pin}\0${pepper ?? ''}`);
  const key = await crypto.subtle.importKey('raw', buffer, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex(salt), iterations: HASH_ITERATIONS }, key, 256);
  return { salt, hash: hex(new Uint8Array(bits)) };
}

function newRound(settings, now) {
  return {
    id: id(), phase: 'lobby', createdAt: date(now), startedAt: null, endedAt: null,
    lateJoin: settings?.lateJoin ?? true, delay: settings?.delay ?? 5, duration: settings?.duration ?? 8,
    states: {}, guessCatalog: {}, reports: [], events: [], results: null, finaleEnabled: false,
  };
}
function initialState() {
  return { round: newRound(null, Date.now()), players: {}, missions: {}, sessions: {}, audit: [], history: [] };
}

async function readState(db) {
  const select = () => db.prepare('SELECT version, payload FROM game_state WHERE id = 1').first();
  let row = await select();
  if (!row) {
    await db.prepare('INSERT OR IGNORE INTO game_state (id, version, payload) VALUES (1, 0, ?)')
      .bind(JSON.stringify(initialState())).run();
    row = await select();
  }
  if (!row) fail(503, 'The game is waking up. Please try again.');
  return { state: JSON.parse(row.payload), version: Number(row.version) };
}

function unchanged(value = { ok: true }) { return { unchanged: true, value }; }

async function change(db, update) {
  // A verdict, life change, report cancellation, and projector cue commit together.
  // A fresh read is required every time another request has changed the record.
  for (let attempt = 0; attempt < 14; attempt += 1) {
    const { state, version } = await readState(db);
    const now = Date.now();
    const result = update(state, now);
    if (result?.unchanged) return result.value;
    const payload = JSON.stringify(state);
    if (payload.length > 450_000 && ENCODER.encode(payload).length > MAX_STATE_BYTES) {
      fail(409, 'This round has reached its storage limit. Ask an organizer to open a new round.');
    }
    const commit = await db.prepare('UPDATE game_state SET version = version + 1, payload = ? WHERE id = 1 AND version = ?')
      .bind(payload, version).run();
    if (commit.meta.changes === 1) return result ?? { ok: true };
    if (attempt >= 3) await new Promise(resolve => setTimeout(resolve, 10 + randomIndex(25)));
  }
  fail(503, 'Many agents are checking in. Please try again.');
}

async function rateLimit(db, key, max, windowMs) {
  const now = Date.now();
  const record = await db.prepare(`INSERT INTO game_limits (key, attempts, window_end) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET
      attempts = CASE WHEN game_limits.window_end <= ? THEN 1 ELSE MIN(game_limits.attempts + 1, ?) END,
      window_end = CASE WHEN game_limits.window_end <= ? THEN excluded.window_end ELSE game_limits.window_end END
    RETURNING attempts, window_end`)
    .bind(await digest(key), now + windowMs, now, max + 1, now).first();
  if (record.attempts > max) {
    const retry = Math.max(1, Math.ceil((record.window_end - now) / 1000));
    throw new ApiError(429, 'Too many attempts. Please wait a few minutes and try again.', { 'Retry-After': String(retry) });
  }
  if (randomIndex(40) === 0) {
    await db.prepare('DELETE FROM game_limits WHERE key IN (SELECT key FROM game_limits WHERE window_end < ? LIMIT 24)').bind(now).run();
  }
}

function network(request) {
  return request.headers.get('CF-Connecting-IP') ?? 'local';
}

function json(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
  });
}

async function body(request) {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
    fail(415, 'Send this request as JSON.');
  }
  const stream = request.body?.getReader();
  if (!stream) fail(400, 'The request is empty.');
  const decoder = new TextDecoder();
  let source = '';
  let total = 0;
  for (;;) {
    const { done, value } = await stream.read();
    if (done) break;
    total += value.length;
    if (total > 12_000) {
      await stream.cancel();
      fail(413, 'The request is too large.');
    }
    source += decoder.decode(value, { stream: true });
  }
  source += decoder.decode();
  let result;
  try { result = JSON.parse(source); } catch { fail(400, 'The request could not be read.'); }
  if (!result || typeof result !== 'object' || Array.isArray(result)) fail(400, 'The request could not be read.');
  return result;
}

function requireSameOrigin(request, url) {
  const origin = request.headers.get('Origin');
  if ((origin && origin !== url.origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
    fail(403, 'Open the game directly to continue.');
  }
}

function cookie(request, role, token = '', maxAge = 0) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE_NAMES[role]}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

async function readSessionKey(request, role) {
  const prefix = `${COOKIE_NAMES[role]}=`;
  const token = request.headers.get('Cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(prefix))?.slice(prefix.length);
  return token && /^[a-f0-9]{64}$/.test(token) ? digest(token) : null;
}

async function newSessionKey() {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  return { token, key: await digest(token) };
}

function session(state, key, role, now, required = true) {
  const current = key && state.sessions[key];
  if (current?.role === role && current.expires > now && (role !== 'player' || state.players[current.playerId])) {
    return current;
  }
  if (required) fail(401, 'Sign in to continue.');
  return null;
}

function storeSession(state, sessionKey, role, now, playerId = null) {
  for (const [key, active] of Object.entries(state.sessions)) {
    if (active.expires <= now) delete state.sessions[key];
  }
  const sameAccount = Object.entries(state.sessions)
    .filter(([, active]) => active.role === role && active.playerId === playerId)
    .sort(([, a], [, b]) => b.expires - a.expires);
  for (const [key] of sameAccount.slice(role === 'player' ? 2 : 7)) delete state.sessions[key];
  state.sessions[sessionKey] = { role, playerId, expires: now + SESSION_AGES[role] * 1000 };
}

function revokePlayerSessions(state, playerId) {
  for (const [key, active] of Object.entries(state.sessions)) {
    if (active.playerId === playerId) delete state.sessions[key];
  }
}

function text(value, label, min, max) {
  if (typeof value !== 'string') fail(400, `Enter ${label}.`);
  const cleaned = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  const length = [...cleaned].length;
  if (length < min || length > max || /[\p{Cc}\p{Cf}]/u.test(cleaned)) {
    fail(400, `Use ${min}–${max} characters for ${label}.`);
  }
  return cleaned;
}

function playerName(value) { return text(value, 'the player name', 2, 35); }
function normalized(name) { return name.toLowerCase(); }
function pinCode(value) {
  if (typeof value !== 'string' || !/^\d{4}$/.test(value)) fail(400, 'Use a 4-digit PIN.');
  return value;
}
function int(value, label, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) fail(400, `Set ${label} between ${min} and ${max}.`);
  return value;
}
function boolean(value, label) {
  if (typeof value !== 'boolean') fail(400, `Choose a value for ${label}.`);
  return value;
}
function entityId(value) {
  if (typeof value !== 'string' || !/^[a-z\d]{8}-[a-z\d]{4}-[a-z\d]{4}-[a-z\d]{4}-[a-z\d]{12}$/i.test(value)) {
    fail(400, 'Choose a valid record.');
  }
  return value;
}
function requestId(value) {
  if (typeof value !== 'string' || !/^[\w-]{8,100}$/.test(value)) fail(400, 'Retry this action from the game screen.');
  return value;
}

function activePlayers(state) { return Object.values(state.players).filter(player => !player.removedAt); }
function hasName(state, name, exceptId) {
  return activePlayers(state).some(player => player.id !== exceptId && player.normalizedName === normalized(name));
}
function getPlayer(state, playerId) {
  const player = state.players[entityId(playerId)];
  if (!player || player.removedAt) fail(404, 'This player is no longer registered.');
  return player;
}
function getMission(state, missionId) {
  const mission = state.missions[entityId(missionId)];
  if (!mission) fail(404, 'This mission is unavailable.');
  return mission;
}
function lifeStatus(playerState) { return playerState.lives > 0 ? 'alive' : 'eliminated'; }
function completed(playerState) { return Boolean(playerState.mission && playerState.progress >= playerState.mission.target); }
function missionSnapshot({ id: missionId, catalogId, revisionId, title, description, target }) {
  return { id: revisionId ?? missionId, catalogId: catalogId ?? missionId, title, description, target };
}
function catalogId(mission) { return mission?.catalogId ?? mission?.id; }
function emptyPlayerState() {
  return { lives: 2, progress: 0, mission: null, completedAt: null, eliminatedAt: null, progressRequests: [] };
}

function addPlayer(state, name, credential, now) {
  if (activePlayers(state).length >= ABSOLUTE_MAX_PLAYERS) fail(409, 'This round has reached its player limit.');
  if (hasName(state, name)) fail(409, 'That name is already registered. Try a nickname or add an initial.');
  const player = { id: id(), name, normalizedName: normalized(name), credential, createdAt: date(now), lastActive: date(now), tutorialDone: false };
  state.players[player.id] = player;
  state.round.states[player.id] = emptyPlayerState();
  return player;
}

function playerRound(state, playerId) {
  const entry = state.round.states[playerId];
  if (!entry) fail(404, 'This player is not part of the current round.');
  return entry;
}
function ensureCurrentRound(state, input) {
  if (input.roundId && input.roundId !== state.round.id) fail(409, 'A new round has started. Refresh your game screen.');
}
function requirePlayable(state, playerId, input) {
  ensureCurrentRound(state, input);
  if (state.round.phase !== 'live') fail(409, 'Gameplay is only available while the round is live.');
  const entry = playerRound(state, playerId);
  if (entry.lives <= 0) fail(409, 'Eliminated agents cannot take gameplay actions.');
  return entry;
}
function assignable(state) { return Object.values(state.missions).filter(mission => mission.active); }
function rememberGuessOption(round, mission) {
  // The guess list tracks every revision visible this round, irrespective of assignments.
  const snapshot = missionSnapshot(mission);
  round.guessCatalog ??= {};
  if (!round.guessCatalog[snapshot.id] && Object.keys(round.guessCatalog).length >= 360) {
    fail(409, 'This round has reached its mission revision limit.');
  }
  round.guessCatalog[snapshot.id] = snapshot;
}
function missionOptions(state) {
  if (state.round.guessCatalog) return new Map(Object.entries(state.round.guessCatalog));
  return new Map(Object.values(state.missions).map(missionSnapshot).map(mission => [mission.id, mission]));
}
function randomMission(state, previousId, excludePlayerId) {
  let candidates = assignable(state);
  if (!candidates.length) return null;
  if (candidates.length > 1 && previousId) candidates = candidates.filter(mission => mission.id !== previousId);
  const counts = new Map(candidates.map(mission => [mission.id, 0]));
  for (const [playerId, entry] of Object.entries(state.round.states)) {
    const missionId = catalogId(entry.mission);
    if (playerId !== excludePlayerId && !state.players[playerId]?.removedAt && counts.has(missionId)) counts.set(missionId, counts.get(missionId) + 1);
  }
  const fewest = Math.min(...counts.values());
  const balanced = candidates.filter(mission => counts.get(mission.id) === fewest);
  return balanced[randomIndex(balanced.length)];
}
function setMission(entry, mission) {
  entry.mission = mission ? missionSnapshot(mission) : null;
  entry.progress = 0;
  entry.completedAt = null;
}
function assignUnassigned(state) {
  const waiting = activePlayers(state).filter(player => !playerRound(state, player.id).mission);
  let assigned = 0;
  while (waiting.length) {
    const [player] = waiting.splice(randomIndex(waiting.length), 1);
    const mission = randomMission(state, player.previousMissionId, player.id);
    if (!mission) break;
    setMission(playerRound(state, player.id), mission);
    assigned += 1;
  }
  return assigned;
}

function setProgress(entry, value, now) {
  entry.progress = value;
  entry.completedAt = completed(entry) ? entry.completedAt ?? date(now) : null;
}
function recordAudit(state, action, detail, now, administrator = 'event-staff') {
  state.audit.unshift({ id: id(), roundId: state.round.id, administrator, action, detail, createdAt: date(now) });
  if (state.audit.length > 160) state.audit.length = 160;
}
function cancelReports(state, playerId, reason, now, targetOnly = false) {
  for (const report of state.round.reports) {
    if (report.status === 'pending' && (report.targetId === playerId || (!targetOnly && report.reporterId === playerId))) {
      Object.assign(report, { status: 'cancelled', reason, reviewedAt: date(now) });
    }
  }
}

function eventStatus(event, now) {
  if (event.cancelledAt) return 'cancelled';
  if (event.startAt > now) return 'queued';
  if (event.endAt > now) return 'showing';
  return 'delivered';
}
function queueEvent(state, type, payload, now, { delay = 0, duration = state.round.duration } = {}) {
  const round = state.round;
  if (round.events.length >= 200) {
    const index = round.events.findIndex(event => ['cancelled', 'delivered'].includes(eventStatus(event, now)));
    if (index < 0) fail(409, 'The projector queue is full. Let some announcements finish first.');
    round.events.splice(index, 1);
  }
  const freeAt = round.events.reduce((time, event) => event.cancelledAt ? time : Math.max(time, event.endAt), now);
  const startAt = Math.max(now + delay * 1000, freeAt > now ? freeAt + 400 : now);
  const event = { id: id(), type, ...payload, createdAt: now, startAt, endAt: startAt + duration * 1000 };
  round.events.push(event);
  return event;
}
function eventView(event, now, details = true) {
  const schedule = { id: event.id, type: event.type, createdAt: date(event.createdAt), startAt: date(event.startAt), endAt: date(event.endAt), status: eventStatus(event, now) };
  if (!details) return schedule;
  return { ...schedule, title: event.title ?? null, message: event.message ?? null, name: event.name ?? null, mission: event.mission ?? null };
}
function setLives(state, player, entry, lives, now, revealMission = false, reason = '') {
  const wasAlive = entry.lives > 0;
  entry.lives = lives;
  if (lives > 0) {
    entry.eliminatedAt = null;
    return;
  }
  if (!wasAlive) return;
  entry.eliminatedAt = date(now);
  cancelReports(state, player.id, 'An involved agent is no longer active.', now);
  if (!['live', 'paused'].includes(state.round.phase)) return;
  queueEvent(state, revealMission ? 'compromised' : 'eliminated', {
    title: revealMission ? 'Mission compromised' : 'Agent eliminated',
    name: player.name,
    message: reason || null,
    mission: revealMission ? entry.mission?.description ?? null : null,
  }, now, { delay: state.round.delay });
}

function finalResults(state, now) {
  const participants = activePlayers(state).map(player => {
    const entry = playerRound(state, player.id);
    return {
      id: player.id, name: player.name, status: lifeStatus(entry), lives: entry.lives, completed: completed(entry),
      mission: entry.mission?.description ?? null, progress: entry.progress, target: entry.mission?.target ?? null,
      completedAt: entry.completedAt,
    };
  });
  const winners = participants.filter(player => player.status === 'alive' && player.completed)
    .map(({ id: playerId, name, mission }) => ({ id: playerId, name, mission }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    roundId: state.round.id, endedAt: date(now), players: participants.length,
    survivors: participants.filter(player => player.status === 'alive').length,
    completed: participants.filter(player => player.completed).length,
    winners, participants,
  };
}
function publicResults(results) {
  if (!results) return null;
  const { participants, ...projection } = results;
  return projection;
}

function staffRound({ id: roundId, phase, lateJoin, delay, duration, createdAt, startedAt, endedAt }) {
  return { id: roundId, phase, lateJoin, delay, duration, createdAt, startedAt, endedAt };
}
function playerView(player, playerState) {
  return {
    id: player.id, name: player.name, lives: playerState.lives, status: lifeStatus(playerState),
    progress: playerState.progress, mission: playerState.mission, tutorialDone: player.tutorialDone,
    createdAt: player.createdAt, lastActive: player.lastActive,
    completedAt: playerState.completedAt, eliminatedAt: playerState.eliminatedAt,
  };
}
function ownReport(report) {
  return { id: report.id, targetName: report.targetName, status: report.status, guessedTitle: report.guess.title, createdAt: report.createdAt, reason: report.reason ?? null };
}
function staffReport(report) {
  return {
    ...ownReport(report), reporterId: report.reporterId, targetId: report.targetId, reporterName: report.reporterName,
    guessedDescription: report.guess.description, actualTitle: report.actual.title, actualDescription: report.actual.description,
    guessedTarget: report.guess.target, actualTarget: report.actual.target,
    match: report.guess.id === report.actual.id, reviewedAt: report.reviewedAt ?? null, reviewedBy: report.reviewedBy ?? null,
  };
}

function staffView(state, revision, env, now) {
  return {
    round: staffRound(state.round), revision, demoAllowed: env.ALLOW_DEMO === 'true', serverTime: date(now),
    players: activePlayers(state).map(player => playerView(player, playerRound(state, player.id))),
    missions: Object.values(state.missions).map(mission => ({
      ...mission, assigned: activePlayers(state).filter(player => catalogId(state.round.states[player.id]?.mission) === mission.id).length,
    })),
    reports: state.round.reports.map(staffReport).reverse(),
    events: state.round.events.map(event => eventView(event, now)).reverse(),
    audit: state.audit,
    results: state.round.results,
    history: state.history.map(({ totals, ...summary }) => ({ ...summary, results: publicResults(totals) })),
  };
}

function screenView(state, revision, now) {
  const { round } = state;
  const pending = round.events.find(event => !event.cancelledAt && event.endAt > now);
  const event = pending ? eventView(pending, now, pending.startAt <= now) : null;
  const finale = round.finaleEnabled && round.events.findLast(entry => entry.type === 'winners' && !entry.cancelledAt);
  return {
    round: { id: round.id, phase: round.phase }, event,
    results: finale && finale.startAt <= now ? publicResults(round.results) : null,
    serverTime: date(now), revision,
  };
}

function playerSnapshot(state, playerKey, revision, now) {
  const { round } = state;
  const current = session(state, playerKey, 'player', now, false);
  const player = current && state.players[current.playerId];
  return {
    round: { id: round.id, phase: round.phase, lateJoin: round.lateJoin }, revision,
    me: player ? playerView(player, playerRound(state, player.id)) : null,
    reports: player ? round.reports.filter(report => report.reporterId === player.id).map(ownReport).reverse() : [],
    winner: Boolean(player && round.results?.winners.some(winner => winner.id === player.id)),
  };
}

export const MIN_ROLE_PASSWORD_LENGTH = 4;

function checkStaffPassword(env, role) {
  const password = role === 'staff' ? env.ADMIN_PASSWORD : env.PRESENTATION_PASSWORD;
  if (typeof password !== 'string' || password.length < MIN_ROLE_PASSWORD_LENGTH) {
    fail(503, role === 'staff' ? 'An organizer must configure staff access.' : 'An organizer must configure projector access.');
  }
  if (env.ADMIN_PASSWORD === env.PRESENTATION_PASSWORD) fail(503, 'Staff and projector access must use separate passphrases.');
  return password;
}

function checkPinPepper(env) {
  if (typeof env.PIN_PEPPER !== 'string' || env.PIN_PEPPER.length < 24) {
    fail(503, 'An organizer must configure private PIN storage.');
  }
  return env.PIN_PEPPER;
}

async function loginRole(request, db, env, role, input) {
  const passphrase = checkStaffPassword(env, role);
  await rateLimit(db, `${role}-login:${network(request)}`, 12, 300_000);
  if (typeof input.password !== 'string' || !input.password || input.password.length > 512) {
    fail(400, 'Enter the access passphrase.');
  }
  const [provided, expected] = await Promise.all([digest(input.password), digest(passphrase)]);
  if (!equal(provided, expected)) fail(401, 'That passphrase did not match.');
  const { token, key } = await newSessionKey();
  const oldKey = await readSessionKey(request, role);
  await change(db, (state, now) => {
    if (oldKey) delete state.sessions[oldKey];
    storeSession(state, key, role, now);
  });
  return json({ ok: true }, 200, { 'Set-Cookie': cookie(request, role, token, SESSION_AGES[role]) });
}

async function logout(request, db, role) {
  const key = await readSessionKey(request, role);
  if (key) {
    await change(db, state => {
      if (!state.sessions[key]) return unchanged();
      delete state.sessions[key];
    });
  }
  return json({ ok: true }, 200, { 'Set-Cookie': cookie(request, role) });
}

async function register(request, db, env, input) {
  const pepper = checkPinPepper(env);
  const name = playerName(input.name);
  const pin = pinCode(input.pin);
  await rateLimit(db, `register:${network(request)}`, 120, 300_000);
  const { state: current } = await readState(db);
  ensureRegistrationOpen(current);
  if (hasName(current, name)) fail(409, 'That name is already registered. Try a nickname or add an initial.');
  const [credential, { token, key }, oldKey] = await Promise.all([
    pinHash(pin, pepper), newSessionKey(), readSessionKey(request, 'player'),
  ]);
  const result = await change(db, (state, now) => {
    ensureRegistrationOpen(state);
    const player = addPlayer(state, name, credential, now);
    if (['live', 'paused'].includes(state.round.phase)) {
      setMission(playerRound(state, player.id), randomMission(state, null, player.id));
    }
    if (oldKey) delete state.sessions[oldKey];
    storeSession(state, key, 'player', now, player.id);
    return { ok: true, playerId: player.id };
  });
  return json(result, 201, { 'Set-Cookie': cookie(request, 'player', token, SESSION_AGES.player) });
}

function ensureRegistrationOpen(state) {
  const { phase, lateJoin } = state.round;
  if (phase === 'ended' || (phase !== 'lobby' && !lateJoin)) fail(409, 'Registration is closed for this round. Check with an organizer.');
}

async function loginPlayer(request, db, env, input) {
  const pepper = checkPinPepper(env);
  const playerId = entityId(input.id);
  const pin = pinCode(input.pin);
  await rateLimit(db, `player-login:${network(request)}`, 120, 300_000);
  const { state } = await readState(db);
  const player = state.players[playerId];
  const credential = player?.credential;
  await rateLimit(db, `player-pin:${playerId}:${credential?.salt ?? 'unknown'}`, 6, 300_000);
  const attempt = await pinHash(pin, pepper, credential?.salt ?? '00000000000000000000000000000000');
  if (!player || player.removedAt || !credential || !equal(attempt.hash, credential.hash)) {
    fail(401, 'That PIN did not match. Please try again.');
  }
  const [{ token, key }, oldKey] = await Promise.all([newSessionKey(), readSessionKey(request, 'player')]);
  await change(db, (fresh, now) => {
    const target = fresh.players[playerId];
    if (!target || target.removedAt || target.credential.hash !== credential.hash) fail(401, 'That PIN did not match. Please try again.');
    target.lastActive = date(now);
    if (oldKey) delete fresh.sessions[oldKey];
    storeSession(fresh, key, 'player', now, playerId);
  });
  return json({ ok: true }, 200, { 'Set-Cookie': cookie(request, 'player', token, SESSION_AGES.player) });
}

async function playerAction(db, request, path, input) {
  const playerKey = await readSessionKey(request, 'player');
  if (!playerKey) fail(401, 'Sign in to continue.');
  return change(db, (state, now) => {
    const { playerId } = session(state, playerKey, 'player', now);
    const player = getPlayer(state, playerId);
    if (path === '/api/player/tutorial') {
      if (player.tutorialDone) return unchanged();
      player.tutorialDone = true;
      player.lastActive = date(now);
      return { ok: true };
    }
    const entry = requirePlayable(state, playerId, input);
    const actionId = requestId(input.requestId);
    if (path === '/api/progress') {
      if (!entry.mission) fail(409, 'Your mission is still being prepared.');
      if (input.missionId && input.missionId !== entry.mission.id) fail(409, 'Your mission changed. Open your current assignment to continue.');
      if (entry.progressRequests.includes(actionId)) return unchanged({ ok: true, progress: entry.progress });
      if (input.delta !== 1 && input.delta !== -1) fail(400, 'Choose one completion to add or undo.');
      setProgress(entry, Math.max(0, Math.min(entry.mission.target, entry.progress + input.delta)), now);
      entry.progressRequests.push(actionId);
      if (entry.progressRequests.length > 40) entry.progressRequests.shift();
      player.lastActive = date(now);
      return { ok: true, progress: entry.progress };
    }
    const repeat = state.round.reports.find(report => report.reporterId === playerId && report.requestId === actionId);
    if (repeat) return unchanged({ ok: true, reportId: repeat.id });
    const target = getPlayer(state, input.targetId);
    const targetState = playerRound(state, target.id);
    if (target.id === playerId || targetState.lives < 1 || !targetState.mission) fail(409, 'Choose an eligible active agent.');
    const guess = missionOptions(state).get(entityId(input.missionId));
    if (!guess) fail(409, 'Choose a mission from the current catalog.');
    const pending = state.round.reports.filter(report => report.status === 'pending' && report.reporterId === playerId);
    if (pending.some(report => report.targetId === target.id && report.guess.id === guess.id)) {
      fail(409, 'That accusation is already awaiting review.');
    }
    if (pending.length >= 5) fail(409, 'Five reports are awaiting review. Wait for an organizer to review them.');
    if (state.round.reports.length >= 500) fail(409, 'The round has reached its report limit. Let an organizer know.');
    const report = {
      id: id(), requestId: actionId, reporterId: playerId, reporterName: player.name, targetId: target.id, targetName: target.name,
      guess: missionSnapshot(guess), actual: { ...targetState.mission }, status: 'pending', createdAt: date(now),
    };
    state.round.reports.push(report);
    player.lastActive = date(now);
    return { ok: true, reportId: report.id };
  });
}

function saveMission(state, input, now) {
  const title = text(input.title, 'a mission title', 2, 80);
  const description = text(input.description, 'a mission description', 5, 300);
  const target = int(input.target, 'the completion target', 1, 50);
  const active = input.active === undefined ? true : boolean(input.active, 'mission availability');
  const existing = input.id ? getMission(state, input.id) : null;
  if (!existing && Object.keys(state.missions).length >= 120) fail(409, 'The mission catalog is full.');
  const mission = existing ?? { id: id(), createdAt: date(now) };
  const assigned = Object.entries(state.round.states)
    .filter(([playerId, entry]) => !state.players[playerId]?.removedAt && catalogId(entry.mission) === mission.id);
  const materialChange = existing && (existing.title !== title || existing.description !== description || existing.target !== target);
  if (materialChange) mission.revisionId = id();
  Object.assign(mission, { title, description, target, active, updatedAt: date(now) });
  state.missions[mission.id] = mission;
  if (['live', 'paused'].includes(state.round.phase) && active) {
    rememberGuessOption(state.round, mission);
  }
  return { detail: materialChange && assigned.length ? `${mission.title} · existing assignments kept` : mission.title, missionId: mission.id };
}

function editPlayer(state, input, now, credential) {
  const player = getPlayer(state, input.id);
  const entry = playerRound(state, player.id);
  const fields = [];
  if (input.name !== undefined) {
    const name = playerName(input.name);
    if (hasName(state, name, player.id)) fail(409, 'That name is already registered.');
    if (player.name !== name) {
      fields.push(`name changed from ${player.name}`);
      player.name = name;
      player.normalizedName = normalized(name);
    }
  }
  if (credential) {
    player.credential = credential;
    revokePlayerSessions(state, player.id);
    fields.push('PIN reset');
  }
  if (input.progress !== undefined) {
    if (!entry.mission) fail(409, 'Assign a mission before setting progress.');
    const progress = int(input.progress, 'mission progress', 0, entry.mission.target);
    if (progress !== entry.progress) {
      fields.push(`progress ${entry.progress} → ${progress}`);
      setProgress(entry, progress, now);
    }
  }
  if (input.lives !== undefined) {
    const lives = int(input.lives, 'lives', 0, 2);
    if (lives !== entry.lives) {
      fields.push(`lives ${entry.lives} → ${lives}`);
      setLives(state, player, entry, lives, now);
    }
  }
  return fields.length ? `${player.name} · ${fields.join(', ')}` : null;
}

function reviewReport(state, input, now, reviewer) {
  const report = state.round.reports.find(entry => entry.id === entityId(input.id));
  if (!report) fail(404, 'That report is no longer in this round.');
  const decision = input.decision;
  if (!['approved', 'rejected'].includes(decision)) fail(400, 'Choose a report decision.');
  if (report.status === decision) return null;
  if (report.status !== 'pending') fail(409, 'This report has already been resolved.');
  if (!['live', 'paused'].includes(state.round.phase)) fail(409, 'The round is no longer open for report review.');
  const reporter = getPlayer(state, report.reporterId);
  const target = getPlayer(state, report.targetId);
  const reporterState = playerRound(state, reporter.id);
  const targetState = playerRound(state, target.id);
  if (!reporterState.lives || !targetState.lives || targetState.mission?.id !== report.actual.id) {
    Object.assign(report, { status: 'cancelled', reason: 'The players or assignment changed before review.', reviewedAt: date(now), reviewedBy: reviewer });
    return `${reporter.name} reported ${target.name} · cancelled`;
  }
  Object.assign(report, { status: decision, reviewedAt: date(now), reviewedBy: reviewer });
  if (decision === 'approved') {
    setLives(state, target, targetState, 0, now, true);
  } else {
    setLives(state, reporter, reporterState, reporterState.lives - 1, now, false, 'This agent lost their last life.');
  }
  return `${reporter.name} reported ${target.name} · ${decision}`;
}

function advancePhase(state, next, now) {
  const { round } = state;
  const prior = round.phase;
  if (!['live', 'paused', 'ended'].includes(next)) fail(400, 'Choose a valid game phase.');
  if (prior === next) return null;
  const legal = { lobby: ['live'], live: ['paused', 'ended'], paused: ['live', 'ended'], ended: [] };
  if (!legal[prior].includes(next)) fail(409, 'This phase change is unavailable.');
  if (prior === 'lobby') {
    if (!assignable(state).length) fail(409, 'Add at least one active mission before starting the game.');
    for (const entry of Object.values(round.states)) {
      Object.assign(entry, { lives: 2, progress: 0, completedAt: null, eliminatedAt: null, progressRequests: [] });
      if (entry.mission && !state.missions[catalogId(entry.mission)]?.active) entry.mission = null;
    }
    for (const mission of assignable(state)) rememberGuessOption(round, mission);
    for (const entry of Object.values(round.states)) {
      if (entry.mission) rememberGuessOption(round, entry.mission);
    }
    assignUnassigned(state);
    round.startedAt = date(now);
  }
  round.phase = next;
  if (next === 'ended') {
    round.endedAt = date(now);
    for (const report of round.reports) {
      if (report.status === 'pending') Object.assign(report, { status: 'cancelled', reason: 'The round ended before review.', reviewedAt: date(now) });
    }
    round.results = finalResults(state, now);
    round.finaleEnabled = true;
    queueEvent(state, 'winners', { title: 'Mission accomplished' }, now, { duration: Math.max(12, round.duration) });
  }
  return `${prior} → ${next}`;
}

function resetRound(state, input, now) {
  const keepPlayers = boolean(input.keepPlayers, 'keeping players');
  const randomize = boolean(input.randomize, 'assigning missions in the lobby');
  const previous = state.round;
  state.history.unshift({
    id: previous.id, phase: previous.phase, startedAt: previous.startedAt, endedAt: previous.endedAt,
    archivedAt: date(now), totals: previous.results,
    reports: {
      approved: previous.reports.filter(report => report.status === 'approved').length,
      rejected: previous.reports.filter(report => report.status === 'rejected').length,
      cancelled: previous.reports.filter(report => ['cancelled', 'pending'].includes(report.status)).length,
    },
  });
  state.history.length = Math.min(3, state.history.length);
  state.round = newRound(previous, now);
  for (const [playerId, player] of Object.entries(state.players)) {
    if (!keepPlayers || player.removedAt) {
      delete state.players[playerId];
      revokePlayerSessions(state, playerId);
    } else {
      player.previousMissionId = catalogId(previous.states[playerId]?.mission) ?? null;
      state.round.states[playerId] = emptyPlayerState();
    }
  }
  const count = randomize ? assignUnassigned(state) : 0;
  return `${keepPlayers ? 'Kept registered players' : 'Cleared registered players'} · ${count} assignments`;
}

function applyStaffAction(state, input, now, env, prepared, reviewer) {
  ensureCurrentRound(state, input);
  const { round } = state;
  switch (input.action) {
    case 'missionSave':
      return saveMission(state, input, now);
    case 'missionArchive': {
      const mission = getMission(state, input.id);
      if (!mission.active) return null;
      Object.assign(mission, { active: false, updatedAt: date(now) });
      return { detail: mission.title };
    }
    case 'playerEdit': {
      const detail = editPlayer(state, input, now, prepared.credential);
      return detail && { detail };
    }
    case 'playerAssign': {
      if (round.phase === 'ended') fail(409, 'Start a new round before changing assignments.');
      const player = getPlayer(state, input.id);
      const entry = playerRound(state, player.id);
      const mission = input.missionId ? getMission(state, input.missionId) : randomMission(state, catalogId(entry.mission) ?? player.previousMissionId, player.id);
      if (!mission?.active) fail(409, 'Choose an active mission.');
      if (entry.mission?.id === (mission.revisionId ?? mission.id)) return null;
      const previousTitle = entry.mission?.title ?? 'unassigned';
      setMission(entry, mission);
      cancelReports(state, player.id, 'The target received a new mission before review.', now, true);
      return { detail: `${player.name} · ${previousTitle} → ${mission.title}` };
    }
    case 'playerRemove': {
      const player = getPlayer(state, input.id);
      cancelReports(state, player.id, 'An involved agent was removed.', now);
      revokePlayerSessions(state, player.id);
      delete state.players[player.id];
      delete round.states[player.id];
      return { detail: player.name };
    }
    case 'assignAll': {
      if (round.phase === 'ended') fail(409, 'Start a new round before changing assignments.');
      if (!assignable(state).length) fail(409, 'Add an active mission first.');
      const count = assignUnassigned(state);
      return count ? { detail: `${count} agents assigned`, count } : null;
    }
    case 'review': {
      const detail = reviewReport(state, input, now, reviewer);
      return detail && { detail };
    }
    case 'phase': {
      const detail = advancePhase(state, input.phase, now);
      return detail && { detail };
    }
    case 'reset':
      return { detail: resetRound(state, input, now) };
    case 'settings': {
      const lateJoin = boolean(input.lateJoin, 'late registration');
      const delay = int(input.delay, 'the reveal delay in seconds', 0, 60);
      const duration = int(input.duration, 'the display duration in seconds', 2, 60);
      Object.assign(round, { lateJoin, delay, duration });
      return { detail: `Late registration ${lateJoin ? 'open' : 'closed'} · ${delay}s delay · ${duration}s display` };
    }
    case 'announce': {
      const title = text(input.title, 'an announcement title', 1, 90);
      const message = input.message ? text(input.message, 'an announcement message', 1, 260) : null;
      const event = queueEvent(state, 'announcement', { title, message }, now);
      return { detail: title, eventId: event.id };
    }
    case 'countdown': {
      const seconds = int(input.seconds, 'countdown seconds', 1, 600);
      const event = queueEvent(state, 'countdown', { title: 'Next mission starts soon' }, now, { duration: seconds });
      return { detail: `${seconds}s countdown`, eventId: event.id };
    }
    case 'screenIdle': {
      for (const event of round.events) {
        const status = eventStatus(event, now);
        const mandatory = ['compromised', 'eliminated'].includes(event.type);
        if (status === 'showing' || (status === 'queued' && !mandatory)) event.cancelledAt = date(now);
      }
      round.finaleEnabled = false;
      return { detail: 'Returned to the main slide' };
    }
    case 'replay': {
      const previous = round.events.find(event => event.id === entityId(input.id));
      if (!previous) fail(404, 'That presentation event is no longer available.');
      const { type, title, message, name, mission, startAt, endAt } = previous;
      const event = queueEvent(state, type, { title, message, name, mission }, now, { duration: (endAt - startAt) / 1000 });
      if (type === 'winners') round.finaleEnabled = true;
      return { detail: title ?? type, eventId: event.id };
    }
    case 'revealWinners': {
      if (!round.results) fail(409, 'End the round to save the winners first.');
      round.finaleEnabled = true;
      const event = queueEvent(state, 'winners', { title: 'Mission accomplished' }, now, { duration: Math.max(12, round.duration) });
      return { detail: `${round.results.winners.length} winners`, eventId: event.id };
    }
    case 'seed': {
      if (env.ALLOW_DEMO !== 'true') fail(403, 'Demo data is disabled on this installation.');
      if (round.phase !== 'lobby') fail(409, 'Return to the lobby before creating demo data.');
      let people = 0;
      let missions = 0;
      DEMO_PLAYERS.forEach((name, index) => {
        if (!hasName(state, name)) {
          addPlayer(state, name, prepared.demoCredentials[index], now);
          people += 1;
        }
      });
      for (const [title, description, target] of DEMO_MISSIONS) {
        if (!Object.values(state.missions).some(mission => normalized(mission.title) === normalized(title))) {
          saveMission(state, { title, description, target, active: true }, now);
          missions += 1;
        }
      }
      return people || missions ? { detail: `${people} demo players · ${missions} demo missions` } : null;
    }
    default:
      fail(400, 'Choose a staff action.');
  }
}

async function staffAction(request, db, env, input) {
  const key = await readSessionKey(request, 'staff');
  if (!key) fail(401, 'Sign in to continue.');
  const prepared = {};
  if ((input.action === 'playerEdit' && input.pin !== undefined) || input.action === 'seed') {
    const { state } = await readState(db);
    session(state, key, 'staff', Date.now());
    if (input.action === 'seed') {
      if (env.ALLOW_DEMO !== 'true') fail(403, 'Demo data is disabled on this installation.');
      const pepper = checkPinPepper(env);
      prepared.demoCredentials = await Promise.all(DEMO_PLAYERS.map(() => pinHash(DEMO_PIN, pepper)));
    } else {
      prepared.credential = await pinHash(pinCode(input.pin), checkPinPepper(env));
    }
  }
  const reviewer = `staff-${key.slice(0, 12)}`;
  return change(db, (state, now) => {
    session(state, key, 'staff', now);
    const result = applyStaffAction(state, input, now, env, prepared, reviewer);
    if (!result) return unchanged();
    const { detail, ...output } = result;
    recordAudit(state, input.action, detail, now, reviewer);
    return { ok: true, ...output };
  });
}

async function getPlayerRoute(request, db, path, url) {
  if (path === '/api/roster') {
    await rateLimit(db, `roster:${network(request)}`, 420, 60_000);
    const { state } = await readState(db);
    const q = normalized((url.searchParams.get('q') ?? '').normalize('NFKC').trim().slice(0, 70));
    const players = activePlayers(state).filter(player => player.normalizedName.includes(q))
      .map(({ id: playerId, name }) => ({ id: playerId, name })).sort((a, b) => a.name.localeCompare(b.name));
    return json({ players });
  }
  const [key, { state, version }] = await Promise.all([readSessionKey(request, 'player'), readState(db)]);
  const now = Date.now();
  if (path === '/api/player') return json(playerSnapshot(state, key, version, now));
  const { playerId } = session(state, key, 'player', now);
  requirePlayable(state, playerId, {});
  const players = activePlayers(state).filter(player => {
    const entry = state.round.states[player.id];
    return player.id !== playerId && entry?.lives > 0 && entry.mission;
  }).map(({ id: playerId, name }) => ({ id: playerId, name })).sort((a, b) => a.name.localeCompare(b.name));
  const missions = Array.from(missionOptions(state).values())
    .map(({ id: missionId, title, description, target }) => ({ id: missionId, title, description, target })).sort((a, b) => a.title.localeCompare(b.title));
  return json({ players, missions });
}

export async function handleApi(request, env) {
  try {
    const url = new URL(request.url);
    const path = url.pathname;
    const db = env.DB?.withSession?.('first-primary') ?? env.DB;
    if (!db) fail(503, 'The game database is unavailable.');
    if (request.method === 'GET') {
      if (['/api/player', '/api/roster', '/api/options'].includes(path)) return await getPlayerRoute(request, db, path, url);
      if (path === '/api/staff' || path === '/api/screen') {
        const role = path === '/api/staff' ? 'staff' : 'screen';
        const key = await readSessionKey(request, role);
        if (!key) fail(401, 'Sign in to continue.');
        const { state, version } = await readState(db);
        const now = Date.now();
        session(state, key, role, now);
        return json(role === 'staff' ? staffView(state, version, env, now) : screenView(state, version, now));
      }
      fail(404, 'This game endpoint is unavailable.');
    }
    if (request.method !== 'POST') fail(405, 'This request method is unavailable.');
    requireSameOrigin(request, url);
    const logoutRole = { '/api/logout': 'player', '/api/staff/logout': 'staff', '/api/screen/logout': 'screen' }[path];
    if (logoutRole) return await logout(request, db, logoutRole);
    const input = await body(request);
    if (path === '/api/register') return await register(request, db, env, input);
    if (path === '/api/login') return await loginPlayer(request, db, env, input);
    if (path === '/api/staff/login') return await loginRole(request, db, env, 'staff', input);
    if (path === '/api/screen/login') return await loginRole(request, db, env, 'screen', input);
    if (path === '/api/staff/action') return json(await staffAction(request, db, env, input));
    if (['/api/player/tutorial', '/api/progress', '/api/report'].includes(path)) return json(await playerAction(db, request, path, input));
    fail(404, 'This game endpoint is unavailable.');
  } catch (error) {
    if (error instanceof ApiError) return json({ error: error.message }, error.status, error.headers);
    console.error('Santa game API failed:', error?.name, error?.message);
    return json({ error: 'Santa’s workshop hit a snag. Please try again.' }, 500);
  }
}
