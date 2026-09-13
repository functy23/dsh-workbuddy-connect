/** Node-free constants and types shared by the Host and browser halves. */

/**
 * How long a benched account stays benched, in the unit that reads best.
 *
 * Shared rather than written on each side because both halves describe the same
 * field of the same document, and the CLI and the settings page disagreeing
 * about how long a cooldown has left would read as one of them being wrong. The
 * *wording* stays local, because only each side knows its language.
 *
 * The hour unit exists because an upstream-stated reset can be most of a day
 * away, and "1078 分钟" is a number nobody converts in their head.
 */
export function describeWait(
  untilMs: number,
  now: number,
): { unit: 'minute' | 'hour', value: number } {
  const minutes = Math.max(1, Math.ceil(Math.max(0, untilMs - now) / 60_000))
  return minutes < 60
    ? { unit: 'minute', value: minutes }
    : { unit: 'hour', value: Math.ceil(minutes / 60) }
}

/** Plugin-owned status endpoint consumed by its browser half. */
export const WORKBUDDY_STATUS_PATH = '/plugins/dsh-workbuddy-connect/status'

/**
 * Plugin-owned probe control endpoint.
 *
 * Separate from the status route because it accepts writes: the status route's
 * loopback Host/Origin guard protects against a DNS-rebinding *page*, which is
 * not the same as authorizing a state-changing action. This route therefore
 * also requires the in-process key the browser half receives with the status
 * document.
 */
export const WORKBUDDY_PROBE_PATH = '/plugins/dsh-workbuddy-connect/probe'

/**
 * The international (WorkBuddy AI) variant's own pair of routes.
 *
 * Kept as separate constants rather than a computed suffix so both halves
 * reference literal strings: the browser bundle and the host bundle are built
 * independently, and a shared expression is one build-config drift away from
 * the desk asking a route the host never mounted.
 */
export const WORKBUDDY_AI_STATUS_PATH = '/plugins/dsh-workbuddy-connect/ai/status'
export const WORKBUDDY_AI_PROBE_PATH = '/plugins/dsh-workbuddy-connect/ai/probe'

/**
 * Account-management routes, one pair per variant.
 *
 * Separate from the probe route because they act on different state (the
 * account pool, not probe records) and because a browser that fails to reach
 * one must not lose the other. Both are writes and therefore carry the same
 * in-process key as the probe route.
 */
export const WORKBUDDY_ACCOUNT_PATH = '/plugins/dsh-workbuddy-connect/accounts'
export const WORKBUDDY_AI_ACCOUNT_PATH = '/plugins/dsh-workbuddy-connect/ai/accounts'

/** One model's recorded probe observation, as the card displays it. */
export interface WorkBuddyWebProbeModel {
  id: string
  name: string
  /** `validating` results carry efforts; the other states never do. */
  validation: 'validating' | 'non-validating' | 'unknown'
  efforts: readonly string[]
  probedAt: number
}

/** Probe section of the status document. */
export interface WorkBuddyWebProbeSection {
  /** Whether the user has authorized probing. */
  consent: boolean
  /** Whether a sweep is in flight right now. */
  running: boolean
  /** Models the user could probe by hand (undeclared yet reasoning-capable). */
  candidates: readonly string[]
  /** Recorded observations. */
  results: readonly WorkBuddyWebProbeModel[]
}

/** Action requested from the probe control route. */
export interface WorkBuddyProbeAction {
  /**
   * `probe` spends credit on one model; `clear` drops recorded observations;
   * `refresh` re-reads the credential and re-fetches the model catalog.
   *
   * All three are writes, which is why they share this route's in-process key
   * and loopback guards rather than the read-only status GET.
   */
  action: 'probe' | 'clear' | 'refresh'
  /** Target model id; required for `probe`. */
  model?: string
}

/**
 * Where the models a card is currently showing came from.
 *
 * The plan requires the card to distinguish a live catalog from the built-in
 * fallback, and to say when the last attempt failed — otherwise a stale list is
 * indistinguishable from an offline one, and a user cannot tell whether the
 * models they see still match the upstream.
 */
export interface WorkBuddyWebCatalog {
  /**
   * Where the models on screen came from, in degradation order:
   * `live` (fetched now) → `saved` (this account's last successful fetch,
   * restored after a restart or a failed fetch) → `fallback` (the roster
   * compiled into the plugin). The card distinguishes them because "stale" and
   * "offline with a saved list" are different situations for the user.
   */
  source: 'live' | 'saved' | 'fallback'
  /** When the live catalog last succeeded, epoch ms. */
  fetchedAt?: number
  /** App version used as the catalog User-Agent, when the variant needed one. */
  appVersion?: string
  /** Why the most recent fetch failed, when it did, redacted for display. */
  error?: string
}

/** One billing package and its remaining credit. */
export interface WorkBuddyWebCreditAccount {
  packageName: string
  remain: number
  size: number
}

/** Aggregated credit answer rendered by the plugin card. */
export interface WorkBuddyWebCredits {
  total: number
  accounts: readonly WorkBuddyWebCreditAccount[]
}

/** Billing convenience facts for one model, rendered as card badges. */
export interface WorkBuddyWebModelBadge {
  id: string
  name: string
  /** Whether the model is currently free (`x0.00` credits). */
  free?: boolean
  /** Promotional badges, e.g. `限时免费`, `夜间折扣`. */
  badges?: readonly string[]
  /**
   * Credits multiplier in display form, e.g. `x0.79`. Unlike the model
   * picker's copy, the card renders through the browser locale, so this value
   * may be interpolated into a localized sentence rather than shown bare.
   */
  credits?: string
  /**
   * The rate cannot be stated right now, and the card must say so.
   *
   * Set for a row whose price came from a promotion that has since ended: the
   * upstream bakes the discounted value into the cached row, and the original
   * price is not recoverable from it, so neither the old figure nor `free` may
   * be repeated. The card renders "refresh to see the price" instead.
   */
  rateUnknown?: true
  /**
   * Context capacity in tokens, taken verbatim from the upstream
   * `maxAllowedSize`/`maxInputTokens`, or from the international document's
   * `contextWindow.defaultLength` when it declares one.
   *
   * Reported, never chosen: the upstream describes one effective capacity per
   * model, so the plugin displays what it was told rather than offering a menu
   * of its own. (The desktop app's "300K / 1M" picker is client-side policy
   * that appears nowhere in the catalog.)
   */
  contextWindow?: number
  /**
   * The international document's larger selectable window, when it declares
   * one, and the model's maximum input ceiling.
   *
   * Kept apart from {@link contextWindow} because they answer different
   * questions: `contextWindow` is the budget the plugin actually requests under,
   * while these are facts about what the upstream will accept. Showing the 1M
   * ceiling as though it were the working window would overstate the budget.
   */
  maxContextWindow?: number
  maxInputTokens?: number
  /**
   * Every context length the upstream offers for this model, ascending.
   *
   * Present only when there is a choice to make (two or more lengths); a model
   * with a single window has nothing to switch between and gets no control.
   */
  contextChoices?: readonly number[]
  /**
   * Which of {@link contextChoices} is in effect — the user's pick, or the
   * upstream default when they have not chosen.
   *
   * This is the value the plugin actually runs the model at, so a card that
   * shows it is showing the truth about the request, not a preference.
   */
  contextChoice?: number
}

/** One pooled account as the browser renders it. Never carries token material. */
export interface WorkBuddyWebAccount {
  id: string
  uid: string
  /** Display name: the user's label, else the nickname, else a short uid. */
  name: string
  label?: string
  nickname?: string
  /**
   * How the account entered the pool.
   *
   * `cookie` means a sign-in token pasted from the web console; it is the only
   * route into the international product, which has no desktop app to capture.
   */
  origin: 'desktop' | 'qr' | 'cookie'
  /** Login domain this account speaks to. */
  domain: string
  /**
   * Whether the account can renew its own sign-in.
   *
   * False for a pasted token, which carries no refresh token: the card uses this
   * to tell the user an expiring account needs a fresh paste.
   */
  renewable: boolean
  /** Whether the user has it switched on. */
  enabled: boolean
  /** Whether rotation may pick it right now (enabled, not benched, not dead). */
  available: boolean
  /** Remaining credit, when the last lookup succeeded. */
  credits?: number
  creditsError?: string
  creditsAtMs?: number
  /** Access-token expiry, epoch ms; 0 means the source did not say. */
  expiresAtMs: number
  /** The upstream refused the session and a token refresh could not fix it. */
  sessionDead?: boolean
  /** Present while the account is benched after a limit. */
  cooldown?: {
    /** Epoch ms after which it will be tried again. */
    untilMs: number
    reason: 'rate' | 'credit' | 'session'
    /** Consecutive failures that produced this benching. */
    strikes: number
  }
  lastUsedAtMs: number
  addedAtMs: number
}

/** The account section of a status document. */
export interface WorkBuddyWebAccounts {
  accounts: readonly WorkBuddyWebAccount[]
  /** The account the catalog and card credits are read from. */
  primary?: string
  /** The desktop app's current account, when it is a pool member. */
  desktop?: string
  /**
   * Whether the floating account window is shown.
   *
   * It rides the status document because the window has to render *before*
   * anything else on the page can tell it what the setting says.
   */
  floatingWindow: boolean
}

/** One QR sign-in challenge, as the browser renders it. */
export interface WorkBuddyQrChallenge {
  /** Opaque state the browser echoes back when polling. */
  state: string
  /** The URL the QR code encodes. */
  authUrl: string
  /** When the challenge stops being valid, epoch ms. */
  expiresAtMs: number
}

/** Result of one QR poll, as the browser renders it. */
export type WorkBuddyQrPoll =
  | { status: 'waiting' }
  | { status: 'expired' }
  | { status: 'invalid' }
  | {
    status: 'added'
    /** Display name of the account that was added. */
    name: string
    /** False when this identity was already in the pool. */
    created: boolean
  }

/** Action requested from the account route. */
export type WorkBuddyAccountAction =
  | { action: 'add' }
  /**
   * Add an account from a sign-in token pasted out of the web console.
   *
   * The token travels in the request body and is never echoed back: it is
   * credential material, and the response describes the account, not the token.
   */
  | { action: 'add-cookie', token: string }
  | { action: 'poll', state: string }
  | { action: 'cancel', state: string }
  | { action: 'remove', id: string }
  | { action: 'enable', id: string, enabled: boolean }
  | { action: 'label', id: string, label?: string }
  | { action: 'reorder', ids: readonly string[] }
  | { action: 'test', id: string }
  | { action: 'refresh-credits' }
  /**
   * Choose which context length a model runs at.
   *
   * A write because it changes subsequent requests, not just the display: the
   * adapter reports the chosen window to pi-ai, which derives each request's
   * output ceiling from it.
   */
  | { action: 'context', model: string, length: number }

/** What an account action answers with. */
export interface WorkBuddyAccountResult {
  /** `ok` for every action that completed; otherwise a short reason. */
  state: 'ok' | 'failed' | 'waiting' | 'expired' | 'invalid' | 'added'
  reason?: string
  /** Present for `add`: the challenge to render as a QR code. */
  challenge?: WorkBuddyQrChallenge
  /** Present for `poll` and `add-cookie`: the added account's display name. */
  name?: string
  created?: boolean
  /** Present for `test`: whether a minimal streaming request succeeded. */
  test?: { ok: boolean, message: string }
}

/** The JSON document the plugin card renders. */
export type WorkBuddyWebStatus =
  | {
    status: 'signed-out'
    /**
     * Why no credential is usable, when that is diagnosable rather than simply
     * "nobody signed in" — today a credential belonging to the other product.
     * The card renders it in place of the generic sign-in hint.
     */
    reason?: string
    /**
     * The account pool, which may be empty.
     *
     * Present in this state so the card's account tab still works: adding the
     * first account by QR is a write, and it is the only way in when the desktop
     * app has never been signed in.
     */
    accounts?: WorkBuddyWebAccounts
    /** In-process key authorizing probe and account writes. */
    probeKey?: string
  }
  | {
    status: 'signed-in'
    nickname?: string
    domain?: string
    /** Where the account the headline figures describe came from. */
    source?: 'desktop' | 'qr' | 'cookie' | 'dsh'
    expiresAt?: number
    credits?: WorkBuddyWebCredits
    creditsError?: string
    /** Billing convenience facts for the models the plugin serves. */
    models?: readonly WorkBuddyWebModelBadge[]
    /** Where those models came from, and whether the last fetch failed. */
    catalog?: WorkBuddyWebCatalog
    /** Reasoning-effort probe state, consent, and recorded observations. */
    probe?: WorkBuddyWebProbeSection
    /** The account pool, for the card's account tab and the floating window. */
    accounts?: WorkBuddyWebAccounts
    /**
     * In-process key authorizing probe control writes. Handed to the card with
     * the status document (the card is same-origin and already had to pass the
     * loopback guard); it is never persisted and rotates per process.
     */
    probeKey?: string
  }
  | { status: 'error'; message: string }
