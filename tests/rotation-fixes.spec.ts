import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkBuddyAccountPool } from '../src/account-pool.ts'
import { WorkBuddyRotation } from '../src/rotation.ts'
import { CN_VARIANT } from '../src/variants.ts'
import { WorkBuddyRefreshFailure } from '../src/upstream.ts'
import type { WorkBuddyChatResult } from '../src/upstream.ts'
import type { WorkBuddyCredential } from '../src/auth.ts'

/** Replays one 30-second credential sweep of the desktop sign-in. */
function sweep(pool: WorkBuddyAccountPool, accessToken: string, expiresAtMs: number) {
  return pool.upsert({
    uid: 'desk', enterpriseId: 'ent', nickname: 'desk', domain: 'copilot.tencent.com',
    accessToken, refreshToken: 'rt-desk', expiresAtMs, origin: 'desktop', sync: true,
  })
}

const CLEANUP: (() => Promise<void>)[] = []
afterEach(async () => { await Promise.all(CLEANUP.splice(0).map(clean => clean())) })

async function makePool(): Promise<WorkBuddyAccountPool> {
  const dir = await mkdtemp(join(tmpdir(), 'wb-fix-'))
  CLEANUP.push(() => rm(dir, { recursive: true, force: true }))
  return new WorkBuddyAccountPool({ variant: CN_VARIANT, path: join(dir, 'accounts.json') })
}

function add(pool: WorkBuddyAccountPool, uid: string, expiresAtMs = Date.now() + 3_600_000): string {
  return pool.upsert({
    uid, enterpriseId: 'ent', nickname: uid, domain: 'copilot.tencent.com',
    accessToken: `at-${uid}`, refreshToken: `rt-${uid}`, expiresAtMs, origin: 'qr',
  }).account.id
}

describe('fix P0-1: the sweep no longer erases pool state', () => {
  it('keeps a disable and a benching', async () => {
    const pool = await makePool()
    // One expiry, reused: the same credential the file already produced, so the
    // sweep has nothing new to adopt. Re-reading `Date.now()` here would make
    // the second call look a millisecond *newer* and turn this into a test of
    // the opposite case.
    const expiry = Date.now() + 1000
    const id = add(pool, 'desk', expiry)
    pool.setEnabled(id, false)
    pool.cooldown(id, 'rate', 6 * 3600_000)

    sweep(pool, 'at-desk', expiry)
    const after = pool.get(id)!
    expect(after.enabled).toBe(false)
    expect(after.cooldown?.untilMs).toBeGreaterThan(Date.now() + 3_600_000)
    expect(after.failureStreak).toBe(1)
  })

  it('keeps a refreshed token rather than restoring the file\'s older one', async () => {
    const pool = await makePool()
    const id = add(pool, 'desk', Date.now() + 1000)
    pool.updateTokens(id, { accessToken: 'plugin-refreshed', expiresAtMs: Date.now() + 3_600_000 })

    sweep(pool, 'file-stale', Date.now() + 1000)
    const after = pool.get(id)!
    expect(after.accessToken).toBe('plugin-refreshed')
    expect(after.expiresAtMs).toBeGreaterThan(Date.now() + 3_500_000)
  })

  it('keeps a dead session across sweeps', async () => {
    const pool = await makePool()
    const expiry = Date.now() + 1000
    const id = add(pool, 'desk', expiry)
    pool.cooldown(id, 'session')
    pool.markSessionDead(id)

    sweep(pool, 'at-desk', expiry)
    expect(pool.get(id)?.sessionDead).toBe(true)
  })

  it('adopts a credential the file demonstrably moved forward to', async () => {
    const pool = await makePool()
    const id = add(pool, 'desk', Date.now() + 1000)
    pool.cooldown(id, 'session')
    pool.markSessionDead(id)

    sweep(pool, 'file-new', Date.now() + 7_200_000)
    const after = pool.get(id)!
    expect(after.accessToken).toBe('file-new')
    // A sign-in contradicts the dead session and the benching alike.
    expect(after.sessionDead).toBeUndefined()
    expect(after.cooldown).toBeUndefined()
  })

  it('does not rewrite the file when nothing changed', async () => {
    const pool = await makePool()
    const expiry = Date.now() + 3_600_000
    const id = add(pool, 'desk', expiry)
    const before = JSON.parse(await readFile(pool.filePath(), 'utf8')) as { accounts: { updatedAtMs: number }[] }
    const stamp = before.accounts[0]!.updatedAtMs
    await new Promise(resolve => setTimeout(resolve, 5))
    // The very same credential the pool already holds: nothing to adopt.
    sweep(pool, 'at-desk', expiry)
    const after = JSON.parse(await readFile(pool.filePath(), 'utf8')) as { accounts: { updatedAtMs: number }[] }
    expect(after.accounts[0]!.updatedAtMs).toBe(stamp)
    expect(pool.get(id)?.accessToken).toBe('at-desk')
  })
})

describe('fix P0-2: a refresh that never reached a verdict', () => {
  it('benches instead of signing the account out', async () => {
    const pool = await makePool()
    const a = add(pool, 'a')
    add(pool, 'b')
    const client = {
      async chatStream(credential: WorkBuddyCredential): Promise<WorkBuddyChatResult> {
        if (credential.uid === 'a') return { ok: false, status: 401, kind: 'session_dead', message: 'expired' }
        return { ok: true, response: new Response('data: [DONE]\n\n', { status: 200 }) }
      },
      async refreshToken(): Promise<never> {
        throw new WorkBuddyRefreshFailure('server', 'transport error: socket hang up')
      },
    }
    const outcome = await new WorkBuddyRotation({ pool, client }).send('{}')
    expect(outcome.result.ok).toBe(true)
    const account = pool.get(a)!
    expect(account.sessionDead).toBeUndefined()
    expect(account.cooldown?.reason).toBe('rate')
    expect(pool.next(new Set())?.uid).toBe('b')
  })

  it('still signs the account out when the refresh is refused', async () => {
    const pool = await makePool()
    const a = add(pool, 'a')
    add(pool, 'b')
    const client = {
      async chatStream(credential: WorkBuddyCredential): Promise<WorkBuddyChatResult> {
        if (credential.uid === 'a') return { ok: false, status: 401, kind: 'session_dead', message: 'gone' }
        return { ok: true, response: new Response('data: [DONE]\n\n', { status: 200 }) }
      },
      async refreshToken(): Promise<never> {
        throw new WorkBuddyRefreshFailure('session_dead', 'workbuddy upstream session_dead (http 401)')
      },
    }
    await new WorkBuddyRotation({ pool, client }).send('{}')
    expect(pool.get(a)?.sessionDead).toBe(true)
  })

  it('lets the user put a dead account back in rotation', async () => {
    const pool = await makePool()
    const a = add(pool, 'a')
    pool.markSessionDead(a)
    expect(pool.isAvailable(pool.get(a)!)).toBe(false)
    pool.setEnabled(a, true)
    expect(pool.isAvailable(pool.get(a)!)).toBe(true)
    expect(pool.next(new Set())?.uid).toBe('a')
  })
})

describe('fix P1-3: the backoff schedule actually grows', () => {
  it('doubles the wait for each consecutive failure', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-13T10:00:00Z') })
    try {
      const pool = await makePool()
      const id = add(pool, 'a')
      const waits: number[] = []
      for (let round = 0; round < 4; round += 1) {
        const before = Date.now()
        const cooldown = pool.cooldown(id, 'rate')
        waits.push((cooldown?.untilMs ?? 0) - before)
        vi.setSystemTime(new Date((cooldown?.untilMs ?? Date.now()) + 1000))
      }
      expect(waits).toEqual([60_000, 120_000, 240_000, 480_000])
      // A success is what resets it.
      pool.clearCooldown(id)
      const afterSuccess = pool.cooldown(id, 'rate')
      expect((afterSuccess?.untilMs ?? 0) - Date.now()).toBe(60_000)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('fix P1-4: two requests in the same millisecond', () => {
  it('claim different accounts', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-13T10:00:00Z') })
    try {
      const pool = await makePool()
      for (const uid of ['a', 'b', 'c']) add(pool, uid)
      // Cold pool: every account has lastUsedAtMs 0 and the clock never moves.
      const first = pool.next(new Set())
      const second = pool.next(new Set())
      const third = pool.next(new Set())
      expect([first?.uid, second?.uid, third?.uid]).toEqual(['a', 'b', 'c'])
      expect(pool.next(new Set())?.uid).toBe('a')
    } finally {
      vi.useRealTimers()
    }
  })
})
