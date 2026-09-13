import z from "@deepseek-ai/schemastery";
import "@earendil-works/pi-ai";
import { PiAiAdapter } from "@deepseek-ai/dsh-llm-pi-ai";
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
/**
 * Probe one model.
 *
 * `options.candidates` exists so tests can shorten the sweep; production always
 * uses {@link PROBE_EFFORT_CANDIDATES}.
 */
declare function probeModel(options: {
  send: ProbeSender;
  sentinel?: SentinelFactory;
  candidates?: readonly WorkBuddyEffort[];
  timeoutMs?: number;
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
}
/** Aggregated credit answer for one credential. */
interface WorkBuddyCredits {
  total: number;
  accounts: readonly WorkBuddyCreditAccount[];
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
  /** Provenance of the most recent successful catalog fetch, for the card. */
  lastCatalog: WorkBuddyCatalogFetch | undefined;
  constructor(options?: WorkBuddyUpstreamClientOptions);
  /** POST the chat endpoint; a successful answer is the raw SSE response. */
  chatStream(credential: WorkBuddyCredential, bodyJson: string, signal?: AbortSignal): Promise<WorkBuddyChatResult>;
  /** POST the token-refresh endpoint; the caller merges the outcome. */
  refreshToken(credential: WorkBuddyCredential): Promise<WorkBuddyRefreshOutcome>;
  /**
   * GET the personal model catalog.
   *
   * Two upstream documents feed this, one per variant:
   *
   * - CN (`workbuddy`): `/console/enterprises/personal/models`, the document
   *   the official CLI itself consumes. Unchanged behaviour.
   * - International (`workbuddy-ai`): `/v3/config`, the product document the
   *   App's main process fetches. The gateway splits it by User-Agent, so this
   *   request carries the App-shaped UA while every other request keeps the
   *   CLI UA it has always sent.
   *
   * Both are unwrapped and classified the same way — `readEnvelope` plus
   * `envelopeError` — so an expired session or exhausted credit is reported as
   * such rather than as a generic catalog failure.
   */
  fetchModels(credential: WorkBuddyCredential, signal?: AbortSignal): Promise<readonly WorkBuddyUpstreamModel[]>;
  /** POST the billing endpoint for the aggregated remaining credit. */
  fetchCredits(credential: WorkBuddyCredential): Promise<WorkBuddyCredits>;
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
/** Parse either response shape after its envelope has been checked. */
declare function parseModelCatalog(data: Record<string, unknown>, international?: boolean): readonly WorkBuddyUpstreamModel[];
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
   * Basename of the plugin-owned saved-catalog file under `$DSH_HOME`.
   *
   * One per variant, like the probe records: the two endpoints disagree about
   * rates, windows, and even which models exist for a shared id, so a catalog
   * saved from one must never be served as the other's.
   */
  catalogFilename: string;
  /** Same-origin status route consumed by this variant's card. */
  statusPath: string;
  /** Same-origin account-control route consumed by this variant's card. */
  accountPath: string;
  /** Same-origin probe-control route consumed by this variant's card. */
  probePath: string;
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
 * `%LOCALAPPDATA%` (Local), older ones under `%APPDATA%` (Roaming). WSL probes
 * those same Windows locations through its mounted Windows profile before the
 * native Linux location.
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
   */
  private readDesktop;
  private readOwn;
  /** Whether any desktop-file candidate exists as a regular file; diagnostics only. */
  desktopFilePresent(): Promise<boolean>;
}
//#endregion
//#region src/catalog.d.ts
/** One model entry the adapter exposes. */
type WorkBuddyModelInfo = WorkBuddyUpstreamModel;
/**
 * Static CLI models observed on the CN endpoint (re-verified against the live
 * catalog 2026-09-01, including the thinking-effort and billing metadata). The
 * upstream refresh replaces this list at startup; it exists so the provider
 * registers with a usable catalog even while the first fetch is in flight or
 * offline.
 *
 * The list tracks the `cli` agent's model roster exactly: the 16 models the
 * desktop CLI offers. Reasoning metadata is taken verbatim from the live
 * endpoint — each model's supported effort set and whether thinking can be
 * disabled — and the `free` flag follows the upstream `x0.00` credits marker.
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
   * subscription. Without this a record outlived the account that produced it,
   * so signing out and in as someone else inherited the previous account's
   * detected levels. Records written before this field existed carry no
   * identity and are therefore never reused.
   */
  account?: string;
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
 * The plugin's probe records: read once, written atomically, never trusted
 * across a fingerprint change or past the TTL.
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
   * The usable record for a model, or `undefined` when there is none, it is
   * expired, it was taken against a different catalog row, or it belongs to a
   * different account.
   *
   * @param account - the account in effect, as `uid:enterpriseId`. Records are
   *   only returned for the account that produced them.
   */
  get(modelId: string, fingerprint: string, account: string): WorkBuddyProbeRecord | undefined;
  /**
   * Store one observation. Only a decisive answer (`validating` /
   * `non-validating`) replaces an existing decisive record: a transient
   * `unknown` must not erase knowledge the user already paid for.
   */
  set(modelId: string, record: WorkBuddyProbeRecord): void;
  /** Drop every record; used by the card's explicit "clear" action. */
  clear(): void;
  /** Every record currently held, for status display. */
  all(): Readonly<Record<string, WorkBuddyProbeRecord>>;
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
   * could not revive it. Kept as a flag rather than a deletion: the account
   * still shows in the list (so the user can see what happened and delete it),
   * and it never participates in rotation again.
   */
  sessionDead?: boolean;
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
  /** Merge a token refresh into a stored account. */
  updateTokens(id: string, tokens: {
    accessToken: string;
    refreshToken?: string;
    expiresAtMs?: number;
    domain?: string;
    refreshExpiresAtMs?: number;
  }): WorkBuddyAccount | undefined;
  /** Remove one account. */
  remove(id: string): boolean;
  /** Enable or disable one account. */
  setEnabled(id: string, enabled: boolean): boolean;
  /** Set or clear the user's label for one account. */
  setLabel(id: string, label: string | undefined): boolean;
  /**
   * Reorder the pool. Ids not named keep their relative order after the named
   * ones, so a stale client cannot drop an account it did not know about.
   */
  reorder(ids: readonly string[]): void;
  /** Mark an account as having just served a request. */
  markUsed(id: string): void;
  /**
   * Bench an account.
   *
   * `strikes` increments when the previous benching is still in force (the
   * account failed again as soon as it was retried), and restarts at 1
   * otherwise. That is what makes the backoff grow under sustained limiting
   * and reset once the account has genuinely recovered.
   *
   * @param retryAfterMs - upstream's own `Retry-After`, which wins over the
   *   schedule: the provider knows its window better than any backoff we pick.
   */
  cooldown(id: string, reason: WorkBuddyCooldownReason, retryAfterMs?: number): WorkBuddyCooldown | undefined;
  /** Clear a benching after a success. */
  clearCooldown(id: string): void;
  /** Mark an account's session as permanently dead. */
  markSessionDead(id: string): void;
  /** Whether an account may be picked right now. */
  isAvailable(account: WorkBuddyAccount, now?: number): boolean;
  /**
   * The next account to try, excluding ids already tried in this request.
   *
   * Least-recently-used wins, with pool order as the tiebreak. LRU rather than
   * round-robin because a restart, a new sign-in, or a user reorder all reset
   * a cursor but leave "when did this account last work" meaningful.
   *
   * @param tried - identities already attempted for the request in flight.
   */
  next(tried: ReadonlySet<string>, now?: number): WorkBuddyAccount | undefined;
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
  /** Injectable clock, for tests. */
  now?: () => number;
}
/** One cached credit lookup. */
interface CreditEntry {
  total?: number;
  error?: string;
  atMs: number;
}
/**
 * Owns the pool's network-facing behaviour for one variant.
 *
 * Credit figures are cached per account for a minute. That matters because the
 * floating window polls while a conversation is open, and an uncached lookup
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
   * @returns the captured account, or undefined when the app is not signed in.
   */
  captureDesktop(): Promise<WorkBuddyAccount | undefined>;
  /**
   * Capture a credential that came from anywhere into the pool.
   *
   * The region is not re-checked here: {@link WorkBuddyCredentialStore} already
   * refuses a credential belonging to the other product, and the QR flow checks
   * its own answer before it gets this far.
   */
  capture(credential: WorkBuddyCredential): WorkBuddyAccount;
  /** The desktop app's account identity, when the app is signed in. */
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
   * The snapshot the card's account tab and the floating window render.
   *
   * @param withCredits - whether to include per-account balances. The floating
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
  private readonly logger;
  constructor(options: WorkBuddyRotationOptions);
  /**
   * Attempt the request until an account answers, or the pool runs out.
   *
   * @param body - the prepared JSON body.
   * @param signal - the caller's abort signal; an aborted request stops the
   *   whole rotation rather than moving on to another account.
   */
  send(body: string, signal?: AbortSignal): Promise<WorkBuddyRotationOutcome>;
  /** Apply the cooldown a failure earns, with the upstream's own hint when given. */
  private bench;
  /**
   * Refresh one account's access token, persisting the result.
   *
   * A refresh with no stored refresh token cannot succeed and is reported as
   * such rather than attempted.
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
   * caller's `clear()` on an account switch is not sufficient on its own,
   * because an in-flight probe completes *after* that clear.
   */
  account: () => string | undefined;
  sentinel?: SentinelFactory;
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
 * - Windows: WMI `CreationDate` is UTC (`YYYYMMDDHHMMSS.mmm+zzzz`); parsed with
 *   `Date.UTC`, again comparable to `registeredAt`.
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
declare const WORKBUDDY_SETTINGS_NS: SettingsNamespace;
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
declare const WORKBUDDY_AI_SETTINGS_NS: SettingsNamespace;
/** Plugin configuration. */
interface Config {
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
  /**
   * Whether the floating account window is drawn in the conversation. On by
   * default: it is the only place the pool's state is visible while chatting,
   * which is exactly when a rotation matters.
   */
  floatingAccounts?: boolean;
}
declare const Config: z<Config>;
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
export { AI_VARIANT, type AppVersionInfo, CN_VARIANT, Config, FALLBACK_WORKBUDDY_AI_MODELS, FALLBACK_WORKBUDDY_MODELS, PROBE_EFFORT_CANDIDATES, type ProbeAttempt, type ProbeOutcome, type ProbeSender, type UpstreamErrorKind, WORKBUDDY_ACCOUNTS_FILENAME, WORKBUDDY_AI_SETTINGS_NS, WORKBUDDY_APP_VERSION_FILENAME, WORKBUDDY_AUTH_FILENAME, WORKBUDDY_AUTH_FILE_ENV, WORKBUDDY_CATALOG_FILENAME, WORKBUDDY_HOST_HEARTBEAT_FILENAME, WORKBUDDY_PROBE_FILENAME, WORKBUDDY_PROVIDER, WORKBUDDY_SETTINGS_NS, WORKBUDDY_STREAM_IDLE_TIMEOUT_MS, WORKBUDDY_VARIANTS, type WorkBuddyAccount, type WorkBuddyAccountInput, type WorkBuddyAccountOrigin, WorkBuddyAccountPool, type WorkBuddyAccountPoolOptions, type WorkBuddyAccountRouteOptions, WorkBuddyAccountService, type WorkBuddyAccountServiceOptions, type WorkBuddyAccountSnapshot, type WorkBuddyAdapter, type WorkBuddyAppVersionSource, type WorkBuddyAuthStatus, WorkBuddyCatalog, type WorkBuddyCatalogFetch, WorkBuddyCatalogStore, type WorkBuddyChatResult, type WorkBuddyChatSender, type WorkBuddyCooldown, type WorkBuddyCooldownReason, WorkBuddyCredentialStore, type WorkBuddyCredits, type WorkBuddyEffort, type WorkBuddyHostHeartbeat, type WorkBuddyModelBilling, type WorkBuddyModelInfo, type WorkBuddyModelReasoning, type WorkBuddyProbeRecord, WorkBuddyProbeService, type WorkBuddyProbeStatus, WorkBuddyProbeStore, type WorkBuddyProbeValidation, type WorkBuddyPromotion, type WorkBuddyQrChallenge, WorkBuddyQrLogin, type WorkBuddyQrLoginOptions, type WorkBuddyQrPoll, type WorkBuddyRefreshOutcome, WorkBuddyRotation, type WorkBuddyRotationOptions, type WorkBuddyRotationOutcome, type WorkBuddyShim, type WorkBuddyUpsertResult, WorkBuddyUpstreamClient, type WorkBuddyUpstreamModel, type WorkBuddyVariant, type WorkBuddyWebAccount, accountIdOf, accountsJson, appUserAgent, apply, challengeTag, chatBaseForDomain, chatBaseForRegion, classifyUpstreamError, clearHostHeartbeat, cooldownDurationMs, cooldownReasonFor, createStoreSender, createWorkBuddyAdapter, createWorkBuddyShim, credentialAccountId, credentialOf, defaultDesktopAuthCandidates, defaultDesktopAuthPath, desktopAuthCandidatesFor, fingerprintModel, formatAccounts, inject, installedAppVersion, isAccountScoped, isHeartbeatProcessAlive, modelWithCurrentPromotion, name, normalizeCredits, originForRegion, parseAccountAction, parseModelCatalog, parseRetryAfter, parseWorkBuddyAuth, prepareChatBody, prepareInternationalChatBody, probeModel, processStartTimeMs, randomSentinel, readBundleVersion, readHostHeartbeat, regionOf, registerWorkBuddyAccountRoute, resolveAppVersion, validAppVersion, variantFor, workBuddyAccountHandler, workbuddyAccountsPath, workbuddyCatalogPath, workbuddyHostHeartbeatPath, workbuddyOwnAuthPath, workbuddyProbePath };