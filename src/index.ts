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
import { WorkBuddyCredentialStore } from './auth.ts'
import { WorkBuddyAccountPool, credentialAccountId, credentialOf } from './account-pool.ts'
import { WorkBuddyAccountService } from './account-service.ts'
import { registerWorkBuddyAccountRoute } from './account-route.ts'
import { WorkBuddyQrLogin } from './qr-login.ts'
import { WorkBuddyRotation } from './rotation.ts'
import { FALLBACK_WORKBUDDY_AI_MODELS, FALLBACK_WORKBUDDY_MODELS, WorkBuddyCatalog } from './catalog.ts'
import { workbuddyCatalogPath, WorkBuddyCatalogStore } from './catalog-store.ts'
import { createWorkBuddyAdapter } from './adapter.ts'
import { createWorkBuddyShim } from './shim.ts'
import { WorkBuddyProbeService } from './probe-service.ts'
import { newestFirst, WorkBuddyProbeStore, workbuddyProbePath } from './probe-store.ts'
import { WorkBuddyUpstreamClient } from './upstream.ts'
import { registerWorkBuddyStatusRoute } from './web-status.ts'
import { createProbeKey, registerWorkBuddyProbeRoute } from './probe-route.ts'
import type { WorkBuddyModelInfo } from './catalog.ts'
import type { WorkBuddyWebCatalog, WorkBuddyWebProbeSection } from './status-paths.ts'
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
export const WORKBUDDY_SETTINGS_NS = 'workbuddy' as SettingsNamespace

/**
 * Settings namespace owning the international card's section.
 *
 * One namespace per card, not one shared: the settings Plugins tab dispatches a
 * card by rendering `settings.plugin.item` with `entryKey = ns` for each
 * namespace the Host serves, and skips an entry whose key names no served
 * namespace. With a single installed section, the international card registers
 * into the slot but is never rendered — the card list is built from the Host's
 * sections, not from the slot's entries. Each card therefore needs its own
 * installed section whose namespace equals the card's slot key.
 */
export const WORKBUDDY_AI_SETTINGS_NS = 'workbuddy-ai' as SettingsNamespace

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
  /**
   * Whether the floating account window is drawn in the conversation. On by
   * default: it is the only place the pool's state is visible while chatting,
   * which is exactly when a rotation matters.
   */
  floatingAccounts?: boolean
}

/** Explicit CN desktop auth-file path (shared by the plugin schema and its section). */
const AUTH_FILE_FIELD = z.string().description('WorkBuddy desktop auth file (defaults to the app\'s own location)')
/** Explicit international desktop auth-file path (shared by the plugin schema and its section). */
const AUTH_FILE_AI_FIELD = z.string().description('WorkBuddy AI desktop auth file (defaults to the app\'s own location)')
/** Probe authorization (shared by the plugin schema and the CN section). */
const PROBE_CONSENT_FIELD = z.boolean().default(false)
  .description('Authorize reasoning-effort probes (each probe sends real requests that may consume credit)')
/** Floating account window visibility (shared by the plugin schema and both sections). */
const FLOATING_ACCOUNTS_FIELD = z.boolean().default(true)
  .description('Show the floating account window (names, remaining credit, and when a limited account will be retried)')

export const Config: z<Config> = z.object({
  authFile: AUTH_FILE_FIELD,
  authFileAI: AUTH_FILE_AI_FIELD,
  probeConsent: PROBE_CONSENT_FIELD,
  floatingAccounts: FLOATING_ACCOUNTS_FIELD,
})

/**
 * The CN card's settings section: only the fields that card edits.
 *
 * A section is what makes its namespace "served", which is what the Plugins
 * tab dispatches a card by — so the schema and the card must stay split the
 * same way. `probeConsent` lives here because it predates the second variant;
 * it gates no current code path (only manual, per-click-confirmed probes run),
 * so it is left where existing users set it rather than moved and re-asked.
 */
const CN_SECTION: z<Config> = z.object({
  authFile: AUTH_FILE_FIELD,
  probeConsent: PROBE_CONSENT_FIELD,
  floatingAccounts: FLOATING_ACCOUNTS_FIELD,
})

/** The international card's settings section: only its own auth-file path. */
const AI_SECTION: z<Config> = z.object({
  authFileAI: AUTH_FILE_AI_FIELD,
  floatingAccounts: FLOATING_ACCOUNTS_FIELD,
})

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

/** Read the configured explicit auth-file path for one variant. */
function configuredAuthFile(config: Config, variant: WorkBuddyVariant): string | undefined {
  return variant.id === CN_VARIANT.id ? config.authFile : config.authFileAI
}

/** The settings namespace a variant's card and provider directory entry use. */
function settingsNamespaceFor(variant: WorkBuddyVariant): SettingsNamespace {
  return variant.id === CN_VARIANT.id ? WORKBUDDY_SETTINGS_NS : WORKBUDDY_AI_SETTINGS_NS
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
): VariantRuntime {
  const client = new WorkBuddyUpstreamClient()
  const configured = configuredAuthFile(config, variant)
  const store = new WorkBuddyCredentialStore({
    variant,
    ...configured === undefined ? {} : { desktopPath: configured },
    refresh: credential => client.refreshToken(credential),
  })
  const pool = new WorkBuddyAccountPool({ variant })
  const qr = new WorkBuddyQrLogin({ variant })
  const accounts = new WorkBuddyAccountService({ variant, pool, store, client, qr })
  const fallback = fallbackFor(variant)
  const catalog = new WorkBuddyCatalog(fallback)
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
    qr,
    probeStore,
    probeService,
    savedCatalogs,
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
  const rotation = new WorkBuddyRotation({ pool, client, logger: ctx.logger })
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

  let invalidate: (() => void) | undefined
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
    })
    invalidate = workbuddy.invalidate
    runtime.invalidate = () => {
      workbuddy.invalidate()
      ctx.emit('llm/adapters-updated')
    }

    let releaseAdapter: (() => void) | undefined
    let releaseDirectory: (() => void) | undefined
    try {
      releaseAdapter = ctx.llm.registerAdapter([variant.id], workbuddy.adapter)
      releaseDirectory = ctx.llm.registerConfigurableProviders([{
        provider: variant.id,
        displayName: variant.displayName,
        // Each variant's directory entry joins its own installed section; the
        // Models settings page resolves `settingsNs` against the served
        // namespaces, so a shared ns would render both providers onto one card.
        settingsNs: settingsNamespaceFor(variant),
        settingsPath: [],
        declared: false,
      }])
    } finally {
      if (releaseAdapter === undefined || releaseDirectory === undefined) {
        // Registration threw; release whichever half landed.
        releaseAdapter?.()
        releaseDirectory?.()
      }
    }
    try {
      ctx.effect(() => () => {
        releaseAdapter?.()
        releaseDirectory?.()
        void shim.close()
      })
    } catch {
      // The plugin was disposed during registration; release immediately — the
      // plugin-level disposer already closed every shim.
      releaseAdapter?.()
      releaseDirectory?.()
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
  let current = (): Config => config

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

  const runtimes = WORKBUDDY_VARIANTS.map(variant => createVariantRuntime(
    config,
    variant,
    () => current(),
    id => lastIdentities.get(id),
  ))

  // Same-origin routes backing each Plugin-configuration card; the webServer
  // service is optional (a headless profile serves no browser).
  const probeKey = createProbeKey()
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
   * Probe observations are dropped whenever the account actually changes —
   * including sign-out, and including the "signed out, then in as someone else"
   * sequence that used to look like a first sighting and let the new account
   * inherit the old one's detected levels. They are deliberately NOT cleared on
   * a first sign-in: no previous account's data could leak there, and clearing
   * would delete records this very account owns (written before a restart, or
   * seeded while all of this is running).
   *
   * @param identity - the account now in effect, or `undefined` when signed out.
   */
  const adoptIdentity = (runtime: VariantRuntime, identity: string | undefined): void => {
    const id = runtime.variant.id
    const known = lastIdentities.get(id)
    if (known === identity) return
    const hadCredential = known !== undefined
    if (identity === undefined) lastIdentities.delete(id)
    else lastIdentities.set(id, identity)
    // Any change of identity invalidates in-flight work and recorded answers.
    runtime.catalogGeneration += 1
    runtime.inflightFetch?.controller.abort()
    runtime.inflightFetch = undefined
    if (hadCredential && known !== identity) {
      runtime.probeStore.clear()
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
        catalog: () => catalogSection(runtime),
        probe: () => probeSection(runtime, current().probeConsent === true),
        floatingWindow: () => current().floatingAccounts !== false,
        emptyReason: () => desktopReadError.get(runtime.variant.id),
        probeKey,
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
            adoptIdentity(runtime, undefined)
            return { state: 'signed-out' }
          }
          const identity = credentialAccountId(credential)
          // Same transition the sweep performs: a switch reached through the
          // manual path must drop the previous account's data *now*, not when
          // the fetch lands, or a failed fetch leaves those models pickable.
          adoptIdentity(runtime, identity)
          await fetchCatalog(runtime, identity)
          return runtime.catalogError === undefined
            ? { state: 'refreshed', reason: `${runtime.catalog.current().length} models` }
            : { state: 'failed', reason: runtime.catalogError }
        },
      }, probeKey)
    }
  })


  // Each settings section is what makes its namespace "served" — which is how
  // both the Plugins tab (card dispatch) and the Models settings page (provider
  // directory join) find this plugin's halves. One section per card, because the
  // tab renders a card by `entryKey = ns` and never interprets one: a section
  // that is not installed leaves its card registered but undispatched, and a
  // provider whose `settingsNs` names no section joins nothing.
  //
  // DSH 0.1.2 moved the helper from a free function (`installSettingsSection`)
  // onto the provider service (`settings.installSection`), so the wiring now has
  // to wait for a settings service to exist — exactly what the inject below
  // does. Without one the plugin still serves its models; it simply has no
  // user-editable sections, as before.
  ctx.inject(['settings'], settingsCtx => {
    /** Section sources; each falls back to its own slice when its side unloads. */
    const sources: { cn: () => Config, ai: () => Config } = {
      cn: () => config,
      ai: () => config,
    }
    /** Merge both sections into the whole config the rest of the plugin reads. */
    // The floating-window switch is shared by both cards but stored per
    // section; the CN section's copy wins when the two disagree, so the switch
    // always has one answer rather than a per-variant one the window would have
    // to arbitrate.
    const floating = (): boolean | undefined => sources.cn().floatingAccounts ?? sources.ai().floatingAccounts
    const merged = (): Config => ({
      ...sources.cn().authFile === undefined ? {} : { authFile: sources.cn().authFile },
      ...sources.cn().probeConsent === undefined ? {} : { probeConsent: sources.cn().probeConsent },
      ...sources.ai().authFileAI === undefined ? {} : { authFileAI: sources.ai().authFileAI },
      ...floating() === undefined ? {} : { floatingAccounts: floating() === true },
    })
    const repointStores = (): void => {
      const next = merged()
      for (const runtime of runtimes) {
        runtime.store.setDesktopPath(configuredAuthFile(next, runtime.variant))
      }
    }
    settingsCtx.settings.installSection(ctx, WORKBUDDY_SETTINGS_NS, CN_SECTION, config, {
      setSource(source) { sources.cn = source as () => Config; current = merged },
      onChange: repointStores,
    })
    settingsCtx.settings.installSection(ctx, WORKBUDDY_AI_SETTINGS_NS, AI_SECTION, config, {
      setSource(source) { sources.ai = source as () => Config; current = merged },
      onChange: repointStores,
    })
  })

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
          adoptIdentity(runtime, undefined)
          return
        }
        const resolvedIdentity = credentialAccountId(credential)
        // `syncVariant` established the identity that owns this fetch, but the
        // primary is resolved again here (and may have just been refreshed).
        // The desktop app can also switch accounts between those reads; never
        // send or persist B's directory as A's.
        if (resolvedIdentity !== identity) {
          adoptIdentity(runtime, resolvedIdentity)
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
          adoptIdentity(runtime, latestIdentity)
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
      adoptIdentity(runtime, undefined)
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

    adoptIdentity(runtime, identity)
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
