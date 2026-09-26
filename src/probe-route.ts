/**
 * Probe control route: the only state-changing endpoint the plugin exposes.
 *
 * Two guards, because they stop different things (see `docs/reasoning-effort-probe-plan.md`
 * §6.4 and the v0.3.1 note in AGENTS.md about their exact scope):
 *
 * 1. **Loopback Host + Origin**, shared with the status route. This drops
 *    DNS-rebinding pages, whose requests arrive addressed to the attacker's
 *    domain.
 * 2. **An in-process random key**, minted per process and handed only to the
 *    same-origin card. Loopback alone is *not* authentication — any local
 *    process can write `Host: 127.0.0.1` — so a route that spends the user's
 *    credit must prove the caller was told the key.
 *
 * A probe request is never accepted with a prompt, a model id outside the
 * live catalog, or a sentinel from the browser: it is assembled entirely
 * host-side. (Scope: the `probe` action only — `set-model-visibility`
 * deliberately accepts a model id the current catalog no longer lists, since
 * a hidden id is kept for when the model returns.)
 *
 * @module dsh-workbuddy-connect/probe-route
 */

import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { hostIsLoopback, originIsLoopback } from './loopback.ts'
import { isWorkBuddySidebarCreditStyle, WORKBUDDY_PROBE_PATH } from './status-paths.ts'
import type { WorkBuddyProbeAction, WorkBuddySidebarCreditStyle } from './status-paths.ts'

/** Largest control body accepted; these payloads are a few dozen bytes. */
const MAX_BODY_BYTES = 4096

/** Constructor dependencies. */
export interface WorkBuddyProbeRouteOptions {
  /**
   * Run a probe for one model. Resolves to a short status string, never a raw
   * upstream body.
   */
  probe: (modelId: string) => Promise<{ state: string; reason?: string }>
  /** Drop every recorded observation. */
  clear: () => void
  /**
   * Re-read the credential and re-fetch the model catalog for this variant.
   *
   * It lives on this route rather than the status GET because it is a write
   * that spends a request against the upstream: the read-only status route's
   * loopback guard protects against a rebinding *page*, which is not the same
   * as authorizing an action. Requires the same in-process key as `probe`.
   */
  refresh?: () => Promise<{ state: string; reason?: string }>
  /** Persist and apply the international context-window preference. */
  setMaximumContextWindow?: (enabled: boolean) => Promise<{ state: string; reason?: string }>
  /**
   * Persist the sidebar's credit-line style.
   *
   * A plugin-wide preference rather than a per-product one (the sidebar shows
   * both products at once), which is why both variants' routes accept it: the
   * card that happens to be rendering when the user picks can write it, and the
   * next read of either document carries the answer.
   */
  setSidebarCreditStyle?: (style: WorkBuddySidebarCreditStyle) => Promise<{ state: string; reason?: string }>
  /**
   * Open one absolute http(s) link in the user's own browser.
   *
   * The sign-in routes hand the user a page on the provider's site, and only
   * their own browser has the session that page needs. A desktop WebView
   * cannot do that itself — those shells answer `window.open` with nothing —
   * so the hand-off happens here, in the process that can ask the operating
   * system. The scheme is validated on this side, immediately before the
   * launch, so the browser is never the thing enforcing it.
   */
  openExternal?: (url: string) => Promise<{ state: string; reason?: string }>
  /**
   * Replace the signed-in account's model allowlist (`[]` clears it).
   *
   * A separate seam from {@link setModelVisibility} because the two write
   * different lists: a per-model toggle edits the hide-list, while this
   * replaces the "only these" filter. Collapsing them into one call would make
   * "hide this one model" and "show only these" the same write, and the second
   * would erase the first.
   */
  setModelAllowlist?: (ids: readonly string[], expectedAccount: string) => Promise<{ state: string; reason?: string }>
  /**
   * Hide or show one model in the picker for the signed-in account. The
   * handler refuses (with a reason, not a crash) when no account with a stable
   * uid is in effect, when the expected account no longer matches (a stale
   * card from before an account switch), or when the preference file cannot
   * be written — a toggle the user pressed must never be reported as saved
   * when it was not.
   */
  setModelVisibility?: (modelId: string, visible: boolean, expectedAccount: string) => Promise<{ state: string; reason?: string }>
  /**
   * Route path to mount. Defaults to the CN variant's path so existing callers
   * and tests keep their behaviour; the international variant passes its own.
   */
  path?: string
}

/** Mint the per-process control key. */
export function createProbeKey(): string {
  return randomBytes(24).toString('hex')
}

/**
 * Whether one presented control key is accepted.
 *
 * The value is a single key (the common case) or a predicate over the keys the
 * host has minted — one per variant. The predicate exists for the sign-in link
 * (`open-link`): that action is not about a variant at all, so a page
 * rendering product A has to be able to ask through B's route when B is the one
 * with a signed-in account, and the alternative — a third route whose URL the
 * page has to guess — buys nothing but a second key to keep in sync.
 */
export type WorkBuddyProbeKey = string | ((presented: string | undefined) => boolean)

/**
 * Constant-time key comparison; a length mismatch is a failure, not a crash.
 *
 * Exported because the caller that registers this route also builds the
 * key-accepting predicate for it: a handler that compares keys one way while
 * its registration compares them another is exactly the kind of drift that ends
 * with a timing side channel in the copy nobody re-read.
 */
export function keyMatches(expected: string, presented: string | undefined): boolean {
  if (presented === undefined || presented.length !== expected.length) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(presented)
  return a.length === b.length && timingSafeEqual(a, b)
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
  res.end(payload)
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

/** Parse and shape-check an action; unknown fields are ignored, not trusted. */
function parseAction(text: string): WorkBuddyProbeAction | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  const wrapped = parsed as Record<string, unknown>
  const action = wrapped['action']
  if (action === 'clear') return { action: 'clear' }
  // No payload: the variant is already known from the route the request arrived
  // on, so the browser cannot ask this route to refresh a different provider.
  if (action === 'refresh') return { action: 'refresh' }
  if (action === 'set-maximum-context-window') {
    return typeof wrapped['enabled'] === 'boolean'
      ? { action: 'set-maximum-context-window', enabled: wrapped['enabled'] }
      : undefined
  }
  if (action === 'set-model-visibility') {
    const model = wrapped['model']
    const account = wrapped['account']
    // `account` is required, not optional-with-fallback: a write that does not
    // name the account it expects cannot be guarded, and there is no honest
    // fallback account to assume.
    if (typeof model !== 'string' || model.trim() === '') return undefined
    if (typeof wrapped['visible'] !== 'boolean') return undefined
    if (typeof account !== 'string' || account === '') return undefined
    return { action: 'set-model-visibility', model: model.trim(), visible: wrapped['visible'], account }
  }
  if (action === 'set-sidebar-credit-style') {
    const style = wrapped['creditStyle']
    // Validated against the shared closed set rather than passed through: the
    // value reaches the plugin's own config schema, and a typo would otherwise
    // be stored and read back as a style nothing renders.
    if (!isWorkBuddySidebarCreditStyle(style)) return undefined
    return { action: 'set-sidebar-credit-style', creditStyle: style }
  }
  if (action === 'set-model-allowlist') {
    const account = wrapped['account']
    const allowlist = wrapped['allowlist']
    // Same account guard as the per-model write, and for the same reason: an
    // allowlist sent from a card showing account A must not land in B's bucket.
    if (typeof account !== 'string' || account === '') return undefined
    if (!Array.isArray(allowlist)) return undefined
    if (!allowlist.every(id => typeof id === 'string' && id !== '')) return undefined
    // Deduped here rather than at the store: a hand-edited or retried request
    // is untrusted input, and the wire shape should not carry duplicates into
    // the file.
    return { action: 'set-model-allowlist', account, allowlist: [...new Set(allowlist as string[])] }
  }
  if (action === 'open-link') {
    const url = wrapped['url']
    // Shape only: the scheme decision belongs to the opener, which applies it
    // again at the last moment. Refusing here as well keeps an obviously wrong
    // request from reaching a seam that would only have to re-report it.
    if (typeof url !== 'string' || url.trim() === '') return undefined
    return { action: 'open-link', url: url.trim() }
  }
  if (action === 'probe') {
    const model = wrapped['model']
    if (typeof model !== 'string' || model.trim() === '') return undefined
    return { action: 'probe', model: model.trim() }
  }
  return undefined
}

/**
 * The control route's handler, extracted so tests can mount it on a bare
 * server with a known key.
 */
export function workBuddyProbeHandler(
  deps: WorkBuddyProbeRouteOptions,
  key: WorkBuddyProbeKey,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  // A bare key is compared constantly-time; a predicate brings its own rule
  // (see {@link WorkBuddyProbeKey}).
  const accepts = typeof key === 'string'
    ? (presented: string | undefined): boolean => keyMatches(key, presented)
    : key
  return async (req, res) => {
    if (req.method !== 'POST') {
      json(res, 405, { error: 'method not allowed' })
      return
    }
    if (!hostIsLoopback(req.headers.host) || !originIsLoopback(req.headers.origin)) {
      json(res, 403, { error: 'request-not-trusted' })
      return
    }
    if (!accepts(req.headers['x-workbuddy-probe-key'] as string | undefined)) {
      json(res, 403, { error: 'invalid-probe-key' })
      return
    }
    const body = await readBody(req)
    if (body === undefined) {
      json(res, 413, { error: 'body too large' })
      return
    }
    const action = parseAction(body)
    if (action === undefined) {
      json(res, 400, { error: 'invalid action' })
      return
    }
    try {
      if (action.action === 'clear') {
        deps.clear()
        json(res, 200, { state: 'cleared' })
        return
      }
      if (action.action === 'refresh') {
        if (deps.refresh === undefined) {
          json(res, 404, { error: 'refresh-not-supported' })
          return
        }
        json(res, 200, await deps.refresh())
        return
      }
      if (action.action === 'set-maximum-context-window') {
        if (deps.setMaximumContextWindow === undefined) {
          json(res, 404, { error: 'context-window-setting-not-supported' })
          return
        }
        json(res, 200, await deps.setMaximumContextWindow(action.enabled === true))
        return
      }
      if (action.action === 'set-sidebar-credit-style') {
        if (deps.setSidebarCreditStyle === undefined) {
          json(res, 404, { error: 'sidebar-style-setting-not-supported' })
          return
        }
        json(res, 200, await deps.setSidebarCreditStyle(action.creditStyle as WorkBuddySidebarCreditStyle))
        return
      }
      if (action.action === 'set-model-visibility') {
        if (deps.setModelVisibility === undefined) {
          json(res, 404, { error: 'visibility-setting-not-supported' })
          return
        }
        json(res, 200, await deps.setModelVisibility(
          action.model as string,
          action.visible === true,
          action.account as string,
        ))
        return
      }
      if (action.action === 'open-link') {
        if (deps.openExternal === undefined) {
          json(res, 404, { error: 'open-link-not-supported' })
          return
        }
        json(res, 200, await deps.openExternal(action.url as string))
        return
      }
      if (action.action === 'set-model-allowlist') {
        if (deps.setModelAllowlist === undefined) {
          json(res, 404, { error: 'visibility-setting-not-supported' })
          return
        }
        json(res, 200, await deps.setModelAllowlist(
          action.allowlist as readonly string[],
          action.account as string,
        ))
        return
      }
      json(res, 200, await deps.probe(action.model as string))
    } catch (error: unknown) {
      json(res, 500, { error: error instanceof Error ? error.message : String(error) })
    }
  }
}

/** Mount the POST probe-control route on an optional webServer context. */
export function registerWorkBuddyProbeRoute(
  ctx: Context,
  deps: WorkBuddyProbeRouteOptions,
  key: WorkBuddyProbeKey,
): void {
  const path = deps.path ?? WORKBUDDY_PROBE_PATH
  ctx.effect(() => {
    const dispose = ctx.webServer.register({
      kind: 'exact',
      path,
      handler: workBuddyProbeHandler(deps, key),
    })
    return () => {
      dispose()
    }
  }, 'dsh-workbuddy-connect: probe control route')
}
