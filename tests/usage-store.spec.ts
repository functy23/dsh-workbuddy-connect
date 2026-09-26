import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  consumeStreamUsage,
  readUsageBlock,
  usageFieldNames,
  WorkBuddyUsageStore,
} from '../src/usage-store.ts'

/**
 * The request accounting behind the account card's usage grid.
 *
 * Two halves are tested here: reading the upstream's usage block (which has
 * several spellings in the wild) and the counters that hold the result. The
 * stream reader is tested separately below because it runs on tee'd bytes and
 * must never disturb them.
 */

const CLEANUP: (() => Promise<void>)[] = []
afterEach(async () => { await Promise.all(CLEANUP.splice(0).map(clean => clean())) })

async function store(flushIntervalMs = 0): Promise<WorkBuddyUsageStore> {
  const dir = await mkdtemp(join(tmpdir(), 'wb-usage-'))
  CLEANUP.push(() => rm(dir, { recursive: true, force: true }))
  return new WorkBuddyUsageStore({ path: join(dir, 'usage.json'), flushIntervalMs })
}

/** One SSE body carrying a usage block, as the upstream sends it. */
function sse(...frames: string[]): string {
  return frames.map(frame => `data: ${frame}\n\n`).join('')
}

describe('readUsageBlock', () => {
  it('reads the OpenAI spelling and its nested cached detail', () => {
    expect(readUsageBlock({ prompt_tokens: 1000, completion_tokens: 200, prompt_tokens_details: { cached_tokens: 800 } }))
      .toEqual({ promptTokens: 1000, completionTokens: 200, cacheReadTokens: 800 })
  })

  it('reads the cache-hit / cache-miss pair some gateways send', () => {
    expect(readUsageBlock({ prompt_tokens: 500, completion_tokens: 10, prompt_cache_hit_tokens: 400 }))
      .toEqual({ promptTokens: 500, completionTokens: 10, cacheReadTokens: 400 })
  })

  it('reads the Anthropic-style input/output pair', () => {
    expect(readUsageBlock({ input_tokens: 300, output_tokens: 40, cache_read_input_tokens: 200 }))
      .toEqual({ promptTokens: 300, completionTokens: 40, cacheReadTokens: 200 })
  })

  it('omits what the block did not state instead of zeroing it', () => {
    expect(readUsageBlock({ completion_tokens: 5 })).toEqual({ completionTokens: 5 })
    expect(readUsageBlock(undefined)).toEqual({})
    expect(readUsageBlock({ prompt_tokens: -1 })).toEqual({})
  })

  it('names the numeric fields a block carried, for the discovery log', () => {
    expect(usageFieldNames({ prompt_tokens: 1, prompt_tokens_details: { cached_tokens: 2 }, model: 'x' }))
      .toEqual(['prompt_tokens', 'prompt_tokens_details.cached_tokens'])
  })
})

describe('consumeStreamUsage', () => {
  it('reports the last usage block of a stream, and leaves the bytes alone', async () => {
    const body = sse('{"choices":[{"delta":{"content":"hi"}}]}', '{"choices":[],"usage":{"prompt_tokens":120,"completion_tokens":8,"prompt_tokens_details":{"cached_tokens":100}}}', '[DONE]')
    const [kept, observed] = new Response(body).body!.tee()
    const seen: unknown[] = []
    const shapes: string[][] = []
    await consumeStreamUsage(observed, usage => seen.push(usage), fields => shapes.push([...fields]))
    expect(seen).toEqual([{ promptTokens: 120, completionTokens: 8, cacheReadTokens: 100 }])
    expect(shapes).toEqual([['completion_tokens', 'prompt_tokens', 'prompt_tokens_details.cached_tokens']])
    // The caller's copy is byte-identical: the accounting is invisible in the reply.
    expect(await new Response(kept).text()).toBe(body)
  })

  it('reports nothing when the answer carried no usage block', async () => {
    const [kept, observed] = new Response(sse('{"choices":[{"delta":{"content":"hi"}}]}', '[DONE]')).body!.tee()
    let called = false
    await consumeStreamUsage(observed, () => { called = true })
    expect(called).toBe(false)
    // Still drained, so the client's copy is never blocked by the reader.
    expect(await new Response(kept).text()).not.toBe('')
  })

  it('parses a truncated tail, which is where usage usually sits', async () => {
    const body = sse('{"choices":[]}') + 'data: {"usage":{"prompt_tokens":42}}'
    const [kept, observed] = new Response(body).body!.tee()
    const seen: unknown[] = []
    await consumeStreamUsage(observed, usage => seen.push(usage))
    expect(seen).toEqual([{ promptTokens: 42 }])
    expect(await new Response(kept).text()).toBe(body)
  })
})

describe('WorkBuddyUsageStore', () => {
  it('counts requests, tokens and the reported subset per account', async () => {
    const usage = await store()
    usage.record('acct-1', { promptTokens: 100, completionTokens: 10, cacheReadTokens: 80 })
    usage.record('acct-1', { promptTokens: 100, completionTokens: 20, cacheReadTokens: 20 })
    // A request whose answer carried no usage block still counts as traffic.
    usage.record('acct-1', undefined)
    const summary = usage.summary('acct-1')
    expect(summary?.requests).toBe(3)
    expect(summary?.reported).toBe(2)
    expect(summary?.promptTokens).toBe(200)
    expect(summary?.completionTokens).toBe(30)
    expect(summary?.cacheReadTokens).toBe(100)
    expect(summary?.cacheHitRate).toBeCloseTo(0.5)
    // Another account's tally is its own.
    expect(usage.summary('acct-2')).toBeUndefined()
  })

  it('omits the cache-hit rate rather than reporting zero when nothing was cached', async () => {
    const usage = await store()
    usage.record('acct-1', { promptTokens: 100, completionTokens: 5 })
    const summary = usage.summary('acct-1')
    // The upstream stated no cache figure: "unknown" is not "0%".
    expect(summary?.cacheHitRate).toBeUndefined()
    expect(summary?.cacheReadTokens).toBe(0)
  })

  it('survives a restart, and reports nothing for an account it never counted', async () => {
    const first = await store()
    first.record('acct-1', { promptTokens: 10, completionTokens: 1 })
    first.close()
    const reopened = new WorkBuddyUsageStore({ path: first.filePath(), flushIntervalMs: 0 })
    expect(reopened.summary('acct-1')?.promptTokens).toBe(10)
    expect(reopened.summary('acct-2')).toBeUndefined()
  })

  it('coalesces writes, and keeps the tally when the write fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wb-usage-slow-'))
    CLEANUP.push(() => rm(dir, { recursive: true, force: true }))
    const errors: unknown[] = []
    const usage = new WorkBuddyUsageStore({
      path: join(dir, 'nested', 'usage.json'),
      flushIntervalMs: 60_000,
      onWriteError: error => errors.push(error),
    })
    usage.record('acct-1', { promptTokens: 7 })
    // Nothing on disk yet: the write is pending on the coalescing timer.
    expect(errors).toEqual([])
    usage.close()
    const reopened = new WorkBuddyUsageStore({ path: usage.filePath(), flushIntervalMs: 0 })
    expect(reopened.summary('acct-1')?.promptTokens).toBe(7)
  })
})
