import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createApp } from '../dev.mjs'
import { playerEntry } from '../public/player-entry.js'
import { ruleScenes } from '../public/tutorial.js'

const ADMIN_PASSWORD = 'staff-testing-77-Christmas'
const PRESENTATION_PASSWORD = 'screen-testing-12-North-Pole'
const ORIGIN = 'https://mission.example.test'
let nextAddress = 1

function browser(app) {
  const cookies = new Map()
  const address = `198.51.100.${nextAddress++}`
  return {
    async request(path, body, { origin = ORIGIN } = {}) {
      const headers = new Headers({
        'cf-connecting-ip': address,
        'x-forwarded-for': address,
      })
      if (cookies.size > 0) {
        headers.set('cookie', [...cookies].map(([key, value]) => `${key}=${value}`).join('; '))
      }
      if (body !== undefined) {
        headers.set('origin', origin)
        headers.set('content-type', 'application/json')
      }
      const response = await app.fetch(new Request(`${ORIGIN}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }))
      const setCookies = response.headers.getSetCookie()
      for (const entry of setCookies) {
        const [keyValue] = entry.split(';')
        const i = keyValue.indexOf('=')
        const key = keyValue.slice(0, i)
        const value = keyValue.slice(i + 1)
        if (/max-age=0(?:;|$)/i.test(entry) || value === '') cookies.delete(key)
        else cookies.set(key, value)
      }
      const raw = await response.text()
      return {
        status: response.status,
        data: response.headers.get('content-type')?.includes('application/json') ? JSON.parse(raw) : raw,
        headers: response.headers,
        setCookies,
      }
    },
  }
}

async function ok(client, path, body) {
  const response = await client.request(path, body)
  assert.ok(response.status >= 200 && response.status < 300, `${path} returned ${response.status}: ${JSON.stringify(response.data)}`)
  return response.data
}

async function fails(client, expected, path, body) {
  const response = await client.request(path, body)
  const codes = Array.isArray(expected) ? expected : [expected]
  assert.ok(codes.includes(response.status), `${path} returned ${response.status} (expected ${codes.join(' or ')}): ${JSON.stringify(response.data)}`)
  assert.equal(typeof response.data.error, 'string')
  return response.data
}

function config(dbPath = ':memory:', allowDemo = false) {
  return {
    dbPath,
    adminPassword: ADMIN_PASSWORD,
    presentationPassword: PRESENTATION_PASSWORD,
    pinPepper: 'test-only-pepper-letters-61-mission',
    allowDemo,
  }
}

function fixture(t, options = config()) {
  const app = createApp(options)
  t.after(() => app.close())
  const visitor = browser(app)
  const admin = browser(app)
  const screen = browser(app)
  return {
    app, visitor, admin, screen,
    action: (action, details) => ok(admin, '/api/staff/action', { action, ...details }),
    async staffLogin() { await ok(admin, '/api/staff/login', { password: ADMIN_PASSWORD }) },
    async screenLogin() { await ok(screen, '/api/screen/login', { password: PRESENTATION_PASSWORD }) },
    async register(name, pin = '0426') {
      const client = browser(app)
      await ok(client, '/api/register', { name, pin })
      return { client, ...(await ok(client, '/api/player')).me }
    },
    async addMission(title, description, target = 2) {
      await ok(admin, '/api/staff/action', { action: 'missionSave', title, description, target, active: true })
      return (await ok(admin, '/api/staff')).missions.find(mission => mission.title === title)
    },
  }
}

const getPlayer = client => ok(client, '/api/player').then(data => data.me)
const getStaff = admin => ok(admin, '/api/staff')
const requestId = () => crypto.randomUUID()
const timestamp = value => new Date(value).getTime()

function stablePlayer({ lastActive: _lastActive, ...state }) {
  return state
}

function assertProjection(data) {
  const sensitiveKeys = /^(pin|pinHash|pinSalt|hash|salt|token|password|passwordHash|sessions|normalizedName|networkRate|audit)$/i
  function visit(value) {
    if (value === null || typeof value !== 'object') return
    for (const [key, bucket] of Object.entries(value)) {
      assert.doesNotMatch(key, sensitiveKeys)
      visit(bucket)
    }
  }
  visit(data)
}

test('registration normalizes names, protects PIN sign-in and retains the browser session', async t => {
  const f = fixture(t)
  const before = await ok(f.visitor, '/api/player')
  assert.equal(before.me, null)
  assert.equal(before.round.phase, 'lobby')
  await fails(f.visitor, [401, 403], '/api/staff')
  await fails(f.visitor, [401, 403], '/api/screen')
  await fails(f.visitor, 400, '/api/register', { name: '  ', pin: '0426' })
  await fails(f.visitor, 400, '/api/register', { name: 'Maya', pin: 'abc1' })

  const client = browser(f.app)
  const registration = await client.request('/api/register', { name: '  Maya Snow  ', pin: '0426' })
  assert.ok(registration.status >= 200 && registration.status < 300)
  assert.ok(registration.setCookies.length)
  assert.ok(registration.setCookies.some(cookie => /;\s*httponly\b/i.test(cookie)))
  assert.ok(registration.setCookies.some(cookie => /;\s*secure\b/i.test(cookie)))
  assert.ok(registration.setCookies.some(cookie => /;\s*samesite=/i.test(cookie)))

  const initial = await getPlayer(client)
  assert.equal(initial.name, 'Maya Snow')
  assert.equal(initial.lives, 2)
  assert.equal(initial.mission, null)
  assert.deepEqual(await getPlayer(client), initial)
  assertProjection(await ok(client, '/api/player'))
  await fails(browser(f.app), 409, '/api/register', { name: 'mAyA sNoW', pin: '9374' })

  const roster = await ok(f.visitor, '/api/roster?q=maya')
  assert.deepEqual(roster.players, [{ id: initial.id, name: initial.name }])
  await fails(f.visitor, [400, 401], '/api/login', { id: initial.id })
  await fails(f.visitor, 401, '/api/login', { id: initial.id, pin: '9426' })

  await ok(client, '/api/logout', {})
  assert.equal(await getPlayer(client), null)
  await ok(f.visitor, '/api/login', { id: initial.id, pin: '0426' })
  const restored = await getPlayer(f.visitor)
  assert.deepEqual(stablePlayer(restored), stablePlayer(initial))
  await fails(f.visitor, [401, 403], '/api/staff/action', { action: 'phase', phase: 'live' })
  await fails(f.visitor, [401, 403], '/api/screen')
})

test('PIN verification throttles repeated guesses across browser clients and unlocks after expiry', async t => {
  const now = Date.now()
  t.mock.timers.enable({ apis: ['Date'], now })
  const f = fixture(t)
  const player = await f.register('Taylor')
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await fails(browser(f.app), 401, '/api/login', { id: player.id, pin: '7031' })
  }
  await fails(browser(f.app), 429, '/api/login', { id: player.id, pin: '0426' })
  t.mock.timers.setTime(now + 6 * 60_000)
  const returning = browser(f.app)
  await ok(returning, '/api/login', { id: player.id, pin: '0426' })
  assert.equal((await getPlayer(returning)).id, player.id)
})

test('roles reject the other role credentials and expose their own projections only', async t => {
  const f = fixture(t)
  const player = await f.register('Morgan')
  await fails(f.admin, 401, '/api/staff/login', { password: PRESENTATION_PASSWORD })
  await fails(f.screen, 401, '/api/screen/login', { password: ADMIN_PASSWORD })
  await f.staffLogin()
  await f.screenLogin()

  const crossOrigin = await f.admin.request('/api/staff/action', {
    action: 'settings', lateJoin: false, delay: 3, duration: 10,
  }, { origin: 'https://other.example.test' })
  assert.equal(crossOrigin.status, 403)

  const adminState = await getStaff(f.admin)
  assert.equal(adminState.players[0].id, player.id)
  const { audit: _audit, ...staffProjection } = adminState
  assertProjection(staffProjection)
  assertProjection(await ok(f.screen, '/api/screen'))
  await fails(f.screen, [401, 403], '/api/staff')
  await fails(f.screen, [401, 403], '/api/staff/action', { action: 'phase', phase: 'live' })
  await fails(f.admin, [401, 403], '/api/screen')
  await fails(f.admin, [401, 403], '/api/progress', { delta: 1, requestId: requestId() })

  await ok(f.admin, '/api/staff/logout', {})
  await ok(f.screen, '/api/screen/logout', {})
  await fails(f.admin, [401, 403], '/api/staff')
  await fails(f.screen, [401, 403], '/api/screen')
})

test('mission catalog, sign-in and progress survive database restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'santa-mission-test-'))
  const options = config(join(directory, 'game.sqlite'))
  let app = createApp(options)
  t.after(async () => {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  })

  const admin = browser(app)
  await ok(admin, '/api/staff/login', { password: ADMIN_PASSWORD })
  const player = browser(app)
  await ok(player, '/api/register', { name: 'Alex', pin: '0418' })
  assert.equal((await getPlayer(player)).mission, null)
  await fails(admin, 409, '/api/staff/action', { action: 'phase', phase: 'live' })
  await ok(admin, '/api/staff/action', {
    action: 'missionSave', title: 'Carol Collector', description: 'Ask someone to sing a Christmas carol.', target: 3, active: true,
  })
  await ok(admin, '/api/staff/action', { action: 'phase', phase: 'live' })
  await ok(player, '/api/progress', { delta: 1, requestId: requestId() })
  const expected = await getPlayer(player)
  assert.equal(expected.mission.title, 'Carol Collector')
  assert.equal(expected.progress, 1)
  await app.close()

  app = createApp(options)
  const returning = browser(app)
  await ok(returning, '/api/login', { id: expected.id, pin: '0418' })
  const restored = await ok(returning, '/api/player')
  assert.equal(restored.round.phase, 'live')
  assert.deepEqual(stablePlayer(restored.me), stablePlayer(expected))
  const nextAdmin = browser(app)
  await ok(nextAdmin, '/api/staff/login', { password: ADMIN_PASSWORD })
  assert.equal((await getStaff(nextAdmin)).missions[0].id, expected.mission.id)
})

test('edited and archived missions preserve distinct, guessable versions and private assignments', async t => {
  const f = fixture(t)
  await f.staffLogin()
  const bells = await f.addMission('Jingle Spy', 'Find the hidden bells.', 4)
  const wraps = await f.addMission('Ribbon Runner', 'Ask someone to tie a bow.', 2)
  const maya = await f.register('Maya')
  const taylor = await f.register('Taylor')

  await f.action('playerAssign', { id: maya.id, missionId: bells.id })
  await f.action('playerAssign', { id: taylor.id, missionId: wraps.id })
  await f.action('phase', { phase: 'live' })
  await ok(maya.client, '/api/progress', { delta: 1, requestId: requestId() })
  const oldMission = (await getPlayer(maya.client)).mission
  const edit = { id: bells.id, title: bells.title, description: 'Ask someone to wear a bell.', target: 1, active: true }
  await f.action('missionSave', edit)
  assert.deepEqual((await getPlayer(maya.client)).mission, oldMission)
  const jordan = await f.register('Jordan')
  await f.action('playerAssign', { id: jordan.id, missionId: bells.id })
  const editedMission = (await getPlayer(jordan.client)).mission
  assert.notEqual(editedMission.id, oldMission.id)
  assert.equal(editedMission.catalogId, bells.id)
  assert.equal(editedMission.description, edit.description)
  await f.action('missionArchive', { id: bells.id })
  const latePlayer = await f.register('Sam')
  assert.equal(latePlayer.mission.id, wraps.id)

  const data = await ok(maya.client, '/api/player')
  assertProjection(data)
  assert.doesNotMatch(JSON.stringify(data), /Ribbon Runner|Ask someone to tie a bow/)
  const options = await ok(maya.client, '/api/options')
  assert.deepEqual(options.players, options.players.map(({ id, name }) => ({ id, name })))
  assert.equal(options.players.some(p => p.id === maya.id), false)
  assert.equal(options.players.some(p => p.id === taylor.id), true)
  assert.equal(options.missions.find(mission => mission.id === oldMission.id).description, oldMission.description)
  assert.equal(options.missions.find(mission => mission.id === editedMission.id).description, edit.description)
  assertProjection(options)
  const catalog = (await getStaff(f.admin)).missions
  assert.equal(catalog.find(mission => mission.id === bells.id).active, false)
  const added = await f.addMission('Workshop Signal', 'Ask someone to draw a star.')
  await f.action('missionSave', {
    id: added.id, title: added.title, description: 'Ask someone to draw a reindeer.', target: 3, active: true,
  })
  assert.equal((await getStaff(f.admin)).missions.find(mission => mission.id === added.id).target, 3)
})

test('progress is bounded, idempotent, correctly synchronized and disabled while paused', async t => {
  const f = fixture(t)
  await f.staffLogin()
  await f.addMission('Secret Santa', 'Get someone to guess the gift.', 3)
  const player = await f.register('Chris')
  await fails(player.client, 409, '/api/progress', { delta: 1, requestId: requestId() })
  await f.action('phase', { phase: 'live' })
  const sharedId = requestId()
  await Promise.all([
    ok(player.client, '/api/progress', { delta: 1, requestId: sharedId }),
    ok(player.client, '/api/progress', { delta: 1, requestId: sharedId }),
  ])
  assert.equal((await getPlayer(player.client)).progress, 1)

  const submissions = await Promise.all(Array.from({ length: 5 }, () => (
    player.client.request('/api/progress', { delta: 1, requestId: requestId() })
  )))
  assert.ok(submissions.every(({ status }) => status >= 200 && status < 300 || status === 409))
  assert.equal((await getPlayer(player.client)).progress, 3)
  assert.equal((await getStaff(f.admin)).players.find(p => p.id === player.id).progress, 3)
  await ok(player.client, '/api/progress', { delta: -1, requestId: requestId() })
  assert.equal((await getPlayer(player.client)).progress, 2)
  await f.action('phase', { phase: 'paused' })
  await fails(player.client, 409, '/api/progress', { delta: 1, requestId: requestId() })
  await f.action('phase', { phase: 'live' })
  await ok(player.client, '/api/progress', { delta: -1, requestId: requestId() })
  await ok(player.client, '/api/progress', { delta: -1, requestId: requestId() })
  const bounded = await player.client.request('/api/progress', { delta: -1, requestId: requestId() })
  assert.ok(bounded.status < 300 || bounded.status === 409)
  assert.equal((await getPlayer(player.client)).progress, 0)
})

test('moderation is atomic across duplicate and concurrent decisions, with queue privacy and expiry', async t => {
  const now = Date.now()
  t.mock.timers.enable({ apis: ['Date'], now })
  const f = fixture(t)
  await f.staffLogin()
  await f.screenLogin()
  await f.action('settings', { lateJoin: true, delay: 5, duration: 4 })
  const bows = await f.addMission('Bow Bureau', 'Collect two compliments on a ribbon.')
  const bells = await f.addMission('Bell Recon', 'Get someone to ring a bell.')
  const casey = await f.register('Casey')
  const blair = await f.register('Blair')
  const maya = await f.register('Maya')
  const drew = await f.register('Drew')
  for (const [player, mission] of [[casey, bells], [blair, bows], [maya, bows], [drew, bells]]) {
    await f.action('playerAssign', { id: player.id, missionId: mission.id })
  }
  await f.action('phase', { phase: 'live' })

  const submit = async (reporter, target, mission) => {
    await ok(reporter.client, '/api/report', { targetId: target.id, missionId: mission.id, requestId: requestId() })
    const report = (await getStaff(f.admin)).reports.find(candidate => (
      candidate.reporterId === reporter.id && candidate.targetId === target.id && candidate.status === 'pending'
    ))
    assert.ok(report)
    return report
  }
  const decision = (report, verdict) => f.action('review', { id: report.id, decision: verdict })

  await fails(casey.client, [400, 409], '/api/report', {
    targetId: casey.id, missionId: bells.id, requestId: requestId(),
  })
  const correct = await submit(casey, blair, bows)
  assert.equal(correct.match, true)
  assert.equal(correct.actualTitle, bows.title)
  await fails(casey.client, 409, '/api/report', { targetId: blair.id, missionId: bows.id, requestId: requestId() })
  const duplicateTarget = await submit(drew, blair, bows)
  const wrong = await submit(casey, maya, bells)
  assert.equal(wrong.match, false)
  const returning = browser(f.app)
  await ok(returning, '/api/login', { id: casey.id, pin: '0426' })
  const pendingReport = (await ok(returning, '/api/player')).reports.find(report => report.id === wrong.id)
  assert.equal(pendingReport.status, 'pending')
  assert.doesNotMatch(JSON.stringify(await ok(casey.client, '/api/player')), /actualTitle|actualMission|Bow Bureau.*actual/)
  const staleOptions = await ok(blair.client, '/api/options')
  assert.equal(staleOptions.players.some(p => p.id === casey.id), true)

  const rejectBody = { action: 'review', id: wrong.id, decision: 'rejected' }
  const repeatRejections = await Promise.all([
    f.admin.request('/api/staff/action', rejectBody),
    f.admin.request('/api/staff/action', rejectBody),
  ])
  assert.ok(repeatRejections.some(({ status }) => status < 300))
  assert.ok(repeatRejections.every(({ status }) => status < 300 || status === 409))
  assert.equal((await getPlayer(casey.client)).lives, 1)

  const approveBody = { action: 'review', id: correct.id, decision: 'approved' }
  const repeatApprovals = await Promise.all([
    f.admin.request('/api/staff/action', approveBody),
    f.admin.request('/api/staff/action', approveBody),
  ])
  assert.ok(repeatApprovals.some(({ status }) => status < 300))
  assert.ok(repeatApprovals.every(({ status }) => status < 300 || status === 409))
  assert.equal((await getPlayer(blair.client)).lives, 0)
  assert.equal((await getPlayer(blair.client)).status, 'eliminated')
  assert.equal((await getPlayer(casey.client)).lives, 1)
  assert.equal((await getStaff(f.admin)).reports.find(r => r.id === duplicateTarget.id).status, 'cancelled')
  await fails(blair.client, 409, '/api/progress', { delta: 1, requestId: requestId() })
  await fails(blair.client, 409, '/api/report', { targetId: casey.id, missionId: bells.id, requestId: requestId() })

  const wrongAgain = await submit(casey, drew, bows)
  await decision(wrongAgain, 'rejected')
  assert.equal((await getPlayer(casey.client)).status, 'eliminated')
  assert.equal((await getPlayer(casey.client)).lives, 0)

  const activity = (await getStaff(f.admin)).events.filter(event => ['compromised', 'eliminated'].includes(event.type))
  const reveals = activity.sort((a, b) => timestamp(a.startAt) - timestamp(b.startAt))
  assert.equal(reveals.length, 2)
  const [first, second] = reveals
  assert.equal(first.type, 'compromised')
  assert.equal(second.type, 'eliminated')
  assert.equal(second.name, 'Casey')
  assert.equal(timestamp(first.startAt), now + 5000)
  assert.ok(timestamp(second.startAt) >= timestamp(first.endAt))
  const prereveal = await ok(f.screen, '/api/screen')
  assert.doesNotMatch(JSON.stringify(prereveal), /Blair|Collect two compliments/)
  t.mock.timers.setTime(timestamp(first.startAt) + 1)
  const compromised = (await ok(f.screen, '/api/screen')).event
  assert.equal(compromised.id, first.id)
  assert.equal(compromised.name, 'Blair')
  assert.match(compromised.mission, /ribbon/i)
  t.mock.timers.setTime(timestamp(second.startAt) + 1)
  const wrongVerdict = (await ok(f.screen, '/api/screen')).event
  assert.equal(wrongVerdict.id, second.id)
  assert.equal(wrongVerdict.name, 'Casey')
  assert.ok(!wrongVerdict.mission)
  t.mock.timers.setTime(timestamp(second.endAt) + 1)
  const reconnected = browser(f.app)
  await ok(reconnected, '/api/screen/login', { password: PRESENTATION_PASSWORD })
  assert.equal((await ok(reconnected, '/api/screen')).event, null)
})

test('staff can rename, reset credentials, revive, reassign and remove participants', async t => {
  const f = fixture(t)
  await f.staffLogin()
  const oldMission = await f.addMission('Candy Cane', 'Collect candy canes.', 4)
  const newMission = await f.addMission('Christmas Star', 'Spot a star.', 3)
  const player = await f.register('Quinn')
  await f.register('Riley')
  await f.action('playerAssign', { id: player.id, missionId: oldMission.id })
  await f.action('phase', { phase: 'live' })

  await fails(f.admin, 409, '/api/staff/action', { action: 'playerEdit', id: player.id, name: 'riley' })
  await f.action('playerEdit', { id: player.id, name: 'Agent Quinn', lives: 1, progress: 2 })
  const edited = await getPlayer(player.client)
  assert.equal(edited.id, player.id)
  assert.equal(edited.name, 'Agent Quinn')
  assert.equal(edited.lives, 1)
  assert.equal(edited.progress, 2)
  await f.action('playerEdit', { id: player.id, lives: 0 })
  assert.equal((await getPlayer(player.client)).status, 'eliminated')
  await f.action('playerEdit', { id: player.id, lives: 2 })
  assert.equal((await getPlayer(player.client)).status, 'alive')
  await f.action('playerAssign', { id: player.id, missionId: newMission.id })
  const reassigned = await getPlayer(player.client)
  assert.equal(reassigned.mission.id, newMission.id)
  assert.equal(reassigned.progress, 0)

  const replacement = '6392'
  await f.action('playerEdit', { id: player.id, pin: replacement })
  await fails(browser(f.app), 401, '/api/login', { id: player.id, pin: '0426' })
  await ok(player.client, '/api/login', { id: player.id, pin: replacement })
  await f.action('playerRemove', { id: player.id })
  assert.equal((await ok(f.visitor, '/api/roster?q=quinn')).players.length, 0)
  assert.equal(await getPlayer(player.client), null)
  const state = await getStaff(f.admin)
  assert.equal(state.players.some(p => p.id === player.id), false)
  assert.ok(state.audit.length >= 7)
  assert.doesNotMatch(JSON.stringify(state.audit), /"(?:6392|0426)"/)
})

test('ending saves an authoritative winner snapshot and new rounds preserve the catalog', async t => {
  const now = Date.now()
  t.mock.timers.enable({ apis: ['Date'], now })
  const f = fixture(t)
  await f.staffLogin()
  await f.screenLogin()
  const star = await f.addMission('Star Keeper', 'Find a golden star.', 1)
  const survivor = await f.register('Ife')
  const caught = await f.register('Jordan')
  const unfinished = await f.register('Maya')
  await f.action('phase', { phase: 'live' })
  await ok(survivor.client, '/api/progress', { delta: 1, requestId: requestId() })
  await ok(caught.client, '/api/progress', { delta: 1, requestId: requestId() })
  await f.action('playerEdit', { id: caught.id, lives: 0 })
  await f.action('phase', { phase: 'ended' })
  const staff = await getStaff(f.admin)
  const priorRound = staff.round.id
  assert.equal(staff.round.phase, 'ended')
  assert.deepEqual(staff.results.winners.map(person => person.id), [survivor.id])
  assert.equal(staff.results.players, 3)
  assert.equal(staff.results.survivors, 2)
  assert.equal(staff.results.completed, 2)
  assert.equal((await ok(survivor.client, '/api/player')).winner, true)
  assert.equal((await ok(caught.client, '/api/player')).winner, false)
  assert.equal((await ok(unfinished.client, '/api/player')).winner, false)
  await fails(unfinished.client, 409, '/api/progress', { delta: 1, requestId: requestId() })
  await fails(unfinished.client, 409, '/api/report', { targetId: survivor.id, missionId: star.id, requestId: requestId() })
  const winnersEvent = staff.events.find(event => event.type === 'winners')
  assert.ok(winnersEvent)
  t.mock.timers.setTime(timestamp(winnersEvent.startAt) + 1)
  const finale = await ok(f.screen, '/api/screen')
  assert.equal(finale.event.type, 'winners')
  const { participants, ...publicResults } = staff.results
  assert.equal(participants.length, 3)
  assert.deepEqual(finale.results, publicResults)
  t.mock.timers.setTime(timestamp(winnersEvent.endAt) + 1)
  const finalDisplay = await ok(f.screen, '/api/screen')
  assert.deepEqual(finalDisplay.results, publicResults)
  assert.equal(finalDisplay.event, null)

  await f.action('reset', { keepPlayers: true, randomize: false })
  const newRound = await getStaff(f.admin)
  assert.notEqual(newRound.round.id, priorRound)
  assert.equal(newRound.round.phase, 'lobby')
  assert.equal(newRound.missions[0].id, star.id)
  assert.equal(newRound.players.length, 3)
  assert.ok(newRound.players.every(person => person.lives === 2 && person.progress === 0 && person.status === 'alive'))
  assert.deepEqual(newRound.reports, [])
  assert.equal((await ok(f.screen, '/api/screen')).results, null)
  await f.action('phase', { phase: 'live' })
  await fails(survivor.client, 409, '/api/progress', { delta: 1, requestId: requestId(), roundId: priorRound })
  assert.equal((await getPlayer(survivor.client)).progress, 0)
})

test('balanced assignment, late registration policy and round history use one persistent game state', async t => {
  const f = fixture(t)
  await f.staffLogin()
  const first = await f.addMission('Silent Night', 'Ask someone to hum quietly.')
  const second = await f.addMission('Reindeer Roll Call', 'Get someone to name a reindeer.')
  const players = []
  for (const name of ['Noel', 'Holly', 'Finley', 'Robin', 'Angel', 'Avery']) {
    players.push(await f.register(name))
  }
  await f.action('settings', { lateJoin: false, delay: 0, duration: 2 })
  await f.action('phase', { phase: 'live' })
  const initial = await getStaff(f.admin)
  const assignments = initial.players.map(player => player.mission.id)
  assert.equal(assignments.filter(id => id === first.id).length, 3)
  assert.equal(assignments.filter(id => id === second.id).length, 3)
  await fails(f.visitor, [403, 409], '/api/register', { name: 'Late Agent', pin: '0216' })

  await f.action('phase', { phase: 'ended' })
  const archivedRound = await getStaff(f.admin)
  assert.deepEqual(archivedRound.results.winners, [])
  await f.action('reset', { keepPlayers: true, randomize: true })
  const after = await getStaff(f.admin)
  assert.equal(after.history[0].id ?? after.history[0].roundId, archivedRound.round.id)
  for (const player of players) {
    const prior = initial.players.find(candidate => candidate.id === player.id)
    const updated = await getPlayer(player.client)
    assert.ok([first.id, second.id].includes(updated.mission?.id))
    assert.notEqual(updated.mission.id, prior.mission.id)
  }
  const newAgent = await f.register('Late Agent')
  assert.equal(newAgent.status, 'alive')
})

test('two dozen browser clients can maintain independent sessions and submit progress together', async t => {
  const f = fixture(t)
  await f.staffLogin()
  await f.addMission('Workshop Audit', 'Ask someone to name a festive color.')
  const groups = [0, 8, 16]
  const players = []
  for (const start of groups) {
    players.push(...await Promise.all(Array.from({ length: 8 }, (_, index) => f.register(`Agent ${start + index + 1}`))))
  }
  assert.equal(new Set(players.map(player => player.id)).size, 24)
  await f.action('phase', { phase: 'live' })
  const progress = players.map(player => ({
    client: player.client,
    input: { delta: 1, requestId: requestId() },
  }))
  await Promise.all(progress.map(async ({ client, input }) => {
    const attempt = await client.request('/api/progress', input)
    if (attempt.status === 503) await ok(client, '/api/progress', input)
    else assert.ok(attempt.status < 300)
  }))
  const staff = await getStaff(f.admin)
  assert.equal(staff.players.length, 24)
  assert.ok(staff.players.every(player => player.progress === 1 && player.lives === 2))
})

test('projector announcement, countdown, idle override and replay do not overlap', async t => {
  const now = Date.now()
  t.mock.timers.enable({ apis: ['Date'], now })
  const f = fixture(t)
  await f.staffLogin()
  await f.screenLogin()
  await f.action('announce', { title: 'Workshop Break', message: 'Gather by the tree.' })
  await f.action('countdown', { seconds: 5 })
  const state = await getStaff(f.admin)
  const notice = state.events.find(event => event.type === 'announcement')
  const countdown = state.events.find(event => event.type === 'countdown')
  assert.ok(timestamp(countdown.startAt) >= timestamp(notice.endAt))
  const current = await ok(f.screen, '/api/screen')
  assert.equal(current.event.id, notice.id)
  assert.equal(current.event.message, 'Gather by the tree.')
  await f.action('screenIdle')
  assert.equal((await ok(f.screen, '/api/screen')).event, null)
  await f.action('replay', { id: notice.id })
  const replay = (await ok(f.screen, '/api/screen')).event
  assert.notEqual(replay.id, notice.id)
  assert.equal(replay.title, notice.title)
})

test('demo fixtures are deliberate and disabled on production-mode runs', async t => {
  const live = fixture(t)
  await live.staffLogin()
  assert.deepEqual((await getStaff(live.admin)).missions, [])
  await fails(live.admin, 403, '/api/staff/action', { action: 'seed' })

  const demo = fixture(t, config(':memory:', true))
  await demo.staffLogin()
  assert.deepEqual((await getStaff(demo.admin)).players, [])
  await demo.action('seed')
  const state = await getStaff(demo.admin)
  assert.ok(state.missions.length >= 5)
  assert.ok(state.players.length >= 5)
  await ok(demo.visitor, '/api/login', { id: state.players[0].id, pin: '2468' })
  assert.ok((await getPlayer(demo.visitor)).id)
})

test('player, staff and projector shells load their own styles and executable modules', async t => {
  const f = fixture(t)
  for (const [route, view] of [['/', 'player'], ['/staff', 'staff'], ['/screen', 'screen']]) {
    const response = await f.visitor.request(route)
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type'), /^text\/html/)
    assert.match(response.data, /<meta name="viewport"/)
    assert.ok(response.data.includes(`/${view}.css`))
    assert.ok(response.data.includes(`/${view}.js`))
    assert.match((await f.visitor.request(`/${view}.js`)).headers.get('content-type'), /javascript/)
    assert.match((await f.visitor.request(`/${view}.css`)).headers.get('content-type'), /^text\/css/)
  }
  const emblem = await f.visitor.request('/art/emblem.svg')
  assert.equal(emblem.status, 200)
  assert.match(emblem.headers.get('content-type'), /svg/)
})

test('the shared landing page shortcuts work after player registration closes', async t => {
  const f = fixture(t)
  assert.deepEqual(playerEntry('  Sky   Snow  ', true), { name: 'Sky Snow' })
  assert.match(playerEntry('Sky Snow', false).error, /closed/i)
  const screen = playerEntry('  JHU ASA  Presentation Screen ', false)
  const staff = playerEntry(' JHU ASA 2026 ', false)
  assert.deepEqual(screen, { path: '/screen' })
  assert.deepEqual(staff, { path: '/staff' })
  for (const { path } of [screen, staff]) {
    assert.equal((await f.visitor.request(path)).status, 200)
    await fails(f.visitor, 401, `/api${path}`)
  }
})

test('each tutorial step uses a distinct, served elf illustration', async t => {
  const f = fixture(t)
  const images = ruleScenes.map(([, , image]) => image)
  assert.equal(images.length, 6)
  assert.equal(new Set(images).size, 6)
  for (const image of images) {
    const response = await f.visitor.request(image)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'image/webp')
  }
})
