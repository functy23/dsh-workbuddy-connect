import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WorkBuddyAccountPool } from '../src/account-pool.ts'
import { WorkBuddyRotation } from '../src/rotation.ts'
import { CN_VARIANT } from '../src/variants.ts'
import type { WorkBuddyChatResult } from '../src/upstream.ts'
import type { WorkBuddyCredential } from '../src/auth.ts'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const CLEANUP: (() => Promise<void>)[] = []
async function makePool(withAccounts: boolean): Promise<WorkBuddyAccountPool> {
  const dir = await mkdtemp(join(tmpdir(), 'wb-claim-'))
  CLEANUP.push(() => rm(dir, { recursive: true, force: true }))
  const pool = new WorkBuddyAccountPool({ variant: CN_VARIANT, path: join(dir, 'a.json') })
  if (withAccounts) {
    for (const uid of ['a', 'b', 'c']) {
      pool.upsert({
        uid, enterpriseId: 'ent', nickname: uid, domain: 'copilot.tencent.com',
        accessToken: `at-${uid}`, refreshToken: `rt-${uid}`, expiresAtMs: Date.now() + 3_600_000, origin: 'qr',
      })
    }
  }
  return pool
}

describe('a real rotation spread', () => {
  it('two messages sent in the same tick go to two accounts', async () => {
    const pool = await makePool(true)
    const seen: string[] = []
    const gates: (() => void)[] = []
    const client = {
      async chatStream(credential: WorkBuddyCredential): Promise<WorkBuddyChatResult> {
        seen.push(credential.uid)
        await new Promise<void>(resolve => { gates.push(resolve) })
        return { ok: true, response: new Response('data: [DONE]\n\n', { status: 200 }) }
      },
      async refreshToken() { return { accessToken: 'x' } },
    }
    const rotation = new WorkBuddyRotation({ pool, client })
    // Two conversations, both waiting on the upstream at the same time.
    const first = rotation.send('{}')
    const second = rotation.send('{}')
    await sleep(20)
    const started = [...seen].sort()
    expect(started).toEqual(['a', 'b'])
    while (gates.length > 0) gates.shift()?.()
    await Promise.all([first, second])
    expect(seen).toHaveLength(2)
  })

  it('three serial messages visit each account once, then the round repeats', async () => {
    const pool = await makePool(true)
    const seen: string[] = []
    const gates: (() => void)[] = []
    const client = {
      async chatStream(credential: WorkBuddyCredential): Promise<WorkBuddyChatResult> {
        seen.push(credential.uid)
        await new Promise<void>(resolve => { gates.push(resolve) })
        return { ok: true, response: new Response('data: [DONE]\n\n', { status: 200 }) }
      },
      async refreshToken() { return { accessToken: 'x' } },
    }
    const rotation = new WorkBuddyRotation({ pool, client })
    for (let round = 0; round < 4; round += 1) {
      const outcome = rotation.send('{}')
      await sleep(15)
      gates.shift()?.()
      await outcome
    }
    expect(seen).toEqual(['a', 'b', 'c', 'a'])
  })
})
