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

/**
 * The settings namespace this plugin's profile entry is served under.
 *
 * Shared because BOTH halves need the same string for different reasons, and a
 * disagreement between them fails silently. The Host uses it as the
 * `settingsNs` of each variant's configurable-provider directory entry; the
 * browser half uses it as the `key` its Models-page provider card registers
 * under, and the Models page dispatches that keyed slot with `entryKey =
 * settingsNs`. Two different strings would mean a card that registers, renders
 * nowhere, and reports no error.
 *
 * On DSH 0.1.7 a plugin's composition entry IS its settings namespace, so this
 * is the profile row id declared in `cordis.patch.yml` — not one of the
 * per-variant names the 0.1.2-era sections used. The Host asserts the two agree
 * at startup (see {@link module:dsh-workbuddy-connect}); this constant is the
 * one place the value is written down.
 */
export const WORKBUDDY_PROFILE_ENTRY_ID = 'llm-workbuddy'

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
   * `refresh` re-reads the credential and re-fetches the model catalog;
   * `set-maximum-context-window` persists the international card preference;
   * `set-model-visibility` hides or shows one model for the signed-in
   * account's picker; `set-sidebar-credit-style` and
   * `set-sidebar-credit-visible` persist how the sidebar's own card is drawn,
   * and whether it is drawn at all.
   *
   * Every one of them is a write, which is why they share this route's
   * in-process key and loopback guards rather than the read-only status GET.
   */
  action: 'probe' | 'clear' | 'refresh' | 'set-maximum-context-window' | 'set-model-visibility' | 'set-model-allowlist' | 'open-link' | 'set-sidebar-credit-style' | 'set-sidebar-credit-visible'
  /** Target model id; required for `probe` and `set-model-visibility`. */
  model?: string
  /**
   * Requested on/off value for `set-maximum-context-window` and
   * `set-sidebar-credit-visible`.
   *
   * Both are switches over an existing surface rather than a value the user
   * types, so the wire carries the desired state itself: a retried request is
   * then idempotent, and a lost one cannot leave the surface half-toggled.
   */
  enabled?: boolean
  /** Requested picker visibility for `set-model-visibility`. */
  visible?: boolean
  /**
   * Replacement allowlist for `set-model-allowlist`.
   *
   * An empty array clears the filter (show everything the hide-list permits) —
   * the same meaning as the field being absent on read. The whole list is sent
   * rather than a delta so the write is idempotent: a retried request cannot
   * leave a half-applied filter.
   */
  allowlist?: readonly string[]
  /**
   * How the sidebar should state each product's credit, for
   * `set-sidebar-credit-style`.
   *
   * One plugin-wide preference (the sidebar shows both products at once), which
   * is why it is written through this route rather than per product: either
   * variant's card can set it, and the next read of either document carries it.
   */
  creditStyle?: WorkBuddySidebarCreditStyle
  /**
   * Absolute http(s) link for `open-link`.
   *
   * Travelling over this route rather than being opened by the page is the
   * point: a desktop WebView cannot hand a URL to the user's own browser, and
   * the sign-in page has to be visited where their session already is. The host
   * validates the scheme again immediately before launching, so a crafted
   * request cannot turn this into a launcher for arbitrary schemes.
   */
  url?: string
  /**
   * Expected account key for `set-model-visibility`: the `visibility.account`
   * the card rendered its checkboxes from. The host refuses the write when the
   * signed-in account has moved on, so a stale card can never land one
   * account's toggle in another account's bucket.
   */
  account?: string
}

/**
 * Model-visibility section of the status document (issue #36).
 *
 * Present only when an account with a stable user id is signed in: the
 * preferences are per account, so a credential without a uid has nothing to
 * key them by and the card renders no visibility controls rather than editing
 * a bucket every uid-less account would share. The account key is the same
 * non-secret `uid:enterpriseId` identity the saved catalogs use — never a
 * token.
 */
export interface WorkBuddyWebVisibilitySection {
  /** The `uid:enterpriseId` identity these preferences belong to. */
  account: string
  /** Model ids this account has hidden from the picker (the full list, including ids not in the current catalog). */
  disabled: readonly string[]
  /**
   * The ids this account allows, when it narrowed the picker; omitted otherwise.
   *
   * Omitted — rather than an empty array — is the "no filter" state, which is
   * what the page renders the checkbox for. An allowlist write is a SEPARATE
   * action from a per-model visibility write because they are separate lists on
   * disk: see {@link WorkBuddyProbeAction}.
   */
  allowlist?: readonly string[]
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
  unlimited?: true
}

/** Aggregated credit answer rendered by the plugin card. */
export interface WorkBuddyWebCredits {
  total: number
  accounts: readonly WorkBuddyWebCreditAccount[]
  unlimited?: true
  cycleResetTime?: string
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
   * The international card can opt into the largest declared alternative. The
   * selected value is what DSH receives as its actual context budget.
   */
  contextWindow?: number
  /** The upstream default, when the card currently uses a selected maximum. */
  defaultContextWindow?: number
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
  /**
   * The cycle's capacity, when the upstream declared one.
   *
   * Optional because "no cap" and "the answer carried none" are both real: the
   * card states a used/total pair only when this is present, and the remaining
   * figure alone otherwise. Deriving a total from `credits` is impossible — a
   * balance does not imply a cap.
   */
  creditsTotal?: number
  creditsError?: string
  creditsAtMs?: number
  /**
   * Credits consumed this cycle, when the upstream stated a figure.
   *
   * Never derived from `creditsTotal - credits`: the two endpoints report usage
   * independently and either may omit it, so a subtraction would be the
   * plugin's arithmetic dressed up as the upstream's number.
   */
  creditsUsed?: number
  /**
   * What this plugin has sent through the account, counted from the answers it
   * relayed (see the usage store). Absent until at least one request landed.
   */
  usage?: {
    requests: number
    /** How many of those answers carried a usage block at all. */
    reported: number
    promptTokens: number
    completionTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
    /**
     * Cache-read share of the prompt, when an answer reported both numbers.
     * Absent — never zero — while nothing has reported a cache figure.
     */
    cacheHitRate?: number
    /** First counted request in this tally, epoch ms. */
    sinceMs: number
    /** Most recent counted request, epoch ms. */
    lastAtMs: number
  }
  /** Access-token expiry, epoch ms; 0 means the source did not say. */
  expiresAtMs: number
  /**
   * The upstream refused the session and a *definitive* refresh refusal
   * confirmed it.
   *
   * Never set by a refresh that merely failed to complete: an unreachable
   * endpoint says nothing about the sign-in. Turning the account back on clears
   * this, which is the user's override.
   */
  sessionDead?: boolean
  /** Present while the account is benched after a limit. */
  cooldown?: {
    /** Epoch ms after which it will be tried again. */
    untilMs: number
    reason: 'rate' | 'credit' | 'session'
    /**
     * Consecutive failures earned by this account, not by this benching.
     *
     * The count survives the benching expiring, which is what makes the backoff
     * grow for an account that keeps failing. It resets on the first success.
     */
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

/**
 * The two ways the sidebar card may state a product's credit.
 *
 * Declared here rather than with the host's config schema because BOTH halves
 * need the closed set: the host validates what it writes, and the browser picks
 * a rendering from what it reads — with one shared definition, a third style
 * could not be added on one side alone.
 *
 * - `'remaining'`: one line per product, "WorkBuddy 剩余额度 5,266" — the figure
 *   most readers open the sidebar for, with no bar;
 * - `'usage'`: the reference provider card's shape, a "used / total" pair over a
 *   bar of that ratio, which states the cycle's capacity as well as the balance.
 */
export type WorkBuddySidebarCreditStyle = 'remaining' | 'usage'

/** Whether a value is one of the closed set of sidebar credit styles. */
export function isWorkBuddySidebarCreditStyle(value: unknown): value is WorkBuddySidebarCreditStyle {
  return value === 'remaining' || value === 'usage'
}

/**
 * Whether the sidebar keeps its credit card at all, when nothing says otherwise.
 *
 * One shared constant rather than a literal on each side, because BOTH halves
 * fall back to it on a document that does not carry the field: an older host, a
 * route assembled without the preference (tests, a headless profile), or a read
 * that failed. The fallback is "present", and that is the one asymmetry worth
 * stating in a constant — every other preference here reshapes a surface that is
 * always there, while this one can REMOVE a surface, so an unknown value has to
 * leave it alone rather than take it away. A browser that defaulted the other
 * way would empty the sidebar of anyone whose host merely predates the field.
 */
export const WORKBUDDY_SIDEBAR_CREDIT_VISIBLE_DEFAULT = true

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
     * How the sidebar should state each product's credit.
     *
     * Carried in BOTH sign-in states: the card draws its credit lines the same
     * way whether the pool is empty or not, so a setting that only arrived once
     * an account existed would re-shape the card on the user's first sign-in.
     */
    sidebarCreditStyle?: WorkBuddySidebarCreditStyle
    /**
     * Whether the sidebar keeps its credit card at the bottom of the column.
     *
     * Carried in BOTH sign-in states for the same reason the style is: the card
     * is the user's always-on summary, and one that reappeared the moment an
     * account was added would make the switch look like it had not been saved.
     * Absent when the host cannot persist the preference — read as
     * {@link WORKBUDDY_SIDEBAR_CREDIT_VISIBLE_DEFAULT}, never as "off".
     */
    sidebarCreditVisible?: boolean
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
    /** The account pool, for the card's account tab. */
    accounts?: WorkBuddyWebAccounts
    /** International-card preference selecting larger declared context windows. */
    useMaximumContextWindow?: boolean
    /** Per-account hidden-model state for the card's visibility controls. */
    visibility?: WorkBuddyWebVisibilitySection
    /**
     * How the sidebar should state each product's credit.
     *
     * Carried on the document because the sidebar draws itself from the same read
     * the dashboard does, and it must state the credit the way the user chose
     * before any other surface has had a chance to run. Absent when the host
     * cannot persist the preference: the card then keeps its default shape.
     */
    sidebarCreditStyle?: WorkBuddySidebarCreditStyle
    /**
     * Whether the sidebar keeps its credit card at the bottom of the column.
     *
     * The ONE preference that can remove a surface rather than reshape it, which
     * is why it is stated on the document and not kept in browser state: the
     * sidebar card, the dashboard it opens and the settings row that writes it
     * are three mounts, and a preference that only one of them knew would leave
     * the card drawn against the user's choice until the next reload. Absent when
     * the host cannot persist the preference — read as
     * {@link WORKBUDDY_SIDEBAR_CREDIT_VISIBLE_DEFAULT}, never as "off".
     */
    sidebarCreditVisible?: boolean
    /**
     * A diagnosable problem reading the desktop app's own credential, while the
     * pool still serves from its other members.
     *
     * Reported in the signed-in state because that is when it is easiest to
     * miss: the group looks healthy (the pool has accounts), the desktop file the
     * user just pointed somewhere is being refused, and nothing else would say
     * so. The reason the group itself is not emptied is the pool's whole point —
     * one bad file must not take away accounts the user added by hand.
     */
    desktopError?: string
    /**
     * In-process key authorizing probe control writes. Handed to the card with
     * the status document (the card is same-origin and already had to pass the
     * loopback guard); it is never persisted and rotates per process.
     */
    probeKey?: string
  }
  | { status: 'error'; message: string }
