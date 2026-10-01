import z from "@deepseek-ai/schemastery";
import "@earendil-works/pi-ai";
import { PiAiAdapter, PiAiAdapterOptions } from "@deepseek-ai/dsh-llm-pi-ai";
import { IncomingMessage, ServerResponse } from "node:http";
import { Context } from "@deepseek-ai/cordis";
import { SettingsNamespace } from "@deepseek-ai/dsh-settings";
import { AttachmentStore } from "@deepseek-ai/dsh-attachment";
//#region src/app-version.d.ts
/** Basename of the saved version under `$DSH_HOME`. */
declare const WORKBUDDY_APP_VERSION_FILENAME = ".workbuddy-ai-version.json";
/** Where the version came from, for `doctor` output. */
type WorkBuddyAppVersionSource = 'installed' | 'saved' | 'fallback';
/** Resolved version plus provenance. */
interface AppVersionInfo {
  version: string;
  source: WorkBuddyAppVersionSource;
  /** Basename of the App bundle the version was read from, when installed. */
  bundle?: string;
}
/**
 * Whether a string is safe to interpolate into an HTTP header.
 *
 * Strict on purpose: the value reaches a header, so anything that could split
 * the request (CR, LF, spaces beyond the separator) or inject a second UA
 * token must never pass. The App's own version is always `N.N.N` or `N.N.N.N`.
 */
declare function validAppVersion(value: unknown): value is string;
/**
 * Read `CFBundleShortVersionString` out of an `Info.plist`.
 *
 * Parsed as XML rather than grepped, because the plist contains several
 * `<string>` values and a regex would be one unrelated key away from
 * returning the wrong one. A binary plist has no `<dict>` in its bytes and is
 * reported as unreadable (the saved value then applies) rather than guessed at.
 */
declare function readBundleVersion(plistPath: string): Promise<string | undefined>;
/**
 * The installed international App's version, or `undefined` when it is not
 * installed (or not readable).
 *
 * Windows and Linux have no verified bundle-metadata location yet, so this
 * returns `undefined` there and the saved/fallback value is used instead of
 * guessing a path — the same discipline the credential discovery follows.
 */
declare function installedAppVersion(): Promise<{
  version: string;
  bundle: string;
} | undefined>;
/** Constructor dependencies; all injectable so tests never touch the real FS. */
interface ResolveAppVersionOptions {
  /** Installed-version reader; defaults to {@link installedAppVersion}. */
  installed?: () => Promise<{
    version: string;
    bundle: string;
  } | undefined>;
  /** Saved-version path; defaults to {@link appVersionPath}. */
  path?: string;
}
/**
 * Resolve the UA version: installed App first, then the last saved value, then
 * the compiled-in fallback.
 *
 * A value read from the App is written back immediately, so an uninstalled App
 * or an unreadable plist later still has the last real version to fall back
 * on. The write is best-effort: failing to cache a version must never fail the
 * catalog request that asked for it.
 */
declare function resolveAppVersion(options?: ResolveAppVersionOptions): Promise<AppVersionInfo>;
/**
 * Build the App-shaped User-Agent for catalog requests.
 *
 * `WorkBuddyAI/<version>` with no space is the form measured to reach the App
 * document; the space form is rejected with 400/12403. Throws on an invalid
 * version rather than sending a malformed header.
 */
declare function appUserAgent(version: string): string;
//#endregion
//#region src/client-identity.d.ts
/**
 * Compiled-in CN fallback for the `WorkBuddy/<v>` tokens.
 *
 * Observed on the CN desktop app installed here (research §3.1, verified
 * 2026-09-11); like the international fallback it is a shape requirement,
 * not a currency claim — the gateway has not been observed to branch on it.
 */
declare const FALLBACK_CN_APP_VERSION = "5.5.6";
/**
 * Basename of the CN saved-version cache under `$DSH_HOME`.
 *
 * Deliberately not the international `.workbuddy-ai-version.json`: that file
 * feeds the international catalog's User-Agent, and a CN App writing its
 * version into it would relabel that request. The two caches stay isolated
 * the way the per-variant catalog files are.
 */
declare const CN_APP_VERSION_FILENAME = ".workbuddy-app-version.json";
/** The resolved identity a chat request presents as. */
interface ChatIdentity {
  /** Desktop App version; drives both `WorkBuddy/<v>` product tokens. */
  clientVersion: string;
  /** Bundled agent-CLI version; absent drops the `CLI/…` UA token. */
  cliVersion?: string;
}
/**
 * Whether a value is a CLI version that may reach a header.
 *
 * Tolerates a prerelease suffix (`2.137.1-rc.1`) because the bundled CLI's
 * own metadata uses that spelling; anything with whitespace, CR or LF never
 * passes — the value is interpolated into an HTTP header.
 */
declare function validCliVersion(value: unknown): value is string;
/**
 * The bundled agent CLI's real version, or `undefined` when it does not resolve.
 *
 * `cli/package.json` ships a `0.0.0` placeholder in `version` with the real
 * version in `publishConfig.customPackage.version`; a valid non-placeholder
 * `version` wins, otherwise the custom-package value applies, and unreadable
 * or invalid metadata yields `undefined` (the caller drops the `CLI/…` UA
 * token rather than guessing).
 */
declare function readCliVersion(bundle: string): Promise<string | undefined>;
/**
 * Build the chat User-Agent for one region.
 *
 * Throws on an invalid version rather than interpolating one into a header;
 * `resolveChatIdentity` never produces such an identity, so the throw is a
 * last gate against future call-site mistakes, not an expected path.
 */
declare function chatUserAgent(identity: ChatIdentity, region: WorkBuddyRegion): string;
/** Constructor dependencies; every reader is injectable so tests never touch a real App or home. */
interface ResolveChatIdentityOptions {
  /** Installed CN desktop-bundle reader; defaults to the macOS probe. */
  installedCn?: () => Promise<{
    version: string;
    bundle: string;
  } | undefined>;
  /** International version resolver; defaults to `app-version.ts`'s chain. */
  resolveIntl?: () => Promise<AppVersionInfo>;
  /** CLI-version reader; defaults to reading the bundle's `cli/package.json`. */
  cliVersion?: (bundle: string) => Promise<string | undefined>;
  /** CN saved-cache path; defaults to `$DSH_HOME/.workbuddy-app-version.json`. */
  cnSavedPath?: string;
}
/**
 * Resolve the chat identity for one region: installed App → region's saved
 * value → compiled-in fallback. Never throws — a missing App, an unreadable
 * plist, a failed cache write, or a reader that throws outright all degrade
 * to {@link fallbackChatIdentity}; resolution never blocks a message.
 *
 * The production path caches per region (a message must not re-read the
 * install tree); any injected option bypasses the cache entirely so tests
 * with different readers cannot observe each other's resolutions.
 */
declare function resolveChatIdentity(region: WorkBuddyRegion, options?: ResolveChatIdentityOptions): Promise<ChatIdentity>;
/**
 * The region's compiled-in fallback identity: the desktop form with the
 * built-in version and no `CLI/…` segment. This is the single degraded
 * shape every failure path converges on — a thrown reader, an unreadable
 * bundle, or a missing cache all present this, never the legacy CLI UA.
 */
declare function fallbackChatIdentity(region: WorkBuddyRegion): ChatIdentity;
//#endregion
//#region src/probe.d.ts
/**
 * The canonical values a probe tests, in a fixed order.
 *
 * `minimal` is absent: it appears in no upstream vocabulary. `off` is absent
 * by policy — disabling thinking is a separate capability the upstream must
 * declare through `canDisableThinking`, never something probing may infer.
 */
declare const PROBE_EFFORT_CANDIDATES: readonly WorkBuddyEffort[];
/** Sentinel generator; injectable so tests get deterministic values. */
type SentinelFactory = () => string;
/** Default sentinel: unmistakably non-canonical, different on every call. */
declare function randomSentinel(): string;
/**
 * One response as the probe sees it, split into the only distinctions the
 * attribution rule needs.
 */
interface ProbeAttempt {
  /** HTTP status, or 0 for a transport failure. */
  status: number;
  /** True when a parseable SSE event arrived. */
  streamed: boolean;
  /** `extError.code` from a JSON error body, when present. */
  errorCode?: string;
  /** Free-form detail for logs; never shown as a capability claim. */
  detail?: string;
}
/** How one attempt is performed; the caller owns credentials and HTTP. */
type ProbeSender = (effort: string | undefined, signal: AbortSignal) => Promise<ProbeAttempt>;
/** The outcome of probing one model. */
type ProbeOutcome = {
  validation: 'validating';
  efforts: readonly WorkBuddyEffort[];
  requests: number;
} | {
  validation: 'non-validating';
  efforts: readonly [];
  requests: number;
} | {
  validation: 'unknown';
  efforts: readonly [];
  requests: number;
  reason: string;
};
/** Which endpoint's rejection vocabulary a probe interprets. */
type ProbeRegion = 'cn' | 'global';
/**
 * Probe one model.
 *
 * `options.candidates` exists so tests can shorten the sweep; production always
 * uses {@link PROBE_EFFORT_CANDIDATES}. `options.region` selects which
 * endpoint's rejection vocabulary is read; it defaults to `cn`, which is also
 * the production default for the China app.
 */
declare function probeModel(options: {
  send: ProbeSender;
  sentinel?: SentinelFactory;
  candidates?: readonly WorkBuddyEffort[];
  timeoutMs?: number;
  region?: ProbeRegion;
}): Promise<ProbeOutcome>;
//#endregion
//#region src/upstream.d.ts
/** WorkBuddy region selected by the credential's login domain. */
type WorkBuddyRegion = 'cn' | 'global';
/** Upstream failure classes the shim maps onto distinct HTTP answers. */
type UpstreamErrorKind = 'hard_credit' | 'soft_rate' | 'session_dead' | 'not_found' | 'server' | 'client';
/** One CLI-usable model as the upstream catalog describes it. */
interface WorkBuddyUpstreamModel {
  id: string;
  name: string;
  contextWindow: number;
  /** The upstream's preferred window before an optional maximum is selected. */
  defaultContextWindow?: number;
  maxInputTokens?: number;
  supportedContextWindows?: readonly number[];
  promotions?: readonly WorkBuddyPromotion[];
  maxTokens: number;
  /**
   * Upstream-declared image input capability. Missing or false upstream data
   * resolves to false, so an unknown model stays text-only: over-claiming
   * admits an image the provider then rejects after the message is durable.
   */
  supportsImages: boolean;
  /**
   * Reasoning metadata the upstream catalog declares per model. The wire
   * effort values (`low`, `medium`, `high`, `xhigh`, `max`) map directly onto
   * pi-ai's thinking levels, and the supported set decides which levels the
   * DSH model selector offers.
   */
  reasoning?: WorkBuddyModelReasoning;
  /**
   * Billing convenience metadata: the credits multiplier string the upstream
   * reports (e.g. `"x0.00"` for free) and promotional badges like
   * `badge:限时免费:#FF0000` or `badge:夜间折扣:#1E90FF`.
   *
   * The multiplier reaches the browser through the host LLM seam, which has no
   * locale service, so {@link normalizeCredits} trims it to a
   * language-neutral display form (`x0.79`) that reads the same in every UI
   * language. The raw upstream string (which may spell `x0.79 credits`) stays
   * on {@link WorkBuddyModelBilling.credits} for diagnostics.
   */
  billing?: WorkBuddyModelBilling;
}
/** Reasoning metadata the upstream catalog declares for one model. */
interface WorkBuddyModelReasoning {
  /** Whether the model does any reasoning at all (upstream `supportsReasoning`). */
  supports: boolean;
  /** Whether the model can only think (upstream `onlyReasoning`). */
  onlyReasoning: boolean;
  /** Selectable effort values; absent means the model has no explicit set. */
  supportedEfforts?: readonly WorkBuddyEffort[];
  /** Default effort the upstream uses when none is chosen. */
  defaultEffort?: WorkBuddyEffort;
  /** Whether thinking can be switched off; false means it is always on. */
  canDisableThinking: boolean;
}
/** The concrete effort spellings WorkBuddy exposes on the wire. */
type WorkBuddyEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
/** Billing convenience metadata reported for one model. */
interface WorkBuddyModelBilling {
  /** Credits multiplier, e.g. `"x0.00"` (free) or `"x0.79"`. */
  credits?: string;
  /** Promotional tags, e.g. `"限时免费"`, `"夜间折扣"`. */
  badges?: readonly string[];
  /** Whether the model is currently free (`x0.00` credits). */
  free: boolean;
  /**
   * The rate cannot be stated for this model right now.
   *
   * Set when a row that arrived with promotions attached has no promotion in
   * force: the upstream bakes the discounted value into `credits`, so the
   * cached rate describes a discount that has ended. The original price is not
   * recoverable from the row, so the plugin reports "unknown, refresh needed"
   * rather than repeating a figure it can no longer stand behind — in
   * particular it never keeps claiming the model is free.
   */
  rateUnknown?: boolean;
}
/** One billing package and its remaining credit. */
interface WorkBuddyCreditAccount {
  packageName: string;
  remain: number;
  size: number;
  /**
   * Credits this package has consumed this cycle, when the upstream stated it.
   *
   * Carried rather than derived from `size - remain`: the two endpoints word it
   * independently (`CycleCapacityUsed` on the personal one, `used_num` on the
   * enterprise one), and a package can report a size with no used figure at all.
   * A renderer that showed a subtraction as "used" would be inventing a number
   * the upstream never sent.
   */
  used?: number;
  unlimited?: true;
}
/** Aggregated credit answer for one credential. */
interface WorkBuddyCredits {
  total: number;
  /** Summed usage across the packages that stated one, when any did. */
  used?: number;
  accounts: readonly WorkBuddyCreditAccount[];
  /**
   * The account's cycle quota is uncapped (`limitNum === -1` on the CN
   * enterprise endpoint).
   *
   * A separate flag rather than a `-1`/`0` sentinel in {@link total}: the two
   * mean opposite things to a reader ("no limit" vs "nothing left"), and the
   * existing negative-clamp in the personal branch would turn a sentinel into
   * a plausible-looking zero. Every renderer must therefore test this flag
   * first and not fall back to `total` when it is set.
   */
  unlimited?: true;
  cycleResetTime?: string;
}
/** Token refresh answer; fields the upstream omits stay absent. */
interface WorkBuddyRefreshOutcome {
  accessToken: string;
  refreshToken?: string;
  expiresInSec?: number;
  domain?: string;
}
/** Chat answer: either a live SSE response or a classified failure. */
type WorkBuddyChatResult = {
  ok: true;
  response: Response;
} | {
  ok: false;
  status: number;
  kind: UpstreamErrorKind;
  message: string;
  /**
   * The upstream's own `Retry-After`, verbatim, when it sent one.
   *
   * Carried rather than parsed here because the value's meaning is the
   * caller's business: the rotation layer prefers it over its own backoff
   * schedule, and the shim forwards it to the harness on a final failure.
   */
  retryAfter?: string;
};
/**
 * Reduce an upstream credits string to its language-neutral display form.
 *
 * The host LLM seam carries this text to the browser, and the host has no
 * locale service — whatever string is produced here is shown verbatim in every
 * UI language. The upstream is inconsistent in a way that matters: some catalog
 * rows report a bare multiplier (`x0.79`) and others append a unit word
 * (`x0.79 credits`), and the unit word would pin the display to English.
 * Dropping a trailing `credits` (case-insensitive, singular or plural) yields
 * the one spelling that reads identically in every language.
 *
 * @param credits - raw upstream credits string, e.g. `"x0.79 credits"`.
 * @returns the bare multiplier, or undefined when nothing displayable remains.
 */
declare function normalizeCredits(credits: string | undefined): string | undefined;
/**
 * Classify an upstream failure from its HTTP status and body excerpt.
 *
 * The status code is authoritative and the body markers refine it, not the
 * other way round. That ordering matters for 401: the gateway in front of the
 * upstream answers an expired or unknown bearer with an **HTML** error page
 * (`openresty`'s "401 Authorization Required"), which carries none of the
 * session markers and parses as no envelope at all. Reading the body first
 * classified the one failure rotation exists for — "this account's sign-in is
 * no longer good" — as a malformed request, which is the class that deliberately
 * does *not* switch accounts.
 */
declare function classifyUpstreamError(status: number, body: string): UpstreamErrorKind;
/** Region for a login domain; an empty domain means CN (matching upstream tooling). */
declare function regionOf(domain: string): WorkBuddyRegion;
/**
 * The chat (and login) base for a login domain.
 *
 * Exported because the QR sign-in flow needs the same answer *before* a
 * credential exists: it knows only which variant it is signing into. Sharing
 * one function is what keeps a QR sign-in from ever being pointed at the other
 * region's endpoint — the mistake that would hand a CN account's token to the
 * international gateway.
 */
declare function chatBaseForDomain(domain: string): string;
/** The chat (and login) base for a region, for callers with no credential yet. */
declare function chatBaseForRegion(region: WorkBuddyRegion): string;
/** The Origin/Referer pair the upstream expects for a region. */
declare function originForRegion(region: WorkBuddyRegion): string;
/**
 * Normalize an OpenAI chat-completions body for the WorkBuddy upstream:
 * force `stream: true` (the upstream rejects non-streaming), flatten
 * `tool_choice` (the upstream's field is a string; object forms return 400),
 * and rewrite `developer` messages as `system`.
 *
 * The `developer` rewrite is load-bearing: pi-ai emits the system prompt as
 * `role: "developer"` (the OpenAI convention it adopted), but the WorkBuddy
 * upstream rejects that role with HTTP 400 code 11128 ("Illegal API
 * invocation from an unapproved channel"). Rewriting to `system` is the
 * compatible spelling the upstream accepts.
 */
declare function prepareChatBody(source: string): string;
/** Provenance of one successful catalog fetch, surfaced by the status card. */
interface WorkBuddyCatalogFetch {
  fetchedAtMs: number;
  /** Which document answered, e.g. `workbuddy-ai:app`. */
  source: string;
  /** UA version used, when the request needed one. */
  appVersion?: AppVersionInfo;
}
/** Constructor dependencies. */
interface WorkBuddyUpstreamClientOptions {
  /** App-version resolver for international catalog requests; injectable for tests. */
  resolveAppVersion?: () => Promise<AppVersionInfo>;
  /**
   * Chat-identity resolver for chat and probe requests; injectable for tests.
   * Defaults to `client-identity.ts`'s per-region chain. Refresh, catalog, and
   * billing never consult it — those requests keep their long-standing headers.
   */
  resolveChatIdentity?: (region: WorkBuddyRegion) => Promise<ChatIdentity>;
}
/**
 * Upstream HTTP client. One instance serves the whole plugin; requests take
 * the credential explicitly so token refreshes apply on the next call.
 *
 * One instance is *per variant*: the international provider needs its own
 * catalog source, UA version, and probe differences, and keeping them on the
 * instance avoids passing a variant through every call signature.
 */
declare class WorkBuddyUpstreamClient {
  /**
   * Resolves the App-shaped UA version for international catalog requests.
   * Injectable so tests never read the real filesystem.
   */
  private readonly resolveAppVersion;
  /** Chat-identity resolver; see {@link WorkBuddyUpstreamClientOptions.resolveChatIdentity}. */
  private readonly resolveChatIdentity;
  /** Provenance of the most recent successful catalog fetch, for the card. */
  lastCatalog: WorkBuddyCatalogFetch | undefined;
  constructor(options?: WorkBuddyUpstreamClientOptions);
  /** POST the chat endpoint; a successful answer is the raw SSE response. */
  chatStream(credential: WorkBuddyCredential, bodyJson: string, signal?: AbortSignal): Promise<WorkBuddyChatResult>;
  /**
   * POST the token-refresh endpoint; the caller merges the outcome.
   *
   * A failure arrives as a {@link WorkBuddyRefreshFailure} — carrying the same
   * classification chat failures get — rather than as a bare `Error`. The
   * distinction the caller needs is *definitive versus not*: "the upstream
   * refused this refresh token" is evidence the session is really gone, while a
   * timeout, a 5xx, or a dropped connection is evidence about the network. Only
   * the first may cost the user an account.
   */
  refreshToken(credential: WorkBuddyCredential): Promise<WorkBuddyRefreshOutcome>;
  /**
   * GET the personal model catalog.
   *
   * Both variants read `/v3/config`, the product document the desktop product
   * itself fetches. CN used to read `/console/enterprises/personal/models`
   * (the console catalog) instead, and that was why its model list drifted
   * from the desktop App's selector: the console document lags the product
   * one, and the product roster itself churns day to day (`auto`,
   * `kimi-k3-1`, `minimax-m3` have each appeared and disappeared within a
   * week).
   *
   * What distinguishes the two variants here is the User-Agent, not the path:
   * the gateway splits `/v3/config` by client identity, and the split is
   * load-bearing. A CLI-shaped UA yields the CLI's roster — the chat models
   * this plugin serves — while an App-shaped UA yields the App's internal
   * roster. CN keeps the CLI UA it sends for chat, so the catalog it
   * advertises is exactly the one its own requests can use. The international
   * variant has no CLI identity, so it keeps the App-shaped UA.
   *
   * Membership is the `cli` roster intersected with the usable rows (see
   * {@link parseModelCatalog}); the promo badges the product document does
   * not carry are merged in from a best-effort console read — see
   * {@link fetchPromoBadges}.
   *
   * Responses are unwrapped and classified the same way — `readEnvelope` plus
   * `envelopeError` — so an expired session or exhausted credit is reported as
   * such rather than as a generic catalog failure.
   */
  fetchModels(credential: WorkBuddyCredential, signal?: AbortSignal): Promise<readonly WorkBuddyUpstreamModel[]>;
  /**
   * Read the console catalog's promotional tags, by model id.
   *
   * `/v3/config` carries no `badge:<label>:<color>` tags — the discount labels
   * the cards render (`限时免费`, `夜间折扣`, …) live only in
   * `/console/enterprises/personal/models`. Since the roster now comes from
   * the product document, those tags are read from the console one in a
   * second request and merged by id.
   *
   * Best-effort by construction: a badge is a label on a price, so failing to
   * read this document must not fail a catalog refresh. Every failure —
   * network, envelope, an unreadable body — returns undefined, and the models
   * simply ship without badges.
   */
  private fetchPromoBadges;
  /**
   * POST the billing endpoint for the aggregated remaining credit.
   *
   * Two upstream shapes, chosen by account type:
   *
   * - **CN enterprise** (`regionOf === 'cn'` and `enterpriseId` non-empty) asks
   *   `/v2/billing/meter/get-enterprise-user-usage`, which answers with a single
   *   cycle quota. The personal endpoint serves these accounts an empty
   *   `Accounts` list, which the card then renders as "0 credit" — a wrong
   *   number rather than a visible failure (issue #31).
   * - **Everyone else** keeps the personal endpoint unchanged.
   *
   * The region gate is load-bearing: the enterprise endpoint is unverified for
   * the global region, so an international credential that happens to carry an
   * `enterpriseId` must stay on the measured personal path instead of being
   * moved onto an unmeasured one.
   */
  fetchCredits(credential: WorkBuddyCredential): Promise<WorkBuddyCredits>;
  /**
   * CN enterprise credit read: a single cycle quota instead of a package list.
   *
   * Verified against the WorkBuddy desktop app (`app.asar`,
   * `BackendProvider.getEnterpriseUsage` and `CloudAccountRepo.billing`): the
   * body is an empty object and the account identity travels only in the
   * headers. The two official call sites disagree on the field spelling
   * (`limitNum`/`credit` vs `limit_num`/`used_num`), so both are accepted.
   *
   * A body carrying no recognisable quota field is a hard error rather than a
   * zero. Rendering `0` for "we did not understand the answer" is exactly how
   * issue #31 stayed invisible while users saw a plausible wrong number.
   *
   * The error names fields and types only: it reaches the browser, and the
   * response body may describe the account's usage.
   */
  private fetchEnterpriseCredits;
  /**
   * One probe request: a real streaming chat call carrying the effort under
   * test.
   *
   * Shares `chatHeaders` with the normal chat path on purpose — the plan
   * forbids probing through anything but the plugin's own credential handling,
   * so a result describes what a real message would experience.
   *
   * The caller aborts as soon as a parseable event arrives; the body is never
   * assembled into an answer. `reasoning_effort` is omitted entirely (rather
   * than sent empty) when `effort` is undefined, so the baseline case is a
   * genuinely bare request.
   *
   * Two international differences, both measured on 2026-09-11:
   *
   * - The gateway requires a leading `system` message (400/11128 otherwise), so
   *   one is prepended for the global region only.
   * - `max_tokens: 1` is below some models' floor (the GPT-5.6 family rejects it
   *   with 400/11133 `integer_below_min_value`), so the international probe asks
   *   for a slightly larger minimum. This is a floor the plugin must clear, not
   *   evidence about any model's effort support: a model still refusing that
   *   minimum is reported as an incompatible request, never as "effort
   *   unsupported", and the ceiling is never raised further to force an answer.
   */
  probeEffort(credential: WorkBuddyCredential, model: string, effort: string | undefined, signal: AbortSignal): Promise<ProbeAttempt>;
}
/**
 * Parse either response shape after its envelope has been checked.
 *
 * Membership is the `cli` agent's roster, intersected with the rows that are
 * usable: the roster is what the client identity this plugin presents is
 * allowed to chat with, and joining rather than trusting it outright drops
 * both ids the roster has retired and rows the document lists but cannot
 * serve (no row, `disabled: true`, or non-positive caps all drop out here —
 * a published-but-unservable id must never reach the picker).
 *
 * @param data - the unwrapped catalog/product document.
 * @param international - whether it is the international product document, whose
 * rows carry window objects and promotions.
 * @param promoBadges - badge tags by model id, read from the console document,
 * which is the only one that carries them.
 */
declare function parseModelCatalog(data: Record<string, unknown>, international?: boolean, promoBadges?: ReadonlyMap<string, readonly string[]>): readonly WorkBuddyUpstreamModel[];
/**
 * One verified promotion entry.
 *
 * Only the shape actually observed in the international App document is
 * modelled — an enabled, time-boxed, `displayMode: "replace"` discount. An
 * entry that does not match is dropped rather than guessed at: rendering a
 * discount the plugin does not understand could understate what the user pays.
 */
interface WorkBuddyPromotion {
  /** Window start, epoch ms, parsed from the document's offset timestamp. */
  start: number;
  /** Window end, epoch ms. */
  end: number;
  /** Badge text as the upstream wrote it, e.g. `Free now`. */
  label: string;
  /** Multiplier applied to the model's rate; `0` replaces it outright. */
  factor: number;
  /** Higher wins when several promotions cover one model. */
  priority: number;
}
/**
 * Re-evaluate a model's promotion against the current time.
 *
 * Promotions are time-boxed, and the catalog they arrive in is cached for the
 * life of the process. Frozen at parse time, a cached "Free now" would keep
 * claiming a discount after `validUntil` had passed, and would keep showing the
 * pre-discount rate as the discounted one. Re-deriving on every read means the
 * badge disappears on its own and the rate reverts, with no refresh needed.
 *
 * Non-destructive: the model's own `credits` and `badges` are the base, and the
 * promotion is layered onto a copy. A model with no live promotion is returned
 * as-is, so the common case allocates nothing.
 */
declare function modelWithCurrentPromotion(model: WorkBuddyUpstreamModel, now?: number): WorkBuddyUpstreamModel;
/**
 * Apply the international endpoint's extra chat requirement: the first message
 * must be a system prompt.
 *
 * The international gateway rejects a body whose first message is not `system`
 * with HTTP 400 code 11128 ("first message is not system prompt"). Note that
 * the *same* code means something else on the CN endpoint — there it reports a
 * rejected `developer` role — so the two are never branched on by code alone.
 *
 * The added prompt is deliberately empty of user content and prepended, never
 * merged: existing messages keep their order and wording. A body that is not a
 * JSON object is returned unchanged, exactly as {@link prepareChatBody} does,
 * so this is safe to run over an already-prepared-or-not body.
 */
declare function prepareInternationalChatBody(source: string): string;
//#endregion
//#region src/variants.d.ts
/** One WorkBuddy product variant. */
interface WorkBuddyVariant {
  /** Provider id registered with DSH, e.g. `workbuddy-ai`. */
  id: string;
  /** Model-group heading and card title stem, e.g. `WorkBuddy AI`. */
  displayName: string;
  /** Desktop app name as users know it, for diagnostics and error copy. */
  appName: string;
  /** Which upstream region this variant's credentials must belong to. */
  region: WorkBuddyRegion;
  /** Env var overriding the desktop auth-file location. */
  env: string;
  /**
   * How this product's Electron helper is identified and located.
   *
   * Optional for source compatibility: `WorkBuddyVariant` is a public type and
   * existing callers construct their own descriptors without it. Resolution
   * falls back to {@link electronProfileFor}, keyed by variant id — an
   * unknown id stays on the CN profile, the store's other legacy default.
   */
  electron?: WorkBuddyElectronProduct;
  /** Basename of the desktop app's own auth file in the shared auth directory. */
  desktopFilename: string;
  /** Basename of the plugin-owned credential copy under `$DSH_HOME`. */
  ownFilename: string;
  /**
   * Basename of the plugin-owned account-pool file under `$DSH_HOME`.
   *
   * One pool per variant, for the same reason the catalogs are split: the two
   * products are separate subscriptions, and an account signed into one has no
   * meaning for the other. The pool holds that variant's desktop-app account
   * plus every account added by QR, so a user signed into both apps gets two
   * independent rotations.
   */
  accountFilename: string;
  /**
   * Basename of the plugin-owned context-length preference file under
   * `$DSH_HOME`.
   *
   * One per variant for the same reason as the pools: the two products declare
   * different windows for the same model id, so a length chosen for one must not
   * be applied to the other.
   */
  contextFilename: string;
  /** Basename of the plugin-owned probe-record file under `$DSH_HOME`. */
  probeFilename: string;
  /**
   * Basename of the plugin-owned request-usage file under `$DSH_HOME`.
   *
   * One per variant like the pools and catalogs: the two products have separate
   * subscriptions, so one product's request tally must never be read as the
   * other's.
   */
  usageFilename: string;
  /**
   * Basename of the plugin-owned saved-catalog file under `$DSH_HOME`.
   *
   * One per variant, like the probe records: the two endpoints disagree about
   * rates, windows, and even which models exist for a shared id, so a catalog
   * saved from one must never be served as the other's.
   */
  catalogFilename: string;
  /**
   * Basename of the plugin-owned per-account model-visibility file under
   * `$DSH_HOME`.
   *
   * One per variant, for the same reason as the catalogs and probe records:
   * the two endpoints share model ids, so one variant's hidden list must never
   * answer for the other's picker.
   */
  visibilityFilename: string;
  /** Same-origin status route consumed by this variant's card. */
  statusPath: string;
  /** Same-origin account-control route consumed by this variant's card. */
  accountPath: string;
  /** Same-origin probe-control route consumed by this variant's card. */
  probePath: string;
}
/**
 * How one product's Electron key helper is identified on each platform, and
 * which env var names an explicit binary for it (issues #59/#60).
 *
 * The profile is the *only* place product identity enters helper resolution —
 * never the discovery setting, which only says whether a platform may be
 * searched at all: two products on the same platform differ by bundle id /
 * registry name / exe basename, so a discovery that matches one can never
 * legitimately execute the other's binary.
 */
interface WorkBuddyElectronProduct {
  /** Product name for helper diagnostics and error copy, e.g. `WorkBuddy AI`. */
  productName: string;
  /** Env var naming an explicit Electron binary for this product alone. */
  envVar: string;
  /** macOS identity and default install layout, verified per product. */
  macOS: {
    bundleId: string;
    defaultPath: string;
  };
  /**
   * Windows identity from the uninstall registry and the exe it names.
   * `defaultPathSegments` exists only where the default install location has
   * been measured (CN); the international app has only been seen in
   * user-chosen locations, so it stays registry-only — an unverified default
   * is a guess, and guessing is how the wrong app gets executed.
   */
  windows: {
    displayNamePattern: RegExp;
    exeBasename: string;
    defaultPathSegments?: readonly string[];
  };
}
/** CN WorkBuddy first: the existing provider keeps its id, paths, and copy. */
declare const WORKBUDDY_VARIANTS: readonly WorkBuddyVariant[];
/** The CN variant; the plugin's long-standing default and compatibility anchor. */
declare const CN_VARIANT: WorkBuddyVariant;
/** The international variant. */
declare const AI_VARIANT: WorkBuddyVariant;
/** Look up a variant by provider id. */
declare function variantFor(id: string): WorkBuddyVariant | undefined;
//#endregion
//#region src/desktop-credential-protection.d.ts
/** The four states a desktop auth document can be read as. */
type DesktopAuthFormat = 'absent' | 'plaintext' | 'encrypted' | 'unrecognized';
/** The spawned helper. Separated from the provider so tests can stand it in. */
type WorkBuddyKeyPayloadSource = () => Promise<string>;
/**
 * Which automatic discovery, if any, this provider may run when no explicit
 * binary is configured.
 *
 * The value says which *platform* may be searched, never which product: two
 * products on the same platform are told apart by the product profile
 * ({@link WorkBuddyElectronProduct} — bundle id, registry name, exe basename),
 * so a search for one can never execute the other's binary. `none` remains the
 * safe default for platforms without a verified layout (Linux today).
 */
type WorkBuddyElectronDiscovery = 'none' | 'macos-workbuddy' | 'windows-workbuddy';
/** Seams the discovery flow runs through, so tests never spawn a process. */
interface WorkBuddyDiscoveryTools {
  /** Candidate `.app` bundles for the product's bundle id, or a throw for an unusable tool. */
  findApps: (signal: AbortSignal) => Promise<readonly string[]>;
  /**
   * `CFBundleIdentifier` of a bundle, or `undefined` when the tool could not
   * read it — which is "we could not check this candidate", never "it does not
   * match". A successful read of a *different* id returns that id, and the
   * caller excludes the candidate.
   */
  bundleIdentifier: (bundlePath: string, signal: AbortSignal) => Promise<string | undefined>;
  /** Display version, best effort; `undefined` when unavailable. */
  bundleVersion: (bundlePath: string, signal: AbortSignal) => Promise<string | undefined>;
}
/** Windows-only seam for querying one uninstall registry root. */
interface WorkBuddyWindowsDiscoveryTools {
  queryUninstallRoot: (root: string, signal: AbortSignal) => Promise<string>;
}
/** Provider options. */
interface WorkBuddyAtRestKeyProviderOptions {
  /**
   * Which product's Electron this provider resolves. Required and the only
   * source of product identity: it names the explicit-path env var, the bundle
   * id / registry name / exe basename discovery must match, and the platform
   * default. Without it the provider could not even decide which env var to
   * read — the discovery setting alone cannot carry this (both products are
   * `none` on Linux, yet each must read its own variable).
   */
  product: WorkBuddyElectronProduct;
  /** Explicit Electron binary; overrides the platform default and env. */
  electronPath?: string;
  /** Helper timeout in milliseconds; default 10s. */
  timeoutMs?: number;
  /**
   * Where the payload comes from. Defaults to spawning WorkBuddy's own
   * Electron with `ELECTRON_RUN_AS_NODE=1`; tests supply a stand-in so no
   * test ever touches the real binary or a real key. Supplying this replaces
   * path *resolution* too, so tests about resolution use
   * {@link spawnHelper} instead.
   */
  source?: WorkBuddyKeyPayloadSource;
  /**
   * Runs the helper at the resolved path. Distinct from {@link source}, which
   * replaces the whole payload path: this seam keeps resolution — explicit
   * config, platform default, discovery — real, so tests can exercise it
   * without spawning anything.
   */
  spawnHelper?: (electronPath: string) => Promise<string>;
  /**
   * Automatic discovery budget; defaults to `'none'` (see
   * {@link WorkBuddyElectronDiscovery}). Passed explicitly per variant at the
   * composition root, never inferred from the environment.
   */
  discovery?: WorkBuddyElectronDiscovery;
  /**
   * Platform default binary, consulted only when `discovery` is enabled and no
   * explicit path is configured. Injectable so tests can force the fallback
   * branch without moving the real app; `null` means "no default here".
   */
  defaultElectronPath?: string | undefined;
  /** Discovery subprocesses; injectable so tests never spawn. */
  tools?: WorkBuddyDiscoveryTools;
  /** Windows registry discovery subprocess; injectable so tests never spawn. */
  windowsTools?: WorkBuddyWindowsDiscoveryTools;
  /** Platform override for deterministic discovery tests. */
  platform?: NodeJS.Platform;
  /**
   * Total budget for one discovery run, covering the search and every
   * candidate check. Injectable so tests can exercise exhaustion without
   * waiting out the production 10s.
   */
  discoveryBudgetMs?: number;
}
/**
 * In-memory protector-key resolver: one spawn per key id, single-flight, never
 * persisted. The cache is keyed by the id envelopes ask for, so an envelope
 * sealed under a rotated key triggers exactly one fresh resolution.
 */ declare class WorkBuddyAtRestKeyProvider {
  /**
   * The explicit binary, when one was configured. `undefined` here means "the
   * caller did not name one", which is what lets discovery run — an explicit
   * path that turns out to be unusable is an error, never a reason to look for
   * a different app.
   */
  private readonly explicitPath;
  private readonly product;
  private readonly defaultPath;
  private readonly discovery;
  private readonly tools;
  private readonly windowsTools;
  private readonly platform;
  private readonly discoveryBudgetMs;
  private readonly timeoutMs;
  private readonly source;
  private readonly spawnHelper;
  /**
   * The path discovery settled on, cached only on success. A failure leaves
   * this unset so the next attempt tries again — the user may install or move
   * the app without restarting DSH.
   */
  private discoveredPath;
  private cache;
  private inflight;
  constructor(options: WorkBuddyAtRestKeyProviderOptions);
  /**
   * The binary the default helper would use, for diagnostics.
   *
   * Reports a *discovery result* once one exists, so diagnostics describe what
   * would actually run rather than the default that was bypassed. Discovery
   * itself stays in {@link resolveElectronPath}: this accessor never triggers a
   * search (the constructor must remain I/O-free, and callers may ask before
   * any resolution has happened).
   */
  helperPath(): string | undefined;
  /**
   * A protector key matching one of the requested envelope key ids. The first
   * id the cache answers wins; otherwise one spawn resolves the current key,
   * which must match a request — a mismatch means the envelopes were sealed by
   * a different install than the one this machine now runs, and no key we can
   * reach will open them.
   */
  protectorKeyFor(requested: readonly string[]): Promise<Buffer>;
  private ingest;
  /**
   * The binary to spawn, or a diagnosable error saying why there is none.
   *
   * Order is the contract: an explicit path is used as-is and never falls back;
   * discovery runs only for a provider that was configured for it, and only
   * after the platform default has been tried and found unusable.
   */
  private resolveElectronPath;
  /**
   * Resolve this product's app through Spotlight, then prove each candidate's
   * identity before it can be executed.
   *
   * The whole flow shares one budget: a hang in one candidate must not extend
   * the wait for the others, and running out of budget is reported as an
   * unfinished check rather than an absent app.
   */
  private discoverMacosApp;
  /**
   * Resolve this product's app through Windows uninstall records. Registry
   * entries provide hints, not trust: every DisplayIcon candidate must still
   * be the product's Electron binary with the known Electron layout before
   * execution.
   */
  private discoverWindowsApp;
  private spawnPayload;
  private spawnAt;
}
//#endregion
//#region src/auth.d.ts
/** Normalized WorkBuddy credential, timestamps in epoch milliseconds. */
interface WorkBuddyCredential {
  accessToken: string;
  refreshToken: string;
  expiresAtMs: number;
  refreshExpiresAtMs?: number;
  domain: string;
  uid: string;
  enterpriseId?: string;
  nickname?: string;
  /** Which storage the credential was read from; refreshes are always `dsh`. */
  source: 'desktop' | 'dsh';
}
/** Read-only sign-in summary for status and doctor output. */
interface WorkBuddyAuthStatus {
  state: 'signed-in' | 'signed-out';
  expiresAtMs?: number;
  refreshExpiresAtMs?: number;
  nickname?: string;
  domain?: string;
  source?: 'desktop' | 'dsh';
  /**
   * Why no credential is usable, when the reason is diagnosable rather than
   * "nobody is signed in" — a region mismatch being the case that matters.
   * Present only on `signed-out`, and never a substitute for fixing the file.
   */
  reason?: string;
}
/** Constructor options; only {@link refresh} is required. */
interface WorkBuddyStoreOptions {
  variant?: WorkBuddyVariant;
  /** Explicit desktop auth-file path, overriding env and platform defaults. */
  desktopPath?: string;
  /** Explicit plugin-owned copy path, defaulting under `$DSH_HOME`. */
  ownPath?: string;
  /** Performs the upstream token refresh. */
  refresh: (credential: WorkBuddyCredential) => Promise<WorkBuddyRefreshOutcome>;
  /** Refresh this long before actual expiry; default five minutes. */
  refreshMarginMs?: number;
  /**
   * Resolver for WorkBuddy 5.6's at-rest protector key, needed when the
   * desktop file stores encrypted token fields. Defaults to the real
   * provider, which spawns the WorkBuddy Electron binary; tests stand in a
   * stub. Structural so a store never depends on how the key is reached.
   */
  keyProvider?: Pick<WorkBuddyAtRestKeyProvider, 'protectorKeyFor' | 'helperPath'>;
}
/** Basename of the plugin-owned credential copy inside the Harness home. */
declare const WORKBUDDY_AUTH_FILENAME = ".workbuddy-auth.json";
/** Env variable that overrides the desktop auth-file location. */
declare const WORKBUDDY_AUTH_FILE_ENV = "WORKBUDDY_AUTH_FILE";
/** Plugin-owned copy path inside the Harness home. */
declare function workbuddyOwnAuthPath(): string;
/**
 * Platform-default candidates for the WorkBuddy desktop app's auth file, in
 * probe order. Windows probes both AppData roots: current builds write under
 * `%LOCALAPPDATA%` (Local), older ones under `%APPDATA%` (Roaming). Linux
 * probes both XDG bases — most distributions write under the config home,
 * but UOS/deepin builds write under the data home (issue #43), and probing
 * only one silently reads a signed-in app as signed out. WSL probes those
 * same Windows locations through its mounted Windows profile before the
 * native Linux locations.
 */
declare function defaultDesktopAuthCandidates(): string[];
/**
 * The platform-default candidates for one variant, in probe order.
 *
 * Both apps write into the *same* shared `CodeBuddyExtension` auth directory
 * and differ only in the file's basename, so the per-platform ordering above
 * is reused verbatim and just the filename is swapped.
 */
declare function desktopAuthCandidatesFor(variant: WorkBuddyVariant): string[];
/** First platform-default candidate; see {@link defaultDesktopAuthCandidates}. */
declare function defaultDesktopAuthPath(variant?: WorkBuddyVariant): string | undefined;
/**
 * Parse a WorkBuddy auth document in either on-disk shape: the plugin OAuth
 * nested form `{"auth":{...},"account":{...}}` and the flat panel form.
 * Returns undefined when the document carries no access token.
 */
declare function parseWorkBuddyAuth(text: string): WorkBuddyCredential | undefined;
/**
 * Read-only credential store with demand-driven refresh.
 *
 * Refresh policy: refresh only when the access token is inside the margin
 * (or already expired), keep the refreshed credential in the plugin-owned
 * copy, and never write the desktop app's file. A failed refresh still
 * returns a not-yet-expired token so an unreachable refresh endpoint does
 * not take down a working session.
 */
declare class WorkBuddyCredentialStore {
  private readonly variant;
  private readonly refresh;
  private readonly refreshMarginMs;
  private readonly ownPath;
  private readonly keyProvider;
  private desktopPathOverride;
  private inflight;
  constructor(options: WorkBuddyStoreOptions);
  /**
   * Configuration precedence for the desktop file: the plugin's configured
   * path, then the environment variable, then the platform defaults. An
   * explicit path is used verbatim; the defaults are a probe order.
   */
  private resolveDesktopCandidates;
  private resolveDesktopPath;
  /**
   * Repoint the desktop file; a settings change applies on the next read.
   */
  setDesktopPath(path: string | undefined): void;
  /** The resolved desktop auth-file path, for diagnostics. */
  desktopAuthPath(): string | undefined;
  /** The plugin-owned copy path, for diagnostics. */
  ownAuthPath(): string;
  /**
   * The desktop app's own credential, ignoring the plugin-owned copy.
   *
   * Used by the account pool's capture step: the pool wants *the app's current
   * sign-in* so it can hold it as an ordinary long-lived member, not the
   * plugin's rotated copy (which is already in the pool under the same
   * identity). Returns undefined when the app is signed out, and throws only
   * for a diagnosable problem such as a region mismatch.
   */
  desktopCredential(): Promise<WorkBuddyCredential | undefined>;
  /** Read the freshest stored credential without refreshing anything. */
  current(): Promise<WorkBuddyCredential | undefined>;
  /**
   * The credential to send upstream: {@link current}, refreshed on demand.
   * Single-flight, so parallel requests share one refresh.
   */
  resolve(): Promise<WorkBuddyCredential>;
  /** Read-only sign-in summary; never refreshes and never throws. */
  status(): Promise<WorkBuddyAuthStatus>;
  /** Remove the plugin-owned copy; the desktop file is untouched. */
  logout(): Promise<void>;
  private needsRefresh;
  private refreshNow;
  private saveOwn;
  /**
   * Read the first desktop candidate that exists. Only an absent file
   * (ENOENT) falls through to the next candidate; a file that is present
   * but unparsable is authoritative for its slot, so a stale older-version
   * file never silently wins over a broken newer one.
   *
   * Since WorkBuddy 5.6 the token fields may arrive in at-rest envelopes, so
   * the text is classified before the regular parser sees it. An encrypted
   * document must be *opened*, never skipped; an unrecognized one must fail
   * loudly. The desktop file, as long as it exists, is the identity
   * authority — a document this plugin cannot read must surface as a
   * diagnosis rather than be papered over by the plugin-owned copy, which
   * belongs to whatever account was signed in when it was last refreshed.
   * Only an absent (or empty) file lets the probe continue.
   */
  private readDesktop;
  /** Open a 5.6 encrypted desktop document into the regular credential shape. */
  private openEncryptedDesktop;
  /**
   * Classify the first desktop candidate that exists and carries content;
   * `absent` when none does. An empty first file is skipped so it cannot mask
   * a real document on the next candidate. Diagnostics only — it never spawns
   * the key helper and never decrypts, so doctor can describe the file
   * without attempting the unlock.
   */
  desktopAuthFormat(): Promise<DesktopAuthFormat>;
  private readOwn;
  /**
   * The first desktop candidate the probe would actually read from; `undefined`
   * when none qualifies. Semantics deliberately match the probe: empty files
   * are skipped (the probe classifies them as absent and moves on), so on an
   * XDG layout where the config-home file is empty but the data-home file
   * holds the credential, diagnostics name the *data-home* file — the one
   * authentication really uses. Like the probe it never parses or decrypts.
   */
  resolvedDesktopAuthPath(): Promise<string | undefined>;
  /** Whether any desktop-file candidate exists as a regular file; diagnostics only. */
  desktopFilePresent(): Promise<boolean>;
}
//#endregion
//#region src/status-paths.d.ts
/** One QR sign-in challenge, as the browser renders it. */
interface WorkBuddyQrChallenge$1 {
  /** Opaque state the browser echoes back when polling. */
  state: string;
  /** The URL the QR code encodes. */
  authUrl: string;
  /** When the challenge stops being valid, epoch ms. */
  expiresAtMs: number;
}
/** Action requested from the account route. */
type WorkBuddyAccountAction = {
  action: 'add';
} |
/**
 * Add an account from a sign-in token pasted out of the web console.
 *
 * The token travels in the request body and is never echoed back: it is
 * credential material, and the response describes the account, not the token.
 */
{
  action: 'add-cookie';
  token: string;
} | {
  action: 'poll';
  state: string;
} | {
  action: 'cancel';
  state: string;
} |
/**
 * Adopt the desktop app's sign-in on the user's explicit request — the
 * add-account dialog's "desktop sign-in" option.
 *
 * Distinct from the background sweep, which is a *sync*: that one may not
 * resurrect an account the user removed, while this is a user action and
 * clears that dismissal.
 */
{
  action: 'adopt-desktop';
} | {
  action: 'remove';
  id: string;
} | {
  action: 'enable';
  id: string;
  enabled: boolean;
} | {
  action: 'label';
  id: string;
  label?: string;
} | {
  action: 'reorder';
  ids: readonly string[];
} | {
  action: 'test';
  id: string;
} | {
  action: 'refresh-credits';
} |
/**
 * Choose which context length a model runs at.
 *
 * A write because it changes subsequent requests, not just the display: the
 * adapter reports the chosen window to pi-ai, which derives each request's
 * output ceiling from it.
 */
{
  action: 'context';
  model: string;
  length: number;
};
/** What an account action answers with. */
interface WorkBuddyAccountResult {
  /** `ok` for every action that completed; otherwise a short reason. */
  state: 'ok' | 'failed' | 'waiting' | 'expired' | 'invalid' | 'added';
  reason?: string;
  /** Present for `add`: the challenge to render as a QR code. */
  challenge?: WorkBuddyQrChallenge$1;
  /** Present for `poll` and `add-cookie`: the added account's display name. */
  name?: string;
  created?: boolean;
  /** Present for `test`: whether a minimal streaming request succeeded. */
  test?: {
    ok: boolean;
    message: string;
  };
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
type WorkBuddySidebarCreditStyle = 'remaining' | 'usage';
//#endregion
//#region src/preferences.d.ts
/**
 * Every plugin-wide preference, by the name of its config field.
 *
 * Both products' surfaces draw these, and each is written once but read from
 * whichever document carries it — see `client/status-document.ts`.
 */
declare const WORKBUDDY_PREFERENCES: {
  /**
   * How the sidebar card states each product's credit.
   *
   * `'remaining'` (default) is one line per product — "WorkBuddy 剩余额度 5,266";
   * `'usage'` is the reference card's shape — a "used / total" pair over a bar of
   * that ratio. Both describe the same pool; they differ in which figure leads,
   * and that is a matter of taste rather than of correctness, which is why it is
   * a setting instead of a decision this plugin makes for the user.
   */
  readonly sidebarCreditStyle: {
    readonly field: z<"remaining" | "usage", "remaining" | "usage", "defined">;
    readonly stated: (value: WorkBuddySidebarCreditStyle) => WorkBuddySidebarCreditStyle;
  };
  /**
   * Whether the sidebar keeps its credit card at all.
   *
   * The one preference here that REMOVES a surface instead of reshaping it:
   * `false` takes the card out of the sidebar's foot, which is where both the
   * resident credit summary and the way into the dashboard live. The dashboard
   * therefore stays reachable from the settings page while this is off — a
   * switch that stranded a destination would be a trap rather than a setting.
   */
  readonly sidebarCreditVisible: {
    readonly field: z<boolean, boolean, "defined">;
    readonly stated: (value: boolean) => boolean;
  };
};
/** Every preference's config-field name. */
type WorkBuddyPreferenceKey = keyof typeof WORKBUDDY_PREFERENCES;
/** The config value one preference stores. */
type WorkBuddyPreferenceValue<K extends WorkBuddyPreferenceKey> = Parameters<(typeof WORKBUDDY_PREFERENCES)[K]['stated']>[0];
/** The preference half of this plugin's config. */
type WorkBuddyPreferenceConfig = { [K in WorkBuddyPreferenceKey]?: WorkBuddyPreferenceValue<K>; };
//#endregion
//#region src/catalog.d.ts
/** One model entry the adapter exposes. */
type WorkBuddyModelInfo = WorkBuddyUpstreamModel;
/**
 * Static CLI models observed on the CN endpoint (re-verified against the live
 * `/v3/config` document 2026-09-23, including the thinking-effort and billing
 * metadata). The upstream refresh replaces this list at startup; it exists so
 * the provider registers with a usable catalog even while the first fetch is
 * in flight or offline.
 *
 * The list tracks the `cli` agent's model roster exactly — the 16 models it
 * offered that day. The roster churns quickly (`auto`, `kimi-k3-1`,
 * `minimax-m3` each appeared or vanished within days, and a competing patch's
 * 2026-09-22 snapshot named three ids that were gone a day later), so this
 * table is a boot-time placeholder, never a promise: the live fetch
 * intersects the day's roster with the document's usable rows, and
 * `tests/upstream.spec.ts` pins this table to the same parse so the two
 * cannot drift apart silently. Reasoning metadata is verbatim from the live
 * document, and the `free` flag follows the normalized `x0.00` credits
 * marker.
 *
 * Deliberately NOT baked in: promotional badges. `限时免费` and friends are
 * dynamic console-side promotions with no reliable validity window, so a
 * static table would keep them alive long after the offers end. The live
 * refresh merges the day's badges best-effort from the console document (see
 * `fetchPromoBadges` in upstream.ts); until then the rows simply ship
 * without them.
 */
declare const FALLBACK_WORKBUDDY_MODELS: readonly WorkBuddyModelInfo[];
/**
 * Static CLI models for the international endpoint, captured 2026-09-11 from
 * the App-form `/v3/config` document (the 20 ids of its `cli` agent, in order).
 *
 * Same purpose and same discipline as {@link FALLBACK_WORKBUDDY_MODELS}: it
 * covers the window before the first successful fetch and an offline start,
 * and it is deliberately *not* a promise about the upstream's current state.
 * Reasoning metadata is verbatim from that snapshot. No promo badge is baked
 * in: promotions are time-boxed (`modelPromotions` carries `validFrom`/
 * `validUntil`), so hard-coding a "Free now" label would keep claiming a
 * discount the upstream may have already ended.
 */
declare const FALLBACK_WORKBUDDY_AI_MODELS: readonly WorkBuddyModelInfo[];
/**
 * Mutable catalog shared by the shim's `/v1/models` and the adapter.
 *
 * Visibility is separate from content. A variant whose app has no credentials
 * must expose *no* models rather than a fallback roster: the DSH model picker
 * drops an empty group, so an empty catalog is exactly how a provider hides
 * without touching registration. Serving the fallback to a signed-out user
 * instead offers models that can only fail (`store.resolve()` throws on the
 * first message), which is worse than showing nothing.
 *
 * The flag defaults to visible so a directly-constructed catalog behaves as it
 * always has; the plugin runtime applies the credential gate.
 */
declare class WorkBuddyCatalog {
  private models;
  private visible;
  private useMaximumContextWindow;
  constructor(initial?: readonly WorkBuddyModelInfo[]);
  /** Current entries; empty while the variant has no usable credential. */
  current(): readonly WorkBuddyModelInfo[];
  /** Replace the list; callers invalidate their adapter snapshot after this. */
  set(models: readonly WorkBuddyModelInfo[]): void;
  /** Whether this variant's models are exposed at all. */
  isVisible(): boolean;
  /**
   * Show or hide the whole catalog. Returns whether the value changed, so the
   * caller can skip an invalidation that would re-render an identical list.
   */
  setVisible(visible: boolean): boolean;
  /** Select the largest declared international window where the upstream offers one. */
  setUseMaximumContextWindow(useMaximum: boolean): boolean;
  /** Models to fall back to when the upstream fetch fails; ignores visibility. */
  fallback(): readonly WorkBuddyModelInfo[];
}
//#endregion
//#region src/probe-store.d.ts
/** Basename of the probe record inside the Harness home. */
declare const WORKBUDDY_PROBE_FILENAME = ".workbuddy-probe.json";
/**
 * Whether the model's effort parameter is actually validated.
 *
 * - `validating`: the upstream rejected an unknown sentinel value, so a
 *   per-level answer is meaningful.
 * - `non-validating`: the upstream accepted the sentinel, so it ignores or
 *   loosely coerces the parameter and no per-level answer can be trusted.
 * - `unknown`: baseline or sentinel failed for an unrelated reason (auth,
 *   rate limit, transport, ambiguous error body). Not a negative claim.
 */
type WorkBuddyProbeValidation = 'validating' | 'non-validating' | 'unknown';
/** One model's recorded observation. */
interface WorkBuddyProbeRecord {
  /** Fingerprint of the catalog row this observation was made against. */
  fingerprint: string;
  validation: WorkBuddyProbeValidation;
  /** Efforts verified as accepted; only ever non-empty for `validating`. */
  efforts: readonly WorkBuddyEffort[];
  /** When the probe ran, epoch milliseconds. */
  probedAtMs: number;
  /** Plugin version that produced the record. */
  pluginVersion: string;
  /**
   * The account this observation was made under, as `uid:enterpriseId`.
   *
   * An effort set is a fact about one account's entitlement as much as about
   * the model: the same model id can accept different levels under a different
   * subscription. Records are stored under this identity and only ever served
   * back to it, so one account never inherits another's detected levels — and
   * because the store nests by this identity, switching back finds this
   * account's own records intact rather than re-probing from scratch.
   */
  account: string;
}
/**
 * Plugin-owned probe record path inside the Harness home.
 *
 * One file per variant. Same-named models exist on both endpoints (the
 * international catalog repeats `glm-5.3`, `glm-5.2`, `hy3`, `kimi-k2.6`), and
 * {@link fingerprintModel} covers only `id`/`reasoning`/`supportsImages` —
 * never the provider — so a single shared file would let one variant's
 * observation answer for the other. The paths differ; the format does not.
 */
declare function workbuddyProbePath(filename?: string): string;
/**
 * Fingerprint the catalog fields a probe depends on.
 *
 * Deliberately excludes display-only fields (`name`, `billing`, `contextWindow`)
 * so a rename or a promo badge does not throw away a valid observation, and
 * deliberately includes the whole reasoning object so any change to the
 * declared shape re-probes.
 */
declare function fingerprintModel(info: WorkBuddyModelInfo): string;
/** Options for {@link WorkBuddyProbeStore}. */
interface WorkBuddyProbeStoreOptions {
  /** Explicit state-file path, overriding the `$DSH_HOME` default. */
  path?: string;
  /** Observation lifetime; defaults to 14 days. */
  ttlMs?: number;
  /** Plugin version stamped into new records. */
  pluginVersion: string;
  /** Clock injection for tests. */
  now?: () => number;
}
/**
 * The plugin's probe records: read once, written atomically, keyed by the
 * account that produced each observation, and never trusted across a
 * fingerprint change or past the TTL.
 */
declare class WorkBuddyProbeStore {
  private readonly path;
  private readonly ttlMs;
  private readonly pluginVersion;
  private readonly now;
  private records;
  constructor(options: WorkBuddyProbeStoreOptions | string);
  /** Resolved state-file path, for the CLI and tests. */
  filePath(): string;
  private load;
  /**
   * The usable record for one account and model, or `undefined` when there is
   * none, it is expired, it was taken against a different catalog row, or it
   * belongs to a different account.
   *
   * @param account - the account in effect, as `uid:enterpriseId`. Records are
   *   only returned for the account that produced them.
   */
  get(modelId: string, fingerprint: string, account: string): WorkBuddyProbeRecord | undefined;
  /**
   * Store one observation under the account stamped on it. Only a decisive
   * answer (`validating` / `non-validating`) replaces an existing decisive
   * record *of the same account*: a transient `unknown` must not erase
   * knowledge the user already paid for.
   */
  set(modelId: string, record: WorkBuddyProbeRecord): void;
  /** Drop every record of every account; used by the card's explicit "clear" action. */
  clear(): void;
  /** Every record currently held, grouped by account, for status display. */
  all(): Readonly<Record<string, Readonly<Record<string, WorkBuddyProbeRecord>>>>;
  /** Build a record stamped with this store's clock, version, and account. */
  record(fingerprint: string, validation: WorkBuddyProbeValidation, efforts: readonly WorkBuddyEffort[], account: string): WorkBuddyProbeRecord;
  /**
   * Write through a temporary file and rename, so a crash mid-write cannot
   * leave a half-parsed document that reads as "no records" and silently drops
   * every observation.
   */
  private persist;
}
//#endregion
//#region src/usage-store.d.ts
/**
 * One request's usage, as the upstream reported it.
 *
 * Every token field is optional: the upstream's usage block varies by model and
 * has changed shape before, so a reader that demanded one spelling would either
 * throw or silently zero the others.
 */
interface WorkBuddyRequestUsage {
  /** Prompt tokens the upstream billed (cache hits included, per OpenAI). */
  promptTokens?: number;
  /** Tokens the model produced. */
  completionTokens?: number;
  /** Prompt tokens the upstream served from its cache. */
  cacheReadTokens?: number;
  /** Prompt tokens written INTO the cache (some upstreams bill these apart). */
  cacheWriteTokens?: number;
  /** Model id the request named, for diagnostics. */
  model?: string;
}
/** One account's running tally. */
interface WorkBuddyUsageCounters {
  /** Requests that reached the upstream through this account. */
  requests: number;
  /** Requests whose answer carried a usage block at all. */
  reported: number;
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** First request counted in this tally, epoch ms. */
  sinceMs: number;
  /** Most recent counted request, epoch ms. */
  lastAtMs: number;
}
/** What the card reads for one account. */
interface WorkBuddyUsageSummary extends WorkBuddyUsageCounters {
  /**
   * Cache-read share of the prompt (`cacheRead / prompt`), when both numbers are
   * known and the prompt was non-zero.
   *
   * Omitted — not zeroed — when no answer ever carried a cache field: see the
   * module note.
   */
  cacheHitRate?: number;
}
//#endregion
//#region src/shim.d.ts
/** Minimal logger surface the plugin context already provides. */
interface ShimLogger {
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}
/** What the plugin needs from a running shim. */
interface WorkBuddyShim {
  /** Resolves once the listener is up; rejects if listening failed. */
  ready: Promise<void>;
  /** The shim origin, e.g. `http://127.0.0.1:39271`; valid after ready. */
  baseUrl(): string;
  /**
   * The per-process shared secret the plugin's own client must carry as
   * `Authorization: Bearer <token>`. Lives only in memory; the adapter
   * resolves this instead of the upstream access token, because the shim
   * resolves the real credential itself through the account pool.
   */
  token(): string;
  /** Stop serving and destroy open connections. */
  close(): Promise<void>;
}
/**
 * Whatever sends one prepared chat body upstream.
 *
 * The shim deliberately knows nothing about accounts: it hands the body to a
 * sender and relays the answer. In production the sender is the pool's
 * rotation (which may try several accounts before answering); in a test it is
 * a stub, or {@link createStoreSender} for the single-credential shape this
 * plugin used before the pool existed.
 */
interface WorkBuddyChatSender {
  send(body: string, signal?: AbortSignal): Promise<WorkBuddyChatResult>;
}
/** Constructor dependencies. */
interface WorkBuddyShimOptions {
  sender: WorkBuddyChatSender;
  catalog: WorkBuddyCatalog;
  logger?: ShimLogger;
}
/**
 * A sender backed by one credential store, for tests and for any caller that
 * wants the pre-pool behaviour: resolve the single stored credential, send
 * once, report the classified failure unchanged.
 */
declare function createStoreSender(options: {
  store: {
    resolve(): Promise<WorkBuddyCredential>;
  };
  client: {
    chatStream(credential: WorkBuddyCredential, body: string, signal?: AbortSignal): Promise<WorkBuddyChatResult>;
  };
}): WorkBuddyChatSender;
/**
 * Start the loopback endpoint. Requests carry any bearer; the loopback bind
 * is the boundary, and the upstream credential is chosen by the sender alone.
 */
declare function createWorkBuddyShim(options: WorkBuddyShimOptions): WorkBuddyShim;
//#endregion
//#region src/adapter.d.ts
/** Provider route this bundle owns. */
declare const WORKBUDDY_PROVIDER = "workbuddy";
/** Provider idle ceiling while one stream read is outstanding. */
declare const WORKBUDDY_STREAM_IDLE_TIMEOUT_MS = 300000;
/** Constructor dependencies. */
interface WorkBuddyAdapterOptions {
  providerId?: string;
  displayName?: string;
  shim: WorkBuddyShim;
  store: WorkBuddyCredentialStore;
  catalog: WorkBuddyCatalog;
  /** Resolve the durable attachment service at request time, when present. */
  resolveAttachments?: () => AttachmentStore | undefined;
  /** Resolve one image's path in the current model-tool execution world. */
  resolveImageAccess?: NonNullable<PiAiAdapterOptions['resolveImageAccess']>;
  /**
   * Look up a local probe observation for a model. Consulted only for rows the
   * upstream left undeclared; absent means declared-set-only behavior.
   */
  observe?: (modelId: string) => WorkBuddyProbeRecord | undefined;
  /**
   * The context window to run a model at, when the user has chosen one.
   *
   * @param modelId - the model being described.
   * @param declared - every window the upstream offers for it.
   * @returns the chosen length, or undefined to use the upstream default.
   *
   * This changes the request, not just the display: pi-ai derives a request's
   * output ceiling from `contextWindow`, so a model running at 1M sends a
   * different cap than the same model running at 200K.
   */
  resolveContextWindow?: (modelId: string, declared: readonly number[]) => number | undefined;
  /**
   * Model ids the current account has hidden from the picker, resolved per
   * read so an account switch is honored without rebuilding the adapter.
   *
   * Hiding is a *listing* concern only: `buildModels()` keeps serving the full
   * catalog because pi-ai's `resolveModel`/`prepareCall` resolve from the same
   * snapshot `listModels` reads — filtering the descriptors there would make a
   * hidden model unresolvable and break sessions already using it. The filter
   * therefore lives in this adapter's `listModels` override alone.
   */
  hidden?: () => readonly string[];
}
/** What {@link createWorkBuddyAdapter} hands back. */
interface WorkBuddyAdapter {
  adapter: PiAiAdapter;
  /** Rebuild the adapter's provider snapshot; call after a catalog update. */
  invalidate: () => void;
}
/**
 * Assemble the adapter. The provider's `getModels` reads the live catalog,
 * and every model's `baseUrl` is re-resolved per read so the shim's
 * ephemeral port applies from the first snapshot after startup.
 *
 * The profile is constructed by hand rather than through dsh-llm-pi-ai's
 * internal `resolveProfiles()`: that helper is not part of the package's
 * public export surface (root entry, `lib/` deep imports blocked by the
 * exports map, `src/` not shipped), so hand-assembly is the only supported
 * path and every newly required field must be adopted here explicitly —
 * `modelErrors` since 0.1.5-alpha.2 (#12).
 */
declare function createWorkBuddyAdapter(options: WorkBuddyAdapterOptions): WorkBuddyAdapter;
//#endregion
//#region src/account-pool.d.ts
/** Basename of the CN variant's account-pool file inside the Harness home. */
declare const WORKBUDDY_ACCOUNTS_FILENAME = ".workbuddy-accounts.json";
/** Why an account was benched. */
type WorkBuddyCooldownReason = 'rate' | 'credit' | 'session';
/**
 * A benching: until when, and why.
 *
 * `strikes` is the count of consecutive *cooldown-causing* failures, so the
 * backoff can grow with repetition and reset on the first success. It is kept
 * on the record (rather than in memory) so a restart does not hand a
 * repeatedly-limited account a fresh, short cooldown.
 */
interface WorkBuddyCooldown {
  /** Epoch ms after which the account is eligible again. */
  untilMs: number;
  reason: WorkBuddyCooldownReason;
  /** Consecutive failures that produced this cooldown; 1 on the first. */
  strikes: number;
  /** When this cooldown was last (re)computed, for display. */
  atMs: number;
}
/** How an account entered the pool. */
type WorkBuddyAccountOrigin = 'desktop' | 'qr' | 'cookie';
/** One account the plugin may send a request as. */
interface WorkBuddyAccount {
  /** Stable identity: `uid:enterpriseId`. The pool's key. */
  id: string;
  uid: string;
  enterpriseId?: string;
  nickname?: string;
  /** Optional user-set label, shown instead of the nickname when present. */
  label?: string;
  /** Login domain; decides the upstream region for every request. */
  domain: string;
  accessToken: string;
  refreshToken: string;
  /** Access-token expiry, epoch ms; 0 means "unknown". */
  expiresAtMs: number;
  /** Refresh-token expiry when the source declares one. */
  refreshExpiresAtMs?: number;
  origin: WorkBuddyAccountOrigin;
  /**
   * Whether rotation may pick this account. A user toggle, not a health
   * signal: health is {@link WorkBuddyCooldown}, which expires on its own.
   */
  enabled: boolean;
  /**
   * Epoch ms of the last request this account served, or 0 for never. This is
   * the whole of the selection policy: least-recently-used wins, which spreads
   * load evenly without a cursor that a restart would lose.
   */
  lastUsedAtMs: number;
  /** Present only while the account is benched. */
  cooldown?: WorkBuddyCooldown;
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
  sessionDead?: boolean;
  /**
   * Consecutive cooldown-causing failures, cleared by the first success.
   *
   * Kept apart from {@link WorkBuddyCooldown.strikes} on purpose: the cooldown
   * is gone by the time the account is eligible again, so a streak stored only
   * inside it restarted at 1 on every later failure and the backoff schedule
   * never grew past its base. This is the counter the schedule actually needs.
   */
  failureStreak?: number;
  addedAtMs: number;
  updatedAtMs: number;
}
/** What an upsert wants to write; identity and bookkeeping are derived. */
interface WorkBuddyAccountInput {
  uid: string;
  enterpriseId?: string;
  nickname?: string;
  domain: string;
  accessToken: string;
  refreshToken: string;
  expiresAtMs: number;
  refreshExpiresAtMs?: number;
  origin: WorkBuddyAccountOrigin;
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
  sync?: boolean;
}
/** Outcome of an upsert, for the "this account is already in the pool" notice. */
interface WorkBuddyUpsertResult {
  account: WorkBuddyAccount;
  /** True when this identity was not in the pool before. */
  created: boolean;
  /** True when the stored tokens actually changed. */
  updated: boolean;
}
/** The backoff an account earns after `strikes` consecutive failures. */
declare function cooldownDurationMs(reason: WorkBuddyCooldownReason, strikes: number): number;
/** Stable identity key for a credential, shared with catalogs and probes. */
declare function accountIdOf(uid: string, enterpriseId?: string): string;
/** The identity key of a credential. */
declare function credentialAccountId(credential: Pick<WorkBuddyCredential, 'uid' | 'enterpriseId'>): string;
/** Project one stored account back into the credential shape the wire layer takes. */
declare function credentialOf(account: WorkBuddyAccount): WorkBuddyCredential;
/** Options for {@link WorkBuddyAccountPool}. */
interface WorkBuddyAccountPoolOptions {
  variant: WorkBuddyVariant;
  /** Explicit pool-file path, overriding the `$DSH_HOME` default. */
  path?: string;
}
/** Pool-file path for one variant inside the Harness home. */
declare function workbuddyAccountsPath(filename?: string): string;
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
declare class WorkBuddyAccountPool {
  private readonly variant;
  private readonly path;
  private accounts;
  /** Identities the user removed; see {@link PoolDocument.dismissed}. */
  private dismissedIds;
  /**
   * Highest stamp handed out by {@link next}, seeded lazily from the rows.
   *
   * Wall-clock based so it stays comparable with the `lastUsedAtMs` values on
   * disk after a restart; only the *strictly increasing* part is what the
   * single-tick case needs.
   */
  private claimSeq;
  constructor(options: WorkBuddyAccountPoolOptions);
  /** Resolved pool-file path, for diagnostics and tests. */
  filePath(): string;
  /** Which variant this pool belongs to. */
  variantId(): string;
  /** Every account, in rotation order. */
  list(): readonly WorkBuddyAccount[];
  /** One account by identity. */
  get(id: string): WorkBuddyAccount | undefined;
  /** Whether the pool could serve a request right now (ignoring cooldowns). */
  hasEnabled(): boolean;
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
  upsert(input: WorkBuddyAccountInput): WorkBuddyUpsertResult;
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
  private adoptTokens;
  /**
   * A background re-read of a sign-in source: identity and freshness, no health.
   *
   * Deliberately does NOT touch `enabled`, `cooldown`, `sessionDead`, or a
   * benching's strike count. Every one of those is state the pool learned from
   * the upstream or from the user, and a file that says "this account signed in
   * at some point" is not evidence about any of them.
   */
  private syncExisting;
  /**
   * A sign-in the user performed (QR, pasted token, or a desktop file that has
   * actually moved forward): the cure for every benching, including a dead
   * session — the tokens are new, so nothing about the old state applies.
   */
  private reSignIn;
  /** Merge a token refresh into a stored account. */
  updateTokens(id: string, tokens: {
    accessToken: string;
    refreshToken?: string;
    expiresAtMs?: number;
    domain?: string;
    refreshExpiresAtMs?: number;
  }): WorkBuddyAccount | undefined;
  /**
   * Remove one account.
   *
   * A desktop account is remembered as dismissed: the app's own file still
   * holds the sign-in, and the next credential sweep would otherwise capture it
   * straight back. Dismissing is per identity, so it survives a restart and
   * never touches a different account the app signs into later.
   */
  remove(id: string): boolean;
  /**
   * Whether a background desktop capture must leave this identity alone.
   *
   * True for an account the user removed from the pool. The desktop app's file
   * is still read — the card still reports the app's sign-in state — but the
   * account is not re-adopted until the user adds it back on purpose.
   */
  ignoresDesktop(id: string): boolean;
  /**
   * Enable or disable one account.
   *
   * Enabling is also the manual override for a session the plugin judged dead:
   * the flag is a conclusion drawn from one upstream refusal plus one failed
   * refresh, and the user saying "use this account" outranks it. Without that,
   * a dead account was unreachable — rotation skipped it, only a successful
   * refresh could clear the flag, and no request would ever try one.
   */
  setEnabled(id: string, enabled: boolean): boolean;
  /** Set or clear the user's label for one account. */
  setLabel(id: string, label: string | undefined): boolean;
  /**
   * Reorder the pool. Ids not named keep their relative order after the named
   * ones, so a stale client cannot drop an account it did not know about.
   */
  reorder(ids: readonly string[]): void;
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
  cooldown(id: string, reason: WorkBuddyCooldownReason, hintMs?: number): WorkBuddyCooldown | undefined;
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
  clearCooldown(id: string): void;
  /**
   * Mark an account's session as dead.
   *
   * Only for a *definitive* refusal: the account has earned this flag when the
   * upstream rejected its credential and the refresh that followed was itself
   * refused. A refresh that failed because the network did is not evidence
   * about the session, and spending the account on it left the user with an
   * account they could only delete.
   */
  markSessionDead(id: string): void;
  /** Whether an account may be picked right now. */
  isAvailable(account: WorkBuddyAccount, now?: number): boolean;
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
  next(tried: ReadonlySet<string>, now?: number): WorkBuddyAccount | undefined;
  /**
   * A strictly increasing stamp for one claim, seeded from the wall clock.
   *
   * Strictly increasing even when the clock stands still or steps backwards, so
   * "most recently claimed" stays a real ordering.
   */
  private claimClock;
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
  primary(preferredId?: string, now?: number): WorkBuddyAccount | undefined;
  private mutate;
  /** The dismissed-identity set, loaded alongside the accounts. */
  private dismissed;
  private load;
  private persist;
}
//#endregion
//#region src/qr-login.d.ts
/** A freshly minted QR sign-in: the state to poll and the URL to render. */
interface WorkBuddyQrChallenge {
  state: string;
  /** The URL the QR code must encode; opening it on a phone starts the sign-in. */
  authUrl: string;
  /** When this challenge stops being pollable, epoch ms. */
  expiresAtMs: number;
}
/** Result of one poll. */
type WorkBuddyQrPoll = {
  status: 'waiting';
} | {
  status: 'expired';
} | {
  status: 'invalid';
} | {
  status: 'ready';
  uid: string;
  enterpriseId?: string;
  nickname?: string;
  domain: string;
  accessToken: string;
  refreshToken: string;
  expiresAtMs: number;
};
/** Constructor dependencies; the variant fixes which region is signed into. */
interface WorkBuddyQrLoginOptions {
  variant: WorkBuddyVariant;
  /** Injectable fetch, for tests. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Injectable clock, for tests. */
  now?: () => number;
}
/**
 * One QR sign-in flow for one variant.
 *
 * Instances are cheap and stateless beyond the outstanding-state set; the
 * plugin keeps one per variant.
 */
declare class WorkBuddyQrLogin {
  private readonly variant;
  /**
   * Injectable fetch. Left undefined in production so {@link send} resolves
   * `globalThis.fetch` per call: a test that stubs the global after
   * constructing the flow (which is how every other test in this plugin works)
   * then still reaches the stub, and a proxy or instrumentation installed later
   * is picked up rather than bypassed.
   */
  private readonly injectedFetch;
  private readonly now;
  /** States this process minted, and when each was created. */
  private readonly states;
  constructor(options: WorkBuddyQrLoginOptions);
  /** The region every request here goes to, from the variant descriptor. */
  private region;
  private base;
  /** One plugin-auth request, through the injected or the ambient fetch. */
  private send;
  /** The headers the official CLI sends; the upstream checks the UA. */
  private headers;
  /**
   * Mint a challenge: the QR payload and the state to poll.
   *
   * The state is remembered locally. The upstream also validates it, but a
   * local record is what lets {@link poll} answer `invalid` for a state that
   * was never minted here instead of forwarding an arbitrary value upstream.
   */
  start(): Promise<WorkBuddyQrChallenge>;
  /**
   * Poll one challenge.
   *
   * A non-zero business code is the *normal* "still waiting" answer
   * (`11217:login ing...`), not a failure, so it is reported as `waiting`
   * rather than thrown. The account call is what turns a token into the uid
   * the pool keys on; until it answers a uid, the sign-in is not complete.
   */
  poll(state: string): Promise<WorkBuddyQrPoll>;
  /** Drop an outstanding challenge (the user closed the dialog). */
  cancel(state: string): void;
  /** The domain a variant's credentials carry when the upstream omits one. */
  private defaultDomain;
  private prune;
}
/** A random opaque id, for logging a challenge without exposing its state. */
declare function challengeTag(): string;
//#endregion
//#region src/account-service.d.ts
/** One account as the browser renders it. Never carries token material. */
interface WorkBuddyWebAccount {
  id: string;
  uid: string;
  /** User label when set, else the upstream nickname, else a short uid. */
  name: string;
  label?: string;
  nickname?: string;
  origin: 'desktop' | 'qr' | 'cookie';
  /** Login domain this account speaks to; the card reports the region from it. */
  domain: string;
  /**
   * True when the account can renew itself.
   *
   * A pasted token carries no refresh token, so the card can tell the user that
   * an expiring account needs a fresh paste rather than letting it fail
   * silently at the next request.
   */
  renewable: boolean;
  enabled: boolean;
  /** Whether rotation may pick it right now (enabled, not benched, not dead). */
  available: boolean;
  /** Remaining credit, when the last lookup succeeded. */
  credits?: number;
  /**
   * The cycle's capacity, when the upstream declared one.
   *
   * Optional because "no cap" and "the answer carried none" are both real: a
   * renderer shows a used/total pair only when this is present, and the bare
   * remaining figure otherwise.
   */
  creditsTotal?: number;
  creditsError?: string;
  /** When `credits` was fetched, epoch ms. */
  creditsAtMs?: number;
  /** Access-token expiry, epoch ms; 0 means the source did not say. */
  expiresAtMs: number;
  /** Set when the upstream refused the session and a refresh could not fix it. */
  sessionDead?: boolean;
  /** Present while the account is benched. */
  cooldown?: {
    /** Epoch ms after which it will be tried again. */
    untilMs: number;
    reason: 'rate' | 'credit' | 'session';
    strikes: number;
  };
  lastUsedAtMs: number;
  addedAtMs: number;
}
/** What the account service reports about one variant. */
interface WorkBuddyAccountSnapshot {
  accounts: readonly WorkBuddyWebAccount[];
  /** Identity of the account the catalog/credits are read from, when any. */
  primary?: string;
  /** Identity of the desktop app's current account, when it is in the pool. */
  desktop?: string;
}
/** Options for {@link WorkBuddyAccountService}. */
interface WorkBuddyAccountServiceOptions {
  variant: WorkBuddyVariant;
  pool: WorkBuddyAccountPool;
  /** Reads the desktop app's own credential file (never writes it). */
  store: Pick<WorkBuddyCredentialStore, 'desktopCredential' | 'current'>;
  client: Pick<WorkBuddyUpstreamClient, 'fetchCredits' | 'refreshToken'>;
  qr: WorkBuddyQrLogin;
  logger?: {
    warn(...args: unknown[]): void;
  };
  /**
   * This account's request tally, when the plugin has counted any.
   *
   * Read per snapshot rather than cached: the tally changes with every answered
   * request, and the card is the only consumer.
   */
  usageFor?: (accountId: string) => WorkBuddyUsageSummary | undefined;
  /**
   * Called when the desktop app's credential could not be read at all.
   *
   * The read is best-effort everywhere it is used for IDENTITY: whether the app
   * is signed in decides which pool member is primary, and nothing about the
   * card's ability to answer depends on it. It used to throw out of
   * {@link WorkBuddyAccountService.desktopIdentity} and take the whole status
   * document with it — on the international variant that meant a 500 on the AI
   * status route, so the page was handed no control key and *every* action,
   * including the only way in (paste a token), answered "request failed".
   *
   * The diagnosis is not swallowed: it is handed here so the card can show which
   * file, binary or region is wrong, and the caller keeps its own record.
   */
  onDesktopReadError?: (message: string) => void;
  /** Injectable clock, for tests. */
  now?: () => number;
}
/** One cached credit lookup. */
interface CreditEntry {
  /** What is left, summed over the packages that answered. */
  total?: number;
  /** What the cycle has consumed, when the upstream stated it. */
  used?: number;
  /**
   * The cycle's capacity, summed the same way, when the upstream declared one.
   *
   * Absent for an uncapped account and for one whose answer carried no capacity:
   * both mean "there is no total to state", which is a different fact from a
   * total of zero, so a renderer shows the remaining figure alone rather than a
   * "used / total" pair built from a zero.
   */
  size?: number;
  error?: string;
  atMs: number;
}
/**
 * Owns the pool's network-facing behaviour for one variant.
 *
 * Credit figures are cached per account for a minute. That matters because the
 * composer badge polls while a conversation is open, and an uncached lookup
 * would mean one billing request per account per poll — real traffic against
 * the user's own quota, for a number that changes slowly.
 */
declare class WorkBuddyAccountService {
  private readonly variant;
  private readonly pool;
  private readonly store;
  private readonly client;
  private readonly qr;
  private readonly logger;
  private readonly usageFor;
  private readonly onDesktopReadError;
  private readonly now;
  private readonly credits;
  private readonly inflight;
  constructor(options: WorkBuddyAccountServiceOptions);
  /**
   * Capture the desktop app's current sign-in into the pool.
   *
   * Called at startup and on every credential sweep, which is what makes the
   * desktop account an ordinary pool member: it is upserted (so a token
   * rotation in the app is picked up) but never *required* — signing out of
   * the app leaves the captured account in place, which is the behaviour the
   * whole feature depends on.
   *
   * The write is marked as a *sync*, so re-reading a file that has not moved on
   * cannot resurrect an account the user disabled, clear a benching, revive a
   * dead session, or put the file's stale token back over one the plugin
   * refreshed itself. The file is polled every thirty seconds; a poll is not a
   * sign-in.
   *
   * @returns the captured account, or undefined when the app is not signed in.
   */
  captureDesktop(): Promise<WorkBuddyAccount | undefined>;
  /**
   * Adopt the desktop app's sign-in on the user's explicit request.
   *
   * The background sweep is a *sync* and must not resurrect an account the user
   * removed; choosing "desktop sign-in" in the add-account dialog is the user
   * asking for that account back, so this path clears the dismissal. Returns
   * undefined when the app holds no sign-in to read.
   */
  adoptDesktop(): Promise<WorkBuddyUpsertResult | undefined>;
  /**
   * Capture a credential that came from anywhere into the pool.
   *
   * The region is not re-checked here: {@link WorkBuddyCredentialStore} already
   * refuses a credential belonging to the other product, and the QR flow checks
   * its own answer before it gets this far.
   */
  capture(credential: WorkBuddyCredential, syncDesktop?: boolean): WorkBuddyUpsertResult | undefined;
  /**
   * The desktop app's account identity, when the app is signed in.
   *
   * Never throws. A desktop read that fails (no decryption binary on this
   * platform, a credential for the other region, an unreadable file) is a
   * diagnosis about the app, not a reason the pool cannot be described: the
   * pool's own members still answer, and on the international variant the
   * account has to be ADDED through this page in the first place. The failure is
   * reported through {@link WorkBuddyAccountServiceOptions.onDesktopReadError}.
   */
  desktopIdentity(): Promise<string | undefined>;
  /**
   * The credential the catalog, credits, and probes run as.
   *
   * The desktop app's current account wins while it is usable, so the card's
   * account name and credit figure stay stable while the user is signed in
   * there; otherwise the first available pool member answers. Returning
   * undefined means the variant has nothing to work with at all, which is what
   * hides its model group.
   */
  primaryCredential(): Promise<WorkBuddyCredential | undefined>;
  /** The identity {@link primaryCredential} would answer for. */
  primaryIdentity(): Promise<string | undefined>;
  /**
   * Refresh an account whose access token is at or near expiry.
   *
   * The pool's own copy is the one that gets updated, so a refresh survives a
   * restart. A failed refresh is not fatal: a token that has not actually
   * expired yet still works, which is the same tolerance the single-account
   * store had.
   */
  private refreshIfStale;
  /** Whether the variant has any account at all (enabled, dead, benched or not). */
  hasAccounts(): boolean;
  /** Whether the variant has at least one account rotation may use. */
  hasUsableAccount(): boolean;
  /**
   * One account's remaining credit, cached.
   *
   * @param force - bypass the cache, for a user-initiated refresh.
   */
  creditsFor(account: WorkBuddyAccount, force?: boolean): Promise<CreditEntry>;
  /** Forget a cached credit figure, e.g. after a request spent some. */
  invalidateCredits(id?: string): void;
  /**
   * The snapshot the card's account tab renders.
   *
   * @param withCredits - whether to include per-account balances. The card
   *   window asks for them; a write confirmation does not need them and should
   *   not pay for N billing requests.
   * @param forceCredits - bypass the credit cache.
   */
  snapshot(options?: {
    withCredits?: boolean;
    forceCredits?: boolean;
  }): Promise<WorkBuddyAccountSnapshot>;
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
    account?: WorkBuddyAccount;
    created?: boolean;
    reason?: string;
  };
  /** Add one QR sign-in to the pool. */
  addQrAccount(poll: Extract<Awaited<ReturnType<WorkBuddyQrLogin['poll']>>, {
    status: 'ready';
  }>): {
    account: WorkBuddyAccount;
    created: boolean;
    updated: boolean;
  };
  /** Identity key for a uid/enterprise pair, for callers holding raw values. */
  idOf(uid: string, enterpriseId?: string): string;
}
//#endregion
//#region src/account-route.d.ts
/** Constructor dependencies. */
interface WorkBuddyAccountRouteOptions {
  /** Execute one account action. Never receives raw credential material. */
  handle: (action: WorkBuddyAccountAction) => Promise<WorkBuddyAccountResult>;
  /**
   * Route path to mount. Defaults to the CN variant's path so existing callers
   * and tests keep their behaviour; the international variant passes its own.
   */
  path?: string;
}
/** Parse and shape-check an action; unknown fields are ignored, not trusted. */
declare function parseAccountAction(text: string): WorkBuddyAccountAction | undefined;
/**
 * The control route's handler, extracted so tests can mount it on a bare
 * server with a known key.
 */
declare function workBuddyAccountHandler(deps: WorkBuddyAccountRouteOptions, key: string): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
/** Mount the POST account-control route on an optional webServer context. */
declare function registerWorkBuddyAccountRoute(ctx: Context, deps: WorkBuddyAccountRouteOptions, key: string): void;
//#endregion
//#region src/account-cli.d.ts
/** Render the pool as one text block per account. */
declare function formatAccounts(options: {
  variant: WorkBuddyVariant;
  snapshot: Awaited<ReturnType<WorkBuddyAccountService['snapshot']>>;
  pool: WorkBuddyAccountPool;
  now?: number;
}): string;
/** The machine-readable shape, secret-free by construction. */
declare function accountsJson(options: {
  variant: WorkBuddyVariant;
  snapshot: Awaited<ReturnType<WorkBuddyAccountService['snapshot']>>;
  pool: WorkBuddyAccountPool;
}): Record<string, unknown>;
//#endregion
//#region src/rotation.d.ts
/** What the caller learns about one completed rotation. */
interface WorkBuddyRotationOutcome {
  /** The upstream answer to relay. */
  result: WorkBuddyChatResult;
  /** Identities tried, in order; the last one produced `result`. */
  attempts: readonly string[];
  /** The account whose credential produced the answer, when one did. */
  account?: WorkBuddyAccount;
  /**
   * Set when the pool could not supply any account at all (empty, or every
   * member disabled / benched / dead). `result` is then a synthesized
   * `session_dead` answer so the shim's status mapping still applies.
   */
  exhausted?: true;
}
/** Constructor dependencies. */
interface WorkBuddyRotationOptions {
  pool: WorkBuddyAccountPool;
  client: Pick<WorkBuddyUpstreamClient, 'chatStream' | 'refreshToken'>;
  /**
   * Called after a token refresh lands, so the pool file and any cached
   * credential view agree. Without it a refresh would be lost on restart and
   * every later request would pay for another refresh.
   */
  onRefreshed?: (account: WorkBuddyAccount, credential: WorkBuddyCredential) => void;
  /**
   * Called with the usage one ANSWER reported, attributed to the pool member
   * that produced it.
   *
   * This is the only place those two facts meet: the rotation knows which account
   * served the request, and the answer's stream is where the upstream states what
   * it cost. The stream is teed — the caller's copy is not delayed by this
   * reader, and the accounting can never stall the user's reply.
   */
  onUsage?: (accountId: string, usage: WorkBuddyRequestUsage) => void;
  /**
   * Called once per process with the numeric field names the upstream's usage
   * block actually carried, so an unfamiliar shape is discovered from a log line
   * rather than guessed at in the parser.
   */
  onUsageShape?: (fields: readonly string[]) => void;
  logger?: {
    warn(...args: unknown[]): void;
  };
}
/**
 * Parse an upstream `Retry-After`, which may be seconds or an HTTP date.
 * Returns undefined when absent or unparsable.
 */
declare function parseRetryAfter(value: string | null | undefined, now?: number): number | undefined;
/** Which cooldown class an upstream failure earns. */
declare function cooldownReasonFor(kind: UpstreamErrorKind): WorkBuddyCooldownReason | undefined;
/** Whether another account could plausibly answer differently. */
declare function isAccountScoped(kind: UpstreamErrorKind): boolean;
/**
 * Send one chat body, rotating accounts on account-scoped failures.
 *
 * The body is already prepared for the wire by the caller: this layer chooses
 * *who* sends it, never *what* is sent, so a retry is byte-identical to the
 * attempt before it.
 */
declare class WorkBuddyRotation {
  private readonly pool;
  private readonly client;
  private readonly onRefreshed;
  private readonly onUsage;
  private readonly onUsageShape;
  private readonly logger;
  constructor(options: WorkBuddyRotationOptions);
  /**
   * Hand back an answer whose usage is being counted, without altering it.
   *
   * The body is teed: one branch reaches the caller exactly as it arrived, the
   * other is drained by {@link consumeStreamUsage}. A body that cannot be teed
   * (no stream at all — a shape this upstream does not produce for chat, but the
   * type permits) is returned untouched, because accounting is never worth
   * breaking a reply for.
   */
  private tapUsage;
  /**
   * Attempt the request until an account answers, or the pool runs out.
   *
   * @param body - the prepared JSON body.
   * @param signal - the caller's abort signal; an aborted request stops the
   *   whole rotation rather than moving on to another account.
   */
  send(body: string, signal?: AbortSignal): Promise<WorkBuddyRotationOutcome>;
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
  private bench;
  /**
   * Refresh one account's access token, persisting the result.
   *
   * The three outcomes are kept apart on purpose, because two of them look
   * identical from the outside and mean opposite things: a refusal says the
   * credential is finished, while an unreachable endpoint says nothing at all.
   * Collapsing them into a single `undefined` is what used to sign an account
   * out over a timeout.
   */
  private tryRefresh;
}
//#endregion
//#region src/catalog-store.d.ts
/** Basename of the CN variant's saved catalog inside the Harness home. */
declare const WORKBUDDY_CATALOG_FILENAME = ".workbuddy-catalog.json";
/** One saved catalog: the account it belonged to, and the models it listed. */
interface SavedCatalog {
  /** `uid:enterpriseId` the catalog was fetched for. */
  account: string;
  /** Which document answered, so a CN roster is never served as an AI one. */
  source: string;
  /** When the fetch succeeded, epoch milliseconds. */
  fetchedAtMs: number;
  models: readonly WorkBuddyUpstreamModel[];
  /** App version used as the UA, when the variant needed one. */
  appVersion?: string;
}
/** Plugin-owned saved-catalog path inside the Harness home. */
declare function workbuddyCatalogPath(filename?: string): string;
/** Options for {@link WorkBuddyCatalogStore}. */
interface WorkBuddyCatalogStoreOptions {
  /** Explicit state-file path, overriding the `$DSH_HOME` default. */
  path?: string;
}
/**
 * The last successful catalog per account, read once and written atomically.
 *
 * Malformed content reads as "nothing saved" rather than throwing: this file
 * is an optimization for the offline and first-seconds cases, and a corrupt one
 * must never be able to stop the plugin from serving models.
 */
declare class WorkBuddyCatalogStore {
  private readonly path;
  private entries;
  constructor(options?: WorkBuddyCatalogStoreOptions | string);
  /** Resolved state-file path, for the CLI and tests. */
  filePath(): string;
  private load;
  /** The saved catalog for one account, or `undefined` when there is none. */
  get(account: string): SavedCatalog | undefined;
  /**
   * Remember a catalog for an account, replacing whatever was saved before.
   *
   * A failed write is swallowed: the plugin has already served these models,
   * and losing the *memory* of them is not worth surfacing.
   */
  set(account: string, catalog: Omit<SavedCatalog, 'account'>): void;
  /** Forget one account's catalog — used when that account signs out. */
  delete(account: string): void;
  private persist;
}
//#endregion
//#region src/visibility-store.d.ts
/**
 * Per-account model-visibility preferences: which models the signed-in account
 * has hidden from the DSH model picker (issue #36).
 *
 * A disabled *list*, deliberately not an enabled whitelist: a new account and a
 * model the upstream adds both start visible, and an id that temporarily
 * disappears from the catalog is kept — when the model returns it stays hidden
 * until this account says otherwise. Entries are also kept across sign-outs, so
 * returning to an account restores exactly what it left.
 *
 * One file per variant (the two endpoints share model ids but never
 * preferences), keyed by the same `uid:enterpriseId` identity the saved
 * catalogs and probe records use. Not a place for secrets: model-id strings
 * only, never a token, and never written into the desktop auth file or the
 * plugin-owned credential copy — hiding a model is a picker preference, not
 * credential state.
 *
 * Why a plugin-owned file rather than a settings section: the settings sections
 * are statically-typed schemastery objects, and `settings.yaml` is account-global
 * — a per-uid dynamic map fits neither without weakening the schema or mixing
 * one account's preferences into another's config. The saved-catalog and probe
 * stores already persist per-account data this way, so this store follows them:
 * version-tagged document, atomic write with `0o600`, and a malformed file that
 * reads as "nothing saved" rather than throwing.
 *
 * @module dsh-workbuddy-connect/visibility-store
 */
/** Basename of the CN variant's visibility file inside the Harness home. */
declare const WORKBUDDY_VISIBILITY_FILENAME = ".workbuddy-model-visibility.json";
/** Plugin-owned visibility-file path inside the Harness home. */
declare function workbuddyVisibilityPath(filename?: string): string;
/** Options for {@link WorkBuddyVisibilityStore}. */
interface WorkBuddyVisibilityStoreOptions {
  /** Explicit state-file path, overriding the `$DSH_HOME` default. */
  path?: string;
}
/**
 * The per-account hidden-model lists, read once and written atomically.
 *
 * Unlike the saved-catalog store, a failed *write* propagates: the caller
 * reports it to the user rather than answering "hidden" for a preference that
 * did not persist. Reads stay forgiving — a corrupt or unreadable file is
 * "nothing hidden", which only ever shows models the account can still pick.
 */
declare class WorkBuddyVisibilityStore {
  private readonly path;
  private accounts;
  constructor(options?: WorkBuddyVisibilityStoreOptions | string);
  /** Resolved state-file path, for the CLI and tests. */
  filePath(): string;
  private load;
  /** The model ids one account has hidden; empty when it never hid any. */
  disabled(account: string): readonly string[];
  /**
   * The ids one account allows, when it narrowed the list; undefined = no
   * allowlist, i.e. show everything {@link disabled} does not hide.
   *
   * undefined and `[]` are deliberately NOT the same value here even though
   * both are stored as an absent list: a caller asking "did the user narrow
   * this?" needs to know, and only the caller can decide whether an empty
   * allowlist means "nothing allowed" or "no filter". Storage keeps no such
   * distinction (see {@link SavedVisibility.allowlist}), so this returns
   * undefined for both and the caller's own empty-string check is what tells
   * the cases apart.
   */
  allowlist(account: string): readonly string[] | undefined;
  /**
   * Replace one account's allowlist.
   *
   * Passing undefined (or an empty list) clears it, which restores the state
   * where the account shows everything `disabled` does not hide — that is what
   * the card's "show all" action does, and it is deliberately the same call as
   * "narrow to these": one method, one meaning per argument.
   *
   * The hidden list is untouched by an allowlist write. A model in `disabled`
   * stays hidden if it is later added to the allowlist only through the
   * subtraction below — see {@link effectiveHidden}, which is what every reader
   * must go through.
   */
  setAllowlist(account: string, ids: readonly string[] | undefined): void;
  /**
   * The ids the picker must actually hide for one account: the union of the
   * allowed-list's complement and the explicit hide-list.
   *
   * The ONE reader every caller uses. With an allowlist set, everything outside
   * it is hidden, and an id in `disabled` stays hidden even if it was also
   * allowed — the two lists can disagree (a stale allowlist entry beside an
   * explicit hide), and "hidden" winning is the only resolution that does not
   * resurrect a model the user turned off.
   */
  effectiveHidden(account: string, catalogIds: readonly string[]): readonly string[];
  /**
   * Show or hide one model for one account, persisting before committing.
   *
   * Re-enabling (showing) the last hidden model removes the account's entry
   * entirely — an absent entry and an empty list mean the same thing
   * (everything visible), and the file should not accumulate empty buckets.
   * Throws when the write fails, leaving the in-memory state untouched so a
   * re-read cannot lie about what was persisted.
   */
  setVisible(account: string, model: string, visible: boolean): void;
  private persist;
}
//#endregion
//#region src/probe-service.d.ts
/** What the caller learns about a completed probe. */
type WorkBuddyProbeStatus = {
  state: 'ok';
  validation: WorkBuddyProbeRecord['validation'];
  efforts: readonly string[];
  requests: number;
} | {
  state: 'unavailable';
  reason: string;
};
/** Options for {@link WorkBuddyProbeService}. */
interface WorkBuddyProbeServiceOptions {
  store: WorkBuddyProbeStore;
  catalog: WorkBuddyCatalog;
  credentials: WorkBuddyCredentialStore;
  client: WorkBuddyUpstreamClient;
  /** Whether probing is permitted at all; consulted before every sweep. */
  consent: () => boolean;
  /**
   * The account currently in effect, as `uid:enterpriseId`, or `undefined`
   * while signed out.
   *
   * Records are read and written against this identity, and it is re-checked
   * after the sweep finishes: an observation produced under account A must not
   * be stored once account B is in effect, however long the probe took. The
   * store's per-account keying alone cannot catch that, because an in-flight
   * probe completes *after* the switch has already happened.
   */
  account: () => string | undefined;
  sentinel?: SentinelFactory;
  /**
   * Which endpoint's rejection vocabulary sweeps read. The two apps talk to
   * different upstreams that answer a bad effort with different codes, so each
   * runtime passes its own region instead of sharing one widening set.
   */
  region: ProbeRegion;
  /** Injectable for tests; defaults to the live upstream sender. */
  send?: (modelId: string) => ProbeSender;
}
/**
 * Serial probe runner. One instance is shared by the manual API and any
 * future automatic trigger, so the two can never overlap.
 */
declare class WorkBuddyProbeService {
  private readonly options;
  private queue;
  private readonly pending;
  private running;
  constructor(options: WorkBuddyProbeServiceOptions);
  /** Whether a sweep is in flight right now. */
  isRunning(): boolean;
  /**
   * The record the adapter may use for this model, or `undefined`.
   *
   * Applies the plan's precedence (§5): a declared set always wins, so a model
   * that declares `supportedEfforts` is never answered from an observation.
   */
  recordFor(modelId: string): WorkBuddyProbeRecord | undefined;
  /**
   * Probe one model, serially.
   *
   * The authenticated manual route supplies one-request consent after UI
   * confirmation. Other callers must pass the configured consent gate.
   * Manual consent never changes the automatic-probing configuration.
   * Explicit requests bypass historical results, but share an ongoing run.
   */
  probe(modelId: string, manualConsent?: boolean): Promise<WorkBuddyProbeStatus>;
}
//#endregion
//#region src/host-heartbeat.d.ts
/**
 * Host-side heartbeat: a small JSON file written under `$DSH_HOME` once the
 * `workbuddy` provider is registered. The status CLI reads it to report
 * whether the host bundle is alive, independent of the browser card.
 *
 * The browser (client) bundle cannot write files; its health is reported
 * only through `console.error` on failure (see `src/client/index.tsx`).
 * This asymmetry is intentional: the host is the load-bearing half, and
 * a missing heartbeat unambiguously means the host never started.
 *
 * @module dsh-workbuddy-connect/host-heartbeat
 */
/** Basename of the host heartbeat file inside the Harness home. */
declare const WORKBUDDY_HOST_HEARTBEAT_FILENAME = ".workbuddy-host-heartbeat.json";
/** Current on-disk heartbeat format; readers reject others. */
declare const HEARTBEAT_FORMAT_VERSION = 1;
/** On-disk shape of the heartbeat. */
interface WorkBuddyHostHeartbeat {
  version: typeof HEARTBEAT_FORMAT_VERSION;
  package: 'dsh-workbuddy-connect';
  pluginVersion: string;
  /** Epoch milliseconds when the host registered the provider. */
  registeredAt: number;
  /** Host process PID, to distinguish a stale heartbeat after a crash. */
  pid: number;
}
/** Absolute path of the host heartbeat file. */
declare function workbuddyHostHeartbeatPath(): string;
/** Remove the heartbeat on plugin disposal so a stale file does not linger. */
declare function clearHostHeartbeat(): Promise<void>;
/** Read and validate the heartbeat; returns `undefined` when absent or malformed. */
declare function readHostHeartbeat(): Promise<WorkBuddyHostHeartbeat | undefined>;
/**
 * Absolute start time (epoch ms) of the process holding `pid`, or `undefined`
 * when it cannot be determined (no such PID, platform lacks a readable source).
 *
 * - macOS / Linux: `ps -o lstart=` prints a local-time "EEE MMM DD HH:MM:SS YYYY";
 *   `Date.parse` resolves it against the local clock, which matches how
 *   `registeredAt` (a `Date.now()` absolute value) is expressed.
 * - Windows: `wmic` prints a CIM_DATETIME `CreationDate` — local fields plus a
 *   signed minute offset (see {@link parseWmiCreationDate}); the epoch it
 *   yields is comparable to `registeredAt`.
 *
 * Failures return `undefined` so callers can fall back to plain PID liveness
 * rather than mis-report a running host as dead.
 */
declare function processStartTimeMs(pid: number): number | undefined;
/**
 * Whether the heartbeat's PID is still alive *and* still the same process that
 * registered it. A stale heartbeat (host crashed without clearing the file)
 * is distinguished from a live host by two checks:
 *
 * 1. `process.kill(pid, 0)` — the PID exists (signal 0 tests existence).
 * 2. The process holding that PID started at or before `registeredAt`. A host
 *    that registered the heartbeat must have been started before writing it,
 *    so `start <= registeredAt`; a recycled PID belongs to an unrelated process
 *    started after the host died, so `start > registeredAt` correctly reads dead.
 *
 * PID-only detection is not enough: after a crash the OS may hand the same PID
 * to an unrelated process, and the un-cleared stale heartbeat would otherwise
 * produce a false "Host running". When the process start time cannot be read
 * (e.g. unsupported platform) the check degrades to plain PID liveness.
 */
declare function isHeartbeatProcessAlive(heartbeat: WorkBuddyHostHeartbeat): boolean;
//#endregion
//#region src/index.d.ts
/** Stable Cordis plugin name. */
declare const name = "llm-workbuddy";
/** The model registry required before the provider can register. */
declare const inject: string[];
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
declare const WORKBUDDY_AI_SETTINGS_NS: SettingsNamespace;
/**
 * The plugin's own row id in the active profile's composition.
 *
 * On DSH 0.1.7 a settings form write is addressed by this id — the Loader row's
 * `id` field, which `cordis.patch.yml` declares as `llm-workbuddy` — rather
 * than by a per-variant namespace. It is a fallback only: the live id is read
 * back from `configEditor.entries()`, so a profile that renamed the row still
 * writes through the right one.
 */
declare const PROFILE_ENTRY_ID = "llm-workbuddy";
/**
 * The config fields that are not display preferences.
 *
 * The preference half is derived from {@link WORKBUDDY_PREFERENCES}, so this
 * plugin's config has exactly one place per field no matter which kind it is.
 */
interface WorkBuddyConfiguredFields {
  /** Explicit WorkBuddy (CN) desktop auth-file path, overriding env and platform defaults. */
  authFile?: string;
  /** Explicit WorkBuddy AI (international) desktop auth-file path, overriding env and platform defaults. */
  authFileAI?: string;
  /**
   * Whether the user has authorized sending probe requests about reasoning
   * efforts. Off by default: a probe spends real credit, so nothing is sent
   * until the user explicitly agrees.
   */
  probeConsent?: boolean;
  /** Use the largest context window the international catalog explicitly offers. */
  useMaximumContextWindow?: boolean;
}
/** Plugin configuration. */
type Config = WorkBuddyPreferenceConfig & WorkBuddyConfiguredFields;
/**
 * The composition schema: what the loader reads and what 0.1.7's settings forms
 * project.
 *
 * Every field is marked volatile, so a write through the 0.1.7 settings wire
 * commits IN PLACE (no fiber remount) and notifies this plugin through
 * `loader/volatile-update`. `apply()` therefore reads the live values through
 * `current()`, which unwraps the references on every call.
 */
declare const Config: z<Config>;
/**
 * The settings namespace this plugin's fields are served under.
 *
 * On 0.1.7 a plugin's composition entry IS its settings namespace, so this is
 * the profile row id (see {@link PROFILE_ENTRY_ID}) rather than a name the
 * plugin installs. Kept exported because the host CLI and the tests resolve
 * the served descriptor by it.
 */
declare const WORKBUDDY_SETTINGS_NS: SettingsNamespace;
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
declare function visibilityAccountOf(credential: Pick<WorkBuddyCredential, 'uid' | 'enterpriseId'>): string | undefined;
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
    'loader/volatile-update'(paths: readonly (readonly string[])[]): void;
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
declare function apply(ctx: Context, config: Config): void;
//#endregion
export { AI_VARIANT, type AppVersionInfo, CN_APP_VERSION_FILENAME, CN_VARIANT, type ChatIdentity, Config, FALLBACK_CN_APP_VERSION, FALLBACK_WORKBUDDY_AI_MODELS, FALLBACK_WORKBUDDY_MODELS, PROBE_EFFORT_CANDIDATES, PROFILE_ENTRY_ID, type ProbeAttempt, type ProbeOutcome, type ProbeSender, type ResolveChatIdentityOptions, type UpstreamErrorKind, WORKBUDDY_ACCOUNTS_FILENAME, WORKBUDDY_AI_SETTINGS_NS, WORKBUDDY_APP_VERSION_FILENAME, WORKBUDDY_AUTH_FILENAME, WORKBUDDY_AUTH_FILE_ENV, WORKBUDDY_CATALOG_FILENAME, WORKBUDDY_HOST_HEARTBEAT_FILENAME, WORKBUDDY_PROBE_FILENAME, WORKBUDDY_PROVIDER, WORKBUDDY_SETTINGS_NS, WORKBUDDY_STREAM_IDLE_TIMEOUT_MS, WORKBUDDY_VARIANTS, WORKBUDDY_VISIBILITY_FILENAME, type WorkBuddyAccount, type WorkBuddyAccountInput, type WorkBuddyAccountOrigin, WorkBuddyAccountPool, type WorkBuddyAccountPoolOptions, type WorkBuddyAccountRouteOptions, WorkBuddyAccountService, type WorkBuddyAccountServiceOptions, type WorkBuddyAccountSnapshot, type WorkBuddyAdapter, type WorkBuddyAppVersionSource, type WorkBuddyAuthStatus, WorkBuddyCatalog, type WorkBuddyCatalogFetch, WorkBuddyCatalogStore, type WorkBuddyChatResult, type WorkBuddyChatSender, type WorkBuddyCooldown, type WorkBuddyCooldownReason, WorkBuddyCredentialStore, type WorkBuddyCredits, type WorkBuddyEffort, type WorkBuddyHostHeartbeat, type WorkBuddyModelBilling, type WorkBuddyModelInfo, type WorkBuddyModelReasoning, type WorkBuddyProbeRecord, WorkBuddyProbeService, type WorkBuddyProbeStatus, WorkBuddyProbeStore, type WorkBuddyProbeValidation, type WorkBuddyPromotion, type WorkBuddyQrChallenge, WorkBuddyQrLogin, type WorkBuddyQrLoginOptions, type WorkBuddyQrPoll, type WorkBuddyRefreshOutcome, WorkBuddyRotation, type WorkBuddyRotationOptions, type WorkBuddyRotationOutcome, type WorkBuddyShim, type WorkBuddyUpsertResult, WorkBuddyUpstreamClient, type WorkBuddyUpstreamModel, type WorkBuddyVariant, WorkBuddyVisibilityStore, type WorkBuddyWebAccount, accountIdOf, accountsJson, appUserAgent, apply, challengeTag, chatBaseForDomain, chatBaseForRegion, chatUserAgent, classifyUpstreamError, clearHostHeartbeat, cooldownDurationMs, cooldownReasonFor, createStoreSender, createWorkBuddyAdapter, createWorkBuddyShim, credentialAccountId, credentialOf, defaultDesktopAuthCandidates, defaultDesktopAuthPath, desktopAuthCandidatesFor, fallbackChatIdentity, fingerprintModel, formatAccounts, inject, installedAppVersion, isAccountScoped, isHeartbeatProcessAlive, modelWithCurrentPromotion, name, normalizeCredits, originForRegion, parseAccountAction, parseModelCatalog, parseRetryAfter, parseWorkBuddyAuth, prepareChatBody, prepareInternationalChatBody, probeModel, processStartTimeMs, randomSentinel, readBundleVersion, readCliVersion, readHostHeartbeat, regionOf, registerWorkBuddyAccountRoute, resolveAppVersion, resolveChatIdentity, validAppVersion, validCliVersion, variantFor, visibilityAccountOf, workBuddyAccountHandler, workbuddyAccountsPath, workbuddyCatalogPath, workbuddyHostHeartbeatPath, workbuddyOwnAuthPath, workbuddyProbePath, workbuddyVisibilityPath };