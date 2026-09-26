/**
 * Per-account request accounting: how much this plugin has sent through each
 * account, and how much of the prompt the upstream served from its cache.
 *
 * Why the plugin counts at all: WorkBuddy's billing endpoint answers "how much
 * quota is left" but publishes nothing about requests or tokens — the numbers a
 * reader wants when asking "what is this account actually costing me". They only
 * exist in the chat stream, which this plugin is the path for, so it counts what
 * it relays.
 *
 * What is measured, and what is NOT claimed:
 *
 * - requests / prompt tokens / completion tokens / cache-read tokens are read
 *   from the upstream's own usage block when it sends one, per request;
 * - the cache-hit rate is `cacheRead / (cacheRead + uncached prompt)`, which is
 *   the definition the upstream's numbers support. It is reported as ABSENT —
 *   never as zero — while no response has carried a cache field, because "we do
 *   not know" and "nothing was cached" are different answers and a zero would
 *   read as the second;
 * - the counters are a plain tally since {@link WorkBuddyUsageCounters.sinceMs},
 *   not a billing-cycle figure: the cycle's reset instant is a string the
 *   billing endpoint words for a human, and inventing a parse for it would put a
 *   wrong window behind a right-looking number.
 *
 * Cost of the accounting: one JSON file per variant, written at most once every
 * {@link WorkBuddyUsageStore.flushIntervalMs} (default 5s) — a per-request write
 * would turn a chat turn into disk I/O. A failed write is logged, never thrown:
 * the counters are a report about the user's traffic, not traffic itself.
 *
 * @module dsh-workbuddy-connect/usage-store
 */

import { readStoreDocument, writeStoreDocument } from './store-file.ts'
import { isJsonObject, parseJsonObject } from './json-value.ts'
import { join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** On-disk format this reader accepts; other versions are discarded. */
const USAGE_FORMAT_VERSION = 1

/** Basename of the CN variant's usage file inside the Harness home. */
export const WORKBUDDY_USAGE_FILENAME = '.workbuddy-usage.json'

/**
 * One request's usage, as the upstream reported it.
 *
 * Every token field is optional: the upstream's usage block varies by model and
 * has changed shape before, so a reader that demanded one spelling would either
 * throw or silently zero the others.
 */
export interface WorkBuddyRequestUsage {
  /** Prompt tokens the upstream billed (cache hits included, per OpenAI). */
  promptTokens?: number
  /** Tokens the model produced. */
  completionTokens?: number
  /** Prompt tokens the upstream served from its cache. */
  cacheReadTokens?: number
  /** Prompt tokens written INTO the cache (some upstreams bill these apart). */
  cacheWriteTokens?: number
  /** Model id the request named, for diagnostics. */
  model?: string
}

/** One account's running tally. */
export interface WorkBuddyUsageCounters {
  /** Requests that reached the upstream through this account. */
  requests: number
  /** Requests whose answer carried a usage block at all. */
  reported: number
  promptTokens: number
  completionTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  /** First request counted in this tally, epoch ms. */
  sinceMs: number
  /** Most recent counted request, epoch ms. */
  lastAtMs: number
}

/** What the card reads for one account. */
export interface WorkBuddyUsageSummary extends WorkBuddyUsageCounters {
  /**
   * Cache-read share of the prompt (`cacheRead / prompt`), when both numbers are
   * known and the prompt was non-zero.
   *
   * Omitted — not zeroed — when no answer ever carried a cache field: see the
   * module note.
   */
  cacheHitRate?: number
}

interface UsageDocument {
  version: typeof USAGE_FORMAT_VERSION
  accounts: Record<string, WorkBuddyUsageCounters>
}

/** Plugin-owned usage-file path inside the Harness home. */
export function workbuddyUsagePath(filename: string = WORKBUDDY_USAGE_FILENAME): string {
  return join(resolveDshHome(), filename)
}

/** Whether a parsed value is a counter record this reader can trust. */
function isCounters(value: unknown): value is WorkBuddyUsageCounters {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const entry = value as Record<string, unknown>
  const numeric = ['requests', 'reported', 'promptTokens', 'completionTokens', 'cacheReadTokens', 'cacheWriteTokens', 'sinceMs', 'lastAtMs'] as const
  return numeric.every(key => typeof entry[key] === 'number' && Number.isFinite(entry[key]))
}

/** One number from a raw usage block, if it is a usable non-negative number. */
function countAt(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key]
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
  return value
}

/**
 * Read one upstream usage block into {@link WorkBuddyRequestUsage}.
 *
 * The spellings below are the ones OpenAI-compatible services use in the wild,
 * including the nested `prompt_tokens_details.cached_tokens` and the
 * Anthropic-style `cache_read_input_tokens` / `cache_creation_input_tokens`
 * pair that some gateways pass through. Unknown fields are simply not read:
 * {@link WorkBuddyUsageStore.record} has no way to invent a number, and the
 * caller reports the keys it actually saw once, so a future shape is discovered
 * from a log rather than by guessing here.
 */
export function readUsageBlock(block: unknown): WorkBuddyRequestUsage {
  if (typeof block !== 'object' || block === null || Array.isArray(block)) return {}
  const usage = block as Record<string, unknown>
  const details = typeof usage['prompt_tokens_details'] === 'object' && usage['prompt_tokens_details'] !== null
    ? usage['prompt_tokens_details'] as Record<string, unknown>
    : {}
  const cacheRead = countAt(usage, 'prompt_cache_hit_tokens')
    ?? countAt(details, 'cached_tokens')
    ?? countAt(usage, 'cache_read_input_tokens')
    ?? countAt(usage, 'cached_tokens')
  const cacheWrite = countAt(usage, 'prompt_cache_miss_tokens') === undefined
    ? countAt(usage, 'cache_creation_input_tokens')
    : undefined
  const prompt = countAt(usage, 'prompt_tokens')
    ?? countAt(usage, 'input_tokens')
  const completion = countAt(usage, 'completion_tokens')
    ?? countAt(usage, 'output_tokens')
  const model = typeof usage['model'] === 'string' && usage['model'] !== '' ? usage['model'] : undefined
  return {
    ...prompt === undefined ? {} : { promptTokens: prompt },
    ...completion === undefined ? {} : { completionTokens: completion },
    ...cacheRead === undefined ? {} : { cacheReadTokens: cacheRead },
    ...cacheWrite === undefined ? {} : { cacheWriteTokens: cacheWrite },
    ...model === undefined ? {} : { model },
  }
}

/**
 * Read one SSE body for the usage block it carries, without disturbing it.
 *
 * Called with one BRANCH of a tee'd body: the other branch is what the user's
 * answer streams through, so this reader may take as long as it likes and can
 * never stall the reply.
 *
 * Two tolerances are deliberate. Frames are split on a blank line but a
 * truncated tail is still parsed, because the LAST frame before `[DONE]` is
 * where OpenAI-compatible services put usage and a stream can be cut short. And
 * every `data:` frame is inspected rather than only the last: some gateways
 * report usage on each chunk, and taking the final one that parses is the same
 * answer with fewer assumptions about which chunk it was.
 *
 * @param stream - the tee'd body to drain.
 * @param onUsage - called once with the last usage block seen; not called at all
 *   when the answer carried none.
 * @param onFirstBlock - called once with the numeric field names of the first
 *   block seen, so an unknown upstream shape is discovered from a log line
 *   rather than by guessing at the parser.
 */
export async function consumeStreamUsage(
  stream: ReadableStream<Uint8Array>,
  onUsage: (usage: WorkBuddyRequestUsage) => void,
  onFirstBlock?: (fields: readonly string[]) => void,
): Promise<void> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let last: Record<string, unknown> | undefined
  let announced = false
  const inspect = (frame: string): void => {
    const line = frame.trim()
    if (!line.startsWith('data:')) return
    const payload = line.slice('data:'.length).trim()
    if (payload === '' || payload === '[DONE]') return
    const parsed = parseJsonObject(payload)
    if (parsed === undefined) return
    const block = parsed['usage']
    if (!isJsonObject(block)) return
    last = block
    if (!announced) {
      announced = true
      onFirstBlock?.(usageFieldNames(block))
    }
  }
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let boundary = buffer.indexOf('\n\n')
      while (boundary >= 0) {
        inspect(buffer.slice(0, boundary))
        buffer = buffer.slice(boundary + 2)
        boundary = buffer.indexOf('\n\n')
      }
    }
    buffer += decoder.decode()
    if (buffer.trim() !== '') inspect(buffer)
  } finally {
    reader.releaseLock()
  }
  if (last !== undefined) onUsage(readUsageBlock(last))
}

/** The token/usage keys a raw block carried, for a one-time diagnostic log. */
export function usageFieldNames(block: unknown): string[] {
  if (typeof block !== 'object' || block === null || Array.isArray(block)) return []
  const names: string[] = []
  for (const [key, value] of Object.entries(block as Record<string, unknown>)) {
    if (typeof value === 'number') names.push(key)
    else if (value !== null && typeof value === 'object') {
      for (const [inner, innerValue] of Object.entries(value as Record<string, unknown>)) {
        if (typeof innerValue === 'number') names.push(`${key}.${inner}`)
      }
    }
  }
  return names.sort()
}

/** Options for {@link WorkBuddyUsageStore}. */
export interface WorkBuddyUsageStoreOptions {
  /** Explicit state-file path, overriding the `$DSH_HOME` default. */
  path?: string
  /** Injectable clock, for tests. */
  now?: () => number
  /** How long writes are coalesced. Zero writes through on every record. */
  flushIntervalMs?: number
  /** Reported a failed write; the caller logs it. */
  onWriteError?: (error: unknown) => void
}

/**
 * The per-account request tallies, read once and written atomically.
 *
 * A failed WRITE degrades to a log rather than a throw: the counters describe
 * traffic that already happened, and failing the user's chat turn because a
 * report could not be written would put the accounting in front of the work.
 */
export class WorkBuddyUsageStore {
  private readonly path: string
  private readonly now: () => number
  private readonly flushIntervalMs: number
  private readonly onWriteError: WorkBuddyUsageStoreOptions['onWriteError']
  private accounts: Record<string, WorkBuddyUsageCounters> | undefined
  private dirty = false
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(options: WorkBuddyUsageStoreOptions | string = {}) {
    const resolved = typeof options === 'string' ? { path: options } : options
    this.path = resolved.path ?? workbuddyUsagePath()
    this.now = resolved.now ?? (() => Date.now())
    this.flushIntervalMs = resolved.flushIntervalMs ?? 5_000
    this.onWriteError = resolved.onWriteError
  }

  /** Resolved state-file path, for tests and diagnostics. */
  filePath(): string {
    return this.path
  }

  private load(): Record<string, WorkBuddyUsageCounters> {
    if (this.accounts !== undefined) return this.accounts
    const accounts: Record<string, WorkBuddyUsageCounters> = {}
    // A corrupt or unreadable file reads as "nothing counted yet": the card then
    // shows no usage rather than a wrong one.
    const counted = readStoreDocument(this.path, USAGE_FORMAT_VERSION, document => {
      const raw = document['accounts']
      return isJsonObject(raw) ? raw : undefined
    })
    for (const [key, value] of Object.entries(counted ?? {})) {
      if (isCounters(value)) accounts[key] = value
    }
    this.accounts = accounts
    return accounts
  }

  /**
   * Count one request against one account.
   *
   * `reported` is incremented only when the answer carried a usage block, which
   * is what lets the card say "N of M requests reported tokens" instead of
   * presenting a partial tally as complete.
   */
  record(account: string, usage: WorkBuddyRequestUsage | undefined): void {
    const accounts = { ...this.load() }
    const now = this.now()
    const current = accounts[account] ?? {
      requests: 0,
      reported: 0,
      promptTokens: 0,
      completionTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      sinceMs: now,
      lastAtMs: now,
    }
    const hasNumbers = usage !== undefined
      && (usage.promptTokens !== undefined || usage.completionTokens !== undefined || usage.cacheReadTokens !== undefined)
    accounts[account] = {
      ...current,
      requests: current.requests + 1,
      reported: current.reported + (hasNumbers ? 1 : 0),
      promptTokens: current.promptTokens + (usage?.promptTokens ?? 0),
      completionTokens: current.completionTokens + (usage?.completionTokens ?? 0),
      cacheReadTokens: current.cacheReadTokens + (usage?.cacheReadTokens ?? 0),
      cacheWriteTokens: current.cacheWriteTokens + (usage?.cacheWriteTokens ?? 0),
      lastAtMs: now,
    }
    this.accounts = accounts
    this.dirty = true
    this.schedule()
  }

  /** One account's tally, with the derived rate when it can be stated. */
  summary(account: string): WorkBuddyUsageSummary | undefined {
    const counters = this.load()[account]
    if (counters === undefined || counters.requests === 0) return undefined
    const rate = counters.cacheReadTokens > 0 && counters.promptTokens > 0
      ? counters.cacheReadTokens / counters.promptTokens
      : undefined
    return {
      ...counters,
      ...rate === undefined ? {} : { cacheHitRate: rate },
    }
  }

  private schedule(): void {
    if (this.flushIntervalMs <= 0) {
      this.flush()
      return
    }
    this.timer ??= setTimeout(() => {
      this.timer = undefined
      this.flush()
    }, this.flushIntervalMs)
    // A pending flush must not hold the process open: this plugin lives inside
    // the harness, and a timer that keeps the event loop alive would turn a
    // report into a shutdown delay.
    this.timer.unref?.()
  }

  /** Write the pending counters now; safe to call repeatedly. */
  flush(): void {
    if (!this.dirty) return
    try {
      const document: UsageDocument = { version: USAGE_FORMAT_VERSION, accounts: this.load() }
      writeStoreDocument(this.path, document)
      this.dirty = false
    } catch (error: unknown) {
      // Kept dirty on purpose: the next flush retries, and a successful one
      // later is better than a lost tally.
      this.onWriteError?.(error)
    }
  }

  /** Stop the coalescing timer, flushing whatever is pending. */
  close(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    this.flush()
  }
}
