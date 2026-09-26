/**
 * Retrying chat sends across the account pool.
 *
 * This is where the pool earns its keep. A chat request is attempted with one
 * account; when the upstream refuses it in a way that is *about that account*
 * rather than about the request, the next healthy account is tried instead, so
 * a rate-limited or quota-exhausted account stops being the user's problem.
 *
 * Three rules make that safe:
 *
 * - **Only before the first byte.** A retry is possible exactly while nothing
 *   has been written to the client. Once the SSE response has started, a
 *   failure is reported, not retried: the harness has already been told the
 *   turn began, and replaying it would duplicate tokens.
 * - **Only for account-scoped failures.** 429 (rate), 402 / credit markers
 *   (quota), and 401 / session-dead are the three classes that another account
 *   can answer. A 400, a 404, or a transport error is about the request or the
 *   network, and trying it as somebody else would fail identically while
 *   spending another account's quota.
 * - **Each account once.** A request never retries an account it already
 *   failed on, so a pool of three accounts costs at most three upstream calls
 *   for one user message.
 *
 * Selection lives in {@link WorkBuddyAccountPool.next}, which claims its choice
 * before returning it: least-recently-used spreads the load, and a claim that
 * does not wait on the clock keeps two simultaneous conversations from starting
 * on the same account.
 *
 * A 401 gets one extra step before the account is abandoned: the refresh token
 * is used to mint a new access token and the *same* account is retried. An
 * expired access token is the most common cause of a 401 and the cheapest to
 * fix; only a refresh the upstream actually *refuses* means the session is
 * really gone.
 *
 * That last distinction is load-bearing. A refresh that times out, or answers
 * 502, or returns a body this build cannot read, has said nothing about the
 * session — and treating it as a dead one cost the user the account, because a
 * dead session is never selected again. Those failures back the account off for
 * a while instead, so a flaky minute upstream is a delay rather than a
 * credential the user has to delete and re-add.
 *
 * @module dsh-workbuddy-connect/rotation
 */

import type { WorkBuddyAccount, WorkBuddyAccountPool, WorkBuddyCooldownReason } from './account-pool.ts'

import { credentialOf } from './account-pool.ts'
import type { WorkBuddyCredential } from './auth.ts'
import { consumeStreamUsage, type WorkBuddyRequestUsage } from './usage-store.ts'
import { isDefinitiveRefreshFailure } from './upstream.ts'
import type { UpstreamErrorKind, WorkBuddyChatResult, WorkBuddyUpstreamClient } from './upstream.ts'

/** What the caller learns about one completed rotation. */
export interface WorkBuddyRotationOutcome {
  /** The upstream answer to relay. */
  result: WorkBuddyChatResult
  /** Identities tried, in order; the last one produced `result`. */
  attempts: readonly string[]
  /** The account whose credential produced the answer, when one did. */
  account?: WorkBuddyAccount
  /**
   * Set when the pool could not supply any account at all (empty, or every
   * member disabled / benched / dead). `result` is then a synthesized
   * `session_dead` answer so the shim's status mapping still applies.
   */
  exhausted?: true
}

/** Constructor dependencies. */
export interface WorkBuddyRotationOptions {
  pool: WorkBuddyAccountPool
  client: Pick<WorkBuddyUpstreamClient, 'chatStream' | 'refreshToken'>
  /**
   * Called after a token refresh lands, so the pool file and any cached
   * credential view agree. Without it a refresh would be lost on restart and
   * every later request would pay for another refresh.
   */
  onRefreshed?: (account: WorkBuddyAccount, credential: WorkBuddyCredential) => void
  /**
   * Called with the usage one ANSWER reported, attributed to the pool member
   * that produced it.
   *
   * This is the only place those two facts meet: the rotation knows which account
   * served the request, and the answer's stream is where the upstream states what
   * it cost. The stream is teed — the caller's copy is not delayed by this
   * reader, and the accounting can never stall the user's reply.
   */
  onUsage?: (accountId: string, usage: WorkBuddyRequestUsage) => void
  /**
   * Called once per process with the numeric field names the upstream's usage
   * block actually carried, so an unfamiliar shape is discovered from a log line
   * rather than guessed at in the parser.
   */
  onUsageShape?: (fields: readonly string[]) => void
  logger?: { warn(...args: unknown[]): void }
}

/**
 * Parse an upstream `Retry-After`, which may be seconds or an HTTP date.
 * Returns undefined when absent or unparsable.
 */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
  if (value === null || value === undefined) return undefined
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  if (/^\d+$/u.test(trimmed)) {
    const seconds = Number(trimmed)
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined
  }
  const at = Date.parse(trimmed)
  if (!Number.isFinite(at)) return undefined
  const delta = at - now
  return delta > 0 ? delta : undefined
}

/**
 * A stated reset time, as both products word it.
 *
 *   …your usage will reset at 2026-09-13 21:50:51 UTC+8, alternatively…
 *   …将在 2026-09-14 11:57:16 UTC+8 重置，…
 *
 * The offset is a required part of the match. Both products write `UTC+8`, and a
 * bare wall-clock time would have to be *assumed* to be in some zone — an
 * assumption that is wrong by hours precisely in the case this exists for. No
 * offset, no hint: the caller falls back to its own schedule.
 */
const RESET_TIME_HINT = /(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})\s*(?:UTC|GMT)(?:\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?)?/u

/**
 * Longest a stated reset is trusted for.
 *
 * A safeguard, not a policy: the value comes from a server and is far more
 * authoritative than any backoff this plugin could invent, so it is used as
 * given. This ceiling only bounds what a mistyped or misparsed date could do —
 * a week is already past every allowance window either product runs, so a real
 * reset can never be cut short by it.
 */
const RESET_HINT_CEILING_MS = 7 * 24 * 60 * 60_000

/**
 * The reset time an upstream limit message states, as a wait from now.
 *
 * A frequency limit answers 429 with the moment the allowance returns, in the
 * *body's* words rather than in a header — so without reading it the plugin has
 * nothing to go on but its own backoff, which starts at a minute and never
 * exceeds fifteen. That is far shorter than the hours these allowances actually
 * take to roll over, so the account would be retried again and again into the
 * same refusal, and the user would be told to wait a minute for something that
 * needs the rest of the day.
 *
 * Returns undefined when the message states no usable time, leaving the caller's
 * schedule in charge.
 */
export function parseResetTimeHint(message: string, now = Date.now()): number | undefined {
  const match = RESET_TIME_HINT.exec(message)
  if (match === null) return undefined
  const [, year, month, day, hour, minute, second, sign, offsetHours, offsetMinutes] = match
  // Range-check the calendar fields rather than trusting Date.UTC, which
  // normalises overflow: month 13 and day 32 would roll into a neighbouring
  // date instead of being rejected as the nonsense they are.
  if (Number(month) < 1 || Number(month) > 12) return undefined
  if (Number(day) < 1 || Number(day) > 31) return undefined
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return undefined
  const wallClock = Date.UTC(
    Number(year), Number(month) - 1, Number(day),
    Number(hour), Number(minute), Number(second),
  )
  if (!Number.isFinite(wallClock)) return undefined
  // `UTC` with no offset means UTC, which `Date.UTC` above already produced.
  const offset = sign === undefined
    ? 0
    : (sign === '-' ? -1 : 1) * (Number(offsetHours) * 60 + Number(offsetMinutes ?? 0))
  const at = wallClock - offset * 60_000
  const wait = at - now
  // A reset in the past means the allowance is already back; the caller's own —
  // short — schedule is the right response to that, not a negative wait.
  if (wait <= 0) return undefined
  return Math.min(wait, RESET_HINT_CEILING_MS)
}

/** Which cooldown class an upstream failure earns. */
export function cooldownReasonFor(kind: UpstreamErrorKind): WorkBuddyCooldownReason | undefined {
  if (kind === 'soft_rate') return 'rate'
  if (kind === 'hard_credit') return 'credit'
  if (kind === 'session_dead') return 'session'
  return undefined
}

/** Whether another account could plausibly answer differently. */
export function isAccountScoped(kind: UpstreamErrorKind): boolean {
  return kind === 'soft_rate' || kind === 'hard_credit' || kind === 'session_dead'
}

/**
 * Whether the caller has given up.
 *
 * A function rather than an inline `signal?.aborted` check on purpose: the
 * loop tests this after every await, and TypeScript's control-flow analysis
 * keeps the narrowing from the first check alive across the awaits, which makes
 * the later ones look like impossible comparisons. Going through a call keeps
 * each check honest.
 */
function aborted(signal?: AbortSignal): boolean {
  return signal !== undefined && signal.aborted
}

/** How the shim should answer when no account could be tried. */
function noAccountResult(): WorkBuddyChatResult {
  return {
    ok: false,
    status: 0,
    kind: 'session_dead',
    message: 'no WorkBuddy account is currently usable (the pool is empty, or every account is disabled, benched, or signed out)',
  }
}

/**
 * Send one chat body, rotating accounts on account-scoped failures.
 *
 * The body is already prepared for the wire by the caller: this layer chooses
 * *who* sends it, never *what* is sent, so a retry is byte-identical to the
 * attempt before it.
 */
export class WorkBuddyRotation {
  private readonly pool: WorkBuddyAccountPool
  private readonly client: Pick<WorkBuddyUpstreamClient, 'chatStream' | 'refreshToken'>
  private readonly onRefreshed: WorkBuddyRotationOptions['onRefreshed']
  private readonly onUsage: WorkBuddyRotationOptions['onUsage']
  private readonly onUsageShape: WorkBuddyRotationOptions['onUsageShape']
  private readonly logger: WorkBuddyRotationOptions['logger']

  constructor(options: WorkBuddyRotationOptions) {
    this.pool = options.pool
    this.client = options.client
    this.onRefreshed = options.onRefreshed
    this.onUsage = options.onUsage
    this.onUsageShape = options.onUsageShape
    this.logger = options.logger
  }

  /**
   * Hand back an answer whose usage is being counted, without altering it.
   *
   * The body is teed: one branch reaches the caller exactly as it arrived, the
   * other is drained by {@link consumeStreamUsage}. A body that cannot be teed
   * (no stream at all — a shape this upstream does not produce for chat, but the
   * type permits) is returned untouched, because accounting is never worth
   * breaking a reply for.
   */
  private tapUsage(result: Extract<WorkBuddyChatResult, { ok: true }>, accountId: string): WorkBuddyChatResult {
    const onUsage = this.onUsage
    if (onUsage === undefined) return result
    const body = result.response.body
    if (body === null || typeof body.tee !== 'function') return result
    const [relayed, observed] = body.tee()
    void consumeStreamUsage(observed, usage => { onUsage(accountId, usage) }, this.onUsageShape)
      .catch((error: unknown) => {
        // Counting is a report about traffic, never traffic itself.
        this.logger?.warn('dsh-workbuddy-connect: request usage could not be read', error)
      })
    return {
      ok: true,
      response: new Response(relayed, {
        status: result.response.status,
        statusText: result.response.statusText,
        headers: result.response.headers,
      }),
    }
  }

  /**
   * Attempt the request until an account answers, or the pool runs out.
   *
   * @param body - the prepared JSON body.
   * @param signal - the caller's abort signal; an aborted request stops the
   *   whole rotation rather than moving on to another account.
   */
  async send(body: string, signal?: AbortSignal): Promise<WorkBuddyRotationOutcome> {
    const tried = new Set<string>()
    const attempts: string[] = []
    let lastResult: WorkBuddyChatResult | undefined
    let lastAccount: WorkBuddyAccount | undefined

    for (;;) {
      if (aborted(signal)) {
        return { result: lastResult ?? noAccountResult(), attempts, ...lastAccount === undefined ? {} : { account: lastAccount } }
      }
      // `next` claims as it selects, so two requests in the same tick cannot
      // both start on the same account; there is no separate "mark used" step.
      const account = this.pool.next(tried)
      if (account === undefined) break
      tried.add(account.id)
      attempts.push(account.id)
      lastAccount = account

      const result = await this.client.chatStream(credentialOf(account), body, signal)
      if (result.ok) {
        // Success is the only evidence the account is healthy again, so this is
        // where a benching is lifted and the backoff counter resets.
        this.pool.clearCooldown(account.id)
        return { result: this.tapUsage(result, account.id), attempts, account }
      }
      lastResult = result

      if (aborted(signal)) return { result, attempts, account }

      // A 401 is the one failure worth repairing in place: the refresh token is
      // still good far more often than the session is dead.
      if (result.kind === 'session_dead') {
        const refreshed = await this.tryRefresh(account)
        if (refreshed.outcome === 'refreshed') {
          const retry = await this.client.chatStream(credentialOf(refreshed.account), body, signal)
          if (retry.ok) {
            this.pool.clearCooldown(account.id)
            return { result: this.tapUsage(retry, refreshed.account.id), attempts, account: refreshed.account }
          }
          lastResult = retry
          if (retry.kind !== 'session_dead') {
            // The refreshed token failed for a non-session reason: bench it by
            // that reason and let the loop move on to the next account.
            this.bench(refreshed.account, retry)
            continue
          }
          // The new token was refused too: the sign-in is genuinely gone.
        } else if (refreshed.outcome === 'unreachable') {
          // The refresh never reached a verdict — a timeout, a 5xx, a body
          // this build cannot read. That is not evidence about the session.
          // Bench the account on the schedule, keep it in rotation, and let
          // the loop answer this message as somebody else.
          this.pool.cooldown(account.id, 'rate')
          this.logger?.warn(`dsh-workbuddy-connect: account ${account.id} could not be refreshed (${refreshed.reason}); benched instead of signed out`)
          continue
        } else if (refreshed.outcome === 'sign-in-needed') {
          // A pasted token carries no refresh token, so there was never
          // anything to try: the upstream's 401 is the whole story.
        }
        // Refresh refused, or the refreshed token refused in turn: the session
        // is really gone. It stays in the list for the user to see — and for
        // the user to turn back on, which clears the flag — and rotation skips
        // it from here on.
        this.pool.markSessionDead(account.id)
        this.pool.cooldown(account.id, 'session')
        this.logger?.warn(`dsh-workbuddy-connect: account ${account.id} session is dead; sign in again, or re-enable it, to restore it`)
        continue
      }

      if (isAccountScoped(result.kind)) {
        this.bench(account, result)
        continue
      }
      // Not about the account: another one would fail identically.
      return { result, attempts, account }
    }

    if (lastResult === undefined) {
      return { result: noAccountResult(), attempts, exhausted: true }
    }
    // Every account was tried and the last one's answer is what the user gets;
    // the pool being unable to satisfy the request is worth saying out loud.
    return { result: lastResult, attempts, ...lastAccount === undefined ? {} : { account: lastAccount }, exhausted: true }
  }

  /**
   * Apply the cooldown a failure earns, preferring whatever the upstream said
   * about when the account comes back.
   *
   * Two hints can be present and they answer different questions. The body's
   * stated reset is about *this account's allowance* — when the frequency limit
   * lifts — and is what the user needs to see. `Retry-After` is the endpoint
   * saying "not right now", which may be about load rather than the allowance.
   * The specific answer wins.
   *
   * With neither, the pool's own backoff applies.
   */
  private bench(account: WorkBuddyAccount, result: Extract<WorkBuddyChatResult, { ok: false }>): void {
    const reason = cooldownReasonFor(result.kind)
    if (reason === undefined) return
    const hint = parseResetTimeHint(result.message) ?? parseRetryAfter(result.retryAfter)
    this.pool.cooldown(account.id, reason, hint)
  }

  /**
   * Refresh one account's access token, persisting the result.
   *
   * The three outcomes are kept apart on purpose, because two of them look
   * identical from the outside and mean opposite things: a refusal says the
   * credential is finished, while an unreachable endpoint says nothing at all.
   * Collapsing them into a single `undefined` is what used to sign an account
   * out over a timeout.
   */
  private async tryRefresh(account: WorkBuddyAccount): Promise<
    | { outcome: 'refreshed', account: WorkBuddyAccount }
    | { outcome: 'unreachable', reason: string }
    | { outcome: 'sign-in-needed' }
    | { outcome: 'refused', reason: string }
  > {
    // A pasted token carries no refresh token, so there is nothing to try; the
    // caller has already seen the upstream's own refusal.
    if (account.refreshToken === '') return { outcome: 'sign-in-needed' }
    let outcome
    try {
      outcome = await this.client.refreshToken(credentialOf(account))
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error)
      if (!isDefinitiveRefreshFailure(error)) {
        this.logger?.warn(`dsh-workbuddy-connect: account ${account.id} token refresh could not be completed`, error)
        return { outcome: 'unreachable', reason }
      }
      this.logger?.warn(`dsh-workbuddy-connect: account ${account.id} token refresh was refused`, error)
      return { outcome: 'refused', reason }
    }
    const updated = this.pool.updateTokens(account.id, {
      accessToken: outcome.accessToken,
      ...outcome.refreshToken === undefined ? {} : { refreshToken: outcome.refreshToken },
      ...outcome.expiresInSec === undefined ? {} : { expiresAtMs: Date.now() + outcome.expiresInSec * 1000 },
      ...outcome.domain === undefined ? {} : { domain: outcome.domain },
    })
    // The account was deleted while the refresh was in flight. Nothing to
    // retry with, and nothing about the session to conclude either.
    if (updated === undefined) return { outcome: 'unreachable', reason: 'the account was removed while refreshing' }
    this.onRefreshed?.(updated, credentialOf(updated))
    return { outcome: 'refreshed', account: updated }
  }
}
