import { createServer, request } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkBuddyAccountPool } from '../src/account-pool.ts'
import { WorkBuddyAccountService } from '../src/account-service.ts'
import { workBuddyAccountHandler } from '../src/account-route.ts'
import { WorkBuddyCredentialStore } from '../src/auth.ts'
import { WorkBuddyQrLogin } from '../src/qr-login.ts'
import { WORKBUDDY_ACCOUNT_PATH } from '../src/status-paths.ts'
import { CN_VARIANT } from '../src/variants.ts'
import type { WorkBuddyAccountResult } from '../src/status-paths.ts'

/**
 * The account control route: its guards, its action parsing, and the QR flow
 * driven end to end through HTTP with a stubbed upstream.
 *
 * The route is a write surface that can delete credentials and spend quota, so
 * the guard assertions here are as important as the feature assertions.
 */

const CLEANUP: (() => Promise<void>)[] = []

afterEach(async () => {
  await Promise.all(CLEANUP.splice(0).map(clean => clean()))
  vi.unstubAllGlobals()
})

const KEY = 'test-key'

function post(options: {
  port: number
  headers: Record<string, string>
  body: string
}): Promise<{ status: number, body: string }> {
  return new Promise((resolve, reject) => {
    const outgoing = request({
      host: '127.0.0.1',
      port: options.port,
      method: 'POST',
      path: WORKBUDDY_ACCOUNT_PATH,
      headers: options.headers,
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
    })
    outgoing.on('error', reject)
    outgoing.write(options.body)
    outgoing.end()
  })
}

/** Answer the three QR endpoints, so the flow can be driven through the route. */
function stubUpstream(options: { tokenReady?: boolean } = {}): void {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
    const url = String(input)
    const answer = (payload: unknown): Response => new Response(JSON.stringify(payload), { status: 200 })
    if (url.includes('/v2/plugin/auth/state')) {
      return answer({ code: 0, msg: 'OK', data: { state: 'st-1', authUrl: 'https://copilot.tencent.com/login?state=st-1' } })
    }
    if (url.includes('/v2/plugin/auth/token')) {
      return answer(options.tokenReady === true
        ? { code: 0, msg: 'OK', data: { accessToken: 'at-qr', refreshToken: 'rt-qr', expiresIn: 3600, domain: 'copilot.tencent.com' } }
        : { code: 11217, msg: '11217:login ing...' })
    }
    if (url.includes('/v2/plugin/login/account')) {
      return answer({ code: 0, msg: 'OK', data: { uid: 'uid-qr', nickname: '扫码账号', enterpriseId: 'ent-qr' } })
    }
    return answer({ code: -1, msg: 'unexpected' })
  }))
}

async function mount(): Promise<{ port: number, pool: WorkBuddyAccountPool, accounts: WorkBuddyAccountService }> {
  const dir = await mkdtemp(join(tmpdir(), 'wb-account-route-'))
  CLEANUP.push(() => rm(dir, { recursive: true, force: true }))
  const desktop = join(dir, 'desktop.info')
  await writeFile(desktop, JSON.stringify({
    auth: { accessToken: 'at-desktop', refreshToken: 'rt', expiresAt: Date.now() + 3_600_000, domain: 'copilot.tencent.com' },
    account: { uid: 'uid-desktop', nickname: '桌面账号' },
  }))
  const store = new WorkBuddyCredentialStore({
    variant: CN_VARIANT,
    desktopPath: desktop,
    ownPath: join(dir, 'own.json'),
    refresh: async credential => ({ accessToken: credential.accessToken }),
  })
  const pool = new WorkBuddyAccountPool({ variant: CN_VARIANT, path: join(dir, 'accounts.json') })
  const accounts = new WorkBuddyAccountService({
    variant: CN_VARIANT,
    pool,
    store,
    client: {
      fetchCredits: async () => ({ total: 42, accounts: [] }),
      refreshToken: async (credential: { accessToken: string }) => ({ accessToken: credential.accessToken }),
      chatStream: async () => ({ ok: true, response: new Response('data: [DONE]\n\n') }),
    } as never,
    qr: new WorkBuddyQrLogin({ variant: CN_VARIANT }),
  })
  await accounts.captureDesktop()
  const handler = workBuddyAccountHandler({
    handle: async action => {
      // The real handler lives in apply(); this mirrors its contract so the
      // route's own guards and parsing are what these tests exercise.
      switch (action.action) {
        case 'add': {
          const challenge = await accounts['qr'].start()
          return { state: 'ok', challenge: { state: challenge.state, authUrl: challenge.authUrl, expiresAtMs: challenge.expiresAtMs } }
        }
        case 'poll': {
          const poll = await accounts['qr'].poll(action.state)
          if (poll.status !== 'ready') return { state: poll.status }
          const added = accounts.addQrAccount(poll)
          return {
            state: 'added',
            ...added.account.nickname === undefined ? {} : { name: added.account.nickname },
            created: added.created,
          }
        }
        case 'remove': return { state: pool.remove(action.id) ? 'ok' : 'failed' }
        case 'enable': return { state: pool.setEnabled(action.id, action.enabled) ? 'ok' : 'failed' }
        case 'reorder': { pool.reorder(action.ids); return { state: 'ok' } }
        case 'refresh-credits': return { state: 'ok' }
        case 'test': return { state: 'ok', test: { ok: true, message: 'ok' } }
        case 'cancel': return { state: 'ok' }
        case 'label': return { state: 'ok' }
      }
    },
  }, KEY)
  const server = createServer(handler)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  CLEANUP.push(() => new Promise<void>(resolve => server.close(() => resolve())))
  return { port, pool, accounts }
}

const authed = (port: number): Record<string, string> => ({
  host: `127.0.0.1:${String(port)}`,
  'content-type': 'application/json',
  'x-workbuddy-probe-key': KEY,
})

describe('account control route guards', () => {
  it('refuses a request without the in-process key', async () => {
    const { port } = await mount()
    const response = await post({
      port,
      headers: { host: `127.0.0.1:${String(port)}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'add' }),
    })
    expect(response.status).toBe(403)
    expect(response.body).toContain('invalid-probe-key')
  })

  it('refuses a DNS-rebinding host and a cross-origin page', async () => {
    const { port } = await mount()
    const rebound = await post({
      port,
      headers: { host: 'evil.example.com', 'content-type': 'application/json', 'x-workbuddy-probe-key': KEY },
      body: JSON.stringify({ action: 'add' }),
    })
    expect(rebound.status).toBe(403)
    const crossOrigin = await post({
      port,
      headers: {
        host: `127.0.0.1:${String(port)}`,
        origin: 'https://evil.example.com',
        'content-type': 'application/json',
        'x-workbuddy-probe-key': KEY,
      },
      body: JSON.stringify({ action: 'add' }),
    })
    expect(crossOrigin.status).toBe(403)
  })

  it('rejects an unknown or malformed action instead of guessing', async () => {
    const { port } = await mount()
    for (const body of ['{"action":"destroy"}', '{"action":"remove"}', 'not json', '{"action":"enable","id":"x"}']) {
      const response = await post({ port, headers: authed(port), body })
      expect(response.status).toBe(400)
    }
  })

  it('answers 405 for a GET', async () => {
    const { port } = await mount()
    const response = await new Promise<number>((resolve, reject) => {
      const outgoing = request({
        host: '127.0.0.1', port, method: 'GET', path: WORKBUDDY_ACCOUNT_PATH,
        headers: { host: `127.0.0.1:${String(port)}` },
      }, res => { res.resume(); resolve(res.statusCode ?? 0) })
      outgoing.on('error', reject)
      outgoing.end()
    })
    expect(response).toBe(405)
  })
})

describe('QR add flow through the route', () => {
  it('mints a challenge, reports waiting, then adds the account', async () => {
    stubUpstream({ tokenReady: false })
    const { port, pool } = await mount()
    const start = await post({ port, headers: authed(port), body: JSON.stringify({ action: 'add' }) })
    expect(start.status).toBe(200)
    const challenge = JSON.parse(start.body) as WorkBuddyAccountResult
    expect(challenge.state).toBe('ok')
    expect(challenge.challenge?.authUrl).toContain('st-1')

    const waiting = await post({
      port, headers: authed(port),
      body: JSON.stringify({ action: 'poll', state: challenge.challenge?.state }),
    })
    expect(JSON.parse(waiting.body)).toMatchObject({ state: 'waiting' })
    expect(pool.list()).toHaveLength(1) // only the desktop account so far

    // The user scans: the same state now yields tokens.
    stubUpstream({ tokenReady: true })
    const done = await post({
      port, headers: authed(port),
      body: JSON.stringify({ action: 'poll', state: challenge.challenge?.state }),
    })
    const added = JSON.parse(done.body) as WorkBuddyAccountResult
    expect(added).toMatchObject({ state: 'added', name: '扫码账号', created: true })
    expect(pool.list()).toHaveLength(2)
    expect(pool.list().find(account => account.uid === 'uid-qr')?.origin).toBe('qr')
  })

  it('updates the tokens instead of duplicating an account that is already pooled', async () => {
    stubUpstream({ tokenReady: true })
    const { port, pool } = await mount()
    const first = await post({ port, headers: authed(port), body: JSON.stringify({ action: 'add' }) })
    const state = (JSON.parse(first.body) as WorkBuddyAccountResult).challenge?.state
    await post({ port, headers: authed(port), body: JSON.stringify({ action: 'poll', state }) })
    expect(pool.list()).toHaveLength(2)

    // Scan again as the same account.
    const again = await post({ port, headers: authed(port), body: JSON.stringify({ action: 'add' }) })
    const secondState = (JSON.parse(again.body) as WorkBuddyAccountResult).challenge?.state
    const second = await post({ port, headers: authed(port), body: JSON.stringify({ action: 'poll', state: secondState }) })
    const result = JSON.parse(second.body) as WorkBuddyAccountResult
    expect(result).toMatchObject({ state: 'added', created: false })
    // Still one QR account: the identity is the key, not the scan.
    expect(pool.list()).toHaveLength(2)
  })

  it('removes, disables, and reorders through the route', async () => {
    stubUpstream({ tokenReady: true })
    const { port, pool } = await mount()
    const start = await post({ port, headers: authed(port), body: JSON.stringify({ action: 'add' }) })
    const state = (JSON.parse(start.body) as WorkBuddyAccountResult).challenge?.state
    await post({ port, headers: authed(port), body: JSON.stringify({ action: 'poll', state }) })
    const qr = pool.list().find(account => account.uid === 'uid-qr')!

    const disabled = await post({ port, headers: authed(port), body: JSON.stringify({ action: 'enable', id: qr.id, enabled: false }) })
    expect(JSON.parse(disabled.body)).toMatchObject({ state: 'ok' })
    expect(pool.get(qr.id)?.enabled).toBe(false)

    const ids = [...pool.list()].reverse().map(account => account.id)
    const reordered = await post({ port, headers: authed(port), body: JSON.stringify({ action: 'reorder', ids }) })
    expect(JSON.parse(reordered.body)).toMatchObject({ state: 'ok' })
    expect(pool.list().map(account => account.id)).toEqual(ids)

    const removed = await post({ port, headers: authed(port), body: JSON.stringify({ action: 'remove', id: qr.id }) })
    expect(JSON.parse(removed.body)).toMatchObject({ state: 'ok' })
    expect(pool.get(qr.id)).toBeUndefined()
  })
})
