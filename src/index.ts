/**
 * WorkBuddy models for DeepSeek Harness, reusing the WorkBuddy desktop apps'
 * sign-in. Registers one provider per product variant — `workbuddy` for the CN
 * app and `workbuddy-ai` for the international one — while streaming, tool
 * calls, compaction, and permissions stay Harness-owned.
 *
 * The two variants are assembled by the same factory and differ only in their
 * {@link WorkBuddyVariant} descriptor: each gets its own credential store,
 * catalog, upstream client, shim, adapter, probe state, and routes. Neither
 * variant's startup, catalog fetch, or credential state can stop the other from
 * registering — a user with only one app installed sees only that group.
 *
 * @module dsh-workbuddy-connect
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-attachment'
import { markVolatileFields, unwrapVolatileConfig } from './config-volatile.ts'
import { WorkBuddyCredentialStore, type WorkBuddyCredential, type WorkBuddyStoreOptions } from './auth.ts'
import { WorkBuddyAtRestKeyProvider } from './desktop-credential-protection.ts'
import { WorkBuddyAccountPool, credentialAccountId, credentialOf } from './account-pool.ts'
import { WorkBuddyAccountService } from './account-service.ts'
import { registerWorkBuddyAccountRoute } from './account-route.ts'
import { WorkBuddyQrLogin } from './qr-login.ts'
import { WorkBuddyRotation } from './rotation.ts'
import { FALLBACK_WORKBUDDY_AI_MODELS, FALLBACK_WORKBUDDY_MODELS, WorkBuddyCatalog } from './catalog.ts'
import { workbuddyCatalogPath, WorkBuddyCatalogStore } from './catalog-store.ts'
import { WorkBuddyVisibilityStore, workbuddyVisibilityPath } from './visibility-store.ts'
import { WorkBuddyUsageStore, workbuddyUsagePath } from './usage-store.ts'
import type { WorkBuddyUsageSummary } from './usage-store.ts'
import { createWorkBuddyAdapter } from './adapter.ts'
import { WorkBuddyContextPreference } from './context-preference.ts'
import { createWorkBuddyShim } from './shim.ts'
import { WorkBuddyProbeService } from './probe-service.ts'
import { newestFirst, WorkBuddyProbeStore, workbuddyProbePath } from './probe-store.ts'
import { WorkBuddyUpstreamClient } from './upstream.ts'
import { registerWorkBuddyStatusRoute } from './web-status.ts'
import { createProbeKey, keyMatches, registerWorkBuddyProbeRoute } from './probe-route.ts'
import { openWorkBuddyLink } from './open-link.ts'
import type { WorkBuddyModelInfo } from './catalog.ts'
import { isWorkBuddySidebarCreditStyle, WORKBUDDY_PROFILE_ENTRY_ID } from './status-paths.ts'
import type { WorkBuddySidebarCreditStyle, WorkBuddyWebCatalog, WorkBuddyWebProbeSection } from './status-paths.ts'
import { clearHostHeartbeat, writeHostHeartbeat } from './host-heartbeat.ts'
import { WORKBUDDY_CONNECT_VERSION } from './version.ts'
import { CN_VARIANT, WORKBUDDY_VARIANTS, type WorkBuddyVariant } from './variants.ts'
import type { WorkBuddyAccountAction, WorkBuddyAccountResult } from './status-paths.ts'

export { WORKBUDDY_PROVIDER, WORKBUDDY_STREAM_IDLE_TIMEOUT_MS, createWorkBuddyAdapter, type WorkBuddyAdapter } from './adapter.ts'
export { createWorkBuddyShim, createStoreSender, type WorkBuddyChatSender, type WorkBuddyShim } from './shim.ts'
export {
  accountIdOf,
  cooldownDurationMs,
  credentialAccountId,
  credentialOf,
  WorkBuddyAccountPool,
  workbuddyAccountsPath,
  WORKBUDDY_ACCOUNTS_FILENAME,
  type WorkBuddyAccount,
  type WorkBuddyAccountInput,
  type WorkBuddyAccountOrigin,
  type WorkBuddyAccountPoolOptions,
  type WorkBuddyCooldown,
  type WorkBuddyCooldownReason,
  type WorkBuddyUpsertResult,
} from './account-pool.ts'
export {
  WorkBuddyAccountService,
  type WorkBuddyAccountServiceOptions,
  type WorkBuddyAccountSnapshot,
  type WorkBuddyWebAccount,
} from './account-service.ts'
export {
  parseAccountAction,
  registerWorkBuddyAccountRoute,
  workBuddyAccountHandler,
  type WorkBuddyAccountRouteOptions,
} from './account-route.ts'
export { accountsJson, formatAccounts } from './account-cli.ts'
export {
  challengeTag,
  WorkBuddyQrLogin,
  type WorkBuddyQrChallenge,
  type WorkBuddyQrLoginOptions,
  type WorkBuddyQrPoll,
} from './qr-login.ts'
export {
  cooldownReasonFor,
  isAccountScoped,
  parseRetryAfter,
  WorkBuddyRotation,
  type WorkBuddyRotationOptions,
  type WorkBuddyRotationOutcome,
} from './rotation.ts'
export {
  FALLBACK_WORKBUDDY_AI_MODELS,
  FALLBACK_WORKBUDDY_MODELS,
  WorkBuddyCatalog,
  type WorkBuddyModelInfo,
} from './catalog.ts'
export {
  chatBaseForDomain,
  chatBaseForRegion,
  originForRegion,
} from './upstream.ts'
export {
  WORKBUDDY_CATALOG_FILENAME,
  workbuddyCatalogPath,
  WorkBuddyCatalogStore,
} from './catalog-store.ts'
export {
  WORKBUDDY_VISIBILITY_FILENAME,
  WorkBuddyVisibilityStore,
  workbuddyVisibilityPath,
} from './visibility-store.ts'
export {
  fingerprintModel,
  WorkBuddyProbeStore,
  workbuddyProbePath,
  WORKBUDDY_PROBE_FILENAME,
  type WorkBuddyProbeRecord,
  type WorkBuddyProbeValidation,
} from './probe-store.ts'
export {
  PROBE_EFFORT_CANDIDATES,
  randomSentinel,
  probeModel,
  type ProbeAttempt,
  type ProbeOutcome,
  type ProbeSender,
} from './probe.ts'
export { WorkBuddyProbeService, type WorkBuddyProbeStatus } from './probe-service.ts'
export {
  AI_VARIANT,
  CN_VARIANT,
  variantFor,
  WORKBUDDY_VARIANTS,
  type WorkBuddyVariant,
} from './variants.ts'
export {
  appUserAgent,
  installedAppVersion,
  readBundleVersion,
  resolveAppVersion,
  validAppVersion,
  WORKBUDDY_APP_VERSION_FILENAME,
  type AppVersionInfo,
  type WorkBuddyAppVersionSource,
} from './app-version.ts'
export {
  CN_APP_VERSION_FILENAME,
  FALLBACK_CN_APP_VERSION,
  chatUserAgent,
  fallbackChatIdentity,
  readCliVersion,
  resolveChatIdentity,
  validCliVersion,
  type ChatIdentity,
  type ResolveChatIdentityOptions,
} from './client-identity.ts'
export {
  defaultDesktopAuthCandidates,
  defaultDesktopAuthPath,
  desktopAuthCandidatesFor,
  parseWorkBuddyAuth,
  WORKBUDDY_AUTH_FILE_ENV,
  WORKBUDDY_AUTH_FILENAME,
  WorkBuddyCredentialStore,
  workbuddyOwnAuthPath,
  type WorkBuddyAuthStatus,
} from './auth.ts'
export {
  classifyUpstreamError,
  modelWithCurrentPromotion,
  normalizeCredits,
  parseModelCatalog,
  prepareChatBody,
  prepareInternationalChatBody,
  regionOf,
  WorkBuddyUpstreamClient,
  type UpstreamErrorKind,
  type WorkBuddyCatalogFetch,
  type WorkBuddyChatResult,
  type WorkBuddyCredits,
  type WorkBuddyEffort,
  type WorkBuddyModelBilling,
  type WorkBuddyModelReasoning,
  type WorkBuddyPromotion,
  type WorkBuddyRefreshOutcome,
  type WorkBuddyUpstreamModel,
} from './upstream.ts'
export {
  WORKBUDDY_HOST_HEARTBEAT_FILENAME,
  clearHostHeartbeat,
  isHeartbeatProcessAlive,
  processStartTimeMs,
  readHostHeartbeat,
  workbuddyHostHeartbeatPath,
  type WorkBuddyHostHeartbeat,
} from './host-heartbeat.ts'

/** Stable Cordis plugin name. */
export const name = 'llm-workbuddy'

/** The model registry required before the provider can register. */
export const inject = ['llm']

/**
 * Settings namespace owning the CN card's section.
 *
 * DSH 0.1.2 dropped the `settingsNamespace()` branding function: a namespace is
 * now a nominal string, validated by the type system where it is used rather
 * than at runtime by a function call. The brand is compile-time only, so this
 * stays the plain string it always was — every comparison, descriptor lookup,
 * and `dsh` config file still sees `'workbuddy'`. It is cast once here so the
 * public constant carries the seam's type without pulling the brand helper
 * into this package (upstream DSH plugins, `dsh-llm-pi-ai` included, pass
 * their namespaces as plain string literals).
 */
/**
 * Settings namespace owning the international section.
 *
 * One namespace per variant, not one shared: each section owns only its own
 * fields (`authFile` vs `authFileAI` and `useMaximumContextWindow`), and the
 * sections are what `settings.yaml` and the TUI `/settings` read. On DSH 0.1.5
 * they carry one more duty — the settings Plugins tab dispatches a card by
 * rendering `settings.plugin.item` with `entryKey = ns` for each namespace the
 * Host serves, so each variant's card needs a served section whose namespace
 * equals its id. DSH 0.1.6+ ignores that pairing (its Plugins page renders the
 * bundle's single `plugins.bundle.config` entry, keyed by package name), which
 * costs nothing: a section that names no card renders no duplicate.
 */
export const WORKBUDDY_AI_SETTINGS_NS = 'workbuddy-ai' as SettingsNamespace

/**
 * The plugin's own row id in the active profile's composition.
 *
 * On DSH 0.1.7 a settings form write is addressed by this id — the Loader row's
 * `id` field, which `cordis.patch.yml` declares as `llm-workbuddy` — rather
 * than by a per-variant namespace. It is a fallback only: the live id is read
 * back from `configEditor.entries()`, so a profile that renamed the row still
 * writes through the right one.
 */
export const PROFILE_ENTRY_ID = WORKBUDDY_PROFILE_ENTRY_ID

/**
 * How often the credential files are re-checked, in milliseconds.
 *
 * A startup-only catalog fetch cannot notice a sign-in that happens while DSH
 * is already running, so the model group would not appear until a restart. This
 * poll is a cheap existence/parse read of at most a few local files: it never
 * contacts the network and never runs a reasoning probe.
 *
 * `DSH_WORKBUDDY_POLL_MS` overrides it. That exists so the sweep can be
 * exercised end to end in tests and shortened while diagnosing a slow sign-in
 * on a real machine; it is not a product setting and no UI exposes it. The
 * value is clamped to a sane range so a mistaken override cannot turn the poll
 * into a busy loop.
 */
const CREDENTIAL_POLL_MS = 30_000

/** Floor and ceiling for the overridable poll interval. */
const MIN_POLL_MS = 100
const MAX_POLL_MS = 24 * 60 * 60 * 1000

/** Resolve the sweep interval, honoring the override when it is usable. */
function credentialPollMs(): number {
  const override = Number(process.env['DSH_WORKBUDDY_POLL_MS'])
  if (!Number.isFinite(override) || override < MIN_POLL_MS) return CREDENTIAL_POLL_MS
  return Math.min(override, MAX_POLL_MS)
}

/**
 * How long to wait before retrying a catalog fetch that failed.
 *
 * The credential sweep deliberately does not re-fetch a catalog it already has
 * (a same-identity token rotation carries no new model information). But a
 * *failed* fetch must not be treated the same way: without a retry, one
 * transient network blip at startup would leave the group on the built-in
 * fallback roster until the user noticed and pressed refresh. This bound keeps
 * that recovery automatic while still honoring the "not every round" rule — at
 * most one attempt per interval, and none at all once a live catalog lands.
 *
 * Expressed as a multiple of the sweep rather than a fixed duration so the two
 * stay in proportion under the `DSH_WORKBUDDY_POLL_MS` override.
 */
const CATALOG_RETRY_SWEEPS = 10

/** Plugin configuration. */
export interface Config {
  /** Explicit WorkBuddy (CN) desktop auth-file path, overriding env and platform defaults. */
  authFile?: string
  /** Explicit WorkBuddy AI (international) desktop auth-file path, overriding env and platform defaults. */
  authFileAI?: string
  /**
   * Whether the user has authorized sending probe requests about reasoning
   * efforts. Off by default: a probe spends real credit, so nothing is sent
   * until the user explicitly agrees.
   */
  probeConsent?: boolean
  /** Use the largest context window the international catalog explicitly offers. */
  useMaximumContextWindow?: boolean
  /**
   * How the sidebar card states each product's credit.
   *
   * `'remaining'` (default) is one line per product — "WorkBuddy 剩余额度 5,266";
   * `'usage'` is the reference card's shape — a "used / total" pair over a bar of
   * that ratio. Both describe the same pool; they differ in which figure leads,
   * and that is a matter of taste rather than of correctness, which is why it is
   * a setting instead of a decision this plugin makes for the user.
   */
  sidebarCreditStyle?: WorkBuddySidebarCreditStyle
  /**
   * Whether the sidebar keeps its credit card at all.
   *
   * The one preference here that REMOVES a surface instead of reshaping it:
   * `false` takes the card out of the sidebar's foot, which is where both the
   * resident credit summary and the way into the dashboard live. The dashboard
   * therefore stays reachable from the settings page while this is off — a
   * switch that stranded a destination would be a trap rather than a setting.
   *
   * Defaults to on ({@link WORKBUDDY_SIDEBAR_CREDIT_VISIBLE_DEFAULT}), so a
   * config written before this field existed keeps drawing the card.
   */
  sidebarCreditVisible?: boolean
}

/** Explicit CN desktop auth-file path (shared by the plugin schema and its section). */
const AUTH_FILE_FIELD = z.string().description('WorkBuddy desktop auth file (defaults to the app\'s own location)')
/** Explicit international desktop auth-file path (shared by the plugin schema and its section). */
const AUTH_FILE_AI_FIELD = z.string().description('WorkBuddy AI desktop auth file (defaults to the app\'s own location)')
/** Probe authorization (shared by the plugin schema and the CN section). */
const PROBE_CONSENT_FIELD = z.boolean().default(false)
  .description('Authorize reasoning-effort probes (each probe sends real requests that may consume credit)')
const MAXIMUM_CONTEXT_WINDOW_FIELD = z.boolean().default(true)
  .description('Use the largest context window declared by WorkBuddy AI when alternatives are available (on by default)')
/** Sidebar credit line style (shared by both variants' cards, which show the same figure). */
const SIDEBAR_CREDIT_STYLE_FIELD = z.union(['remaining', 'usage']).default('remaining')
  .description('Sidebar credit line: "remaining" states the balance per product; "usage" shows used / total over a bar')
/** Whether the sidebar keeps its credit card (shared by both variants, which write one sidebar). */
const SIDEBAR_CREDIT_VISIBLE_FIELD = z.boolean().default(true)
  .description('Show the WorkBuddy credit card at the bottom of the sidebar (off: the dashboard stays reachable from this settings page)')

/**
 * The plugin's own config fields, built once so the two generations can share
 * the field definitions while disagreeing about the marks.
 *
 * Every field here is user-editable from a browser surface, which on
 * 0.1.7 means it has to be marked `volatile` for `settings.describe()` to
 * project it into a form (see `./config-volatile.ts`). The marks go on the
 * exported `Config` ONLY: the legacy settings registration below must receive
 * the unmarked dict, because ≤0.1.6's `installSection` re-validates the base
 * it is handed and chokes on the frozen `{ get() }` references a marked schema
 * produces at parse time on every generation.
 */
const CONFIG_FIELDS = {
  authFile: AUTH_FILE_FIELD,
  authFileAI: AUTH_FILE_AI_FIELD,
  probeConsent: PROBE_CONSENT_FIELD,
  useMaximumContextWindow: MAXIMUM_CONTEXT_WINDOW_FIELD,
  sidebarCreditStyle: SIDEBAR_CREDIT_STYLE_FIELD,
  sidebarCreditVisible: SIDEBAR_CREDIT_VISIBLE_FIELD,
} as const

/**
 * The composition schema: what the loader reads and what 0.1.7's settings forms
 * project.
 *
 * Every field is marked volatile, so a write through the 0.1.7 settings wire
 * commits IN PLACE (no fiber remount) and notifies this plugin through
 * `loader/volatile-update`. `apply()` therefore reads the live values through
 * `current()`, which unwraps the references on every call.
 */
export const Config: z<Config> = z.object(markVolatileFields(CONFIG_FIELDS))

/**
 * The settings namespace this plugin's fields are served under.
 *
 * On 0.1.7 a plugin's composition entry IS its settings namespace, so this is
 * the profile row id (see {@link PROFILE_ENTRY_ID}) rather than a name the
 * plugin installs. Kept exported because the host CLI and the tests resolve
 * the served descriptor by it.
 */
export const WORKBUDDY_SETTINGS_NS = PROFILE_ENTRY_ID as SettingsNamespace

/** One variant's live runtime, assembled by {@link createVariantRuntime}. */
interface VariantRuntime {
  variant: WorkBuddyVariant
  store: WorkBuddyCredentialStore
  client: WorkBuddyUpstreamClient
  catalog: WorkBuddyCatalog
  /** Every credential this variant may send upstream. */
  pool: WorkBuddyAccountPool
  /** The pool's network-facing half: capture, credits, primary resolution. */
  accounts: WorkBuddyAccountService
  /** The QR sign-in flow, one per variant so the region is fixed by construction. */
  qr: WorkBuddyQrLogin
  /**
   * The context window each model should run at, when the user has chosen one.
   *
   * Read by the adapter on every model listing, which is what makes the choice
   * affect the request rather than only the card.
   */
  contextPreference: WorkBuddyContextPreference
  probeStore: WorkBuddyProbeStore
  probeService: WorkBuddyProbeService
  /**
   * The last catalogs that loaded, keyed by account.
   *
   * Sits between the live fetch and the built-in roster in the degradation
   * order: a restart, or a fetch that fails while offline, serves what this
   * account was last actually shown instead of the one-off snapshot compiled
   * into the plugin.
   */
  savedCatalogs: WorkBuddyCatalogStore
  /**
   * This variant's per-account hidden-model preferences (issue #36). One file
   * per variant, keyed by account: a model id one account hid never hides for
   * another, and switching accounts switches the whole list in one read.
   */
  visibilityStore: WorkBuddyVisibilityStore
  /** Per-account request tally, filled by the rotation as answers arrive. */
  usageStore: WorkBuddyUsageStore
  /**
   * The visibility account key currently in effect (`uid:enterpriseId`), or
   * undefined when signed out or the credential carries no uid. Read per call,
   * so an account switch changes the answer without rebuilding anything.
   */
  account: () => string | undefined
  /** The static roster this variant falls back to. */
  fallback: readonly WorkBuddyModelInfo[]
  /**
   * Where the served models came from, in degradation order:
   * `live` (fetched now) → `saved` (this account's last successful fetch) →
   * `fallback` (the roster compiled into the plugin).
   */
  catalogSource: 'live' | 'saved' | 'fallback'
  /** When the served catalog was fetched, for `live` and `saved`. */
  catalogFetchedAtMs: number | undefined
  /** Why the last catalog attempt failed, when it did. */
  catalogError: string | undefined
  /** When the last catalog attempt started, for the retry backoff. */
  lastFetchAtMs: number
  /**
   * Bumped whenever this variant's catalog generation changes — an account
   * switch, a sign-out, or a new fetch superseding an older one. A request
   * carries the generation it started under and refuses to write back if the
   * generation has moved on, so a slow answer can never resurrect data the
   * plugin has since decided to drop (spec §5: late responses are discarded).
   */
  catalogGeneration: number
  /**
   * The in-flight catalog fetch, scoped to the identity and generation it began
   * under. A caller may only join the same scope; an account change cancels the
   * old request and immediately starts one for the newly adopted account.
   */
  inflightFetch: CatalogFetch | undefined
  /** Notify the model directory that this variant's answers changed. */
  invalidate: () => void
  /** Whether the provider registered successfully. */
  registered: boolean
}

/** One catalog request plus the identity state it is allowed to update. */
interface CatalogFetch {
  identity: string
  generation: number
  controller: AbortController
  promise: Promise<void>
}

/** Stable identity key used by credentials, probe records, and catalog entries. */
function credentialIdentity(credential: Pick<WorkBuddyCredential, 'uid' | 'enterpriseId'>): string {
  return `${credential.uid}:${credential.enterpriseId ?? ''}`
}

/**
 * The account key model-visibility preferences are stored under: the stable
 * identity, but only when it carries a uid.
 *
 * A credential whose desktop document carried no `account.uid` normalizes to
 * an empty string; keying preferences on the resulting `":enterpriseId"` would
 * silently share one bucket between every such account. Those accounts get no
 * per-account preferences at all — everything stays visible and the control
 * route explains the refusal — which is the only honest degradation: it never
 * applies one account's hidden list to another.
 */
export function visibilityAccountOf(credential: Pick<WorkBuddyCredential, 'uid' | 'enterpriseId'>): string | undefined {
  return credential.uid === '' ? undefined : credentialIdentity(credential)
}

/**
 * The settings service faces this plugin adapts across generations, typed
 * structurally because the installed `@deepseek-ai/dsh-settings` .d.ts
 * describes only the generation it was built against — `installSection`
 * through 0.1.6, `configure`/`update` from 0.1.7 — so naming either method
 * statically would not compile against the other.
 */
/**
 * The loader event a 0.1.7 volatile config write dispatches to the owning fiber.
 *
 * Re-stated locally rather than imported: `@deepseek-ai/cordis-plugin-loader`
 * is not published under the engine's own version line, and the loader is the
 * host's package rather than a plugin dependency — this plugin only needs the
 * event's SHAPE at compile time. The declaration merges into cordis's `Events`,
 * so `ctx.on` stays fully typed; a future loader that renames the event turns
 * the listener below into a compile error rather than a silent no-op.
 */
declare module '@deepseek-ai/cordis' {
  interface Events {
    /** Volatile config values were committed into the running fiber without a remount. */
    'loader/volatile-update'(paths: readonly (readonly string[])[]): void
  }
}

interface SettingsServiceSeam {
  /** Declare this instance's auto-form policy (a disposer). */
  configure?(presentation: { auto?: boolean }, owner?: unknown): () => void
  /** Merge editable fields into an entry's config. */
  update?(ns: string, patch: object, expectedRevision?: number): Promise<void>
}

/** Read the configured explicit auth-file path for one variant. */
function configuredAuthFile(config: Config, variant: WorkBuddyVariant): string | undefined {
  return variant.id === CN_VARIANT.id ? config.authFile : config.authFileAI
}

/**
 * The static catalog a variant serves before its first successful fetch.
 *
 * Each variant has its own roster: the two endpoints share several model ids
 * but not their billing, context windows, or reasoning sets, so one shared
 * fallback would misdescribe whichever variant it was not captured from.
 */
function fallbackFor(variant: WorkBuddyVariant): readonly WorkBuddyModelInfo[] {
  return variant.id === CN_VARIANT.id ? FALLBACK_WORKBUDDY_MODELS : FALLBACK_WORKBUDDY_AI_MODELS
}

/** Build one variant's stores and probe state. */
function createVariantRuntime(
  config: Config,
  variant: WorkBuddyVariant,
  current: () => Config,
  identityOf: (variantId: string) => string | undefined,
  accountOf: (variantId: string) => string | undefined,
  keyProvider: WorkBuddyStoreOptions['keyProvider'],
  onDesktopReadError: (message: string) => void,
  warn: (message: string, error: unknown) => void,
): VariantRuntime {
  const client = new WorkBuddyUpstreamClient()
  // Read through `current()`, never the raw `config`: on 0.1.7 every marked
  // field arrives as a frozen `{ get() }` reference, so a direct read would
  // hand the stores an object where a path or a boolean belongs.
  const configured = configuredAuthFile(current(), variant)
  const store = new WorkBuddyCredentialStore({
    variant,
    ...configured === undefined ? {} : { desktopPath: configured },
    ...keyProvider === undefined ? {} : { keyProvider },
    refresh: credential => client.refreshToken(credential),
  })
  const pool = new WorkBuddyAccountPool({ variant })
  const contextPreference = new WorkBuddyContextPreference({ variant })
  const qr = new WorkBuddyQrLogin({ variant })
  const accounts = new WorkBuddyAccountService({
    variant,
    pool,
    store,
    client,
    qr,
    // The card's usage figures come from what the rotation counted, read fresh
    // because the tally moves with every answered request.
    usageFor: (accountId: string): WorkBuddyUsageSummary | undefined => usageStore.summary(accountId),
    // A desktop read that fails is recorded per variant, exactly as the sweep
    // records it: the card then says which file or binary is wrong instead of
    // reporting "signed out" for a problem the user can fix.
    onDesktopReadError,
  })
  const fallback = fallbackFor(variant)
  const catalog = new WorkBuddyCatalog(fallback)
  if (variant.id !== CN_VARIANT.id) catalog.setUseMaximumContextWindow(current().useMaximumContextWindow === true)
  // Start hidden: a variant must serve no models until an account has actually
  // been adopted, so a signed-out variant is empty rather than showing a roster
  // whose models could only fail. `adoptIdentity` is what reveals it, and it
  // treats "never seen, still signed out" as no change — which is only correct
  // if the pre-adoption state is already hidden.
  catalog.setVisible(false)
  const probeStore = new WorkBuddyProbeStore({
    pluginVersion: WORKBUDDY_CONNECT_VERSION,
    path: workbuddyProbePath(variant.probeFilename),
  })
  // One file per variant, for the same reason the probe records are split: the
  // two endpoints disagree about rates and windows for shared model ids, so a
  // saved CN roster must never be served as an international one.
  const savedCatalogs = new WorkBuddyCatalogStore(
    workbuddyCatalogPath(variant.catalogFilename),
  )
  const visibilityStore = new WorkBuddyVisibilityStore(
    workbuddyVisibilityPath(variant.visibilityFilename),
  )
  // Request accounting: what each account has actually sent, and what the
  // upstream said it cost. Written at most once every few seconds — a
  // per-request write would turn every chat turn into disk I/O for a report.
  const usageStore = new WorkBuddyUsageStore({
    path: workbuddyUsagePath(variant.usageFilename),
    onWriteError: error => { warn('dsh-workbuddy-connect: usage tally could not be written', error) },
  })
  const probeService = new WorkBuddyProbeService({
    store: probeStore,
    catalog,
    // Probes run as the pool's primary account, the same one the catalog was
    // fetched for, so an observation is always attributed to the account whose
    // model list produced it.
    credentials: accountsAsCredentialSource(accounts),
    client,
    consent: () => current().probeConsent === true,
    // Observations are per account: the service reads and writes its records
    // against this identity, so one account's detected levels never answer for
    // another's, and an in-flight sweep cannot store under a new account.
    account: () => identityOf(variant.id),
  })
  return {
    variant,
    store,
    client,
    catalog,
    pool,
    accounts,
    contextPreference,
    qr,
    probeStore,
    probeService,
    savedCatalogs,
    visibilityStore,
    usageStore,
    account: () => accountOf(variant.id),
    fallback,
    catalogSource: 'fallback',
    catalogFetchedAtMs: undefined,
    catalogError: undefined,
    lastFetchAtMs: 0,
    catalogGeneration: 0,
    inflightFetch: undefined,
    invalidate: () => {},
    registered: false,
  }
}

/** The catalog provenance the card displays. */
function catalogSection(runtime: VariantRuntime): WorkBuddyWebCatalog {
  const fetch = runtime.client.lastCatalog
  return {
    // The source is what the models on screen actually came from, so the card
    // can distinguish a fresh fetch from a saved one from the built-in roster —
    // "stale" and "offline" are different problems for the user.
    source: runtime.catalogSource,
    // The served catalog's own fetch time, which for a saved list is when it
    // was fetched, not when the process started.
    ...runtime.catalogFetchedAtMs === undefined ? {} : { fetchedAt: runtime.catalogFetchedAtMs },
    ...fetch?.appVersion === undefined ? {} : { appVersion: fetch.appVersion.version },
    ...runtime.catalogError === undefined ? {} : { error: runtime.catalogError },
  }
}

/**
 * Whether a model can be probed by hand: it reasons and the upstream declares
 * no effort set for it.
 *
 * Deliberately *not* filtered by whether a result already exists. Dropping a
 * model once it has been detected made the list shrink with use, so
 * re-detecting one model — after an upstream change, say — meant clearing every
 * other result first. The list stays stable and the card marks which entries
 * already have an answer.
 */
function isProbeCandidate(info: WorkBuddyModelInfo): boolean {
  if (info.reasoning?.supports !== true) return false
  return (info.reasoning.supportedEfforts?.length ?? 0) === 0
}

/** Compact probe state for one card: consent, candidates, observations. */
function probeSection(runtime: VariantRuntime, consent: boolean): WorkBuddyWebProbeSection {
  const models = runtime.catalog.current()
  // Read results through the *same* judgement the adapter uses, rather than
  // straight from the store. A raw record can be stale in ways the adapter
  // already discounts — its catalog row changed, it aged past the TTL, or the
  // upstream has since declared an effort set (which always wins) — and showing
  // one would have the card promise levels the model picker does not offer. A
  // model the upstream dropped leaves the catalog entirely, so it drops out
  // here too.
  const results = models.flatMap(info => {
    const record = runtime.probeService.recordFor(info.id)
    if (record === undefined) return []
    return [{
      id: info.id,
      name: info.name,
      validation: record.validation,
      efforts: record.efforts,
      probedAt: record.probedAtMs,
    }]
  })
  return {
    consent,
    running: runtime.probeService.isRunning(),
    candidates: models.filter(isProbeCandidate).map(info => info.id),
    // Newest first: a detection the user just ran belongs at the top, not
    // appended below every earlier one.
    results: newestFirst(results),
  }
}

/**
 * Adapt the account pool to the credential-store surface the probe service and
 * the adapter's auth plane expect.
 *
 * Only three members are ever read there — `current`, `resolve`, and (for the
 * probe's write-back guard) nothing else — so the pool's primary account is the
 * one answer they all get. Returning a narrowed object rather than the real
 * store keeps it impossible for a caller to reach the desktop file or the
 * plugin-owned copy through this seam.
 */
function accountsAsCredentialSource(accounts: WorkBuddyAccountService): WorkBuddyCredentialStore {
  return {
    current: () => accounts.primaryCredential(),
    resolve: async () => {
      const credential = await accounts.primaryCredential()
      if (credential === undefined) {
        throw new Error('workbuddy: no account is available for this provider; add one from the plugin card')
      }
      return credential
    },
  } as unknown as WorkBuddyCredentialStore
}

/**
 * Start one variant: its loopback endpoint, provider registration, and
 * configuration-card wiring.
 *
 * Registration waits for the shim to hold a port, because the provider's
 * models read the shim origin at construction time. A failure here is
 * contained to this variant: the caller logs it and the other keeps working.
 *
 * @returns whether the provider registered.
 */
async function startVariant(ctx: Context, runtime: VariantRuntime): Promise<boolean> {
  const { variant, client, catalog, probeService, pool, accounts } = runtime
  // Chat requests run through the pool's rotation, so one account's 429 is a
  // routing decision rather than the user's problem. A refresh performed mid-
  // rotation is persisted by the pool itself, which is what keeps a recovered
  // token from being re-fetched on every later request.
  const rotation = new WorkBuddyRotation({
    pool,
    client,
    logger: ctx.logger,
    // The tally the account card reads: one increment per answer, attributed to
    // the member that produced it (which only the rotation knows).
    onUsage: (accountId, usage) => { runtime.usageStore.record(accountId, usage) },
    // Logged once per process: an unfamiliar usage block is then discovered from
    // this line instead of guessed at in the parser.
    onUsageShape: fields => {
      ctx.logger.info(`dsh-workbuddy-connect: ${variant.displayName} upstream usage fields: ${fields.join(', ') || '(none)'}`)
    },
  })
  // The shim wants "send this body and tell me what happened"; the rotation's
  // extra bookkeeping (which accounts were tried) is not part of that contract,
  // so only the result crosses the seam.
  const shim = createWorkBuddyShim({
    sender: { send: async (body, signal) => (await rotation.send(body, signal)).result },
    catalog,
    logger: ctx.logger,
  })
  try {
    await shim.ready
  } catch (error: unknown) {
    ctx.logger.error(`dsh-workbuddy-connect: ${variant.displayName} loopback endpoint failed to start`, error)
    return false
  }

  try {
    // Constructed only once the listener holds a port: the provider's models
    // read the shim origin at construction time.
    const workbuddy = createWorkBuddyAdapter({
      providerId: variant.id,
      displayName: variant.displayName,
      shim,
      // The catalog, the card's headline credit figure, and reasoning probes all
      // run as the pool's primary account, so those answers stay stable while
      // chat requests rotate underneath them.
      store: accountsAsCredentialSource(accounts),
      catalog,
      resolveAttachments: () => ctx.get('attachments'),
      observe: modelId => probeService.recordFor(modelId),
      resolveContextWindow: (modelId, declared) => runtime.contextPreference.resolve(modelId, declared),
      // Hidden ids resolve per read from the store by the *current* account:
      // an account switch or a toggle changes the answer after the next
      // invalidate, and a signed-out or uid-less variant hides nothing.
      //
      // Read through `effectiveHidden`, never `disabled` directly: an account
      // can narrow the picker to an allowlist, and that list only means anything
      // against the catalog — every id outside it is hidden, which is a fact
      // neither the stored list nor this call site can compute alone. The
      // catalog is the same one the adapter lists models from, so the two agree
      // on what "outside the allowlist" covers.
      hidden: () => {
        const account = runtime.account()
        if (account === undefined) return []
        return runtime.visibilityStore.effectiveHidden(
          account,
          runtime.catalog.current().map(model => model.id),
        )
      },
    })
    runtime.invalidate = () => {
      workbuddy.invalidate()
      ctx.emit('llm/adapters-updated')
    }

    // TWO registrations, and they answer different questions.
    //
    // The ADAPTER is what makes models requestable under this route; the
    // directory entry is what makes the Models settings page draw a row for the
    // provider at all. The plugin used to contribute only the first, on the
    // grounds that the page's editor has no fields to offer a WorkBuddy row and
    // an unusable editor is worse than no row.
    //
    // That reasoning no longer holds, because the row is now the anchor for a
    // surface the page does own: `settings.models.provider-card` is a keyed slot
    // the Models page dispatches per row with `entryKey = settingsNs`, and this
    // plugin registers its own card there. Without the directory entry there is
    // no row and therefore nowhere for that card to render — the card exists only
    // because the row does. The page's own editor stays reachable and still has
    // nothing to offer; the card beside it is where the real controls live, which
    // is exactly the shape the reference provider plugin uses.
    //
    // `settingsPath: []` means this variant's whole settings section is the
    // profile. On 0.1.7 a plugin's composition entry IS its settings namespace
    // (one namespace per variant would have nothing behind it), so both variants
    // address the same document — each card reads its own variant's fields from
    // it.
    const releaseDirectory = ctx.llm.registerConfigurableProviders([{
      provider: variant.id,
      displayName: variant.displayName,
      settingsNs: WORKBUDDY_SETTINGS_NS,
      settingsPath: [],
    }])
    const releaseAdapter = ctx.llm.registerAdapter([variant.id], workbuddy.adapter)
    try {
      ctx.effect(() => () => {
        releaseDirectory()
        releaseAdapter()
        void shim.close()
      })
    } catch {
      // `ctx.effect` throws when the context is already disposed, so the
      // disposer it would have registered never runs: release this variant's
      // own registration (and its shim) here instead.
      releaseAdapter()
      void shim.close()
    }
    runtime.registered = true
    return true
  } catch (error: unknown) {
    ctx.logger.error(`dsh-workbuddy-connect: ${variant.displayName} provider registration failed`, error)
    void shim.close()
    return false
  }
}

/**
 * Start both variants: their loopback endpoints, the `workbuddy` and
 * `workbuddy-ai` providers, their configuration cards, and their
 * credential-driven catalog lifecycles.
 *
 * Each variant registers unconditionally; what varies is whether its catalog is
 * *visible*. An empty catalog is how DSH hides a model group (the host filters
 * out groups with no models), which keeps a sign-in that happens after startup
 * working without re-registering the provider.
 */
export function apply(ctx: Context, config: Config): void {
  // Live configuration source: starts as the applied config and is replaced by
  // the settings section's source once one is installed, so edits reach the
  // probe consent gate without a restart.
  //
  // On 0.1.7 the loader commits a settings write IN PLACE into the marked
  // `Config` field references (no fiber remount — see `./config-volatile.ts`),
  // so every read goes through `unwrapVolatileConfig` and a fresh object is
  // returned each time a reference moved. On ≤0.1.6 the config is plain and the
  // unwrap is an identity return, which keeps object identity for the
  // adapter-options memo.
  let appliedSource: () => Config = () => config
  let current = (): Config => unwrapVolatileConfig(appliedSource())

  /** Timers and in-flight work belonging to this plugin instance. */
  let stopped = false
  const timers: NodeJS.Timeout[] = []
  /**
   * The account identity each variant last published a catalog for. Keeps a
   * same-identity token rotation from re-fetching, and lets a late response
   * from a previous identity be discarded instead of overwriting a newer one.
   */
  const lastIdentities = new Map<string, string>()
  /**
   * The last diagnosable failure while capturing the desktop app's sign-in,
   * per variant. Surfaced by the card when the pool is empty, because that is
   * the case where "signed out" is an unhelpful answer — a file holding the
   * other product's credential is the common cause and it names the file.
   */
  const desktopReadError = new Map<string, string>()
  /**
   * The visibility account key each variant last adopted, parallel to
   * {@link lastIdentities}: same credential, second key — undefined both when
   * signed out and when the credential carried no uid, which is exactly the
   * case that must not fall back to a shared preference bucket.
   */
  const lastAccounts = new Map<string, string>()

  // One at-rest key provider per variant. The difference is the discovery
  // setting, and it is deliberate: only the CN WorkBuddy install has been
  // verified to hold the key its envelopes name, and only its macOS layout is
  // known, so CN may look for the app by bundle id. A Global (WorkBuddy AI)
  // encrypted credential has never been seen live, so that provider runs at
  // `discovery: 'none'` — no default path and no Spotlight, which is a
  // deliberate narrowing from the shared provider it replaces: a Global unlock
  // must not silently execute the *CN* app's Electron, and the provider cannot
  // tell which variant is asking. An explicit WORKBUDDY_ELECTRON_BIN still
  // works for Global. A keyId mismatch is still reported as a diagnosis rather
  // than a wrong open, and the helper only runs if an encrypted credential is
  // read.
  const atRestKeysFor = (variant: WorkBuddyVariant): WorkBuddyAtRestKeyProvider =>
    new WorkBuddyAtRestKeyProvider({
      discovery: variant.id === CN_VARIANT.id ? 'macos-workbuddy' : 'none',
    })
  const runtimes = WORKBUDDY_VARIANTS.map(variant => createVariantRuntime(
    current(),
    variant,
    () => current(),
    id => lastIdentities.get(id),
    id => lastAccounts.get(id),
    atRestKeysFor(variant),
    message => { desktopReadError.set(variant.id, message.slice(0, 300)) },
    (message, error) => { ctx.logger.warn(message, error) },
  ))

  // Same-origin routes backing each Plugin-configuration card; the webServer
  // service is optional (a headless profile serves no browser).
  const probeKey = createProbeKey()
  let setMaximumContextWindow: ((enabled: boolean) => Promise<{ state: string; reason?: string }>) | undefined
  /**
   * Writes the sidebar credit-line style through the same settings service the
   * maximum-context preference uses. Undefined on a host with no settings
   * service: the status document then carries no style, and the card keeps its
   * default rather than rendering a control that could not be saved.
   */
  let setSidebarCreditStyle: ((style: WorkBuddySidebarCreditStyle) => Promise<{ state: string; reason?: string }>) | undefined
  /**
   * Writes whether the sidebar keeps its credit card, through the same settings
   * service. Undefined on a host with no settings service, exactly like the
   * style beside it: the status document then carries no value and the card
   * keeps its default (present) rather than vanishing on a write that could not
   * have been saved.
   */
  let setSidebarCreditVisible: ((visible: boolean) => Promise<{ state: string; reason?: string }>) | undefined
  /**
   * Whether the host mounted a settings service this plugin can write through.
   * Decided once, inside the `settings` inject. The maximum-context getter
   * answers `undefined` while this is false, and a status document without the
   * field is what keeps the card from rendering a checkbox that could not be
   * saved.
   */
  let settingsAvailable = false
  /**
   * Point a variant at an account identity, invalidating whatever the previous
   * one left behind.
   *
   * One helper for all four transitions (sweep sign-in, sweep sign-out, manual
   * refresh, manual refresh sign-out) because each of them used to do its own
   * partial version, and the manual path forgot pieces the sweep did. Every
   * transition bumps {@link VariantRuntime.catalogGeneration}, which is what
   * makes an in-flight request from before the change refuse to write back.
   *
   * Probe observations are kept across an account change: the store nests them
   * per account, so the departing account's records simply stop being served
   * (every read is account-scoped) and are found intact if that account
   * returns. The "signed out, then in as someone else" sequence that used to
   * look like a first sighting is still safe — a record only ever answers for
   * the account stamped on it, so the new account inherits nothing. Visibility
   * preferences are kept for the same reason, and read through the new
   * account's key immediately: the picker re-lists after the invalidate below
   * and a returning account finds its own hidden list back in force.
   *
   * @param identity - the account now in effect, or `undefined` when signed out.
   * @param account - the visibility key for that same credential (`undefined`
   * also when the credential carries no uid); stored alongside the identity so
   * preference reads never guess it from the identity string.
   */
  const adoptIdentity = (runtime: VariantRuntime, identity: string | undefined, account: string | undefined): void => {
    const id = runtime.variant.id
    const known = lastIdentities.get(id)
    if (known === identity) return
    const hadCredential = known !== undefined
    if (identity === undefined) lastIdentities.delete(id)
    else lastIdentities.set(id, identity)
    if (account === undefined) lastAccounts.delete(id)
    else lastAccounts.set(id, account)
    // Any change of identity invalidates in-flight work and the catalog it was
    // serving; recorded probe answers stay on disk, keyed by account and
    // re-judged on every read.
    runtime.catalogGeneration += 1
    runtime.inflightFetch?.controller.abort()
    runtime.inflightFetch = undefined
    if (hadCredential && known !== identity) {
      runtime.invalidate()
    }
    if (identity === undefined) {
      // Signed out: hide the group, and drop the models so they are not left
      // registered-but-invisible if visibility ever flips back. The signed-out
      // account's saved catalog is forgotten as well — it is that account's
      // data, and it is keyed by identity so nothing else can serve it, but
      // keeping it would only be useful if that same account returned, and the
      // file is not a place to accumulate departed accounts' catalogs.
      if (known !== undefined) runtime.savedCatalogs.delete(known)
      runtime.catalog.set(runtime.fallback)
      runtime.catalogSource = 'fallback'
      runtime.catalogFetchedAtMs = undefined
      runtime.catalogError = undefined
      if (runtime.catalog.setVisible(false)) runtime.invalidate()
      return
    }
    // Serve this account's best-known catalog until a fetch lands. The saved
    // catalog is preferred over the built-in roster: the roster is a snapshot
    // taken once, while the saved one is what this account (from this source)
    // was actually served. This covers both a switch and a restart — on a
    // restart `hadCredential` is false, and the saved catalog is exactly what
    // stops the group from falling back to the compiled-in list.
    const saved = runtime.savedCatalogs.get(identity)
    if (saved !== undefined) {
      runtime.catalog.set([...saved.models])
      runtime.catalogSource = 'saved'
      runtime.catalogFetchedAtMs = saved.fetchedAtMs
    } else {
      runtime.catalog.set(runtime.fallback)
      runtime.catalogSource = 'fallback'
      runtime.catalogFetchedAtMs = undefined
    }
    runtime.catalogError = undefined
    runtime.catalog.setVisible(true)
    runtime.invalidate()
  }

  ctx.inject(['webServer'], webCtx => {
    for (const runtime of runtimes) {
      registerWorkBuddyStatusRoute(webCtx, {
        path: runtime.variant.statusPath,
        accounts: runtime.accounts,
        client: runtime.client,
        models: () => runtime.catalog.current(),
        resolveContextWindow: (modelId, declared) => runtime.contextPreference.resolve(modelId, declared),
        catalog: () => catalogSection(runtime),
        probe: () => probeSection(runtime, current().probeConsent === true),
        // The card's display preference rides the status document so the sidebar
        // knows how to draw itself before anything else on the page can tell it
        // what the setting says.
        sidebarCreditStyle: () => current().sidebarCreditStyle === 'usage' ? 'usage' : 'remaining',
        // The card may be switched off entirely. Read straight off the live
        // config, so the next status read after the write already reflects it and
        // the sidebar can be told to drop the card without a reload. `!== false`
        // rather than a truthiness test: an untouched config field resolves to
        // the schema default, and a hand-edited `settings.yaml` missing the key
        // must still mean "present" — the opposite reading would empty the
        // sidebar of anyone whose file predates the field.
        sidebarCreditVisible: () => current().sidebarCreditVisible !== false,
        emptyReason: () => desktopReadError.get(runtime.variant.id),
        store: runtime.store,
        probeKey,
        // The full per-account hidden list — stale ids included — so the card's
        // checkboxes answer exactly what the picker filter reads. Absent (and
        // the card renders no controls) when no uid-keyed account is in effect.
        visibility: () => {
          const account = runtime.account()
          if (account === undefined) return undefined
          const allowlist = runtime.visibilityStore.allowlist(account)
          return {
            account,
            disabled: runtime.visibilityStore.disabled(account),
            // Omitted rather than an empty array: absent is the "no filter"
            // state, which is what the page renders the checkbox for.
            ...allowlist === undefined ? {} : { allowlist },
          }
        },
        ...runtime.variant.id === CN_VARIANT.id ? {} : {
          // Presence of this field in the document is the card's capability
          // signal, so the getter answers `undefined` — not merely `false` —
          // on a host that cannot persist the preference. See
          // {@link legacySettingsAvailable}.
          useMaximumContextWindow: () => settingsAvailable
            ? current().useMaximumContextWindow === true
            : undefined,
        },
      })
      registerWorkBuddyAccountRoute(webCtx, {
        path: runtime.variant.accountPath,
        handle: async action => {
          const result = await handleAccountAction(runtime, action)
          // A pool change can add, remove, or re-enable the account the catalog
          // and probes run as, so the next sweep is not the right moment to
          // notice — the group has to appear or disappear now.
          if (action.action !== 'poll' && action.action !== 'add' && action.action !== 'cancel') {
            await syncVariant(runtime)
          }
          return result
        },
      }, probeKey)
      registerWorkBuddyProbeRoute(webCtx, {
        path: runtime.variant.probePath,
        probe: async modelId => {
          // The authenticated manual endpoint is called only after per-model confirmation.
          const result = await runtime.probeService.probe(modelId, true)
          if (result.state === 'ok') runtime.invalidate()
          return result
        },
        clear: () => { runtime.probeStore.clear(); runtime.invalidate() },
        refresh: async () => {
          if (stopped) return { state: 'failed', reason: 'plugin is stopping' }
          // Re-read the credential first: the user pressed this because the list
          // looks wrong, and a sign-in that happened since the last sweep is the
          // common cause. Re-registering is unnecessary — visibility is what
          // changes, and the sweep owns that.
          let credential
          try {
            // Capture the desktop app's current sign-in first: the user pressed
            // refresh because the list looks wrong, and a sign-in that happened
            // since the last sweep is the common cause.
            await runtime.accounts.captureDesktop()
            credential = await runtime.accounts.primaryCredential()
          } catch (error: unknown) {
            // A refused credential (wrong region, unreadable file) is a report,
            // not a crash out of the route.
            return {
              state: 'failed',
              reason: error instanceof Error ? error.message.slice(0, 300) : String(error),
            }
          }
          if (credential === undefined) {
            adoptIdentity(runtime, undefined, undefined)
            return { state: 'signed-out' }
          }
          const identity = credentialAccountId(credential)
          // Same transition the sweep performs: a switch reached through the
          // manual path must drop the previous account's data *now*, not when
          // the fetch lands, or a failed fetch leaves those models pickable.
          adoptIdentity(runtime, identity, visibilityAccountOf(credential))
          await fetchCatalog(runtime, identity)
          return runtime.catalogError === undefined
            ? { state: 'refreshed', reason: `${runtime.catalog.current().length} models` }
            : { state: 'failed', reason: runtime.catalogError }
        },
        ...runtime.variant.id === CN_VARIANT.id ? {} : {
          setMaximumContextWindow: async enabled => {
            if (setMaximumContextWindow === undefined) return { state: 'failed', reason: 'settings are unavailable' }
            return setMaximumContextWindow(enabled)
          },
        },
        // On BOTH variants, unlike the maximum-window preference: the sidebar
        // style is one plugin-wide setting shown by both products' cards, so
        // either route may carry the write.
        setSidebarCreditStyle: async style => {
          if (setSidebarCreditStyle === undefined) return { state: 'failed', reason: 'settings are unavailable' }
          const result = await setSidebarCreditStyle(style)
          // The card redraws from a status read, so the change has to be visible
          // to the next one without waiting for a sweep.
          if (result.state === 'updated') ctx.emit('llm/adapters-updated')
          return result
        },
        // Also on BOTH variants, and for a stronger reason than the style: this
        // one can remove the card altogether, and the card is what tells the
        // browser the setting exists. Whichever route the settings page reached
        // first has to be able to carry the write.
        setSidebarCreditVisible: async visible => {
          if (setSidebarCreditVisible === undefined) return { state: 'failed', reason: 'settings are unavailable' }
          const result = await setSidebarCreditVisible(visible)
          // Same reason as the style: the sidebar draws itself from a status
          // read, so an immediate nudge is what makes the card leave the column
          // as the switch is flipped rather than on its next minute tick.
          if (result.state === 'updated') ctx.emit('llm/adapters-updated')
          return result
        },
        // The sign-in link is not about this variant: both products' cards share
        // one dialog layout, and the page hands this route whatever link the
        // host minted. Opening it is the host's job because only the host can
        // ask the operating system — see the module for why the page cannot.
        openExternal: url => openWorkBuddyLink(url),
        setModelVisibility: async (modelId, visible, expectedAccount) => {
          // Refused rather than bucketed: a signed-out variant, or a
          // credential with no uid, has no account to key the preference by,
          // and writing it anywhere else would let one account's hidden list
          // answer for another.
          const account = runtime.account()
          if (account === undefined) {
            return { state: 'failed', reason: 'model visibility needs a signed-in account with a stable user id' }
          }
          // Expected-account guard: the card names the account its checkboxes
          // were rendered from. A card still showing account A while the
          // desktop has already switched to B must not land A's toggle in B's
          // bucket — refuse, and the card refreshes into B's own section.
          if (expectedAccount !== account) {
            return { state: 'stale-account', reason: 'the signed-in account changed' }
          }
          try {
            runtime.visibilityStore.setVisible(account, modelId, visible)
          } catch (error: unknown) {
            // A toggle that did not persist must not be reported as saved.
            return { state: 'failed', reason: error instanceof Error ? error.message.slice(0, 300) : String(error) }
          }
          runtime.invalidate()
          return { state: 'updated' }
        },
        setModelAllowlist: async (ids, expectedAccount) => {
          const account = runtime.account()
          if (account === undefined) {
            return { state: 'failed', reason: 'model visibility needs a signed-in account with a stable user id' }
          }
          // The same expected-account guard as the per-model write, for the same
          // reason: an allowlist sent from a card rendering account A must not
          // land in B's bucket after the desktop switched accounts.
          if (expectedAccount !== account) {
            return { state: 'stale-account', reason: 'the signed-in account changed' }
          }
          try {
            runtime.visibilityStore.setAllowlist(account, ids)
          } catch (error: unknown) {
            return { state: 'failed', reason: error instanceof Error ? error.message.slice(0, 300) : String(error) }
          }
          // The adapter resolves hidden ids through the store on every read, so
          // the picker follows the filter — but only after the provider snapshot
          // is rebuilt, which is what `invalidate` does.
          runtime.invalidate()
          return { state: 'updated' }
        },
        // Any variant's key opens the link: the action is not variant-scoped,
        // and the page may be rendering product A while B is the one signed in.
        // Compared the same constant-time way the handler compares a bare key.
      }, (presented: string | undefined) => keyMatches(probeKey, presented))
    }
  })


  // Settings, on the one generation this build targets.
  //
  // DSH 0.1.7 replaced the provider-service section API (`installSection`,
  // `update`, `get`) with schema-derived profile Config forms: a plugin's
  // composition entry IS its settings namespace, its `Config` schema is the
  // form, and a write through `settings.update`/`mutate` commits into the
  // marked `volatile` fields IN PLACE — no fiber remount — then dispatches
  // `loader/volatile-update` to the owning fiber.
  //
  // Two consequences shape this block:
  //
  // 1. **No section install.** The fields are already served: the plugin row in
  //    `cordis.patch.yml` carries this plugin's `Config`, so `describe()`
  //    projects it and the native configuration editor writes it. What the host
  //    still needs is the `auto: false` policy, which declares that this plugin
  //    ships its own pages and the host must not synthesize a second one.
  //    The per-variant split \u2014 two namespaces (`workbuddy` / `workbuddy-ai`),
  //    each owning only its own fields \u2014 existed to keep one card's form from
  //    editing the other's path; on 0.1.7 there is one entry, so both cards read
  //    the same document and the split is gone.
  // 2. **Facts frozen at assembly must be re-applied on a write.** The catalog's
  //    maximum-window flag and each credential store's desktop path are decided
  //    once, when the runtime is built, so they are re-derived from `current()`
  //    on every volatile update \u2014 which is what makes a saved preference reach
  //    the very next request instead of the next restart.
  ctx.inject(['settings'], settingsCtx => {
    const forms = settingsCtx.settings as SettingsServiceSeam
    if (typeof forms.configure !== 'function') {
      ctx.logger.warn('dsh-workbuddy-connect: host settings service has no configure API; the store-backed preferences are read-only')
      return
    }
    const configure = forms.configure.bind(forms)
    ctx.effect(() => configure({ auto: false }, ctx.fiber), 'dsh-workbuddy-connect: settings page policy')
    settingsAvailable = true

    // A settings write commits in place and notifies the owning fiber. Every
    // fact that is NOT re-derived from `current()` on each use is re-applied
    // here: the AI catalog's maximum-window flag (a stored flag, not a
    // read-through) and each store's desktop path (frozen when the runtime was
    // assembled).
    ctx.on('loader/volatile-update', () => {
      const next = current()
      applyMaximumContextWindow(next)
      for (const runtime of runtimes) {
        runtime.store.setDesktopPath(configuredAuthFile(next, runtime.variant))
      }
    })

    // A form write is addressed by the PROFILE ENTRY id \u2014 the Loader row's own
    // name, declared as `llm-workbuddy` in `cordis.patch.yml` \u2014 not by the
    // namespaces the old sections used. The live id is read back from the
    // service so a profile that renamed the row still writes to the right one;
    // the declared constant is only the fallback. A host whose entry cannot be
    // found refuses the write rather than reporting a success that did not
    // happen.
    const entryId = (): string | undefined => {
      // `configEditor` belongs to the host, not to a package this bundle may
      // depend on, so it is read reflectively and typed by the one field the
      // lookup needs.
      const editor = settingsCtx.get('configEditor') as {
        entries(): readonly { fiber?: unknown, options: { id: string } }[]
      } | undefined
      const mine = editor?.entries().find(entry => entry.fiber === ctx.fiber)
      return mine?.options.id
    }
    setMaximumContextWindow = async enabled => {
      if (forms.update === undefined) {
        return { state: 'failed', reason: 'this host does not accept settings writes' }
      }
      try {
        await forms.update(entryId() ?? PROFILE_ENTRY_ID, { useMaximumContextWindow: enabled })
      } catch (error: unknown) {
        return { state: 'failed', reason: error instanceof Error ? error.message.slice(0, 300) : String(error) }
      }
      return { state: 'updated' }
    }
    // The sidebar style is the same kind of write: a config field the next status
    // read reflects, which is what redraws the card without a reload.
    setSidebarCreditStyle = async style => {
      if (forms.update === undefined) {
        return { state: 'failed', reason: 'this host does not accept settings writes' }
      }
      if (!isWorkBuddySidebarCreditStyle(style)) {
        return { state: 'failed', reason: 'unknown sidebar credit style' }
      }
      try {
        await forms.update(entryId() ?? PROFILE_ENTRY_ID, { sidebarCreditStyle: style })
      } catch (error: unknown) {
        return { state: 'failed', reason: error instanceof Error ? error.message.slice(0, 300) : String(error) }
      }
      return { state: 'updated' }
    }
    // Same write, one field over: whether the sidebar carries the card at all.
    // No client-side validation to do — a boolean from the wire is already the
    // whole value domain, and the route refused anything that was not one.
    setSidebarCreditVisible = async visible => {
      if (forms.update === undefined) {
        return { state: 'failed', reason: 'this host does not accept settings writes' }
      }
      try {
        await forms.update(entryId() ?? PROFILE_ENTRY_ID, { sidebarCreditVisible: visible })
      } catch (error: unknown) {
        return { state: 'failed', reason: error instanceof Error ? error.message.slice(0, 300) : String(error) }
      }
      return { state: 'updated' }
    }
  })

  /**
   * Push the maximum-window preference into the AI catalog.
   *
   * The catalog keeps it as a flag, so this is the only path by which a saved
   * choice reaches a request \u2014 at startup and again on every settings write.
   */
  function applyMaximumContextWindow(next: Config): void {
    const runtime = runtimes.find(candidate => candidate.variant.id !== CN_VARIANT.id)
    if (runtime?.catalog.setUseMaximumContextWindow(next.useMaximumContextWindow === true)) {
      runtime.invalidate()
    }
  }

  ctx.effect(() => () => {
    stopped = true
    for (const timer of timers) clearInterval(timer)
    timers.length = 0
    void clearHostHeartbeat()
  })

  /**
   * Execute one account-pool action from the card.
   *
   * Everything credential-shaped happens here, host-side: the browser sends a
   * verb and an id, never a token, and the QR flow's state is the only opaque
   * value that travels in either direction.
   */
  const handleAccountAction = async (
    runtime: VariantRuntime,
    action: WorkBuddyAccountAction,
  ): Promise<WorkBuddyAccountResult> => {
    const { pool, accounts, qr, client } = runtime
    switch (action.action) {
      case 'add': {
        const challenge = await qr.start()
        return {
          state: 'ok',
          challenge: { state: challenge.state, authUrl: challenge.authUrl, expiresAtMs: challenge.expiresAtMs },
        }
      }
      case 'add-cookie': {
        // Everything about the token is decided here, host-side: the browser
        // posts it and receives a description of the account, never the token.
        const added = accounts.addCookieAccount(action.token)
        if (added.account === undefined) {
          return { state: 'failed', reason: added.reason ?? 'the token was refused' }
        }
        return {
          state: 'added',
          name: added.account.label ?? added.account.nickname ?? added.account.uid.slice(0, 8),
          created: added.created === true,
          ...added.created === true ? {} : { reason: 'already in the pool; its token was replaced' },
        }
      }
      case 'context': {
        // Refused unless the upstream actually offers that length: accepting an
        // arbitrary number would let a stale card widen a window the model does
        // not have, and the request would fail upstream with no explanation.
        const model = runtime.catalog.current().find(entry => entry.id === action.model)
        if (model === undefined) return { state: 'failed', reason: 'no such model' }
        const declared = model.supportedContextWindows ?? []
        if (!declared.includes(action.length)) {
          return { state: 'failed', reason: 'that model does not offer that context length' }
        }
        runtime.contextPreference.set(action.model, action.length)
        // The window is part of the model descriptor, so the provider's snapshot
        // has to be rebuilt before the next request sees the new ceiling.
        runtime.invalidate?.()
        return { state: 'ok' }
      }
      case 'cancel': {
        qr.cancel(action.state)
        return { state: 'ok' }
      }
      case 'poll': {
        let poll: Awaited<ReturnType<WorkBuddyQrLogin['poll']>>
        try {
          poll = await qr.poll(action.state)
        } catch (error: unknown) {
          // A wrong-region scan is a user-fixable mistake, not a crash.
          return { state: 'failed', reason: error instanceof Error ? error.message.slice(0, 300) : String(error) }
        }
        if (poll.status !== 'ready') return { state: poll.status }
        const added = accounts.addQrAccount(poll)
        // Adding an account can make an empty pool non-empty, which is what
        // reveals the model group; the caller's sync handles that.
        return {
          state: 'added',
          name: added.account.label ?? added.account.nickname ?? added.account.uid.slice(0, 8),
          created: added.created,
          ...added.created ? {} : { reason: 'already in the pool; its sign-in tokens were refreshed' },
        }
      }
      case 'remove': {
        if (!pool.remove(action.id)) return { state: 'failed', reason: 'no such account' }
        accounts.invalidateCredits(action.id)
        return { state: 'ok' }
      }
      case 'enable': {
        if (!pool.setEnabled(action.id, action.enabled)) return { state: 'failed', reason: 'no such account' }
        // Re-enabling is a promise that this account is usable again, so a
        // benching from before the user's decision must not keep blocking it.
        if (action.enabled) pool.clearCooldown(action.id)
        return { state: 'ok' }
      }
      case 'label': {
        if (!pool.setLabel(action.id, action.label)) return { state: 'failed', reason: 'no such account' }
        return { state: 'ok' }
      }
      case 'reorder': {
        pool.reorder(action.ids)
        return { state: 'ok' }
      }
      case 'refresh-credits': {
        for (const account of pool.list()) accounts.invalidateCredits(account.id)
        return { state: 'ok' }
      }
      case 'test': {
        const account = pool.get(action.id)
        if (account === undefined) return { state: 'failed', reason: 'no such account' }
        // A minimal streaming request, assembled host-side, so the result
        // describes what a real message would experience.
        const model = runtime.catalog.current()[0]?.id ?? 'auto'
        const result = await client.chatStream(
          credentialOf(account),
          JSON.stringify({ model, stream: true, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
          AbortSignal.timeout(30_000),
        )
        if (result.ok) {
          // Read the first bytes and hang up: the probe wants the acceptance
          // signal, not an answer.
          const body = result.response.body
          if (body !== null) {
            const reader = body.getReader()
            try {
              const first = await reader.read()
              if (first.done) return { state: 'ok', test: { ok: false, message: '上游没有返回任何数据' } }
              return { state: 'ok', test: { ok: true, message: '连通正常' } }
            } catch (error: unknown) {
              return { state: 'ok', test: { ok: false, message: `读取流失败: ${String(error)}` } }
            } finally {
              await reader.cancel().catch(() => {})
            }
          }
          return { state: 'ok', test: { ok: true, message: '连通正常' } }
        }
        return { state: 'ok', test: { ok: false, message: `上游返回 ${result.kind} (http ${result.status}): ${result.message.slice(0, 200)}` } }
      }
    }
  }

  /**
   * Fetch one variant's catalog for the current credential.
   *
   * Shared by the credential sweep and the card's manual refresh, and written
   * so that concurrent callers cost one request and cannot interleave badly:
   *
   * - **One request at a time.** A second caller joins the in-flight fetch
   *   instead of starting its own (spec §5: one catalog request per variant at
   *   a time).
   * - **Generation-checked write-back.** The request records the generation it
   *   started under and writes nothing if the generation moved on — which is
   *   what a slow answer from a superseded account must not do. Checking only
   *   the *identity* was not enough: two refreshes for the same account can
   *   still finish out of order, and the older one would win.
   * - **`primaryCredential()`, not a raw pool read.** The primary resolver is
   *   the one path that renews a token that is at or near expiry, so an expired
   *   token cannot make every catalog request fail until something else happens
   *   to refresh it.
   */
  const fetchCatalog = async (runtime: VariantRuntime, identity: string): Promise<void> => {
    const inflight = runtime.inflightFetch
    const generation = runtime.catalogGeneration
    if (inflight !== undefined && inflight.identity === identity && inflight.generation === generation) {
      return inflight.promise
    }
    // A caller should normally reach this only after `adoptIdentity()` has
    // already cancelled a previous generation. Keep this guard local as well:
    // no stale request may prevent the current account from fetching now.
    inflight?.controller.abort()
    const controller = new AbortController()
    let run: Promise<void>
    run = (async (): Promise<void> => {
      let models: readonly WorkBuddyModelInfo[]
      try {
        const credential = await runtime.accounts.primaryCredential()
        if (credential === undefined) {
          // The pool emptied between the caller's read and this one.
          adoptIdentity(runtime, undefined, undefined)
          return
        }
        const resolvedIdentity = credentialAccountId(credential)
        // `syncVariant` established the identity that owns this fetch, but the
        // primary is resolved again here (and may have just been refreshed).
        // The desktop app can also switch accounts between those reads; never
        // send or persist B's directory as A's.
        if (resolvedIdentity !== identity) {
          adoptIdentity(runtime, resolvedIdentity, visibilityAccountOf(credential))
          await fetchCatalog(runtime, resolvedIdentity)
          return
        }
        models = await runtime.client.fetchModels(credential, controller.signal)
        // The primary can also change while the upstream request is in flight
        // (a cooldown, a removal, a desktop switch). Re-read before publishing
        // so the just-finished document still belongs to the account in effect.
        const latest = await runtime.accounts.primaryCredential()
        const latestIdentity = latest === undefined ? undefined : credentialAccountId(latest)
        if (latestIdentity !== identity) {
          adoptIdentity(runtime, latestIdentity, latest === undefined ? undefined : visibilityAccountOf(latest))
          if (latestIdentity !== undefined) await fetchCatalog(runtime, latestIdentity)
          return
        }
      } catch (error: unknown) {
        // Report only if this attempt is still the current one; a failure from
        // a superseded attempt must not overwrite the newer state's error.
        if (stopped || runtime.catalogGeneration !== generation) return
        runtime.lastFetchAtMs = Date.now()
        runtime.catalogError = error instanceof Error ? error.message.slice(0, 300) : String(error)
        ctx.logger.warn(
          `dsh-workbuddy-connect: ${runtime.variant.displayName} catalog unavailable; serving the fallback list`,
          error,
        )
        runtime.invalidate()
        return
      }
      if (stopped || runtime.catalogGeneration !== generation) return
      runtime.lastFetchAtMs = Date.now()
      runtime.catalog.set([...models])
      runtime.catalogSource = 'live'
      runtime.catalogFetchedAtMs = runtime.client.lastCatalog?.fetchedAtMs ?? Date.now()
      runtime.catalogError = undefined
      // Remember it for this account, so a restart — or a later fetch that
      // fails — can serve what this account was actually shown rather than the
      // snapshot compiled into the plugin.
      if (lastIdentities.get(runtime.variant.id) === identity) {
        runtime.savedCatalogs.set(identity, {
          source: runtime.client.lastCatalog?.source ?? 'unknown',
          fetchedAtMs: runtime.client.lastCatalog?.fetchedAtMs ?? Date.now(),
          models: [...models],
          ...runtime.client.lastCatalog?.appVersion === undefined
            ? {}
            : { appVersion: runtime.client.lastCatalog.appVersion.version },
        })
      }
      runtime.invalidate()
    })().finally(() => {
      if (runtime.inflightFetch?.promise === run) runtime.inflightFetch = undefined
    })
    runtime.inflightFetch = { identity, generation, controller, promise: run }
    return run
  }

  /**
   * Reconcile one variant with its account pool.
   *
   * Two things happen on every sweep, in this order:
   *
   * 1. **Capture the desktop app's sign-in**, if it is signed in. This is what
   *    makes the desktop account an ordinary long-lived pool member: the pool
   *    is the only thing that decides what the plugin may serve as, and signing
   *    out of the app simply stops *adding* to it.
   * 2. **Reconcile the primary**, which is the identity the catalog is fetched
   *    for and the one the card's headline figures describe.
   *
   * Four transitions matter, and each is a different action:
   *
   * - **none → some** (first account): reveal the group and fetch a catalog.
   * - **none → some, identity changed**: additionally drop the previous
   *   account's observations, so another user's probe answers cannot be read as
   *   the new account's.
   * - **some → none**: hide the group and stop serving its models. With the
   *   pool, this means the pool is *empty* — the desktop app signing out no
   *   longer hides anything.
   * - **same identity**: nothing to do — the pool refreshes tokens on demand,
   *   and re-fetching on every rotation would hit the catalog endpoint for no
   *   new information.
   */
  const syncVariant = async (runtime: VariantRuntime): Promise<void> => {
    if (stopped || !runtime.registered) return
    await runtime.accounts.captureDesktop().then(
      () => { desktopReadError.delete(runtime.variant.id) },
      (error: unknown) => {
        // A region mismatch or an unreadable file is reported, not swallowed as
        // "signed out": the user needs to know which file to fix.
        desktopReadError.set(
          runtime.variant.id,
          error instanceof Error ? error.message.slice(0, 300) : String(error),
        )
        ctx.logger.warn(`dsh-workbuddy-connect: ${runtime.variant.displayName} credential read failed`, error)
      },
    )
    if (stopped) return
    // `primaryCredential` re-reads the desktop identity, so a file that was
    // just refused is refused again here. That is deliberate (the pool must
    // never adopt it), but the *sweep* must not turn a diagnosable refusal into
    // an unhandled rejection: the reason was recorded above and the variant
    // simply has no primary. The card reports the reason.
    const credential = await runtime.accounts.primaryCredential().catch((error: unknown) => {
      ctx.logger.warn(`dsh-workbuddy-connect: ${runtime.variant.displayName} account resolution failed`, error)
      return undefined
    })

    if (credential === undefined) {
      adoptIdentity(runtime, undefined, undefined)
      return
    }

    const identity = credentialAccountId(credential)
    const known = lastIdentities.get(runtime.variant.id)
    if (known === identity && runtime.catalog.isVisible()) {
      // Same account, already showing something. One case still needs a fetch:
      // an earlier attempt failed, so the group is on the fallback roster and
      // nothing else will ever replace it. Retry on a slow backoff rather than
      // every sweep, so a persistent outage does not become a request loop.
      // Any non-live source is stale: both the saved catalog and the built-in
      // roster are worth replacing with a fresh fetch on the same backoff.
      const stale = runtime.catalogSource !== 'live'
      const due = Date.now() - runtime.lastFetchAtMs >= credentialPollMs() * CATALOG_RETRY_SWEEPS
      if (stale && due) await fetchCatalog(runtime, identity)
      return
    }

    adoptIdentity(runtime, identity, visibilityAccountOf(credential))
    await fetchCatalog(runtime, identity)
  }

  /** Run one reconcile sweep across both variants. */
  const syncAll = async (): Promise<void> => {
    for (const runtime of runtimes) await syncVariant(runtime)
  }

  void Promise.all(runtimes.map(async runtime => startVariant(ctx, runtime))).then(() => {
    if (stopped) return
    // The host bundle is live: write a heartbeat so the status CLI can report
    // host health without a browser. Cleared on disposal; a stale heartbeat
    // after a crash is detected by PID in the reader. Written when at least one
    // variant registered, since that is what "the host bundle serves models"
    // means for this plugin.
    if (runtimes.some(runtime => runtime.registered)) void writeHostHeartbeat()

    void syncAll()
    const timer = setInterval(() => { void syncAll() }, credentialPollMs())
    timer.unref?.()
    timers.push(timer)
  })
}
