/**
 * Same-origin status route for the WorkBuddy plugin card: sign-in state,
 * token expiry, remaining credit, and the account pool.
 * data. The route answers loopback browser requests only and never carries
 * token material.
 *
 * "Signed in" now means *the pool has an account*, not "the desktop app is
 * signed in": the pool is what actually serves requests, and it deliberately
 * outlives the desktop app's session.
 *
 * @module dsh-workbuddy-connect/web-status
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { WorkBuddyAccountService } from './account-service.ts'
import type { WorkBuddyCredentialStore } from './auth.ts'
import type { WorkBuddyUpstreamClient } from './upstream.ts'
import { normalizeCredits } from './upstream.ts'
import type { WorkBuddyModelInfo } from './catalog.ts'
import { hostIsLoopback, originIsLoopback } from './loopback.ts'
import { WORKBUDDY_STATUS_PATH } from './status-paths.ts'
import type { WorkBuddyWebCatalog, WorkBuddyWebModelBadge, WorkBuddyWebProbeSection, WorkBuddyWebStatus, WorkBuddyWebVisibilitySection } from './status-paths.ts'
import type { WorkBuddyStatedPreferences } from './preferences.ts'

export { WORKBUDDY_STATUS_PATH } from './status-paths.ts'
export type { WorkBuddyWebStatus } from './status-paths.ts'

/** Constructor dependencies. */
export interface WorkBuddyStatusRouteOptions {
  /** The account pool this variant serves from. */
  accounts: Pick<WorkBuddyAccountService, 'snapshot' | 'hasAccounts' | 'primaryCredential'>
  client: Pick<WorkBuddyUpstreamClient, 'fetchCredits'>
  /** Resolve the current model catalog for free/badge display. */
  models: () => readonly WorkBuddyModelInfo[]
  /**
   * The context window a model is running at, when the user has chosen one.
   *
   * Shared with the adapter so the figure on the card and the ceiling in the
   * request can never disagree.
   */
  resolveContextWindow?: (modelId: string, declared: readonly number[]) => number | undefined
  /**
   * Compact probe state for the card. Optional so the status route keeps
   * working on its own in tests and headless profiles.
   */
  probe?: () => WorkBuddyWebProbeSection
  /**
   * Origin of the currently served model list. Optional so the status route
   * keeps working without one in tests and headless profiles.
   */
  catalog?: () => WorkBuddyWebCatalog | undefined
  /** In-process key authorizing probe control writes. */
  probeKey?: string
  /**
   * The display preferences this document states.
   *
   * Projected per document rather than captured at registration: every one of
   * them is written through the host's settings service, so the very next read
   * has to reflect a write without a restart. A route assembled without the
   * projector (tests, a headless profile) leaves the fields out, and the
   * browser half then keeps its defaults rather than drawing a surface from a
   * document that never knew the setting.
   */
  preferences?: () => WorkBuddyStatedPreferences
  /**
   * Why the pool is empty, when the reason is diagnosable.
   *
   * "Signed out" is the wrong answer for a desktop file that exists but holds
   * the *other* product's credential: the user needs to be told which file to
   * fix, not told to sign in.
   */
  emptyReason?: () => string | undefined
  /**
   * The credential store the signed-out *reason code* is read from.
   *
   * Optional so a route assembled without one (tests, headless profiles) still
   * answers: the document then carries the prose alone and the browser falls
   * back to the generic hint. The pool is the authority on what is actually
   * served; this is the authority on *why* nothing is.
   */
  store?: Pick<WorkBuddyCredentialStore, 'status'>
  /**
   * International-card preference selecting larger declared context windows.
   * The getter may answer `undefined` when this host cannot persist the
   * preference (a 0.1.7 settings service has no section API): the field then
   * stays out of the document, and the card renders no control for it.
   */
  useMaximumContextWindow?: () => boolean | undefined
  /**
   * Per-account hidden-model state for the card's visibility controls.
   * Undefined when the caller offers none (tests, headless profiles); a
   * defined getter may still answer undefined — a signed-in account without a
   * stable uid has no bucket to key preferences by, and the card then renders
   * no visibility controls rather than a list every such account would share.
   */
  visibility?: () => WorkBuddyWebVisibilitySection | undefined
  /**
   * Route path to mount. Defaults to the CN variant's path so existing callers
   * and tests keep their behaviour; the international variant passes its own.
   */
  path?: string
}

/** Redact token-like content before it crosses to the browser. */
function safeMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, '[redacted token]')
    .replace(/(\b(?:code|token|refresh_token|access_token)=)[^&\s]+/giu, '$1[redacted]')
    .slice(0, 500)
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
  res.end(payload)
}

/**
 * The request must be addressed to the loopback interface, and a
 * browser-attached Origin must be loopback too. The Host check drops
 * DNS-rebinding pages (their Host is the attacker's domain, not loopback);
 * the card's same-origin fetches carry no Origin and pass on Host alone.
 */
function loopbackRequest(req: IncomingMessage): boolean {
  return hostIsLoopback(req.headers.host) && originIsLoopback(req.headers.origin)
}

/**
 * Assemble the card's status document.
 *
 * Sign-in state is the pool's existence; credit is a live billing answer whose
 * failure degrades to `creditsError` rather than failing the whole document.
 */
export async function workBuddyWebStatus(
  deps: WorkBuddyStatusRouteOptions,
): Promise<WorkBuddyWebStatus> {
  if (!deps.accounts.hasAccounts()) {
    // Nothing to serve as: the model group is hidden in this state too, so the
    // card explains how to get an account rather than reporting a dead one. A
    // diagnosable cause (a credential for the other product) wins over the
    // generic hint, because it names the file to fix.
    //
    // The store is the authority on *why* no credential is usable, so its
    // answer becomes the reason line verbatim. This branch deliberately does not
    // run `safeMessage` on it — the store produces a short, path-only
    // diagnosis, so any new failure path added here must keep credentials,
    // payloads and subprocess output out of its own message.
    const diagnosed = deps.emptyReason?.()
    const authStatus = deps.store === undefined ? undefined : await deps.store.status()
    return {
      status: 'signed-out',
      reason: diagnosed ?? authStatus?.reason
        ?? 'no account yet: sign in to the desktop app, or add one by QR from this card',
      // The account section and the control key travel even with an empty pool.
      // They are how the pool stops being empty: the card's add-account action is
      // a write, so withholding the key until an account existed would make
      // signing in the first account impossible — the one case where the user has
      // no other way in.
      //
      // A snapshot that fails must not take that key with it. The pool is empty
      // here, so the account LIST is worth nothing, while the key is worth
      // everything: without it the card's every action answers "request failed"
      // for a problem the user cannot even see. The reason line still carries the
      // diagnosis (the caller records desktop-read failures for exactly this).
      ...await accountSections(deps, await deps.accounts.snapshot({ withCredits: false }).catch(() => ({
        accounts: [] as const,
      }))),
    }
  }
  // One snapshot serves every surface that reads this document.
  // Credits are included because the window shows a balance per account; the
  // service caches each figure for a minute so a poll is not a burst of
  // billing requests.
  // One snapshot serves both the account section and the primary account's
  // identity fields; a second call would spend a second round of billing reads.
  const snapshot = await deps.accounts.snapshot({ withCredits: true })
  const primary = snapshot.accounts.find(account => account.id === snapshot.primary)
  const sections = accountSections(deps, snapshot)
  /** The last diagnosable desktop-read failure, read once for this document. */
  const desktopError = deps.emptyReason?.()
  const status: Extract<WorkBuddyWebStatus, { status: 'signed-in' }> = {
    status: 'signed-in',
    ...primary?.nickname === undefined ? {} : { nickname: primary.nickname },
    ...primary === undefined ? {} : { expiresAt: primary.expiresAtMs },
    // Which region this variant is answering for. Carried from the account
    // rather than the descriptor so a card can never claim a region its pool
    // does not actually speak to.
    ...primary === undefined ? {} : { domain: primary.domain },
    ...primary === undefined ? {} : { source: primary.origin },
    // A desktop read that failed is reported even now: the pool keeps serving,
    // so without this the user would see a healthy group and never learn that
    // the file they just configured is being refused.
    ...desktopError === undefined ? {} : { desktopError },
    ...sections,
  }
  // Model facts ride the signed-in document so the card can show rates,
  // promos, and context capacity without touching the Models picker. The rate
  // is normalized here (not in the card) so both halves agree on one display
  // form; the card additionally localizes it.
  //
  // The card receives *every* model, not just the discounted ones: context
  // capacity is exactly the fact a user wants before picking a model, and the
  // models where it matters most (a 200k model beside 1M siblings) are
  // precisely the ones with no promo attached. The discount section filters
  // what it renders.
  const models = deps.models()
  const modelsField: readonly WorkBuddyWebModelBadge[] = models
    .map(model => {
      const rate = normalizeCredits(model.billing?.credits)
      // The largest window the upstream declares for this model, when it
      // declares alternatives; equal to `contextWindow` otherwise, and omitted
      // when the upstream said nothing.
      const supported = model.supportedContextWindows ?? []
      const maxContextWindow = supported.length > 0 ? Math.max(...supported) : undefined
      // The window the model will actually run at: the user's choice when they
      // have made one and the upstream still offers it, else the default the
      // catalog reported. The card shows this figure, so it must be the same
      // one the adapter hands pi-ai.
      const chosen = deps.resolveContextWindow?.(model.id, supported)
      const effective = chosen ?? model.contextWindow
      // The upstream default, carried when the maximum-window preference is
      // what moved the working window off it, so the card can say which two
      // numbers it is choosing between.
      const defaultContextWindow = model.defaultContextWindow ?? model.contextWindow
      // A control is only worth showing when there is something to choose.
      const choices = supported.length > 1 ? [...supported].sort((left, right) => left - right) : undefined
      return {
        id: model.id,
        name: model.name,
        ...model.billing?.free === true ? { free: true as const } : {},
        ...model.billing?.badges !== undefined && model.billing.badges.length > 0 ? { badges: model.billing.badges } : {},
        ...rate === undefined ? {} : { credits: rate },
        // The rate is deliberately withheld for a row whose price cannot be
        // vouched for (a promotion that has ended but is still baked into the
        // cached row): the card then says the price needs a refresh instead of
        // repeating a stale figure or implying the model is free.
        ...model.billing?.rateUnknown === true ? { rateUnknown: true as const } : {},
        // The window in force, which is the upstream's default unless the user
        // chose one of the other lengths it declares (or the international card
        // opted into the largest one it offers).
        ...typeof effective === 'number' && effective > 0 ? { contextWindow: effective } : {},
        ...typeof defaultContextWindow === 'number' && defaultContextWindow > 0
          && defaultContextWindow < effective
          ? { defaultContextWindow }
          : {},
        ...choices === undefined ? {} : { contextChoices: choices, contextChoice: effective },
        ...maxContextWindow === undefined || maxContextWindow <= effective
          ? {}
          : { maxContextWindow },
        ...typeof model.maxInputTokens === 'number' && model.maxInputTokens > 0
          ? { maxInputTokens: model.maxInputTokens }
          : {},
      }
    })
  // Catalog provenance rides the document even when the model list is empty:
  // "no models" is precisely the case a user needs explained, and it is the
  // only way to tell a hidden group from a failed fetch.
  const catalog = deps.catalog?.()
  const withCatalog: WorkBuddyWebStatus = catalog === undefined ? status : { ...status, catalog }
  // Visibility rides the document beside the model list it qualifies. Absent
  // when no account-with-uid is in effect; the card keys its controls on the
  // section's presence.
  const visibility = deps.visibility?.()
  const withVisibility: WorkBuddyWebStatus = visibility === undefined ? withCatalog : { ...withCatalog, visibility }
  const statusWithModels: WorkBuddyWebStatus = modelsField.length > 0
    ? { ...withVisibility, models: modelsField }
    : withVisibility
  // Probe state rides the signed-in document so the card can render the
  // consent switches and results without a second request. The control key
  // travels with it: this response already passed the loopback guard, and the
  // key authorizes only probe control, never credentials or completions.
  let probed: WorkBuddyWebStatus = statusWithModels
  if (deps.probe !== undefined) {
    // The preference is offered only when the getter can answer a value; a
    // host that cannot persist it answers `undefined` and the field stays out
    // of this document, which is the card's signal not to render the control.
    const maximumContextWindow = deps.useMaximumContextWindow?.()
    probed = {
      ...statusWithModels,
      probe: deps.probe(),
      ...deps.probeKey === undefined ? {} : { probeKey: deps.probeKey },
      ...maximumContextWindow === undefined ? {} : { useMaximumContextWindow: maximumContextWindow },
    }
  }
  // The primary account's own balance, so the card's headline figure and the
  // per-account rows can never disagree about which account they describe.
  try {
    const credential = await deps.accounts.primaryCredential()
    if (credential !== undefined) {
      const credits = await deps.client.fetchCredits(credential)
      // `unlimited` and `cycleResetTime` ride along as-is: the card must see
      // "no cap" as its own state, and the fetch only sets them when the
      // upstream actually reported them.
      return { ...probed, credits }
    }
  } catch (error: unknown) {
    return { ...probed, creditsError: safeMessage(error) }
  }
  return probed
}

/**
 * The account section plus the control key, shared by both sign-in states.
 *
 * One helper rather than two copies because the signed-out document needs both
 * for the same reason: adding the first account is a write, and the write is
 * authorized by the key this same document hands out.
 */
function accountSections(
  deps: WorkBuddyStatusRouteOptions,
  snapshot: Awaited<ReturnType<WorkBuddyStatusRouteOptions['accounts']['snapshot']>>,
): {
  accounts: NonNullable<Extract<WorkBuddyWebStatus, { status: 'signed-in' }>['accounts']>
  probeKey?: string
} & WorkBuddyStatedPreferences {
  // The display preferences ride this helper because they are shared by both
  // sign-in states for the same reason the control key is: the sidebar draws its
  // credit line the same way whether the pool is empty or not, and whether it is
  // drawn at all is equally independent of what the pool holds.
  return {
    accounts: {
      accounts: snapshot.accounts,
      ...snapshot.primary === undefined ? {} : { primary: snapshot.primary },
      ...snapshot.desktop === undefined ? {} : { desktop: snapshot.desktop },
    },
    ...deps.probeKey === undefined ? {} : { probeKey: deps.probeKey },
    ...deps.preferences?.(),
  }
}

/** The status route's request handler, extracted so tests can mount it on a bare server. */
export function workBuddyStatusHandler(
  deps: WorkBuddyStatusRouteOptions,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    if (req.method !== 'GET') {
      json(res, 405, { error: 'method not allowed' })
      return
    }
    if (!loopbackRequest(req)) {
      json(res, 403, { error: 'request-not-trusted' })
      return
    }
    try {
      json(res, 200, await workBuddyWebStatus(deps))
    } catch (error: unknown) {
      json(res, 500, { error: safeMessage(error) })
    }
  }
}

/** Mount the GET status route on an optional webServer context. */
export function registerWorkBuddyStatusRoute(ctx: Context, deps: WorkBuddyStatusRouteOptions): void {
  const path = deps.path ?? WORKBUDDY_STATUS_PATH
  ctx.effect(() => {
    const dispose = ctx.webServer.register({
      kind: 'exact',
      path,
      handler: workBuddyStatusHandler(deps),
    })
    return () => {
      dispose()
    }
  }, 'dsh-workbuddy-connect: Web status route')
}
