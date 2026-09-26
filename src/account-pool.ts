/**
 * The per-variant WorkBuddy account pool: every credential this plugin may
 * send upstream, the order it tries them in, and how long a failed one is
 * benched.
 *
 * Why a pool at all: the upstream rate-limits and quota-limits *per account*
 * (429 / 402), and the plugin used to have exactly one credential — the
 * desktop app's. A single 429 was therefore the user's problem. With several
 * accounts the plugin can treat one account's limit as a routing decision
 * rather than a failure.
 *
 * Two credential sources feed the same pool, and both are *long-lived*:
 *
 * - the desktop app's sign-in, captured automatically whenever it is present
 *   (startup and every credential sweep). Signing out of the desktop app does
 *   NOT remove it: the captured tokens keep working until they expire, and the
 *   refresh token usually keeps them working well past that. That is the whole
 *   point — the desktop app is one account among several, not the plugin's
 *   master switch.
 * - a QR sign-in started from the plugin's own card, which lands a brand-new
 *   account without a desktop app at all.
 *
 * Nothing here talks to the network: this module is pure pool state (with
 * atomic file persistence), so it can be reasoned about and tested without a
 * credential. {@link module:dsh-workbuddy-connect/account-service} owns the
 * network half.
 *
 * @module dsh-workbuddy-connect/account-pool
 */

import { resolve } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { readStoreDocument, writeStoreDocument } from './store-file.ts'
import type { WorkBuddyCredential } from './auth.ts'
import type { WorkBuddyVariant } from './variants.ts'

/** On-disk format this reader accepts; other versions are discarded. */
const POOL_FORMAT_VERSION = 1

/** Basename of the CN variant's account-pool file inside the Harness home. */
export const WORKBUDDY_ACCOUNTS_FILENAME = '.workbuddy-accounts.json'

/** Why an account was benched. */
export type WorkBuddyCooldownReason = 'rate' | 'credit' | 'session'

/**
 * A benching: until when, and why.
 *
 * `strikes` is the count of consecutive *cooldown-causing* failures, so the
 * backoff can grow with repetition and reset on the first success. It is kept
 * on the record (rather than in memory) so a restart does not hand a
 * repeatedly-limited account a fresh, short cooldown.
 */
export interface WorkBuddyCooldown {
  /** Epoch ms after which the account is eligible again. */
  untilMs: number
  reason: WorkBuddyCooldownReason
  /** Consecutive failures that produced this cooldown; 1 on the first. */
  strikes: number
  /** When this cooldown was last (re)computed, for display. */
  atMs: number
}

/** How an account entered the pool. */
export type WorkBuddyAccountOrigin = 'desktop' | 'qr' | 'cookie'

/** One account the plugin may send a request as. */
export interface WorkBuddyAccount {
  /** Stable identity: `uid:enterpriseId`. The pool's key. */
  id: string
  uid: string
  enterpriseId?: string
  nickname?: string
  /** Optional user-set label, shown instead of the nickname when present. */
  label?: string
  /** Login domain; decides the upstream region for every request. */
  domain: string
  accessToken: string
  refreshToken: string
  /** Access-token expiry, epoch ms; 0 means "unknown". */
  expiresAtMs: number
  /** Refresh-token expiry when the source declares one. */
  refreshExpiresAtMs?: number
  origin: WorkBuddyAccountOrigin
  /**
   * Whether rotation may pick this account. A user toggle, not a health
   * signal: health is {@link WorkBuddyCooldown}, which expires on its own.
   */
  enabled: boolean
  /**
   * Epoch ms of the last request this account served, or 0 for never. This is
   * the whole of the selection policy: least-recently-used wins, which spreads
   * load evenly without a cursor that a restart would lose.
   */
  lastUsedAtMs: number
  /** Present only while the account is benched. */
  cooldown?: WorkBuddyCooldown
  /**
   * Set when the upstream refused the session outright and the refresh token
   * could not revive it *definitively*. Kept as a flag rather than a deletion:
   * the account still shows in the list (so the user can see what happened and
   * delete it), and it never participates in rotation again.
   *
   * A transient failure while refreshing (a timeout, a 5xx, a dropped
   * connection) never sets this: it is not evidence that the sign-in is gone,
   * and burning the account for it left the user with no way back. Turning the
   * account back on — {@link WorkBuddyAccountPool.setEnabled} with `true` — is
   * the manual override, for the case where the session really is gone but the
   * upstream has since accepted it again.
   */
  sessionDead?: boolean
  /**
   * Consecutive cooldown-causing failures, cleared by the first success.
   *
   * Kept apart from {@link WorkBuddyCooldown.strikes} on purpose: the cooldown
   * is gone by the time the account is eligible again, so a streak stored only
   * inside it restarted at 1 on every later failure and the backoff schedule
   * never grew past its base. This is the counter the schedule actually needs.
   */
  failureStreak?: number
  addedAtMs: number
  updatedAtMs: number
}

/** What an upsert wants to write; identity and bookkeeping are derived. */
export interface WorkBuddyAccountInput {
  uid: string
  enterpriseId?: string
  nickname?: string
  domain: string
  accessToken: string
  refreshToken: string
  expiresAtMs: number
  refreshExpiresAtMs?: number
  origin: WorkBuddyAccountOrigin
  /**
   * This write is a background re-read of a sign-in source, not a user action.
   *
   * A sweep re-reads the desktop app's file every thirty seconds and upserts
   * what it finds. That is a *duplicate* of a credential the pool already
   * holds, and treating it like a fresh sign-in undid everything the pool had
   * learned in the meantime: a disabled account came back on, a benching was
   * dropped, a dead session was resurrected, and — worst — the tokens were
   * overwritten with the file's older copy, discarding a refresh the plugin had
   * performed itself.
   *
   * A sync therefore only refreshes what a re-read can legitimately tell us
   * (the nickname), keeps the user's enabled flag and every health field, and
   * adopts the tokens only when the source's copy is demonstrably *newer*.
   */
  sync?: boolean
}

/** Outcome of an upsert, for the "this account is already in the pool" notice. */
export interface WorkBuddyUpsertResult {
  account: WorkBuddyAccount
  /** True when this identity was not in the pool before. */
  created: boolean
  /** True when the stored tokens actually changed. */
  updated: boolean
}

/** Backoff schedule for one cooldown reason. */
const COOLDOWN_BASE_MS: Readonly<Record<WorkBuddyCooldownReason, number>> = {
  // Rate limits are usually short (a burst window); start at a minute.
  rate: 60_000,
  // Exhausted quota refills on the provider's own schedule, so start long.
  credit: 60 * 60_000,
  // A dead session only comes back through a fresh sign-in, which the user
  // must perform; the cooldown exists so the pool stops asking, not because
  // waiting fixes it.
  session: 6 * 60 * 60_000,
}

/**
 * Longest failure streak the backoff schedule is computed from.
 *
 * The schedule is capped anyway, so this only bounds the counter itself; it
 * keeps a long outage from growing an unbounded integer in the pool file.
 */
const STRIKE_CEILING = 16

/** Ceiling for each reason's exponential backoff. */
const COOLDOWN_CAP_MS: Readonly<Record<WorkBuddyCooldownReason, number>> = {
  rate: 15 * 60_000,
  credit: 24 * 60 * 60_000,
  session: 24 * 60 * 60_000,
}

/**
 * Longest an *upstream-stated* wait is honoured.
 *
 * Deliberately not {@link COOLDOWN_CAP_MS}: those caps bound this plugin's own
 * backoff schedule, which is a guess and should stay modest. A time the upstream
 * stated is not a guess — a frequency-limit reset is routinely hours away, and
 * clamping it to the rate schedule's fifteen minutes meant retrying into the
 * same refusal for as long as the limit lasted. This bound exists only so a
 * mistyped date cannot bench an account indefinitely.
 */
const COOLDOWN_HINT_CAP_MS = 7 * 24 * 60 * 60_000

/** The backoff an account earns after `strikes` consecutive failures. */
export function cooldownDurationMs(reason: WorkBuddyCooldownReason, strikes: number): number {
  const exponent = Math.max(0, Math.min(strikes - 1, 16))
  const base = COOLDOWN_BASE_MS[reason]
  return Math.min(base * 2 ** exponent, COOLDOWN_CAP_MS[reason])
}

/**
 * Whether a source file's credential demonstrably post-dates the pool's copy.
 *
 * Only a strictly later access-token expiry proves that, and only that is
 * evidence a sign-in happened: the pool refreshes inside the five-minute margin
 * before expiry, so every token *it* mints expires later than the copy in the
 * source file. A file that expires later than the pool's copy is therefore a
 * credential the pool has never seen.
 */
function sourceIsNewer(previous: WorkBuddyAccount, input: WorkBuddyAccountInput): boolean {
  return input.expiresAtMs > previous.expiresAtMs
}

/** Stable identity key for a credential, shared with catalogs and probes. */
export function accountIdOf(uid: string, enterpriseId?: string): string {
  return `${uid}:${enterpriseId ?? ''}`
}

/** The identity key of a credential. */
export function credentialAccountId(credential: Pick<WorkBuddyCredential, 'uid' | 'enterpriseId'>): string {
  return accountIdOf(credential.uid, credential.enterpriseId)
}

/** Project one stored account back into the credential shape the wire layer takes. */
export function credentialOf(account: WorkBuddyAccount): WorkBuddyCredential {
  return {
    accessToken: account.accessToken,
    refreshToken: account.refreshToken,
    expiresAtMs: account.expiresAtMs,
    ...account.refreshExpiresAtMs === undefined ? {} : { refreshExpiresAtMs: account.refreshExpiresAtMs },
    domain: account.domain,
    uid: account.uid,
    ...account.enterpriseId === undefined ? {} : { enterpriseId: account.enterpriseId },
    ...account.nickname === undefined ? {} : { nickname: account.nickname },
    source: account.origin === 'desktop' ? 'desktop' : 'dsh',
  }
}

/** Options for {@link WorkBuddyAccountPool}. */
export interface WorkBuddyAccountPoolOptions {
  variant: WorkBuddyVariant
  /** Explicit pool-file path, overriding the `$DSH_HOME` default. */
  path?: string
}

/** The pool file's document shape. */
interface PoolDocument {
  version: typeof POOL_FORMAT_VERSION
  /** Accounts in rotation order (index 0 tried first among equals). */
  accounts: WorkBuddyAccount[]
}

/** Pool-file path for one variant inside the Harness home. */
export function workbuddyAccountsPath(filename: string = WORKBUDDY_ACCOUNTS_FILENAME): string {
  return resolve(resolveDshHome(), filename)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** Whether a parsed value is an account row this reader can trust. */
function isAccount(value: unknown): value is WorkBuddyAccount {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  if (typeof row['id'] !== 'string' || row['id'] === '') return false
  if (typeof row['uid'] !== 'string' || row['uid'] === '') return false
  if (typeof row['accessToken'] !== 'string' || row['accessToken'] === '') return false
  if (typeof row['domain'] !== 'string') return false
  if (typeof row['enabled'] !== 'boolean') return false
  if (typeof row['expiresAtMs'] !== 'number' || !Number.isFinite(row['expiresAtMs'])) return false
  return true
}

/** Normalize one parsed row, filling the fields older writes may have omitted. */
function normalizeAccount(row: WorkBuddyAccount): WorkBuddyAccount {
  const now = Date.now()
  const cooldown = row.cooldown
  const normalized: WorkBuddyAccount = {
    id: row.id,
    uid: row.uid,
    ...optionalString(row.enterpriseId) === undefined ? {} : { enterpriseId: row.enterpriseId },
    ...optionalString(row.nickname) === undefined ? {} : { nickname: row.nickname },
    ...optionalString(row.label) === undefined ? {} : { label: row.label },
    domain: row.domain,
    accessToken: row.accessToken,
    refreshToken: typeof row.refreshToken === 'string' ? row.refreshToken : '',
    expiresAtMs: row.expiresAtMs,
    ...typeof row.refreshExpiresAtMs === 'number' && Number.isFinite(row.refreshExpiresAtMs)
      ? { refreshExpiresAtMs: row.refreshExpiresAtMs }
      : {},
    // An unknown origin in a file from a newer build degrades to 'desktop'
    // rather than dropping the row: the credential itself is still usable, and
    // losing it would be a worse failure than mislabelling how it arrived.
    origin: row.origin === 'qr' ? 'qr' : row.origin === 'cookie' ? 'cookie' : 'desktop',
    enabled: row.enabled,
    lastUsedAtMs: typeof row.lastUsedAtMs === 'number' && Number.isFinite(row.lastUsedAtMs) ? row.lastUsedAtMs : 0,
    ...typeof row.addedAtMs === 'number' && Number.isFinite(row.addedAtMs) ? { addedAtMs: row.addedAtMs } : { addedAtMs: now },
    updatedAtMs: typeof row.updatedAtMs === 'number' && Number.isFinite(row.updatedAtMs) ? row.updatedAtMs : now,
    ...row.sessionDead === true ? { sessionDead: true } : {},
    ...typeof row.failureStreak === 'number' && Number.isFinite(row.failureStreak) && row.failureStreak > 0
      ? { failureStreak: Math.floor(row.failureStreak) }
      : {},
  }
  if (cooldown !== undefined && typeof cooldown === 'object' && cooldown !== null
    && typeof cooldown.untilMs === 'number' && Number.isFinite(cooldown.untilMs)) {
    normalized.cooldown = {
      untilMs: cooldown.untilMs,
      reason: cooldown.reason === 'credit' || cooldown.reason === 'session' ? cooldown.reason : 'rate',
      strikes: typeof cooldown.strikes === 'number' && cooldown.strikes > 0 ? Math.floor(cooldown.strikes) : 1,
      atMs: typeof cooldown.atMs === 'number' && Number.isFinite(cooldown.atMs) ? cooldown.atMs : now,
    }
  }
  return normalized
}

/**
 * The account pool for one variant.
 *
 * Persistence is synchronous and whole-document: the file is small (a handful
 * of accounts), every mutation is rare compared with a chat request, and a
 * partial write is worse than a slow one. Writes go through a temp file plus
 * rename, so a crash mid-write leaves the previous document intact.
 *
 * Every mutation writes; every read is served from memory after the first
 * load. The in-memory copy is the authority during a run, so a failed write
 * never makes the pool forget an account the user just added (it just will not
 * survive a restart).
 */
export class WorkBuddyAccountPool {
  private readonly variant: WorkBuddyVariant
  private readonly path: string
  private accounts: WorkBuddyAccount[] | undefined
  /**
   * Highest stamp handed out by {@link next}, seeded lazily from the rows.
   *
   * Wall-clock based so it stays comparable with the `lastUsedAtMs` values on
   * disk after a restart; only the *strictly increasing* part is what the
   * single-tick case needs.
   */
  private claimSeq = 0

  constructor(options: WorkBuddyAccountPoolOptions) {
    this.variant = options.variant
    this.path = options.path ?? workbuddyAccountsPath(options.variant.accountFilename)
  }

  /** Resolved pool-file path, for diagnostics and tests. */
  filePath(): string {
    return this.path
  }

  /** Which variant this pool belongs to. */
  variantId(): string {
    return this.variant.id
  }

  /** Every account, in rotation order. */
  list(): readonly WorkBuddyAccount[] {
    return this.load()
  }

  /** One account by identity. */
  get(id: string): WorkBuddyAccount | undefined {
    return this.load().find(account => account.id === id)
  }

  /** Whether the pool could serve a request right now (ignoring cooldowns). */
  hasEnabled(): boolean {
    return this.load().some(account => account.enabled && account.sessionDead !== true)
  }

  /**
   * Add an account, or refresh the tokens of one already present.
   *
   * The identity is `uid:enterpriseId`, so a second sign-in as the same user
   * updates the stored credential instead of creating a duplicate row — which
   * is what the card reports as "already in the pool, tokens updated".
   * `origin` is only applied on create: an account first captured from the
   * desktop app keeps that provenance even if it is later re-added by QR, so
   * the list never rewrites the user's mental model of where it came from.
   */
  upsert(input: WorkBuddyAccountInput): WorkBuddyUpsertResult {
    const accounts = this.load()
    const id = accountIdOf(input.uid, input.enterpriseId)
    const now = Date.now()
    const index = accounts.findIndex(account => account.id === id)
    if (index < 0) {
      const account: WorkBuddyAccount = {
        id,
        uid: input.uid,
        ...input.enterpriseId === undefined || input.enterpriseId === '' ? {} : { enterpriseId: input.enterpriseId },
        ...input.nickname === undefined || input.nickname === '' ? {} : { nickname: input.nickname },
        domain: input.domain,
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
        expiresAtMs: input.expiresAtMs,
        ...input.refreshExpiresAtMs === undefined ? {} : { refreshExpiresAtMs: input.refreshExpiresAtMs },
        origin: input.origin,
        enabled: true,
        lastUsedAtMs: 0,
        addedAtMs: now,
        updatedAtMs: now,
      }
      accounts.push(account)
      this.persist()
      return { account, created: true, updated: false }
    }
    const previous = accounts[index] as WorkBuddyAccount
    const updated = input.sync === true
      ? this.syncExisting(previous, input, now)
      : this.reSignIn(previous, input, now)
    accounts[index] = updated
    const changed = updated.accessToken !== previous.accessToken
      || updated.refreshToken !== previous.refreshToken
      || updated.domain !== previous.domain
    this.persist()
    return { account: updated, created: false, updated: changed }
  }

  /**
   * Adopt the tokens of a *newer* copy of a sign-in the pool already holds.
   *
   * The comparison is by access-token expiry, which is the only ordering a
   * source file offers: a token minted later expires later. An equal or older
   * stamp is a copy the pool has already surpassed — which is exactly what the
   * desktop file is after the plugin refreshed the account itself.
   *
   * A copy with no expiry at all (0, "the source did not say") is treated as
   * *newer* than one the pool also cannot date, because in that case there is
   * nothing to order by and the file is the live sign-in.
   */
  private adoptTokens(
    previous: WorkBuddyAccount,
    input: WorkBuddyAccountInput,
  ): Pick<WorkBuddyAccount, 'accessToken' | 'refreshToken' | 'expiresAtMs'> {
    // No dates on either side: nothing to order by, and the file is the live
    // sign-in, so its token is taken — but {@link sourceIsNewer} still answers
    // false, because taking a token is not the same as claiming it is evidence.
    const undated = input.expiresAtMs === 0 && previous.expiresAtMs === 0
    if (!sourceIsNewer(previous, input) && !undated) return {
      accessToken: previous.accessToken,
      refreshToken: previous.refreshToken,
      expiresAtMs: previous.expiresAtMs,
    }
    return {
      accessToken: input.accessToken,
      // A source that carries no refresh token must not erase the one the pool
      // holds: the file's silence is not evidence that renewal stopped working.
      refreshToken: input.refreshToken === '' ? previous.refreshToken : input.refreshToken,
      expiresAtMs: input.expiresAtMs,
    }
  }

  /**
   * A background re-read of a sign-in source: identity and freshness, no health.
   *
   * Deliberately does NOT touch `enabled`, `cooldown`, `sessionDead`, or a
   * benching's strike count. Every one of those is state the pool learned from
   * the upstream or from the user, and a file that says "this account signed in
   * at some point" is not evidence about any of them.
   */
  private syncExisting(previous: WorkBuddyAccount, input: WorkBuddyAccountInput, now: number): WorkBuddyAccount {
    const tokens = this.adoptTokens(previous, input)
    const updated: WorkBuddyAccount = {
      ...previous,
      ...input.enterpriseId === undefined || input.enterpriseId === '' ? {} : { enterpriseId: input.enterpriseId },
      ...input.nickname === undefined || input.nickname === '' ? {} : { nickname: input.nickname },
      ...input.domain === '' ? {} : { domain: input.domain },
      ...tokens,
    }
    if (sourceIsNewer(previous, input)) {
      // The one piece of health a poll *can* prove. A credential that post-dates
      // everything the pool holds came from a sign-in the pool never saw, and a
      // sign-in contradicts a dead session and makes a benching moot.
      delete updated.cooldown
      delete updated.sessionDead
      delete updated.failureStreak
    }
    // Only a write that actually changed something earns a new timestamp: the
    // sweep runs every thirty seconds and would otherwise rewrite the document
    // — and every account's mtime — forever.
    if (updated.accessToken !== previous.accessToken
      || updated.refreshToken !== previous.refreshToken
      || updated.expiresAtMs !== previous.expiresAtMs
      || updated.domain !== previous.domain
      || updated.nickname !== previous.nickname
      || updated.enterpriseId !== previous.enterpriseId) {
      updated.updatedAtMs = now
    }
    return updated
  }

  /**
   * A sign-in the user performed (QR, pasted token, or a desktop file that has
   * actually moved forward): the cure for every benching, including a dead
   * session — the tokens are new, so nothing about the old state applies.
   */
  private reSignIn(previous: WorkBuddyAccount, input: WorkBuddyAccountInput, now: number): WorkBuddyAccount {
    const adopted = this.adoptTokens(previous, input)
    const updated: WorkBuddyAccount = {
      ...previous,
      ...input.enterpriseId === undefined || input.enterpriseId === '' ? {} : { enterpriseId: input.enterpriseId },
      ...input.nickname === undefined || input.nickname === '' ? {} : { nickname: input.nickname },
      ...input.domain === '' ? {} : { domain: input.domain },
      ...adopted,
      updatedAtMs: now,
      enabled: true,
    }
    delete updated.cooldown
    delete updated.sessionDead
    delete updated.failureStreak
    return updated
  }

  /** Merge a token refresh into a stored account. */
  updateTokens(id: string, tokens: {
    accessToken: string
    refreshToken?: string
    expiresAtMs?: number
    domain?: string
    refreshExpiresAtMs?: number
  }): WorkBuddyAccount | undefined {
    const accounts = this.load()
    const index = accounts.findIndex(account => account.id === id)
    if (index < 0) return undefined
    const previous = accounts[index] as WorkBuddyAccount
    const updated: WorkBuddyAccount = {
      ...previous,
      accessToken: tokens.accessToken,
      ...tokens.refreshToken === undefined || tokens.refreshToken === '' ? {} : { refreshToken: tokens.refreshToken },
      ...tokens.expiresAtMs === undefined ? {} : { expiresAtMs: tokens.expiresAtMs },
      ...tokens.domain === undefined || tokens.domain === '' ? {} : { domain: tokens.domain },
      ...tokens.refreshExpiresAtMs === undefined ? {} : { refreshExpiresAtMs: tokens.refreshExpiresAtMs },
      updatedAtMs: Date.now(),
    }
    delete updated.sessionDead
    accounts[index] = updated
    this.persist()
    return updated
  }

  /** Remove one account. */
  remove(id: string): boolean {
    const accounts = this.load()
    const index = accounts.findIndex(account => account.id === id)
    if (index < 0) return false
    accounts.splice(index, 1)
    this.persist()
    return true
  }

  /**
   * Enable or disable one account.
   *
   * Enabling is also the manual override for a session the plugin judged dead:
   * the flag is a conclusion drawn from one upstream refusal plus one failed
   * refresh, and the user saying "use this account" outranks it. Without that,
   * a dead account was unreachable — rotation skipped it, only a successful
   * refresh could clear the flag, and no request would ever try one.
   */
  setEnabled(id: string, enabled: boolean): boolean {
    const account = this.mutate(id, current => {
      if (!enabled) return { ...current, enabled, updatedAtMs: Date.now() }
      const next = { ...current, enabled, updatedAtMs: Date.now() }
      delete next.sessionDead
      delete next.failureStreak
      return next
    })
    return account !== undefined
  }

  /** Set or clear the user's label for one account. */
  setLabel(id: string, label: string | undefined): boolean {
    const trimmed = label?.trim()
    return this.mutate(id, current => {
      const next = { ...current, updatedAtMs: Date.now() }
      if (trimmed === undefined || trimmed === '') delete next.label
      else next.label = trimmed
      return next
    }) !== undefined
  }

  /**
   * Reorder the pool. Ids not named keep their relative order after the named
   * ones, so a stale client cannot drop an account it did not know about.
   */
  reorder(ids: readonly string[]): void {
    const accounts = this.load()
    const byId = new Map(accounts.map(account => [account.id, account]))
    const ordered: WorkBuddyAccount[] = []
    for (const id of ids) {
      const account = byId.get(id)
      if (account === undefined) continue
      byId.delete(id)
      ordered.push(account)
    }
    for (const account of accounts) {
      if (byId.has(account.id)) ordered.push(account)
    }
    this.accounts = ordered
    this.persist()
  }

  /**
   * Bench an account.
   *
   * The account's own failure streak decides the wait, so a limit that keeps
   * coming back is answered with a longer benching each time and a single
   * success puts the schedule back to its base.
   *
   * @param retryAfterMs - upstream's own `Retry-After`, which wins over the
   *   schedule: the provider knows its window better than any backoff we pick.
   */
  cooldown(id: string, reason: WorkBuddyCooldownReason, hintMs?: number): WorkBuddyCooldown | undefined {
    const now = Date.now()
    let result: WorkBuddyCooldown | undefined
    void this.mutate(id, current => {
      // The streak is the account's own memory of repeated failure, not the
      // current benching's: it survives the cooldown expiring, so a second
      // failure an hour after the first one *does* back off for longer than the
      // first. Reading the depth out of the cooldown object instead — which is
      // what this did — made every round strike 1 and pinned the schedule to
      // its base value forever (a rate-limited account was retried every
      // fifteen minutes for as long as the limit stood).
      const strikes = Math.min((current.failureStreak ?? 0) + 1, STRIKE_CEILING)
      // An upstream-stated wait is honoured on its own terms; the backoff
      // schedule's per-reason cap applies only to the schedule.
      const duration = hintMs !== undefined && hintMs > 0
        ? Math.min(Math.max(hintMs, 1_000), COOLDOWN_HINT_CAP_MS)
        : cooldownDurationMs(reason, strikes)
      const cooldown: WorkBuddyCooldown = { untilMs: now + duration, reason, strikes, atMs: now }
      result = cooldown
      return { ...current, cooldown, failureStreak: strikes }
    })
    return result
  }

  /**
   * Clear a benching after a success.
   *
   * The failure streak goes with it: a success is the evidence that whatever
   * was failing has stopped, and the next failure deserves the base backoff
   * rather than the tail of a schedule earned by the previous outage.
   *
   * The flag is the caller's to hand over, but this is a *state* cleanup rather
   * than a cooldown one, so it also runs when there is nothing to clear.
   */
  clearCooldown(id: string): void {
    void this.mutate(id, current => {
      if (current.cooldown === undefined && current.failureStreak === undefined) return current
      const next = { ...current }
      delete next.cooldown
      delete next.failureStreak
      return next
    })
  }

  /**
   * Mark an account's session as dead.
   *
   * Only for a *definitive* refusal: the account has earned this flag when the
   * upstream rejected its credential and the refresh that followed was itself
   * refused. A refresh that failed because the network did is not evidence
   * about the session, and spending the account on it left the user with an
   * account they could only delete.
   */
  markSessionDead(id: string): void {
    void this.mutate(id, current => ({ ...current, sessionDead: true, updatedAtMs: Date.now() }))
  }

  /** Whether an account may be picked right now. */
  isAvailable(account: WorkBuddyAccount, now = Date.now()): boolean {
    if (!account.enabled || account.sessionDead === true) return false
    if (account.cooldown !== undefined && account.cooldown.untilMs > now) return false
    return true
  }

  /**
   * The next account to try, excluding ids already attempted by this caller.
   *
   * Least-recently-used wins, with pool order as the tiebreak. LRU rather than
   * round-robin because a restart, a new sign-in, or a user reorder all reset
   * a cursor but leave "when did this account last work" meaningful.
   *
   * **Claiming is synchronous, and that is the point.** Selection used to be a
   * pure read plus a later `Date.now()` write from the caller, so two
   * conversations started in the same millisecond both looked at the same
   * snapshot and both picked the same account — precisely when spreading the
   * load matters, because that is the case where one 429 is about to fail the
   * other user message too. A persistent counter, stamped here before anything
   * is awaited, makes every claim distinct whatever the clock resolution is.
   *
   * @param tried - identities already attempted for the request in flight.
   * @param now - wall clock for availability decisions only.
   */
  next(tried: ReadonlySet<string>, now = Date.now()): WorkBuddyAccount | undefined {
    let best: WorkBuddyAccount | undefined
    for (const account of this.load()) {
      if (tried.has(account.id)) continue
      if (!this.isAvailable(account, now)) continue
      if (best === undefined || account.lastUsedAtMs < best.lastUsedAtMs) best = account
    }
    if (best === undefined) return undefined
    const claimed: WorkBuddyAccount = { ...best, lastUsedAtMs: this.claimClock(now) }
    const index = this.load().indexOf(best)
    if (index >= 0) {
      // Assigned in place: the caller gets the row it claimed, and a later
      // commit of the same account starts from the claim rather than
      // overwriting it with a wall-clock value that could be lower.
      ;(this.accounts as WorkBuddyAccount[])[index] = claimed
    }
    return claimed
  }

  /**
   * A strictly increasing stamp for one claim, seeded from the wall clock.
   *
   * Strictly increasing even when the clock stands still or steps backwards, so
   * "most recently claimed" stays a real ordering.
   */
  private claimClock(now: number): number {
    this.claimSeq = Math.max(this.claimSeq + 1, now)
    return this.claimSeq
  }

  /**
   * The account the plugin presents as "this variant's account" — the one used
   * for the model catalog, the credit figure on the card, and reasoning probes.
   *
   * Preferring the desktop app's current account keeps every one of those
   * answers stable while the user is signed in there, which is what makes the
   * card's numbers mean something. Rotation is deliberately separate: a chat
   * request may run as any healthy account, but "who am I signed in as" does
   * not flicker per request.
   *
   * @param preferredId - identity of the desktop app's current account, if any.
   */
  primary(preferredId?: string, now = Date.now()): WorkBuddyAccount | undefined {
    if (preferredId !== undefined) {
      const preferred = this.get(preferredId)
      if (preferred !== undefined && this.isAvailable(preferred, now)) return preferred
      // The desktop account is present but benched or disabled: fall through
      // rather than reporting a dead primary, because the catalog still has to
      // come from somewhere.
      if (preferred !== undefined && preferred.enabled && preferred.sessionDead !== true) return preferred
    }
    for (const account of this.load()) {
      if (this.isAvailable(account, now)) return account
    }
    for (const account of this.load()) {
      if (account.enabled && account.sessionDead !== true) return account
    }
    return undefined
  }

  private mutate(id: string, update: (account: WorkBuddyAccount) => WorkBuddyAccount): WorkBuddyAccount | undefined {
    const accounts = this.load()
    const index = accounts.findIndex(account => account.id === id)
    if (index < 0) return undefined
    const next = update(accounts[index] as WorkBuddyAccount)
    accounts[index] = next
    this.persist()
    return next
  }

  private load(): WorkBuddyAccount[] {
    if (this.accounts !== undefined) return this.accounts
    const accounts: WorkBuddyAccount[] = []
    // A corrupt or unreadable file reads as an empty pool. A pool that cannot be
    // read must never take the plugin down — the desktop app's file is still
    // read separately and re-captured on the next sweep.
    const saved = readStoreDocument(this.path, POOL_FORMAT_VERSION, document => {
      const raw = document['accounts']
      return Array.isArray(raw) ? raw : undefined
    })
    const seen = new Set<string>()
    for (const value of saved ?? []) {
      if (!isAccount(value)) continue
      const account = normalizeAccount(value)
      // A duplicate identity in the file would make selection ambiguous; the
      // first row wins and later ones are dropped.
      if (seen.has(account.id)) continue
      seen.add(account.id)
      accounts.push(account)
    }
    this.accounts = accounts
    // Seeded from the rows so a restart cannot hand out a stamp older than one
    // already stored, which would make a fresh claim look like the least
    // recently used account.
    this.claimSeq = accounts.reduce((highest, account) => Math.max(highest, account.lastUsedAtMs), Date.now())
    return accounts
  }

  private persist(): void {
    try {
      const document: PoolDocument = { version: POOL_FORMAT_VERSION, accounts: this.load() }
      writeStoreDocument(this.path, document)
    } catch {
      // See the class doc: the in-memory pool stays authoritative for this run.
    }
  }
}
