/**
 * QR sign-in against the WorkBuddy (CodeBuddy) plugin-auth endpoints.
 *
 * Three calls, in order, exactly as the official CLI performs them (and as
 * `workbuddy-manager` reimplements them server-side):
 *
 * 1. `POST /v2/plugin/auth/state?platform=CLI` → `{state, authUrl}`
 * 2. `GET  /v2/plugin/auth/token?state=…` → the token pair once scanned; while
 *    the user has not scanned, the envelope answers a non-zero business code
 *    (`11217:login ing...`) rather than an HTTP error.
 * 3. `GET  /v2/plugin/login/account?state=…` (bearer = the fresh access token)
 *    → `{uid, enterpriseId, nickname}`, which is the identity the pool needs.
 *
 * The endpoints live on the same host as that region's chat traffic, so a CN
 * sign-in is done against `copilot.tencent.com` and an international one
 * against `www.workbuddy.ai`. Sharing {@link chatBaseForRegion} with the chat
 * path is deliberate: a QR sign-in that pointed at the wrong region would put
 * a credential in a pool that can never use it.
 *
 * Everything here is stateless apart from an in-memory set of outstanding
 * states, which exists so a caller cannot poll a state this process never
 * minted. Nothing is persisted until a sign-in completes.
 *
 * @module dsh-workbuddy-connect/qr-login
 */

import { randomUUID } from 'node:crypto'
import { chatBaseForRegion, originForRegion, regionOf } from './upstream.ts'
import type { WorkBuddyRegion } from './upstream.ts'
import type { WorkBuddyVariant } from './variants.ts'

/** How long a minted QR sign-in stays valid; matches the upstream's own window. */
const STATE_TTL_MS = 5 * 60_000

/** Timeout for one plugin-auth request. */
const AUTH_TIMEOUT_MS = 20_000

/** The CLI identity the upstream expects on every plugin-auth request. */
const AUTH_UA = 'CLI/2.63.2 CodeBuddy/2.63.2'

/** A freshly minted QR sign-in: the state to poll and the URL to render. */
export interface WorkBuddyQrChallenge {
  state: string
  /** The URL the QR code must encode; opening it on a phone starts the sign-in. */
  authUrl: string
  /** When this challenge stops being pollable, epoch ms. */
  expiresAtMs: number
}

/** Result of one poll. */
export type WorkBuddyQrPoll =
  | { status: 'waiting' }
  | { status: 'expired' }
  | { status: 'invalid' }
  | {
    status: 'ready'
    uid: string
    enterpriseId?: string
    nickname?: string
    domain: string
    accessToken: string
    refreshToken: string
    expiresAtMs: number
  }

/** Constructor dependencies; the variant fixes which region is signed into. */
export interface WorkBuddyQrLoginOptions {
  variant: WorkBuddyVariant
  /** Injectable fetch, for tests. Defaults to the global `fetch`. */
  fetch?: typeof fetch
  /** Injectable clock, for tests. */
  now?: () => number
}

/** The upstream's uniform envelope. */
interface Envelope {
  code: number
  msg: string
  data: unknown
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** Parse the envelope, tolerating a non-JSON body (an edge gateway's HTML 401). */
function parseEnvelope(text: string): Envelope | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!isObject(parsed)) return undefined
  return {
    code: typeof parsed['code'] === 'number' ? parsed['code'] : 0,
    msg: typeof parsed['msg'] === 'string' ? parsed['msg'] : '',
    data: parsed['data'],
  }
}

/**
 * One QR sign-in flow for one variant.
 *
 * Instances are cheap and stateless beyond the outstanding-state set; the
 * plugin keeps one per variant.
 */
export class WorkBuddyQrLogin {
  private readonly variant: WorkBuddyVariant
  /**
   * Injectable fetch. Left undefined in production so {@link send} resolves
   * `globalThis.fetch` per call: a test that stubs the global after
   * constructing the flow (which is how every other test in this plugin works)
   * then still reaches the stub, and a proxy or instrumentation installed later
   * is picked up rather than bypassed.
   */
  private readonly injectedFetch: typeof fetch | undefined
  private readonly now: () => number
  /** States this process minted, and when each was created. */
  private readonly states = new Map<string, number>()

  constructor(options: WorkBuddyQrLoginOptions) {
    this.variant = options.variant
    this.injectedFetch = options.fetch
    this.now = options.now ?? (() => Date.now())
  }

  /** The region every request here goes to, from the variant descriptor. */
  private region(): WorkBuddyRegion {
    return this.variant.region
  }

  private base(): string {
    return chatBaseForRegion(this.region())
  }

  /** One plugin-auth request, through the injected or the ambient fetch. */
  private send(url: string, init: RequestInit): Promise<Response> {
    const doFetch = this.injectedFetch ?? globalThis.fetch
    return doFetch(url, init)
  }

  /** The headers the official CLI sends; the upstream checks the UA. */
  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const origin = originForRegion(this.region())
    return {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/plain, */*',
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent': AUTH_UA,
      'Origin': origin,
      'Referer': `${origin}/`,
      ...extra,
    }
  }

  /**
   * Mint a challenge: the QR payload and the state to poll.
   *
   * The state is remembered locally. The upstream also validates it, but a
   * local record is what lets {@link poll} answer `invalid` for a state that
   * was never minted here instead of forwarding an arbitrary value upstream.
   */
  async start(): Promise<WorkBuddyQrChallenge> {
    const response = await this.send(`${this.base()}/v2/plugin/auth/state?platform=CLI`, {
      method: 'POST',
      headers: this.headers(),
      body: '{}',
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
    })
    const envelope = parseEnvelope(await response.text())
    if (envelope === undefined) {
      throw new Error(`${this.variant.displayName} sign-in: the auth endpoint answered a non-JSON body (http ${response.status})`)
    }
    if (!response.ok || envelope.code !== 0) {
      throw new Error(`${this.variant.displayName} sign-in: could not obtain an authorization link (code ${envelope.code}${envelope.msg === '' ? '' : `: ${envelope.msg.slice(0, 120)}`})`)
    }
    const data = isObject(envelope.data) ? envelope.data : {}
    const state = optionalString(data['state'])
    const authUrl = optionalString(data['authUrl'])
    if (state === undefined || authUrl === undefined) {
      throw new Error(`${this.variant.displayName} sign-in: the auth endpoint returned no state/authUrl`)
    }
    const createdAt = this.now()
    this.states.set(state, createdAt)
    this.prune()
    return { state, authUrl, expiresAtMs: createdAt + STATE_TTL_MS }
  }

  /**
   * Poll one challenge.
   *
   * A non-zero business code is the *normal* "still waiting" answer
   * (`11217:login ing...`), not a failure, so it is reported as `waiting`
   * rather than thrown. The account call is what turns a token into the uid
   * the pool keys on; until it answers a uid, the sign-in is not complete.
   */
  async poll(state: string): Promise<WorkBuddyQrPoll> {
    const createdAt = this.states.get(state)
    if (createdAt === undefined) return { status: 'invalid' }
    if (this.now() - createdAt > STATE_TTL_MS) {
      this.states.delete(state)
      return { status: 'expired' }
    }
    const tokenResponse = await this.send(`${this.base()}/v2/plugin/auth/token?state=${encodeURIComponent(state)}`, {
      method: 'GET',
      headers: this.headers(),
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
    })
    const tokenEnvelope = parseEnvelope(await tokenResponse.text())
    if (tokenEnvelope === undefined) return { status: 'waiting' }
    const tokenData = isObject(tokenEnvelope.data) ? tokenEnvelope.data : {}
    const accessToken = optionalString(tokenData['accessToken'])
    if (tokenEnvelope.code !== 0 || accessToken === undefined) return { status: 'waiting' }
    const refreshToken = optionalString(tokenData['refreshToken']) ?? ''
    const expiresInSec = typeof tokenData['expiresIn'] === 'number' && tokenData['expiresIn'] > 0
      ? tokenData['expiresIn']
      : 3_600
    const declaredDomain = optionalString(tokenData['domain']) ?? ''

    const accountResponse = await this.send(`${this.base()}/v2/plugin/login/account?state=${encodeURIComponent(state)}`, {
      method: 'GET',
      headers: this.headers({ Authorization: `Bearer ${accessToken}` }),
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
    })
    const accountEnvelope = parseEnvelope(await accountResponse.text())
    const accountData = accountEnvelope !== undefined && isObject(accountEnvelope.data) ? accountEnvelope.data : {}
    const uid = optionalString(accountData['uid'])
    if (uid === undefined) return { status: 'waiting' }

    this.states.delete(state)
    // The domain decides the region every later request goes to, so it is
    // checked against the variant that minted this challenge rather than
    // trusted blindly: a mismatch means the sign-in landed on the other
    // product, and storing it here would make a pool whose every request is
    // refused by the region guard.
    const domain = declaredDomain !== '' ? declaredDomain : this.defaultDomain()
    if (regionOf(domain) !== this.variant.region) {
      throw new Error(
        `${this.variant.displayName} sign-in returned a ${regionOf(domain) === 'cn' ? 'WorkBuddy (CN)' : 'WorkBuddy AI'} credential`
        + ` (domain ${JSON.stringify(domain)}); scan the code with the ${this.variant.appName} account instead`,
      )
    }
    return {
      status: 'ready',
      uid,
      ...optionalString(accountData['enterpriseId']) === undefined ? {} : { enterpriseId: accountData['enterpriseId'] as string },
      ...optionalString(accountData['nickname']) === undefined ? {} : { nickname: accountData['nickname'] as string },
      domain,
      accessToken,
      refreshToken,
      expiresAtMs: this.now() + expiresInSec * 1000,
    }
  }

  /** Drop an outstanding challenge (the user closed the dialog). */
  cancel(state: string): void {
    this.states.delete(state)
  }

  /** The domain a variant's credentials carry when the upstream omits one. */
  private defaultDomain(): string {
    return this.variant.region === 'global' ? 'workbuddy.ai' : ''
  }

  private prune(): void {
    const cutoff = this.now() - STATE_TTL_MS
    for (const [state, createdAt] of this.states) {
      if (createdAt < cutoff) this.states.delete(state)
    }
  }
}

/** A random opaque id, for logging a challenge without exposing its state. */
export function challengeTag(): string {
  return randomUUID().slice(0, 8)
}
