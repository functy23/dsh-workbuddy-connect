/**
 * Account control route: the pool's write surface (add by QR, remove, enable,
 * disable, label, reorder, test, refresh balances).
 *
 * Guards are the same pair the probe route uses, and for the same reasons: a
 * loopback Host/Origin check drops DNS-rebinding pages, and the in-process key
 * proves the caller is the same-origin card. Loopback alone is not
 * authentication — any local process can send `Host: 127.0.0.1` — and this
 * route can spend the user's quota (the connectivity test) and delete their
 * stored credentials, so it must not be reachable by an arbitrary local page.
 *
 * The route never accepts credential material from the browser. The QR flow is
 * assembled entirely host-side: the browser receives a URL to render and a
 * state to echo, and never sees a token.
 *
 * @module dsh-workbuddy-connect/account-route
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { hostIsLoopback, originIsLoopback } from './loopback.ts'
import { WORKBUDDY_ACCOUNT_PATH } from './status-paths.ts'
import type { WorkBuddyAccountAction, WorkBuddyAccountResult } from './status-paths.ts'

/** Largest control body accepted; these payloads are small. */
const MAX_BODY_BYTES = 16 * 1024

/** Constructor dependencies. */
export interface WorkBuddyAccountRouteOptions {
  /** Execute one account action. Never receives raw credential material. */
  handle: (action: WorkBuddyAccountAction) => Promise<WorkBuddyAccountResult>
  /**
   * Route path to mount. Defaults to the CN variant's path so existing callers
   * and tests keep their behaviour; the international variant passes its own.
   */
  path?: string
}

/** Mint the per-process control key (shared with the probe route). */
export { createProbeKey } from './probe-route.ts'

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
  res.end(payload)
}

/** Constant-time key comparison; a length mismatch is a failure, not a crash. */
function keyMatches(expected: string, presented: string | undefined): boolean {
  if (presented === undefined || presented.length !== expected.length) return false
  let mismatch = 0
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ (presented.charCodeAt(index) || 0)
  }
  return mismatch === 0
}

/** Read the request body with a hard ceiling. */
async function readBody(req: IncomingMessage): Promise<string | undefined> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    total += buffer.length
    if (total > MAX_BODY_BYTES) return undefined
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** Parse and shape-check an action; unknown fields are ignored, not trusted. */
export function parseAccountAction(text: string): WorkBuddyAccountAction | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  const wrapped = parsed as Record<string, unknown>
  switch (wrapped['action']) {
    case 'add': return { action: 'add' }
    case 'refresh-credits': return { action: 'refresh-credits' }
    case 'context': {
      const model = stringField(wrapped['model'])
      const length = wrapped['length']
      if (model === undefined || typeof length !== 'number' || !Number.isFinite(length) || length <= 0) return undefined
      return { action: 'context', model, length }
    }
    case 'add-cookie': {
      // The token is credential material, and is deliberately not validated
      // beyond being a non-empty string: this route's job is to hand it to the
      // host, which is where the decode and the region check live.
      const token = stringField(wrapped['token'])
      return token === undefined ? undefined : { action: 'add-cookie', token }
    }
    case 'poll': {
      const state = stringField(wrapped['state'])
      return state === undefined ? undefined : { action: 'poll', state }
    }
    case 'cancel': {
      const state = stringField(wrapped['state'])
      return state === undefined ? undefined : { action: 'cancel', state }
    }
    case 'remove': {
      const id = stringField(wrapped['id'])
      return id === undefined ? undefined : { action: 'remove', id }
    }
    case 'test': {
      const id = stringField(wrapped['id'])
      return id === undefined ? undefined : { action: 'test', id }
    }
    case 'enable': {
      const id = stringField(wrapped['id'])
      if (id === undefined || typeof wrapped['enabled'] !== 'boolean') return undefined
      return { action: 'enable', id, enabled: wrapped['enabled'] }
    }
    case 'label': {
      const id = stringField(wrapped['id'])
      if (id === undefined) return undefined
      const label = typeof wrapped['label'] === 'string' ? wrapped['label'] : undefined
      return { action: 'label', id, ...label === undefined ? {} : { label } }
    }
    case 'reorder': {
      const ids = wrapped['ids']
      if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string')) return undefined
      return { action: 'reorder', ids: ids as string[] }
    }
    default: return undefined
  }
}

/**
 * The control route's handler, extracted so tests can mount it on a bare
 * server with a known key.
 */
export function workBuddyAccountHandler(
  deps: WorkBuddyAccountRouteOptions,
  key: string,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    if (req.method !== 'POST') {
      json(res, 405, { error: 'method not allowed' })
      return
    }
    if (!hostIsLoopback(req.headers.host) || !originIsLoopback(req.headers.origin)) {
      json(res, 403, { error: 'request-not-trusted' })
      return
    }
    if (!keyMatches(key, req.headers['x-workbuddy-probe-key'] as string | undefined)) {
      json(res, 403, { error: 'invalid-probe-key' })
      return
    }
    const body = await readBody(req)
    if (body === undefined) {
      json(res, 413, { error: 'body too large' })
      return
    }
    const action = parseAccountAction(body)
    if (action === undefined) {
      json(res, 400, { error: 'invalid action' })
      return
    }
    try {
      json(res, 200, await deps.handle(action))
    } catch (error: unknown) {
      json(res, 200, {
        state: 'failed',
        reason: (error instanceof Error ? error.message : String(error)).slice(0, 300),
      } satisfies WorkBuddyAccountResult)
    }
  }
}

/** Mount the POST account-control route on an optional webServer context. */
export function registerWorkBuddyAccountRoute(
  ctx: Context,
  deps: WorkBuddyAccountRouteOptions,
  key: string,
): void {
  const path = deps.path ?? WORKBUDDY_ACCOUNT_PATH
  ctx.effect(() => {
    const dispose = ctx.webServer.register({
      kind: 'exact',
      path,
      handler: workBuddyAccountHandler(deps, key),
    })
    return () => {
      dispose()
    }
  }, 'dsh-workbuddy-connect: account control route')
}
