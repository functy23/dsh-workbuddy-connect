import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  accountIdOf,
  cooldownDurationMs,
  credentialOf,
  WorkBuddyAccountPool,
} from '../src/account-pool.ts'
import { WorkBuddyRotation, isAccountScoped, parseResetTimeHint, parseRetryAfter } from '../src/rotation.ts'
import { CN_VARIANT } from '../src/variants.ts'
import type { WorkBuddyChatResult, WorkBuddyRefreshOutcome } from '../src/upstream.ts'
import type { WorkBuddyCredential } from '../src/auth.ts'

/**
 * Rotation: what happens to one chat request when an account is limited.
 *
 * These are the tests that make the feature's promise real — "a 429 on one
 * account is answered by another account" — so they assert on the *sequence of
 * accounts the upstream saw*, not on the rotation's internal bookkeeping.
 */

const CLEANUP: (() => Promise<void>)[] = []

afterEach(async () => {
  await Promise.all(CLEANUP.splice(0).map(clean => clean()))
  vi.unstubAllEnvs()
})

async function makePool(): Promise<WorkBuddyAccountPool> {
  const dir = await mkdtemp(join(tmpdir(), 'wb-rotation-'))
  CLEANUP.push(() => rm(dir, { recursive: true, force: true }))
  return new WorkBuddyAccountPool({ variant: CN_VARIANT, path: join(dir, 'accounts.json') })
}

/** Add one account and return its identity. */
function add(pool: WorkBuddyAccountPool, uid: string, domain = 'copilot.tencent.com'): string {
  const result = pool.upsert({
    uid,
    enterpriseId: 'ent-1',
    nickname: uid,
    domain,
    accessToken: `at-${uid}`,
    refreshToken: `rt-${uid}`,
    expiresAtMs: Date.now() + 3_600_000,
    origin: 'qr',
  })
  return result.account.id
}

/** A sender that answers per account, recording who was asked. */
function recorder(answer: (uid: string, attempt: number) => WorkBuddyChatResult): {
  seen: string[]
  client: { chatStream: (credential: WorkBuddyCredential, body: string, signal?: AbortSignal) => Promise<WorkBuddyChatResult>, refreshToken: (credential: WorkBuddyCredential) => Promise<WorkBuddyRefreshOutcome> }
} {
  const seen: string[] = []
  const counts = new Map<string, number>()
  return {
    seen,
    client: {
      async chatStream(credential): Promise<WorkBuddyChatResult> {
        seen.push(credential.uid)
        const attempt = (counts.get(credential.uid) ?? 0) + 1
        counts.set(credential.uid, attempt)
        return answer(credential.uid, attempt)
      },
      async refreshToken(credential): Promise<WorkBuddyRefreshOutcome> {
        return { accessToken: `at-${credential.uid}-refreshed` }
      },
    },
  }
}

const ok = (): WorkBuddyChatResult => ({ ok: true, response: new Response('data: [DONE]\n\n', { status: 200 }) })
const rate = (retryAfter?: string, message = 'rate limited'): WorkBuddyChatResult => ({
  ok: false, status: 429, kind: 'soft_rate', message,
  ...retryAfter === undefined ? {} : { retryAfter },
})

/**
 * The two products' real 429 bodies, copied from live responses.
 *
 * Both state when the allowance returns, in the body rather than in a header —
 * which is the whole reason the plugin could not previously do better than its
 * own backoff.
 */
const RATE_LIMIT_EN = '{"code":6004,"msg":"usage exceeds frequency limit, but don\'t worry, your usage will reset at 2026-09-13 21:50:51 UTC+8, alternatively, you can switch to the other models to continue using it.","requestId":"5ed1453d"}'
const RATE_LIMIT_CN = '{"code":6004,"msg":"您的使用量已超出频率限制，将在 2026-09-14 11:57:16 UTC+8 重置，您也可以切换其他模型继续使用。","requestId":"f34605c2"}'
const credit = (): WorkBuddyChatResult => ({ ok: false, status: 402, kind: 'hard_credit', message: 'no credit' })
const dead = (): WorkBuddyChatResult => ({ ok: false, status: 401, kind: 'session_dead', message: 'session dead' })
const badRequest = (): WorkBuddyChatResult => ({ ok: false, status: 400, kind: 'client', message: 'bad model' })

describe('rotation on a limited account', () => {
  it('switches to another account when the first answers 429', async () => {
    const pool = await makePool()
    const first = add(pool, 'uid-a')
    const second = add(pool, 'uid-b')
    // Pool order is the tiebreak while both are unused, so uid-a goes first.
    const { seen, client } = recorder(uid => uid === 'uid-a' ? rate() : ok())
    const rotation = new WorkBuddyRotation({ pool, client })
    const outcome = await rotation.send('{}')
    expect(outcome.result.ok).toBe(true)
    expect(seen).toEqual(['uid-a', 'uid-b'])
    expect(outcome.attempts).toEqual([first, second])
  })

  it('tries every healthy account once, then reports the last failure', async () => {
    const pool = await makePool()
    add(pool, 'uid-a')
    add(pool, 'uid-b')
    add(pool, 'uid-c')
    const { seen, client } = recorder(() => rate())
    const rotation = new WorkBuddyRotation({ pool, client })
    const outcome = await rotation.send('{}')
    // Each account exactly once: a pool of three costs three upstream calls,
    // never a loop.
    expect(seen).toEqual(['uid-a', 'uid-b', 'uid-c'])
    expect(outcome.result.ok).toBe(false)
    expect(outcome.exhausted).toBe(true)
  })

  it('does not retry an account that was already tried', async () => {
    const pool = await makePool()
    add(pool, 'uid-a')
    add(pool, 'uid-b')
    const { seen, client } = recorder(uid => uid === 'uid-a' ? rate() : credit())
    const rotation = new WorkBuddyRotation({ pool, client })
    await rotation.send('{}')
    expect(seen).toEqual(['uid-a', 'uid-b'])
  })

  it('benches a rate-limited account and prefers the other one next time', async () => {
    const pool = await makePool()
    const a = add(pool, 'uid-a')
    add(pool, 'uid-b')
    const { seen, client } = recorder(uid => uid === 'uid-a' ? rate() : ok())
    const rotation = new WorkBuddyRotation({ pool, client })
    await rotation.send('{}')
    seen.length = 0
    // uid-a is benched, so the next request starts at uid-b.
    await rotation.send('{}')
    expect(seen).toEqual(['uid-b'])
    expect(pool.get(a)?.cooldown).toBeDefined()
  })

  /**
   * The end the user actually sees: a 429 that names its reset benches the
   * account until then, not for the schedule's fifteen-minute ceiling.
   *
   * Only `Date` is faked, so the promises rotation chains still settle on real
   * timers.
   */
  it('benches a rate-limited account until the reset the body states', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(Date.UTC(2026, 8, 13, 10, 0, 0)) })
    try {
      const pool = await makePool()
      const a = add(pool, 'uid-a')
      add(pool, 'uid-b')
      const { client } = recorder(uid => uid === 'uid-a' ? rate(undefined, RATE_LIMIT_CN) : ok())
      const rotation = new WorkBuddyRotation({ pool, client })
      await rotation.send('{}')
      const cooldown = pool.get(a)?.cooldown
      expect(cooldown?.reason).toBe('rate')
      // 17h57m16s, not the 60s the backoff schedule would have chosen and not
      // the 15-minute cap it would have clamped it to.
      const expected = 17 * 3600_000 + 57 * 60_000 + 16_000
      expect((cooldown?.untilMs ?? 0) - Date.now()).toBe(expected)
    } finally {
      vi.useRealTimers()
    }
  })

  it('honours the upstream Retry-After over its own backoff', async () => {
    const pool = await makePool()
    const a = add(pool, 'uid-a')
    add(pool, 'uid-b')
    const { client } = recorder(uid => uid === 'uid-a' ? rate('120') : ok())
    const rotation = new WorkBuddyRotation({ pool, client })
    const before = Date.now()
    await rotation.send('{}')
    const cooldown = pool.get(a)?.cooldown
    expect(cooldown).toBeDefined()
    // 120 seconds, not the one-minute schedule.
    expect((cooldown?.untilMs ?? 0) - before).toBeGreaterThan(110_000)
    expect((cooldown?.untilMs ?? 0) - before).toBeLessThan(130_000)
  })

  it('grows the cooldown on repeated failures and clears it on success', async () => {
    const pool = await makePool()
    const a = add(pool, 'uid-a')
    // First strike: 60s. Then simulate the benching expiring and failing again.
    pool.cooldown(a, 'rate')
    expect(pool.get(a)?.cooldown?.strikes).toBe(1)
    const firstUntil = pool.get(a)?.cooldown?.untilMs ?? 0
    // Force the cooldown into the past so the second failure counts as a repeat.
    pool.updateTokens(a, { accessToken: 'at-uid-a' })
    const forced = pool.get(a) as NonNullable<ReturnType<WorkBuddyAccountPool['get']>>
    expect(forced).toBeDefined()
    pool.cooldown(a, 'rate')
    // Not yet expired, so this is the second consecutive strike.
    expect(pool.get(a)?.cooldown?.strikes).toBe(2)
    expect(pool.get(a)?.cooldown?.untilMs ?? 0).toBeGreaterThan(firstUntil)
    pool.clearCooldown(a)
    expect(pool.get(a)?.cooldown).toBeUndefined()
    expect(cooldownDurationMs('credit', 1)).toBe(3_600_000)
    expect(cooldownDurationMs('credit', 5)).toBeLessThanOrEqual(24 * 3_600_000)
  })

  it('benches an exhausted-quota account far longer than a rate limit', async () => {
    const pool = await makePool()
    const a = add(pool, 'uid-a')
    add(pool, 'uid-b')
    const { client } = recorder(uid => uid === 'uid-a' ? credit() : ok())
    const rotation = new WorkBuddyRotation({ pool, client })
    const before = Date.now()
    await rotation.send('{}')
    const cooldown = pool.get(a)?.cooldown
    expect(cooldown?.reason).toBe('credit')
    expect((cooldown?.untilMs ?? 0) - before).toBeGreaterThan(3_500_000)
  })

  it('refreshes the token once on a dead session, then keeps the account', async () => {
    const pool = await makePool()
    const a = add(pool, 'uid-a')
    const { seen, client } = recorder((uid, attempt) => attempt === 1 ? dead() : ok())
    const rotation = new WorkBuddyRotation({ pool, client })
    const outcome = await rotation.send('{}')
    // Two calls to the SAME account: the refresh saved it rather than rotating.
    expect(seen).toEqual(['uid-a', 'uid-a'])
    expect(outcome.result.ok).toBe(true)
    expect(pool.get(a)?.sessionDead).toBeUndefined()
    expect(pool.get(a)?.accessToken).toBe('at-uid-a-refreshed')
  })

  it('marks a session dead and moves on when the refresh cannot save it', async () => {
    const pool = await makePool()
    const a = add(pool, 'uid-a')
    add(pool, 'uid-b')
    const { seen, client } = recorder(uid => uid === 'uid-a' ? dead() : ok())
    const rotation = new WorkBuddyRotation({ pool, client })
    const outcome = await rotation.send('{}')
    expect(seen).toEqual(['uid-a', 'uid-a', 'uid-b'])
    expect(outcome.result.ok).toBe(true)
    expect(pool.get(a)?.sessionDead).toBe(true)
    // A dead session is never picked again.
    expect(pool.next(new Set())?.uid).toBe('uid-b')
  })

  it('does not rotate for a failure that is about the request', async () => {
    const pool = await makePool()
    add(pool, 'uid-a')
    add(pool, 'uid-b')
    const { seen, client } = recorder(() => badRequest())
    const rotation = new WorkBuddyRotation({ pool, client })
    const outcome = await rotation.send('{}')
    // A 400 would fail identically as anybody else, so nobody else is spent.
    expect(seen).toEqual(['uid-a'])
    expect(outcome.result.ok).toBe(false)
    expect(outcome.exhausted).toBeUndefined()
  })

  it('reports "no account" rather than calling upstream with nothing', async () => {
    const pool = await makePool()
    const { seen, client } = recorder(() => ok())
    const rotation = new WorkBuddyRotation({ pool, client })
    const outcome = await rotation.send('{}')
    expect(seen).toEqual([])
    expect(outcome.result.ok).toBe(false)
    expect(outcome.exhausted).toBe(true)
  })

  it('skips disabled, benched, and dead accounts when choosing', async () => {
    const pool = await makePool()
    const a = add(pool, 'uid-a')
    const b = add(pool, 'uid-b')
    const c = add(pool, 'uid-c')
    pool.setEnabled(a, false)
    pool.cooldown(b, 'rate')
    pool.markSessionDead(c)
    expect(pool.next(new Set())).toBeUndefined()
    pool.setEnabled(a, true)
    expect(pool.next(new Set())?.uid).toBe('uid-a')
  })

  it('persists a mid-rotation refresh so a restart does not repeat it', async () => {
    const pool = await makePool()
    const a = add(pool, 'uid-a')
    const { client } = recorder((uid, attempt) => attempt === 1 ? dead() : ok())
    const rotation = new WorkBuddyRotation({ pool, client })
    await rotation.send('{}')
    const document = JSON.parse(await readFile(pool.filePath(), 'utf8')) as {
      accounts: readonly { id: string, accessToken: string }[]
    }
    expect(document.accounts.find(account => account.id === a)?.accessToken).toBe('at-uid-a-refreshed')
  })
})

describe('rotation helpers', () => {
  it('classifies only account-scoped failures as rotatable', () => {
    expect(isAccountScoped('soft_rate')).toBe(true)
    expect(isAccountScoped('hard_credit')).toBe(true)
    expect(isAccountScoped('session_dead')).toBe(true)
    expect(isAccountScoped('client')).toBe(false)
    expect(isAccountScoped('server')).toBe(false)
    expect(isAccountScoped('not_found')).toBe(false)
  })

  /**
   * The stated reset is the whole point: a frequency limit names the moment the
   * allowance returns, and a backoff this plugin invents is at best a guess
   * about a schedule the server already knows.
   */
  it('reads the reset time out of both products\' 429 bodies', () => {
    const now = Date.UTC(2026, 8, 13, 10, 0, 0)   // 18:00 in UTC+8
    // 2026-09-13 21:50:51 UTC+8 is 3h50m51s after 18:00 UTC+8.
    expect(parseResetTimeHint(RATE_LIMIT_EN, now)).toBe(3 * 3600_000 + 50 * 60_000 + 51_000)
    // 2026-09-14 11:57:16 UTC+8 is 17h57m16s after 18:00 UTC+8.
    expect(parseResetTimeHint(RATE_LIMIT_CN, now)).toBe(17 * 3600_000 + 57 * 60_000 + 16_000)
  })

  it('refuses a reset it cannot place on the clock', () => {
    const now = Date.UTC(2026, 8, 13, 10, 0, 0)
    // No time at all.
    expect(parseResetTimeHint('usage exceeds frequency limit', now)).toBeUndefined()
    // A wall clock with no offset would have to be *assumed* to be in some zone,
    // and a wrong assumption is wrong by hours exactly when it matters.
    expect(parseResetTimeHint('reset at 2026-09-13 21:50:51', now)).toBeUndefined()
    // Already past: the allowance is back, so the caller's short backoff is the
    // right answer rather than a negative wait.
    expect(parseResetTimeHint('reset at 2026-09-13 09:00:00 UTC+8', now)).toBeUndefined()
    // Nonsense calendar fields are rejected rather than rolled over by Date.UTC.
    expect(parseResetTimeHint('reset at 2026-13-13 21:50:51 UTC+8', now)).toBeUndefined()
    expect(parseResetTimeHint('reset at 2026-09-32 21:50:51 UTC+8', now)).toBeUndefined()
  })

  it('handles the offsets and separators a reset could plausibly use', () => {
    const now = Date.UTC(2026, 8, 13, 10, 0, 0)
    // Bare UTC means UTC.
    expect(parseResetTimeHint('reset at 2026-09-13 13:50:51 UTC', now)).toBe(3 * 3600_000 + 50 * 60_000 + 51_000)
    // A negative offset moves the other way.
    expect(parseResetTimeHint('reset at 2026-09-13 09:50:51 UTC-5', now)).toBe(4 * 3600_000 + 50 * 60_000 + 51_000)
    // Half-hour zones are real.
    expect(parseResetTimeHint('reset at 2026-09-13 16:00:00 UTC+05:30', now)).toBe(30 * 60_000)
    // ISO's T separator.
    expect(parseResetTimeHint('reset at 2026-09-13T13:00:00 UTC', now)).toBe(3 * 3600_000)
    // A date absurdly far out is bounded, so a mistyped year cannot bench an
    // account indefinitely.
    expect(parseResetTimeHint('reset at 2026-12-31 23:59:59 UTC+8', now)).toBe(7 * 24 * 3600_000)
  })

  it('parses Retry-After in both of its forms and refuses nonsense', () => {
    expect(parseRetryAfter('30')).toBe(30_000)
    const now = Date.UTC(2026, 0, 1, 0, 0, 0)
    expect(parseRetryAfter(new Date(now + 45_000).toUTCString(), now)).toBe(45_000)
    expect(parseRetryAfter(undefined)).toBeUndefined()
    expect(parseRetryAfter('')).toBeUndefined()
    expect(parseRetryAfter('soon')).toBeUndefined()
    // An already-past date is not a wait.
    expect(parseRetryAfter(new Date(now - 1_000).toUTCString(), now)).toBeUndefined()
  })

  it('projects a stored account back into a credential', () => {
    const account = {
      id: accountIdOf('u', 'e'), uid: 'u', enterpriseId: 'e', nickname: 'n', domain: 'copilot.tencent.com',
      accessToken: 'at', refreshToken: 'rt', expiresAtMs: 5, origin: 'qr' as const, enabled: true,
      lastUsedAtMs: 0, addedAtMs: 0, updatedAtMs: 0,
    }
    const credential = credentialOf(account)
    expect(credential).toMatchObject({ uid: 'u', enterpriseId: 'e', accessToken: 'at', refreshToken: 'rt', domain: 'copilot.tencent.com' })
    // A QR account is stored by the plugin, not read from the desktop app.
    expect(credential.source).toBe('dsh')
  })
})
