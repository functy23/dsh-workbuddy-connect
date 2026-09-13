/**
 * The network half of the account pool: capturing the desktop app's sign-in,
 * minting QR sign-ins, and answering "who is this variant right now" for the
 * catalog, the card, and the floating window.
 *
 * The split from {@link module:dsh-workbuddy-connect/account-pool} is
 * deliberate: the pool is pure state that tests can drive directly, while
 * everything here touches the network or the filesystem.
 *
 * @module dsh-workbuddy-connect/account-service
 */

import type { WorkBuddyAccount, WorkBuddyAccountPool } from './account-pool.ts'
import { accountIdOf, credentialAccountId, credentialOf } from './account-pool.ts'
import { profileFromToken } from './account-token.ts'
import type { WorkBuddyCredential, WorkBuddyCredentialStore } from './auth.ts'
import type { WorkBuddyQrLogin } from './qr-login.ts'
import { regionOf } from './upstream.ts'
import type { WorkBuddyUpstreamClient } from './upstream.ts'
import type { WorkBuddyVariant } from './variants.ts'

/** How long a per-account credit figure is reused before it is fetched again. */
const CREDIT_TTL_MS = 60_000

/** One account as the browser renders it. Never carries token material. */
export interface WorkBuddyWebAccount {
  id: string
  uid: string
  /** User label when set, else the upstream nickname, else a short uid. */
  name: string
  label?: string
  nickname?: string
  origin: 'desktop' | 'qr' | 'cookie'
  /** Login domain this account speaks to; the card reports the region from it. */
  domain: string
  /**
   * True when the account can renew itself.
   *
   * A pasted token carries no refresh token, so the card can tell the user that
   * an expiring account needs a fresh paste rather than letting it fail
   * silently at the next request.
   */
  renewable: boolean
  enabled: boolean
  /** Whether rotation may pick it right now (enabled, not benched, not dead). */
  available: boolean
  /** Remaining credit, when the last lookup succeeded. */
  credits?: number
  creditsError?: string
  /** When `credits` was fetched, epoch ms. */
  creditsAtMs?: number
  /** Access-token expiry, epoch ms; 0 means the source did not say. */
  expiresAtMs: number
  /** Set when the upstream refused the session and a refresh could not fix it. */
  sessionDead?: boolean
  /** Present while the account is benched. */
  cooldown?: {
    /** Epoch ms after which it will be tried again. */
    untilMs: number
    reason: 'rate' | 'credit' | 'session'
    strikes: number
  }
  lastUsedAtMs: number
  addedAtMs: number
}

/** What the account service reports about one variant. */
export interface WorkBuddyAccountSnapshot {
  accounts: readonly WorkBuddyWebAccount[]
  /** Identity of the account the catalog/credits are read from, when any. */
  primary?: string
  /** Identity of the desktop app's current account, when it is in the pool. */
  desktop?: string
}

/** Options for {@link WorkBuddyAccountService}. */
export interface WorkBuddyAccountServiceOptions {
  variant: WorkBuddyVariant
  pool: WorkBuddyAccountPool
  /** Reads the desktop app's own credential file (never writes it). */
  store: Pick<WorkBuddyCredentialStore, 'desktopCredential' | 'current'>
  client: Pick<WorkBuddyUpstreamClient, 'fetchCredits' | 'refreshToken'>
  qr: WorkBuddyQrLogin
  logger?: { warn(...args: unknown[]): void }
  /** Injectable clock, for tests. */
  now?: () => number
}

/** One cached credit lookup. */
interface CreditEntry {
  total?: number
  error?: string
  atMs: number
}

/**
 * Owns the pool's network-facing behaviour for one variant.
 *
 * Credit figures are cached per account for a minute. That matters because the
 * floating window polls while a conversation is open, and an uncached lookup
 * would mean one billing request per account per poll — real traffic against
 * the user's own quota, for a number that changes slowly.
 */
export class WorkBuddyAccountService {
  private readonly variant: WorkBuddyVariant
  private readonly pool: WorkBuddyAccountPool
  private readonly store: WorkBuddyAccountServiceOptions['store']
  private readonly client: WorkBuddyAccountServiceOptions['client']
  private readonly qr: WorkBuddyQrLogin
  private readonly logger: WorkBuddyAccountServiceOptions['logger']
  private readonly now: () => number
  private readonly credits = new Map<string, CreditEntry>()
  private readonly inflight = new Map<string, Promise<CreditEntry>>()

  constructor(options: WorkBuddyAccountServiceOptions) {
    this.variant = options.variant
    this.pool = options.pool
    this.store = options.store
    this.client = options.client
    this.qr = options.qr
    this.logger = options.logger
    this.now = options.now ?? (() => Date.now())
  }

  /**
   * Capture the desktop app's current sign-in into the pool.
   *
   * Called at startup and on every credential sweep, which is what makes the
   * desktop account an ordinary pool member: it is upserted (so a token
   * rotation in the app is picked up) but never *required* — signing out of
   * the app leaves the captured account in place, which is the behaviour the
   * whole feature depends on.
   *
   * @returns the captured account, or undefined when the app is not signed in.
   */
  async captureDesktop(): Promise<WorkBuddyAccount | undefined> {
    const credential = await this.store.desktopCredential()
    if (credential === undefined) return undefined
    return this.capture(credential)
  }

  /**
   * Capture a credential that came from anywhere into the pool.
   *
   * The region is not re-checked here: {@link WorkBuddyCredentialStore} already
   * refuses a credential belonging to the other product, and the QR flow checks
   * its own answer before it gets this far.
   */
  capture(credential: WorkBuddyCredential): WorkBuddyAccount {
    const result = this.pool.upsert({
      uid: credential.uid,
      ...credential.enterpriseId === undefined ? {} : { enterpriseId: credential.enterpriseId },
      ...credential.nickname === undefined ? {} : { nickname: credential.nickname },
      domain: credential.domain,
      accessToken: credential.accessToken,
      refreshToken: credential.refreshToken,
      expiresAtMs: credential.expiresAtMs,
      ...credential.refreshExpiresAtMs === undefined ? {} : { refreshExpiresAtMs: credential.refreshExpiresAtMs },
      origin: 'desktop',
    })
    return result.account
  }

  /** The desktop app's account identity, when the app is signed in. */
  async desktopIdentity(): Promise<string | undefined> {
    const credential = await this.store.desktopCredential()
    return credential === undefined ? undefined : credentialAccountId(credential)
  }

  /**
   * The credential the catalog, credits, and probes run as.
   *
   * The desktop app's current account wins while it is usable, so the card's
   * account name and credit figure stay stable while the user is signed in
   * there; otherwise the first available pool member answers. Returning
   * undefined means the variant has nothing to work with at all, which is what
   * hides its model group.
   */
  async primaryCredential(): Promise<WorkBuddyCredential | undefined> {
    const desktopId = await this.desktopIdentity()
    const primary = this.pool.primary(desktopId, this.now())
    if (primary === undefined) return undefined
    const refreshed = await this.refreshIfStale(primary)
    return credentialOf(refreshed)
  }

  /** The identity {@link primaryCredential} would answer for. */
  async primaryIdentity(): Promise<string | undefined> {
    const desktopId = await this.desktopIdentity()
    return this.pool.primary(desktopId, this.now())?.id
  }

  /**
   * Refresh an account whose access token is at or near expiry.
   *
   * The pool's own copy is the one that gets updated, so a refresh survives a
   * restart. A failed refresh is not fatal: a token that has not actually
   * expired yet still works, which is the same tolerance the single-account
   * store had.
   */
  private async refreshIfStale(account: WorkBuddyAccount): Promise<WorkBuddyAccount> {
    const marginMs = 5 * 60_000
    if (account.expiresAtMs > this.now() + marginMs) return account
    if (account.refreshToken === '') return account
    try {
      const outcome = await this.client.refreshToken(credentialOf(account))
      const updated = this.pool.updateTokens(account.id, {
        accessToken: outcome.accessToken,
        ...outcome.refreshToken === undefined ? {} : { refreshToken: outcome.refreshToken },
        ...outcome.expiresInSec === undefined ? {} : { expiresAtMs: this.now() + outcome.expiresInSec * 1000 },
        ...outcome.domain === undefined ? {} : { domain: outcome.domain },
      })
      return updated ?? account
    } catch (error: unknown) {
      this.logger?.warn(`dsh-workbuddy-connect: ${this.variant.displayName} token refresh failed`, error)
      return account
    }
  }

  /** Whether the variant has any account at all (enabled, dead, benched or not). */
  hasAccounts(): boolean {
    return this.pool.list().length > 0
  }

  /** Whether the variant has at least one account rotation may use. */
  hasUsableAccount(): boolean {
    return this.pool.list().some(account => this.pool.isAvailable(account, this.now()))
  }

  /**
   * One account's remaining credit, cached.
   *
   * @param force - bypass the cache, for a user-initiated refresh.
   */
  async creditsFor(account: WorkBuddyAccount, force = false): Promise<CreditEntry> {
    const cached = this.credits.get(account.id)
    if (!force && cached !== undefined && this.now() - cached.atMs < CREDIT_TTL_MS) return cached
    const existing = this.inflight.get(account.id)
    if (existing !== undefined) return existing
    const run = (async (): Promise<CreditEntry> => {
      try {
        const answer = await this.client.fetchCredits(credentialOf(account))
        const entry: CreditEntry = { total: answer.total, atMs: this.now() }
        this.credits.set(account.id, entry)
        return entry
      } catch (error: unknown) {
        const entry: CreditEntry = {
          error: (error instanceof Error ? error.message : String(error)).slice(0, 200),
          atMs: this.now(),
        }
        this.credits.set(account.id, entry)
        return entry
      }
    })().finally(() => {
      this.inflight.delete(account.id)
    })
    this.inflight.set(account.id, run)
    return run
  }

  /** Forget a cached credit figure, e.g. after a request spent some. */
  invalidateCredits(id?: string): void {
    if (id === undefined) this.credits.clear()
    else this.credits.delete(id)
  }

  /**
   * The snapshot the card's account tab and the floating window render.
   *
   * @param withCredits - whether to include per-account balances. The floating
   *   window asks for them; a write confirmation does not need them and should
   *   not pay for N billing requests.
   * @param forceCredits - bypass the credit cache.
   */
  async snapshot(options: { withCredits?: boolean, forceCredits?: boolean } = {}): Promise<WorkBuddyAccountSnapshot> {
    const desktopId = await this.desktopIdentity()
    const accounts = this.pool.list()
    const primary = this.pool.primary(desktopId, this.now())?.id
    const views: WorkBuddyWebAccount[] = []
    for (const account of accounts) {
      let credits: CreditEntry | undefined
      if (options.withCredits === true) credits = await this.creditsFor(account, options.forceCredits === true)
      views.push({
        id: account.id,
        uid: account.uid,
        name: account.label ?? account.nickname ?? `${account.uid.slice(0, 8)}…`,
        ...account.label === undefined ? {} : { label: account.label },
        ...account.nickname === undefined ? {} : { nickname: account.nickname },
        origin: account.origin,
        domain: account.domain,
        renewable: account.refreshToken !== '',
        enabled: account.enabled,
        available: this.pool.isAvailable(account, this.now()),
        ...credits?.total === undefined ? {} : { credits: credits.total },
        ...credits?.error === undefined ? {} : { creditsError: credits.error },
        ...credits === undefined ? {} : { creditsAtMs: credits.atMs },
        expiresAtMs: account.expiresAtMs,
        ...account.sessionDead === true ? { sessionDead: true } : {},
        ...account.cooldown === undefined ? {} : {
          cooldown: {
            untilMs: account.cooldown.untilMs,
            reason: account.cooldown.reason,
            strikes: account.cooldown.strikes,
          },
        },
        lastUsedAtMs: account.lastUsedAtMs,
        addedAtMs: account.addedAtMs,
      })
    }
    return {
      accounts: views,
      ...primary === undefined ? {} : { primary },
      ...desktopId === undefined ? {} : { desktop: desktopId },
    }
  }

  /**
   * Add an account from a sign-in token pasted out of the web console.
   *
   * Everything is read out of the token itself — no request is made, so this
   * cannot fail because an endpoint moved, and it works for the international
   * product, which has no desktop app to capture from.
   *
   * The token's issuer decides which product it belongs to, and it must be
   * *this* variant's: the same refusal the desktop file gets applies here,
   * because accepting the other product's token would put a credential in the
   * pool that every request is guaranteed to be rejected for, with no hint as
   * to why. The stored `refreshToken` is empty by construction — the console
   * issues none — so the account works until its `exp` and then needs the user
   * to paste a fresh one.
   *
   * @returns the upsert outcome, or a refusal reason.
   */
  addCookieAccount(token: string): {
    account?: WorkBuddyAccount
    created?: boolean
    reason?: string
  } {
    const profile = profileFromToken(token)
    if (profile === undefined) {
      return { reason: 'that does not look like a sign-in token (no readable payload)' }
    }
    if (profile.domain === '') {
      return { reason: 'the token names an issuer this plugin does not recognise' }
    }
    if (regionOf(profile.domain) !== this.variant.region) {
      const actual = regionOf(profile.domain) === 'global' ? 'WorkBuddy AI (international)' : 'WorkBuddy (CN)'
      return { reason: `that is a ${actual} token; paste it into the matching product's dialog` }
    }
    const result = this.pool.upsert({
      uid: profile.uid,
      ...profile.enterpriseId === undefined ? {} : { enterpriseId: profile.enterpriseId },
      ...profile.nickname === undefined ? {} : { nickname: profile.nickname },
      domain: profile.domain,
      accessToken: token.trim(),
      refreshToken: '',
      expiresAtMs: profile.expiresAtMs,
      origin: 'cookie',
    })
    this.invalidateCredits(result.account.id)
    return { account: result.account, created: result.created }
  }

  /** Add one QR sign-in to the pool. */
  addQrAccount(poll: Extract<Awaited<ReturnType<WorkBuddyQrLogin['poll']>>, { status: 'ready' }>): {
    account: WorkBuddyAccount
    created: boolean
    updated: boolean
  } {
    const result = this.pool.upsert({
      uid: poll.uid,
      ...poll.enterpriseId === undefined ? {} : { enterpriseId: poll.enterpriseId },
      ...poll.nickname === undefined ? {} : { nickname: poll.nickname },
      domain: poll.domain,
      accessToken: poll.accessToken,
      refreshToken: poll.refreshToken,
      expiresAtMs: poll.expiresAtMs,
      origin: 'qr',
    })
    // A fresh sign-in can change the balance, so the cached figure is stale.
    this.invalidateCredits(result.account.id)
    return { account: result.account, created: result.created, updated: result.updated }
  }

  /** Identity key for a uid/enterprise pair, for callers holding raw values. */
  idOf(uid: string, enterpriseId?: string): string {
    return accountIdOf(uid, enterpriseId)
  }
}
