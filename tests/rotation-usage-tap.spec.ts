import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkBuddyAccountPool } from '../src/account-pool.ts'
import { WorkBuddyRotation } from '../src/rotation.ts'
import { CN_VARIANT } from '../src/variants.ts'
import type { WorkBuddyChatResult } from '../src/upstream.ts'

/**
 * The usage tap inside the rotation: who gets charged with a request's cost,
 * and the promise that counting never changes what the user receives.
 */

const CLEANUP: (() => Promise<void>)[] = []
afterEach(async () => { await Promise.all(CLEANUP.splice(0).map(clean => clean())) })

async function poolWithAccount(): Promise<WorkBuddyAccountPool> {
  const dir = await mkdtemp(join(tmpdir(), 'wb-tap-'))
  CLEANUP.push(() => rm(dir, { recursive: true, force: true }))
  const pool = new WorkBuddyAccountPool({ variant: CN_VARIANT, path: join(dir, 'accounts.json') })
  pool.upsert({
    uid: 'uid-1',
    enterpriseId: 'ent-1',
    domain: 'copilot.tencent.com',
    accessToken: 'at',
    refreshToken: 'rt',
    expiresAtMs: Date.now() + 3_600_000,
    origin: 'qr',
  })
  return pool
}

/** The SSE body the upstream would send for one short answer. */
const ANSWER = [
  'data: {"choices":[{"delta":{"content":"hi"}}]}',
  '',
  'data: {"choices":[],"usage":{"prompt_tokens":120,"completion_tokens":8,"prompt_tokens_details":{"cached_tokens":100}}}',
  '',
  'data: [DONE]',
  '',
].join('\n')

function answeringClient(body: string) {
  return {
    client: {
      async chatStream(): Promise<WorkBuddyChatResult> {
        return { ok: true, response: new Response(body, { headers: { 'content-type': 'text/event-stream' } }) }
      },
      async refreshToken() { return { accessToken: 'at-2' } },
    },
  }
}

describe('the rotation usage tap', () => {
  it('counts the answer against the account that served it, without changing the answer', async () => {
    const pool = await poolWithAccount()
    const seen: { account: string, usage: unknown }[] = []
    const rotation = new WorkBuddyRotation({
      pool,
      ...answeringClient(ANSWER),
      onUsage: (account, usage) => seen.push({ account, usage }),
    })
    const outcome = await rotation.send('{}')
    expect(outcome.result.ok).toBe(true)
    // The caller reads exactly the bytes the upstream sent.
    const relayed = outcome.result.ok ? await new Response(outcome.result.response.body).text() : ''
    expect(relayed).toBe(ANSWER)
    expect(outcome.result.ok && outcome.result.response.headers.get('content-type')).toBe('text/event-stream')
    // The tee'd reader reports the usage after the answer is consumed.
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(seen).toEqual([{
      account: outcome.account?.id,
      usage: { promptTokens: 120, completionTokens: 8, cacheReadTokens: 100 },
    }])
  })

  it('reports the usage block shape once, for a shape this build has never seen', async () => {
    const pool = await poolWithAccount()
    const shapes: string[][] = []
    const rotation = new WorkBuddyRotation({
      pool,
      ...answeringClient('data: {"usage":{"input_tokens":5,"output_tokens":1,"cache_read_input_tokens":4}}\n\ndata: [DONE]\n\n'),
      onUsage: () => {},
      onUsageShape: fields => shapes.push([...fields]),
    })
    await rotation.send('{}')
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(shapes).toEqual([['cache_read_input_tokens', 'input_tokens', 'output_tokens']])
  })

  it('does not tap when nobody asked for the count', async () => {
    const pool = await poolWithAccount()
    const rotation = new WorkBuddyRotation({ pool, ...answeringClient(ANSWER) })
    const outcome = await rotation.send('{}')
    expect(outcome.result.ok).toBe(true)
    // A body with no tap is passed through untouched, so nothing is buffered.
    expect(outcome.result.ok && await new Response(outcome.result.response.body).text()).toBe(ANSWER)
  })
})
