import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkBuddyAccountPool, cooldownDurationMs } from '../src/account-pool.ts'
import { WorkBuddyRotation } from '../src/rotation.ts'
import { CN_VARIANT } from '../src/variants.ts'
import { WorkBuddyRefreshFailure } from '../src/upstream.ts'
import type { WorkBuddyChatResult } from '../src/upstream.ts'
import type { WorkBuddyCredential } from '../src/auth.ts'

const CLEANUP: (() => Promise<void>)[] = []
afterEach(async () => { await Promise.all(CLEANUP.splice(0).map(clean => clean())) })

describe('end-to-end: a desktop account that keeps getting limited', () => {
  it('the poll leaves it benched and the wait grows', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-13T10:00:00Z') })
    try {
      const dir = await mkdtemp(join(tmpdir(), 'wb-e2e-'))
      CLEANUP.push(() => rm(dir, { recursive: true, force: true }))
      const pool = new WorkBuddyAccountPool({ variant: CN_VARIANT, path: join(dir, 'a.json') })
      const expiry = Date.now() + 3_600_000
      const signIn = () => pool.upsert({
        uid: 'desk', enterpriseId: 'ent', nickname: 'desk', domain: 'copilot.tencent.com',
        accessToken: 'at-desk', refreshToken: 'rt-desk', expiresAtMs: expiry, origin: 'desktop', sync: true,
      })
      const id = signIn().account.id
      pool.upsert({
        uid: 'spare', enterpriseId: 'ent', nickname: 'spare', domain: 'copilot.tencent.com',
        accessToken: 'at-spare', refreshToken: 'rt-spare', expiresAtMs: expiry, origin: 'qr',
      })
      const client = {
        async chatStream(credential: WorkBuddyCredential): Promise<WorkBuddyChatResult> {
          if (credential.uid === 'desk') return { ok: false, status: 429, kind: 'soft_rate', message: 'rate limited' }
          return { ok: true, response: new Response('data: [DONE]\n\n', { status: 200 }) }
        },
        async refreshToken() { return { accessToken: 'x' } },
      }
      const rotation = new WorkBuddyRotation({ pool, client })
      const waits: number[] = []
      for (let round = 0; round < 3; round += 1) {
        await rotation.send('{}')
        // The 30-second poll fires in the middle of the benching, twice.
        signIn()
        signIn()
        const cooldown = pool.get(id)?.cooldown
        waits.push((cooldown?.untilMs ?? 0) - Date.now())
        vi.setSystemTime(new Date((cooldown?.untilMs ?? Date.now()) + 1000))
      }
      expect(waits).toEqual([cooldownDurationMs('rate', 1), cooldownDurationMs('rate', 2), cooldownDurationMs('rate', 3)])
      expect(pool.get(id)?.failureStreak).toBe(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a broken refresh never costs the account, and the file stream is untouched', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wb-e2e2-'))
    CLEANUP.push(() => rm(dir, { recursive: true, force: true }))
    const pool = new WorkBuddyAccountPool({ variant: CN_VARIANT, path: join(dir, 'a.json') })
    const expiry = Date.now() + 3_600_000
    const a = pool.upsert({
      uid: 'desk', enterpriseId: 'ent', nickname: 'desk', domain: 'copilot.tencent.com',
      accessToken: 'at-desk', refreshToken: 'rt-desk', expiresAtMs: expiry, origin: 'desktop', sync: true,
    }).account.id
    pool.upsert({
      uid: 'spare', enterpriseId: 'ent', nickname: 'spare', domain: 'copilot.tencent.com',
      accessToken: 'at-spare', refreshToken: 'rt-spare', expiresAtMs: expiry, origin: 'qr',
    })
    const client = {
      async chatStream(credential: WorkBuddyCredential): Promise<WorkBuddyChatResult> {
        if (credential.uid === 'desk') return { ok: false, status: 401, kind: 'session_dead', message: '401' }
        return { ok: true, response: new Response('data: [DONE]\n\n', { status: 200 }) }
      },
      async refreshToken(): Promise<never> { throw new WorkBuddyRefreshFailure('server', 'timeout') },
    }
    const outcome = await new WorkBuddyRotation({ pool, client }).send('{}')
    expect(outcome.result.ok).toBe(true)
    // Still in the pool, still enabled, merely benched — and the user can see it.
    const account = pool.get(a)!
    expect(account.sessionDead).toBeUndefined()
    expect(account.enabled).toBe(true)
    const snapshot = JSON.parse(await readFile(pool.filePath(), 'utf8')) as { accounts: { id: string, sessionDead?: boolean }[] }
    expect(snapshot.accounts.find(row => row.id === a)?.sessionDead).toBeUndefined()
  })
})
