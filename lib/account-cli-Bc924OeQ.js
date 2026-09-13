import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir, release } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { withFileLock, writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
//#region src/app-version.ts
/**
* The international desktop app's version, used as the `/v3/config` UA.
*
* The App-shaped catalog is served only to a User-Agent carrying the product
* name (see `docs/workbuddy-ai-international-research-2026-09-11.md` §2.7).
* That document's conclusion recommended the space form `WorkBuddy AI/<v>`;
* re-measured on 2026-09-11 the *space* form is rejected (HTTP 400, code
* 12403) while the terse `WorkBuddyAI/<v>` form — with or without the space
* removed — returns the 21-model App document. The UA is therefore built from
* the form verified in code, not from the earlier prose.
*
* The version is only ever a UA component: a missing App, an unreadable
* plist, or a bad cached value degrades to the last saved value and finally to
* a compiled-in constant, and never blocks credential use or the provider.
*
* @module dsh-workbuddy-connect/app-version
*/
/**
* Last-resort UA version.
*
* The gateway ignores the version number when splitting the UA (research §2.7.2
* item 2: `CLI/1.0.0`, `CLI/99.0.0` and the real version all return the same
* document), so this constant is a shape requirement rather than a currency
* claim. It is *not* used to infer anything about model capabilities.
*/
const FALLBACK_APP_VERSION = "5.5.2";
/** Basename of the saved version under `$DSH_HOME`. */
const WORKBUDDY_APP_VERSION_FILENAME = ".workbuddy-ai-version.json";
/**
* Whether a string is safe to interpolate into an HTTP header.
*
* Strict on purpose: the value reaches a header, so anything that could split
* the request (CR, LF, spaces beyond the separator) or inject a second UA
* token must never pass. The App's own version is always `N.N.N` or `N.N.N.N`.
*/
function validAppVersion(value) {
	return typeof value === "string" && /^\d{1,6}(?:\.\d{1,6}){1,3}$/u.test(value);
}
/** macOS App-bundle roots: system-wide first, then the user's own install. */
function macAppRoots() {
	return ["/Applications", join(homedir(), "Applications")];
}
/**
* Read `CFBundleShortVersionString` out of an `Info.plist`.
*
* Parsed as XML rather than grepped, because the plist contains several
* `<string>` values and a regex would be one unrelated key away from
* returning the wrong one. A binary plist has no `<dict>` in its bytes and is
* reported as unreadable (the saved value then applies) rather than guessed at.
*/
async function readBundleVersion(plistPath) {
	let text;
	try {
		text = await readFile(plistPath, "utf8");
	} catch {
		return;
	}
	const version = /<key>\s*CFBundleShortVersionString\s*<\/key>\s*<string>([^<]*)<\/string>/u.exec(text)?.[1]?.trim();
	return validAppVersion(version) ? version : void 0;
}
/**
* The installed international App's version, or `undefined` when it is not
* installed (or not readable).
*
* Windows and Linux have no verified bundle-metadata location yet, so this
* returns `undefined` there and the saved/fallback value is used instead of
* guessing a path — the same discipline the credential discovery follows.
*/
async function installedAppVersion() {
	if (process.platform !== "darwin") return void 0;
	for (const root of macAppRoots()) {
		const bundle = join(root, "WorkBuddy AI.app");
		const version = await readBundleVersion(join(bundle, "Contents", "Info.plist"));
		if (version !== void 0) return {
			version,
			bundle
		};
	}
}
/** Saved-version file path under the Harness home. */
function appVersionPath() {
	return join(resolveDshHome(), WORKBUDDY_APP_VERSION_FILENAME);
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
async function resolveAppVersion(options = {}) {
	const path = options.path ?? appVersionPath();
	const installed = await (options.installed ?? installedAppVersion)();
	if (installed !== void 0 && validAppVersion(installed.version)) {
		try {
			await writeFileAtomic(path, `${JSON.stringify({
				version: installed.version,
				bundle: installed.bundle,
				observedAt: Date.now()
			}, null, 2)}\n`, {
				mode: 384,
				dirMode: 448
			});
		} catch {}
		return {
			version: installed.version,
			source: "installed",
			bundle: installed.bundle
		};
	}
	try {
		const saved = JSON.parse(await readFile(path, "utf8"));
		if (typeof saved === "object" && saved !== null) {
			const version = saved["version"];
			if (validAppVersion(version)) return {
				version,
				source: "saved"
			};
		}
	} catch {}
	return {
		version: FALLBACK_APP_VERSION,
		source: "fallback"
	};
}
/**
* Build the App-shaped User-Agent for catalog requests.
*
* `WorkBuddyAI/<version>` with no space is the form measured to reach the App
* document; the space form is rejected with 400/12403. Throws on an invalid
* version rather than sending a malformed header.
*/
function appUserAgent(version) {
	if (!validAppVersion(version)) throw new Error(`invalid WorkBuddy AI version for User-Agent: ${JSON.stringify(version)}`);
	return `WorkBuddyAI/${version}`;
}
//#endregion
//#region src/probe.ts
/**
* The reasoning-effort probe: decide whether a model's `reasoning_effort`
* parameter is actually validated, and if so which canonical values it accepts.
*
* Implements `docs/reasoning-effort-probe-plan.md` §4. The order matters and is
* not an optimization:
*
* 1. **Baseline** (no `reasoning_effort`) proves the model, credential, and
*    request shape work at all, so a later rejection can be attributed.
* 2. **Sentinel** (a fresh random, impossible-to-collide value) answers the one
*    question a per-level sweep cannot: does the upstream validate the field?
*    A model that accepts the sentinel answers 200 to *everything*, so its
*    per-level results would be uniformly false positives.
* 3. **Levels**, only after the sentinel was refused.
*
* The result is an observation, never a capability claim. Even a fully
* successful sweep means "the upstream accepted these spellings", not "these
* spellings change how the model thinks".
*
* @module dsh-workbuddy-connect/probe
*/
/**
* The canonical values a probe tests, in a fixed order.
*
* `minimal` is absent: it appears in no upstream vocabulary. `off` is absent
* by policy — disabling thinking is a separate capability the upstream must
* declare through `canDisableThinking`, never something probing may infer.
*/
const PROBE_EFFORT_CANDIDATES = [
	"low",
	"medium",
	"high",
	"xhigh",
	"max"
];
/** Prompt body used by every probe request; carries nothing user-specific. */
const PROBE_PROMPT = "ping";
/** Default sentinel: unmistakably non-canonical, different on every call. */
function randomSentinel() {
	return `probe_sentinel_${randomBytes(12).toString("hex")}`;
}
/**
* The upstream's "this effort value is not supported" code, measured
* 2026-09-11 (plan §4.2). It is *not* treated as a permanent protocol promise:
* anything unrecognized degrades to `unknown` rather than to a capability
* conclusion.
*/
const INVALID_EFFORT_CODE = "invalid_reasoning_effort";
/** Whether an attempt is an attributable rejection of the effort value. */
function isEffortRejection(attempt) {
	return attempt.status === 400 && attempt.errorCode === INVALID_EFFORT_CODE;
}
/** Whether an attempt shows the upstream accepted the request and streamed. */
function isAcceptance(attempt) {
	return attempt.status === 200 && attempt.streamed;
}
/** Why an attempt ended in `unknown`, phrased for a log line. */
function unknownReason(stage, attempt) {
	const code = attempt.errorCode === void 0 ? "" : ` (${attempt.errorCode})`;
	const detail = attempt.detail === void 0 ? "" : `: ${attempt.detail}`;
	return `${stage} status ${attempt.status}${code}${detail}`;
}
/**
* Probe one model.
*
* `options.candidates` exists so tests can shorten the sweep; production always
* uses {@link PROBE_EFFORT_CANDIDATES}.
*/
async function probeModel(options) {
	const sentinel = options.sentinel ?? randomSentinel;
	const candidates = options.candidates ?? PROBE_EFFORT_CANDIDATES;
	const timeoutMs = options.timeoutMs ?? 3e4;
	let requests = 0;
	const attempt = async (effort) => {
		requests += 1;
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			return await options.send(effort, controller.signal);
		} catch (error) {
			return {
				status: 0,
				streamed: false,
				detail: `transport error: ${String(error)}`
			};
		} finally {
			clearTimeout(timer);
		}
	};
	const baseline = await attempt(void 0);
	if (!isAcceptance(baseline)) return {
		validation: "unknown",
		efforts: [],
		requests,
		reason: unknownReason("baseline", baseline)
	};
	const sentinelAttempt = await attempt(sentinel());
	if (isAcceptance(sentinelAttempt)) return {
		validation: "non-validating",
		efforts: [],
		requests
	};
	if (!isEffortRejection(sentinelAttempt)) return {
		validation: "unknown",
		efforts: [],
		requests,
		reason: unknownReason("sentinel", sentinelAttempt)
	};
	const accepted = [];
	for (const effort of candidates) {
		const levelAttempt = await attempt(effort);
		if (isAcceptance(levelAttempt)) {
			accepted.push(effort);
			continue;
		}
		if (isEffortRejection(levelAttempt)) continue;
		return {
			validation: "unknown",
			efforts: [],
			requests,
			reason: unknownReason(`level ${effort}`, levelAttempt)
		};
	}
	return {
		validation: "validating",
		efforts: accepted,
		requests
	};
}
//#endregion
//#region src/upstream.ts
/**
* WorkBuddy (CodeBuddy / copilot.tencent.com) upstream client: chat streaming,
* token refresh, model catalog, and credit balance. The wire behavior is
* ported from Sliverkiss/workbuddy2api (MIT), whose Go implementation is
* battle-tested against the real endpoint.
*
* @module dsh-workbuddy-connect/upstream
*/
const CN_CHAT_BASE = "https://copilot.tencent.com";
const CN_BILLING_BASE = "https://www.codebuddy.cn";
const GLOBAL_BASE = "https://www.workbuddy.ai";
const CLIENT_UA = "CLI/2.63.2 CodeBuddy/2.63.2";
const JSON_TIMEOUT_MS = 3e4;
const ERROR_BODY_LIMIT = 4096;
/** Insufficient-credit markers, ASCII lowercase plus the original Chinese. */
const HARD_CREDIT_MARKERS = [
	"insufficient credit",
	"no credit",
	"credit exhausted",
	"credits exhausted",
	"out of credit",
	"quota exceeded",
	"quota exhaust",
	"payment required",
	"credit not enough",
	"not enough credit",
	"积分不足",
	"额度不足",
	"余额不足",
	"积分用完",
	"额度用尽",
	"没有积分"
];
/** The concrete effort spellings WorkBuddy exposes on the wire. */
const EFFORT_VALUES = [
	"low",
	"medium",
	"high",
	"xhigh",
	"max"
];
/** Promotional badge keys the upstream tags carry, minus their color suffix. */
const BADGE_PREFIX = "badge:";
/** Parse the upstream `reasoning` object into {@link WorkBuddyModelReasoning}. */
function resolveUpstreamReasoning(wrapped) {
	const supports = wrapped["supportsReasoning"] === true;
	const onlyReasoning = wrapped["onlyReasoning"] === true;
	const rawReasoning = wrapped["reasoning"];
	let supportedEfforts;
	let defaultEffort;
	let canDisableThinking = true;
	if (typeof rawReasoning === "object" && rawReasoning !== null && !Array.isArray(rawReasoning)) {
		const reasoning = rawReasoning;
		const rawEfforts = reasoning["supportedEfforts"];
		if (Array.isArray(rawEfforts)) {
			const efforts = rawEfforts.filter((value) => typeof value === "string" && EFFORT_VALUES.includes(value));
			if (efforts.length > 0) supportedEfforts = efforts;
		}
		if (typeof reasoning["defaultEffort"] === "string" && EFFORT_VALUES.includes(reasoning["defaultEffort"])) defaultEffort = reasoning["defaultEffort"];
		else if (typeof reasoning["effort"] === "string" && EFFORT_VALUES.includes(reasoning["effort"])) defaultEffort = reasoning["effort"];
		canDisableThinking = reasoning["canDisableThinking"] === true;
	}
	return { reasoning: {
		supports,
		onlyReasoning,
		...supportedEfforts === void 0 ? {} : { supportedEfforts },
		...defaultEffort === void 0 ? {} : { defaultEffort },
		canDisableThinking
	} };
}
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
function normalizeCredits(credits) {
	if (credits === void 0) return void 0;
	const trimmed = credits.trim();
	if (trimmed === "") return void 0;
	if (/^credits?$/iu.test(trimmed)) return void 0;
	const bare = trimmed.replace(/\s+credits?$/iu, "").trim();
	return bare === "" ? void 0 : bare;
}
/** Parse the upstream `tags` / `credits` fields into billing metadata. */
function resolveUpstreamBilling(wrapped) {
	const rawCredits = wrapped["credits"];
	const credits = typeof rawCredits === "string" && rawCredits.trim() !== "" ? rawCredits.trim() : void 0;
	const badges = [];
	const rawTags = wrapped["tags"];
	if (Array.isArray(rawTags)) for (const tag of rawTags) {
		if (typeof tag !== "string") continue;
		if (!tag.toLowerCase().startsWith(BADGE_PREFIX)) continue;
		const label = tag.slice(6).split(":")[0] ?? tag.slice(6);
		if (label !== "") badges.push(label);
	}
	const free = credits !== void 0 && /^x?0\.0+$/u.test(credits);
	return { billing: {
		...credits === void 0 ? {} : { credits },
		...badges.length === 0 ? {} : { badges },
		free
	} };
}
/** Session-invalidation markers that mean "sign in again in the WorkBuddy app". */
const SESSION_DEAD_MARKERS = ["Offline user session not found", "12153"];
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
function classifyUpstreamError(status, body) {
	if (status === 402) return "hard_credit";
	const lower = body.toLowerCase();
	for (const marker of HARD_CREDIT_MARKERS) if (lower.includes(marker.toLowerCase()) || body.includes(marker)) return "hard_credit";
	for (const marker of SESSION_DEAD_MARKERS) if (body.includes(marker)) return "session_dead";
	if (status === 401) return "session_dead";
	if (status === 429) return "soft_rate";
	if (status === 404) return "not_found";
	if (status >= 500) return "server";
	if (status >= 400) return "client";
	return "client";
}
/** Region for a login domain; an empty domain means CN (matching upstream tooling). */
function regionOf(domain) {
	const lowered = domain.trim().toLowerCase();
	if (lowered === "workbuddy.ai" || lowered.endsWith(".workbuddy.ai")) return "global";
	return "cn";
}
function chatBase(credential) {
	return chatBaseForDomain(credential.domain);
}
/**
* The chat (and login) base for a login domain.
*
* Exported because the QR sign-in flow needs the same answer *before* a
* credential exists: it knows only which variant it is signing into. Sharing
* one function is what keeps a QR sign-in from ever being pointed at the other
* region's endpoint — the mistake that would hand a CN account's token to the
* international gateway.
*/
function chatBaseForDomain(domain) {
	return regionOf(domain) === "global" ? GLOBAL_BASE : CN_CHAT_BASE;
}
/** The chat (and login) base for a region, for callers with no credential yet. */
function chatBaseForRegion(region) {
	return region === "global" ? GLOBAL_BASE : CN_CHAT_BASE;
}
/** The Origin/Referer pair the upstream expects for a region. */
function originForRegion(region) {
	return region === "global" ? GLOBAL_BASE : CN_BILLING_BASE;
}
function billingBase(credential) {
	return regionOf(credential.domain) === "global" ? GLOBAL_BASE : CN_BILLING_BASE;
}
function originReferer(credential) {
	return regionOf(credential.domain) === "global" ? GLOBAL_BASE : CN_BILLING_BASE;
}
/** Headers every upstream request shares. */
function commonHeaders(credential) {
	return {
		"Accept": "application/json, text/plain, */*",
		"X-Requested-With": "XMLHttpRequest",
		"Origin": originReferer(credential),
		"Referer": `${originReferer(credential)}/`,
		"User-Agent": CLIENT_UA
	};
}
/** Chat request headers, including the X-No-* conventions the official CLI uses. */
function chatHeaders(credential) {
	return {
		...commonHeaders(credential),
		"Content-Type": "application/json",
		...credential.uid === "" ? { "X-No-User-Id": "1" } : { "X-User-Id": credential.uid },
		...credential.enterpriseId === void 0 || credential.enterpriseId === "" ? { "X-No-Enterprise-Id": "1" } : { "X-Enterprise-Id": credential.enterpriseId },
		...credential.domain === "" ? { "X-No-Department-Info": "1" } : { "X-Domain": credential.domain },
		"X-Product": "SaaS"
	};
}
/** Refresh-endpoint headers; X-Refresh-Token appears here and nowhere else. */
function refreshHeaders(credential) {
	const headers = {
		...commonHeaders(credential),
		"X-Refresh-Token": credential.refreshToken,
		"X-Auth-Refresh-Source": "workbuddy"
	};
	if (credential.enterpriseId !== void 0 && credential.enterpriseId !== "") headers["X-Enterprise-Id"] = credential.enterpriseId;
	return headers;
}
/** Billing request headers. */
function billingHeaders(credential) {
	const headers = {
		"Authorization": `Bearer ${credential.accessToken}`,
		"Accept": "application/json",
		"Content-Type": "application/json"
	};
	if (credential.uid !== "") headers["X-User-Id"] = credential.uid;
	if (credential.enterpriseId !== void 0 && credential.enterpriseId !== "") {
		headers["X-Enterprise-Id"] = credential.enterpriseId;
		headers["X-Tenant-Id"] = credential.enterpriseId;
	}
	if (credential.domain !== "") headers["X-Domain"] = credential.domain;
	return headers;
}
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
function prepareChatBody(source) {
	let body;
	try {
		body = JSON.parse(source);
	} catch {
		return source;
	}
	if (typeof body !== "object" || body === null || Array.isArray(body)) return source;
	const obj = body;
	obj["stream"] = true;
	normalizeDeveloperRole(obj);
	normalizeToolChoice(obj);
	return JSON.stringify(obj);
}
/** Rewrite `role: "developer"` messages to `role: "system"` (upstream rejects developer). */
function normalizeDeveloperRole(obj) {
	const messages = obj["messages"];
	if (!Array.isArray(messages)) return;
	for (const message of messages) {
		if (typeof message !== "object" || message === null || Array.isArray(message)) continue;
		const wrapped = message;
		if (wrapped["role"] === "developer") wrapped["role"] = "system";
	}
}
/** Rewrite OpenAI `tool_choice` spellings into the upstream's string form. */
function normalizeToolChoice(obj) {
	const suppress = () => {
		delete obj["tools"];
		delete obj["functions"];
	};
	if (!("tool_choice" in obj)) return;
	const choice = obj["tool_choice"];
	if (typeof choice === "string") {
		if (choice.trim().toLowerCase() === "none") {
			delete obj["tool_choice"];
			suppress();
		}
		return;
	}
	if (typeof choice === "object" && choice !== null && !Array.isArray(choice)) {
		const wrapped = choice;
		const type = typeof wrapped["type"] === "string" ? wrapped["type"].trim().toLowerCase() : "";
		if (type === "none") {
			delete obj["tool_choice"];
			suppress();
		} else if (type === "auto" || type === "required") obj["tool_choice"] = type;
		else if (type === "function") {
			const fn = typeof wrapped["function"] === "object" && wrapped["function"] !== null ? wrapped["function"] : void 0;
			let name = typeof fn?.["name"] === "string" ? fn["name"] : "";
			if (name === "" && typeof wrapped["name"] === "string") name = wrapped["name"];
			name = name.trim();
			obj["tool_choice"] = name !== "" ? name : "auto";
		} else delete obj["tool_choice"];
		return;
	}
	delete obj["tool_choice"];
}
async function readEnvelope(response) {
	const text = await response.text();
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new Error(`workbuddy upstream returned non-JSON (http ${response.status}): ${text.slice(0, 160)}`);
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error(`workbuddy upstream returned an unexpected document (http ${response.status})`);
	const document = parsed;
	return {
		code: typeof document["code"] === "number" ? document["code"] : 0,
		msg: typeof document["msg"] === "string" ? document["msg"] : "",
		data: "data" in document ? document["data"] : void 0,
		document
	};
}
/** Fail an envelope whose business code is non-zero, classified like HTTP errors. */
function envelopeError(status, envelope) {
	const kind = classifyUpstreamError(status, envelope.msg);
	return /* @__PURE__ */ new Error(`workbuddy upstream ${kind} (http ${status}): ${envelope.msg.slice(0, 160)}`);
}
/**
* Upstream HTTP client. One instance serves the whole plugin; requests take
* the credential explicitly so token refreshes apply on the next call.
*
* One instance is *per variant*: the international provider needs its own
* catalog source, UA version, and probe differences, and keeping them on the
* instance avoids passing a variant through every call signature.
*/
var WorkBuddyUpstreamClient = class {
	/**
	* Resolves the App-shaped UA version for international catalog requests.
	* Injectable so tests never read the real filesystem.
	*/
	resolveAppVersion;
	/** Provenance of the most recent successful catalog fetch, for the card. */
	lastCatalog;
	constructor(options = {}) {
		this.resolveAppVersion = options.resolveAppVersion ?? (() => resolveAppVersion());
	}
	/** POST the chat endpoint; a successful answer is the raw SSE response. */
	async chatStream(credential, bodyJson, signal) {
		let response;
		try {
			response = await fetch(`${chatBase(credential)}/v2/chat/completions`, {
				method: "POST",
				headers: {
					...chatHeaders(credential),
					"Authorization": `Bearer ${credential.accessToken}`
				},
				body: regionOf(credential.domain) === "global" ? prepareInternationalChatBody(bodyJson) : bodyJson,
				...signal === void 0 ? {} : { signal }
			});
		} catch (error) {
			return {
				ok: false,
				status: 0,
				kind: "server",
				message: `transport error: ${String(error)}`
			};
		}
		if (response.ok) return {
			ok: true,
			response
		};
		const retryAfter = response.headers.get("retry-after") ?? void 0;
		const text = (await response.text()).slice(0, ERROR_BODY_LIMIT);
		return {
			ok: false,
			status: response.status,
			kind: classifyUpstreamError(response.status, text),
			message: text,
			...retryAfter === void 0 ? {} : { retryAfter }
		};
	}
	/** POST the token-refresh endpoint; the caller merges the outcome. */
	async refreshToken(credential) {
		const response = await fetch(`${chatBase(credential)}/v2/plugin/auth/token/refresh`, {
			method: "POST",
			headers: refreshHeaders(credential),
			signal: AbortSignal.timeout(JSON_TIMEOUT_MS)
		});
		const envelope = await readEnvelope(response);
		if (!response.ok || envelope.code !== 0) throw envelopeError(response.status, envelope);
		const data = typeof envelope.data === "object" && envelope.data !== null ? envelope.data : {};
		const accessToken = typeof data["accessToken"] === "string" ? data["accessToken"] : "";
		if (accessToken === "") throw new Error("workbuddy token refresh returned no accessToken; sign in again in the WorkBuddy app");
		const outcome = { accessToken };
		if (typeof data["refreshToken"] === "string" && data["refreshToken"] !== "") outcome.refreshToken = data["refreshToken"];
		if (typeof data["expiresIn"] === "number" && data["expiresIn"] > 0) outcome.expiresInSec = data["expiresIn"];
		if (typeof data["domain"] === "string" && data["domain"] !== "") outcome.domain = data["domain"];
		return outcome;
	}
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
	async fetchModels(credential, signal) {
		const international = regionOf(credential.domain) === "global";
		const appVersion = international ? await this.resolveAppVersion() : void 0;
		const response = await fetch(`${chatBase(credential)}${international ? "/v3/config" : "/console/enterprises/personal/models"}`, {
			headers: {
				Authorization: `Bearer ${credential.accessToken}`,
				Accept: "application/json",
				Origin: originReferer(credential),
				Referer: `${originReferer(credential)}/`,
				...international ? {
					"X-Requested-With": "XMLHttpRequest",
					"X-Product": "SaaS"
				} : {},
				"User-Agent": appVersion === void 0 ? CLIENT_UA : appUserAgent(appVersion.version)
			},
			signal: signal === void 0 ? AbortSignal.timeout(JSON_TIMEOUT_MS) : AbortSignal.any([signal, AbortSignal.timeout(JSON_TIMEOUT_MS)])
		});
		const envelope = await readEnvelope(response);
		if (!response.ok || envelope.code !== 0) throw envelopeError(response.status, envelope);
		const models = parseModelCatalog(isObject$1(envelope.data) ? envelope.data : "models" in envelope.document || "agents" in envelope.document ? envelope.document : {}, international);
		this.lastCatalog = {
			fetchedAtMs: Date.now(),
			source: international ? "workbuddy-ai:app" : "workbuddy:cli",
			...appVersion === void 0 ? {} : { appVersion }
		};
		return models;
	}
	/** POST the billing endpoint for the aggregated remaining credit. */
	async fetchCredits(credential) {
		const now = /* @__PURE__ */ new Date();
		const format = (date) => [
			date.getFullYear().toString().padStart(4, "0"),
			(date.getMonth() + 1).toString().padStart(2, "0"),
			date.getDate().toString().padStart(2, "0")
		].join("-") + " " + [
			date.getHours().toString().padStart(2, "0"),
			date.getMinutes().toString().padStart(2, "0"),
			date.getSeconds().toString().padStart(2, "0")
		].join(":");
		const response = await fetch(`${billingBase(credential)}/v2/billing/meter/get-user-resource`, {
			method: "POST",
			headers: billingHeaders(credential),
			body: JSON.stringify({
				PageNumber: 1,
				PageSize: 100,
				ProductCode: "p_tcaca",
				Status: [0, 3],
				PackageEndTimeRangeBegin: format(now),
				PackageEndTimeRangeEnd: format(new Date(now.getTime() + 3185136e6))
			}),
			signal: AbortSignal.timeout(JSON_TIMEOUT_MS)
		});
		const envelope = await readEnvelope(response);
		if (!response.ok || envelope.code !== 0) throw envelopeError(response.status, envelope);
		const responseWrapper = typeof envelope.data === "object" && envelope.data !== null ? envelope.data : {};
		const data = typeof responseWrapper["Response"] === "object" && responseWrapper["Response"] !== null ? responseWrapper["Response"] : {};
		const inner = typeof data["Data"] === "object" && data["Data"] !== null ? data["Data"] : {};
		const rawAccounts = Array.isArray(inner["Accounts"]) ? inner["Accounts"] : [];
		const accounts = [];
		let total = 0;
		for (const raw of rawAccounts) {
			if (typeof raw !== "object" || raw === null) continue;
			const account = raw;
			const numberField = (key) => typeof account[key] === "number" ? account[key] : 0;
			const size = numberField("CycleCapacitySize");
			const cycleRemain = numberField("CycleCapacityRemain");
			const cycleUsed = numberField("CycleCapacityUsed");
			const capacityRemain = numberField("CapacityRemain");
			let remain;
			if (size > 0) remain = cycleRemain;
			else if (cycleRemain > 0 || cycleUsed > 0) remain = cycleRemain;
			else remain = capacityRemain;
			if (remain < 0) remain = 0;
			total += remain;
			accounts.push({
				packageName: typeof account["PackageName"] === "string" ? account["PackageName"] : "(unnamed)",
				remain,
				size: size > 0 ? size : numberField("CapacitySize")
			});
		}
		return {
			total,
			accounts
		};
	}
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
	async probeEffort(credential, model, effort, signal) {
		const international = regionOf(credential.domain) === "global";
		const payload = {
			model,
			stream: true,
			messages: [...international ? [{
				role: "system",
				content: INTERNATIONAL_SYSTEM_PROMPT
			}] : [], {
				role: "user",
				content: PROBE_PROMPT
			}],
			max_tokens: international ? INTERNATIONAL_PROBE_MAX_TOKENS : 1
		};
		if (effort !== void 0) payload["reasoning_effort"] = effort;
		let response;
		try {
			response = await fetch(`${chatBase(credential)}/v2/chat/completions`, {
				method: "POST",
				headers: {
					...chatHeaders(credential),
					"Authorization": `Bearer ${credential.accessToken}`
				},
				body: JSON.stringify(payload),
				signal
			});
		} catch (error) {
			return {
				status: 0,
				streamed: false,
				detail: `transport error: ${String(error)}`
			};
		}
		if (!response.ok) {
			const text = (await response.text()).slice(0, ERROR_BODY_LIMIT);
			return {
				status: response.status,
				streamed: false,
				...errorCodeOf(text)
			};
		}
		const streamed = await readFirstEvent(response);
		return {
			status: response.status,
			streamed
		};
	}
};
/** Pull `extError.code` out of an upstream error body, if it is shaped that way. */
function errorCodeOf(text) {
	try {
		const parsed = JSON.parse(text);
		if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
			const extError = parsed["extError"];
			if (typeof extError === "object" && extError !== null && !Array.isArray(extError)) {
				const code = extError["code"];
				if (typeof code === "string") return {
					errorCode: code,
					detail: code
				};
			}
		}
	} catch {}
	return { detail: text.slice(0, 200) };
}
/**
* Consume just enough of a streaming response to know it really streams.
*
* Returns true on the first chunk containing a data line. Cancels the body
* afterwards; a stream that ends or errors before that counts as not streamed,
* because an empty 200 is not evidence the effort was accepted.
*/
async function readFirstEvent(response) {
	const body = response.body;
	if (body === null) return false;
	const reader = body.getReader();
	const decoder = new TextDecoder();
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) return false;
			if (decoder.decode(value, { stream: true }).includes("data:")) return true;
		}
	} catch {
		return false;
	} finally {
		await reader.cancel().catch(() => {});
	}
}
function isObject$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function positive(value) {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}
/** Parse either response shape after its envelope has been checked. */
function parseModelCatalog(data, international = false) {
	const rawModels = Array.isArray(data["models"]) ? data["models"] : [];
	const agents = Array.isArray(data["agents"]) ? data["agents"] : [];
	let cliIds;
	for (const agent of agents) if (typeof agent === "object" && agent !== null) {
		const wrapped = agent;
		if (wrapped["name"] === "cli" && Array.isArray(wrapped["models"])) {
			cliIds = wrapped["models"].filter((id) => typeof id === "string");
			break;
		}
	}
	if (cliIds === void 0 || cliIds.length === 0) throw new Error("workbuddy model catalog lists no cli agent models");
	const byId = /* @__PURE__ */ new Map();
	for (const model of rawModels) {
		if (typeof model !== "object" || model === null) continue;
		const wrapped = model;
		const id = typeof wrapped["id"] === "string" ? wrapped["id"] : "";
		if (id === "" || wrapped["disabled"] === true) continue;
		const input = typeof wrapped["maxInputTokens"] === "number" ? wrapped["maxInputTokens"] : 0;
		const output = typeof wrapped["maxOutputTokens"] === "number" ? wrapped["maxOutputTokens"] : 0;
		if (input <= 0 || output <= 0) continue;
		byId.set(id, {
			id,
			name: typeof wrapped["name"] === "string" && wrapped["name"] !== "" ? wrapped["name"] : id,
			contextWindow: international && isObject$1(wrapped["contextWindow"]) && positive(wrapped["contextWindow"]["defaultLength"]) ? wrapped["contextWindow"]["defaultLength"] : input,
			...international ? {
				maxInputTokens: input,
				supportedContextWindows: isObject$1(wrapped["contextWindow"]) && Array.isArray(wrapped["contextWindow"]["supportedLengths"]) ? wrapped["contextWindow"]["supportedLengths"].filter(positive) : [],
				promotions: parsePromotions(data["modelPromotions"], id)
			} : {},
			maxTokens: output,
			supportsImages: wrapped["supportsImages"] === true && wrapped["disabledMultimodal"] !== true,
			...resolveUpstreamReasoning(wrapped),
			...resolveUpstreamBilling(wrapped)
		});
	}
	const models = cliIds.map((id) => byId.get(id)).filter((model) => model !== void 0);
	if (models.length === 0) throw new Error("workbuddy model catalog resolved to an empty list");
	return models;
}
/** Extract the promotions covering `model` from the `modelPromotions` array. */
function parsePromotions(value, model) {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) => {
		if (!isObject$1(item) || item["enabled"] !== true) return [];
		const modelIds = item["modelIds"];
		if (!Array.isArray(modelIds) || !modelIds.includes(model)) return [];
		const schedule = item["schedule"];
		const discount = item["discount"];
		const badge = item["badge"];
		if (!isObject$1(schedule) || !isObject$1(discount) || !isObject$1(badge)) return [];
		if (discount["displayMode"] !== "replace") return [];
		const start = typeof schedule["validFrom"] === "string" ? Date.parse(schedule["validFrom"]) : NaN;
		const end = typeof schedule["validUntil"] === "string" ? Date.parse(schedule["validUntil"]) : NaN;
		const factor = discount["factor"];
		if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
		if (typeof factor !== "number" || !Number.isFinite(factor) || factor < 0) return [];
		return [{
			start,
			end,
			factor,
			label: typeof badge["label"] === "string" ? badge["label"] : "",
			priority: typeof item["priority"] === "number" && Number.isFinite(item["priority"]) ? item["priority"] : 0
		}];
	});
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
function modelWithCurrentPromotion(model, now = Date.now()) {
	if (model.promotions === void 0 || model.promotions.length === 0) return model;
	const promotion = [...model.promotions].sort((a, b) => b.priority - a.priority).find((candidate) => now >= candidate.start && now < candidate.end);
	if (promotion === void 0) {
		if (!(model.billing?.free === true || (model.billing?.badges?.length ?? 0) > 0 || model.promotions.some((candidate) => candidate.factor !== 1))) return model;
		return {
			...model,
			billing: {
				free: false,
				rateUnknown: true
			}
		};
	}
	const rate = normalizeCredits(model.billing?.credits);
	const original = rate !== void 0 && rate.startsWith("x") ? Number(rate.slice(1)) : NaN;
	if (promotion.factor !== 0 && !Number.isFinite(original)) return model;
	const value = promotion.factor === 0 ? 0 : original * promotion.factor;
	return {
		...model,
		billing: {
			...model.billing,
			credits: `x${value.toFixed(2)}`,
			free: value === 0,
			badges: [...model.billing?.badges ?? [], ...promotion.label === "" ? [] : [promotion.label]]
		}
	};
}
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
function prepareInternationalChatBody(source) {
	const prepared = prepareChatBody(source);
	let body;
	try {
		body = JSON.parse(prepared);
	} catch {
		return prepared;
	}
	if (!isObject$1(body)) return prepared;
	const messages = body["messages"];
	if (!Array.isArray(messages)) return prepared;
	const first = messages[0];
	if (isObject$1(first) && first["role"] === "system") return prepared;
	messages.unshift({
		role: "system",
		content: INTERNATIONAL_SYSTEM_PROMPT
	});
	return JSON.stringify(body);
}
/**
* The system prompt injected when the international endpoint receives a body
* with none.
*
* Minimal on purpose: it exists to satisfy a gateway precondition, not to
* steer the model. The plugin is not the place to invent a persona, and the
* normal path never reaches this — pi-ai already sends the harness's system
* prompt, so this only covers a caller that omitted one.
*/
const INTERNATIONAL_SYSTEM_PROMPT = "You are a helpful assistant.";
/**
* Output ceiling for an international probe request.
*
* Above the smallest value that the strictest observed model accepts (the
* GPT-5.6 family rejects `1` with 11133), while still being far too small to
* produce a real answer. See {@link WorkBuddyUpstreamClient.probeEffort}.
*/
const INTERNATIONAL_PROBE_MAX_TOKENS = 16;
//#endregion
//#region src/auth.ts
/**
* WorkBuddy credential resolution. The primary source is the WorkBuddy
* desktop app's own auth file, read-only; a plugin-owned copy under
* `$DSH_HOME` holds token refreshes so the desktop file is never written.
* The effective credential is whichever of the two expires later, so a
* refresh by either side wins.
*
* @module dsh-workbuddy-connect/auth
*/
/** Basename of the plugin-owned credential copy inside the Harness home. */
const WORKBUDDY_AUTH_FILENAME = ".workbuddy-auth.json";
/** Env variable that overrides the desktop auth-file location. */
const WORKBUDDY_AUTH_FILE_ENV = "WORKBUDDY_AUTH_FILE";
/** Current on-disk format of the plugin-owned copy; readers reject others. */
const OWN_FORMAT_VERSION = 1;
/** Plugin-owned copy path inside the Harness home. */
function workbuddyOwnAuthPath() {
	return join(resolveDshHome(), WORKBUDDY_AUTH_FILENAME);
}
const DESKTOP_AUTH_RELATIVE_PATH = [
	"CodeBuddyExtension",
	"Data",
	"Public",
	"auth",
	"workbuddy-desktop.info"
];
/** Whether this Linux process is running inside Windows Subsystem for Linux. */
function isWsl() {
	if (process.platform !== "linux") return false;
	if (process.env["WSL_DISTRO_NAME"] !== void 0 || process.env["WSL_INTEROP"] !== void 0) return true;
	return release().toLowerCase().includes("microsoft");
}
/** Convert a Windows drive path to WSL's conventional `/mnt/<drive>` form. */
function windowsPathForWsl(value) {
	const path = value?.trim();
	if (!path) return void 0;
	if (path.startsWith("/")) return path;
	const drivePath = /^([a-z]):[\\/](.*)$/iu.exec(path);
	if (drivePath === null) return void 0;
	return join("/mnt", drivePath[1].toLowerCase(), ...drivePath[2].split(/[\\/]+/u));
}
/** Windows desktop credential candidates visible from a WSL process. */
function wslDesktopAuthCandidates(home) {
	const profile = windowsPathForWsl(process.env["USERPROFILE"]) ?? join("/mnt/c/Users", basename(home));
	const localAppData = windowsPathForWsl(process.env["LOCALAPPDATA"]) ?? join(profile, "AppData", "Local");
	const roamingAppData = windowsPathForWsl(process.env["APPDATA"]) ?? join(profile, "AppData", "Roaming");
	return [join(localAppData, ...DESKTOP_AUTH_RELATIVE_PATH), join(roamingAppData, ...DESKTOP_AUTH_RELATIVE_PATH)];
}
/**
* Platform-default candidates for the WorkBuddy desktop app's auth file, in
* probe order. Windows probes both AppData roots: current builds write under
* `%LOCALAPPDATA%` (Local), older ones under `%APPDATA%` (Roaming). WSL probes
* those same Windows locations through its mounted Windows profile before the
* native Linux location.
*/
function defaultDesktopAuthCandidates() {
	const home = homedir();
	if (process.platform === "darwin") return [join(home, "Library", "Application Support", "CodeBuddyExtension", "Data", "Public", "auth", "workbuddy-desktop.info")];
	if (process.platform === "win32") return [join(home, "AppData", "Local", "CodeBuddyExtension", "Data", "Public", "auth", "workbuddy-desktop.info"), join(home, "AppData", "Roaming", "CodeBuddyExtension", "Data", "Public", "auth", "workbuddy-desktop.info")];
	if (process.platform === "linux") {
		const linux = join(home, ".config", ...DESKTOP_AUTH_RELATIVE_PATH);
		return isWsl() ? [...wslDesktopAuthCandidates(home), linux] : [linux];
	}
	return [];
}
/**
* The platform-default candidates for one variant, in probe order.
*
* Both apps write into the *same* shared `CodeBuddyExtension` auth directory
* and differ only in the file's basename, so the per-platform ordering above
* is reused verbatim and just the filename is swapped.
*/
function desktopAuthCandidatesFor(variant) {
	return defaultDesktopAuthCandidates().map((path) => join(dirname(path), variant.desktopFilename));
}
/** First platform-default candidate; see {@link defaultDesktopAuthCandidates}. */
function defaultDesktopAuthPath(variant) {
	return (variant === void 0 ? defaultDesktopAuthCandidates() : desktopAuthCandidatesFor(variant))[0];
}
/** Normalize an expiry that may arrive in seconds or milliseconds. */
function expiryToMs(value) {
	if (value <= 0) return 0;
	return value > 0xe8d4a51000 ? value : value * 1e3;
}
function optionalString$2(value) {
	return typeof value === "string" && value !== "" ? value : void 0;
}
/**
* Parse a WorkBuddy auth document in either on-disk shape: the plugin OAuth
* nested form `{"auth":{...},"account":{...}}` and the flat panel form.
* Returns undefined when the document carries no access token.
*/
function parseWorkBuddyAuth(text) {
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		return;
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return void 0;
	const document = parsed;
	let auth;
	let identity;
	if (typeof document["auth"] === "object" && document["auth"] !== null) {
		auth = document["auth"];
		identity = typeof document["account"] === "object" && document["account"] !== null ? document["account"] : {};
	} else {
		auth = document;
		identity = document;
	}
	const accessToken = typeof auth["accessToken"] === "string" ? auth["accessToken"] : "";
	if (accessToken === "") return void 0;
	const expiresAtMs = typeof auth["expiresAt"] === "number" ? expiryToMs(auth["expiresAt"]) : 0;
	const refreshExpiresAtMs = typeof auth["refreshExpiresAt"] === "number" ? expiryToMs(auth["refreshExpiresAt"]) : void 0;
	const enterpriseId = optionalString$2(identity["enterpriseId"]);
	const nickname = optionalString$2(identity["nickname"]);
	return {
		accessToken,
		refreshToken: typeof auth["refreshToken"] === "string" ? auth["refreshToken"] : "",
		expiresAtMs,
		...refreshExpiresAtMs === void 0 ? {} : { refreshExpiresAtMs },
		domain: optionalString$2(auth["domain"]) ?? "",
		uid: optionalString$2(identity["uid"]) ?? "",
		...enterpriseId === void 0 ? {} : { enterpriseId },
		...nickname === void 0 ? {} : { nickname },
		source: "desktop"
	};
}
/** Serialize the plugin-owned copy. */
function ownDocument(credential) {
	return {
		version: OWN_FORMAT_VERSION,
		credential
	};
}
/** Parse the plugin-owned copy; other versions and shapes are rejected. */
function parseOwnDocument(text) {
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		return;
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return void 0;
	const document = parsed;
	if (document["version"] !== OWN_FORMAT_VERSION) return void 0;
	if (typeof document["credential"] !== "object" || document["credential"] === null) return void 0;
	const stored = document["credential"];
	const accessToken = typeof stored["accessToken"] === "string" ? stored["accessToken"] : "";
	if (accessToken === "") return void 0;
	const refreshExpiresAtMs = typeof stored["refreshExpiresAtMs"] === "number" ? stored["refreshExpiresAtMs"] : void 0;
	const enterpriseId = optionalString$2(stored["enterpriseId"]);
	const nickname = optionalString$2(stored["nickname"]);
	return {
		accessToken,
		refreshToken: typeof stored["refreshToken"] === "string" ? stored["refreshToken"] : "",
		expiresAtMs: typeof stored["expiresAtMs"] === "number" ? stored["expiresAtMs"] : 0,
		...refreshExpiresAtMs === void 0 ? {} : { refreshExpiresAtMs },
		domain: optionalString$2(stored["domain"]) ?? "",
		uid: optionalString$2(stored["uid"]) ?? "",
		...enterpriseId === void 0 ? {} : { enterpriseId },
		...nickname === void 0 ? {} : { nickname },
		source: "dsh"
	};
}
/** Whether a filesystem error reports an absent path. */
function isENOENT(error) {
	return error?.code === "ENOENT";
}
/**
* Read-only credential store with demand-driven refresh.
*
* Refresh policy: refresh only when the access token is inside the margin
* (or already expired), keep the refreshed credential in the plugin-owned
* copy, and never write the desktop app's file. A failed refresh still
* returns a not-yet-expired token so an unreachable refresh endpoint does
* not take down a working session.
*/
var WorkBuddyCredentialStore = class {
	variant;
	refresh;
	refreshMarginMs;
	ownPath;
	desktopPathOverride;
	inflight;
	constructor(options) {
		this.variant = options.variant;
		this.refresh = options.refresh;
		this.refreshMarginMs = options.refreshMarginMs ?? 3e5;
		this.ownPath = options.ownPath ?? (options.variant ? join(resolveDshHome(), options.variant.ownFilename) : workbuddyOwnAuthPath());
		this.desktopPathOverride = options.desktopPath;
	}
	/**
	* Configuration precedence for the desktop file: the plugin's configured
	* path, then the environment variable, then the platform defaults. An
	* explicit path is used verbatim; the defaults are a probe order.
	*/
	resolveDesktopCandidates() {
		const fromEnv = process.env[this.variant?.env ?? "WORKBUDDY_AUTH_FILE"];
		const explicit = this.desktopPathOverride ?? (fromEnv !== void 0 && fromEnv.trim() !== "" ? fromEnv : void 0);
		if (explicit !== void 0) return [explicit];
		return this.variant === void 0 ? defaultDesktopAuthCandidates() : desktopAuthCandidatesFor(this.variant);
	}
	resolveDesktopPath() {
		return this.resolveDesktopCandidates()[0];
	}
	/**
	* Repoint the desktop file; a settings change applies on the next read.
	*/
	setDesktopPath(path) {
		this.desktopPathOverride = path;
	}
	/** The resolved desktop auth-file path, for diagnostics. */
	desktopAuthPath() {
		return this.resolveDesktopPath();
	}
	/** The plugin-owned copy path, for diagnostics. */
	ownAuthPath() {
		return this.ownPath;
	}
	/**
	* The desktop app's own credential, ignoring the plugin-owned copy.
	*
	* Used by the account pool's capture step: the pool wants *the app's current
	* sign-in* so it can hold it as an ordinary long-lived member, not the
	* plugin's rotated copy (which is already in the pool under the same
	* identity). Returns undefined when the app is signed out, and throws only
	* for a diagnosable problem such as a region mismatch.
	*/
	async desktopCredential() {
		const credential = await this.readDesktop();
		if (credential === void 0) return void 0;
		if (this.variant !== void 0) {
			const region = regionOf(credential.domain);
			if (region !== this.variant.region) throw new Error(`${this.variant.displayName} received a ${region === "cn" ? "WorkBuddy (CN)" : "WorkBuddy AI"} credential in its desktop file (domain ${JSON.stringify(credential.domain)}); point ${this.variant.env} at the ${this.variant.appName} sign-in, or remove the mismatched file`);
		}
		return credential;
	}
	/** Read the freshest stored credential without refreshing anything. */
	async current() {
		const [desktop, own] = await Promise.all([this.readDesktop(), this.readOwn()]);
		if (this.variant !== void 0) for (const [label, credential] of [["desktop file", desktop], ["plugin copy", own]]) {
			if (credential === void 0) continue;
			const region = regionOf(credential.domain);
			if (region !== this.variant.region) throw new Error(`${this.variant.displayName} received a ${region === "cn" ? "WorkBuddy (CN)" : "WorkBuddy AI"} credential in its ${label} (domain ${JSON.stringify(credential.domain)}); point ${this.variant.env} at the ${this.variant.appName} sign-in, or remove the mismatched file`);
		}
		if (desktop === void 0) return own;
		if (own === void 0) return desktop;
		if (desktop.uid !== own.uid || desktop.enterpriseId !== own.enterpriseId) return desktop;
		return own.expiresAtMs > desktop.expiresAtMs ? own : desktop;
	}
	/**
	* The credential to send upstream: {@link current}, refreshed on demand.
	* Single-flight, so parallel requests share one refresh.
	*/
	async resolve() {
		const credential = await this.current();
		if (credential === void 0) {
			const candidates = this.resolveDesktopCandidates();
			const desktop = candidates.length > 0 ? candidates.join(" or ") : "(no desktop path on this platform)";
			const app = this.variant?.appName ?? "WorkBuddy";
			throw new Error(`workbuddy: no signed-in ${app} account found; sign in once in the ${app} desktop app (expected ${desktop} or ${this.variant?.env ?? "WORKBUDDY_AUTH_FILE"}), or refresh an existing session`);
		}
		if (!this.needsRefresh(credential)) return credential;
		this.inflight ??= this.refreshNow(credential).finally(() => {
			this.inflight = void 0;
		});
		return this.inflight;
	}
	/** Read-only sign-in summary; never refreshes and never throws. */
	async status() {
		try {
			const credential = await this.current();
			if (credential === void 0) return { state: "signed-out" };
			return {
				state: "signed-in",
				expiresAtMs: credential.expiresAtMs,
				...credential.refreshExpiresAtMs === void 0 ? {} : { refreshExpiresAtMs: credential.refreshExpiresAtMs },
				...credential.nickname === void 0 ? {} : { nickname: credential.nickname },
				...credential.domain === "" ? {} : { domain: credential.domain },
				source: credential.source
			};
		} catch (error) {
			return {
				state: "signed-out",
				reason: error instanceof Error ? error.message : String(error)
			};
		}
	}
	/** Remove the plugin-owned copy; the desktop file is untouched. */
	async logout() {
		await rm(this.ownPath, { force: true });
		await rm(`${this.ownPath}.lock`, { force: true });
	}
	needsRefresh(credential) {
		if (credential.expiresAtMs <= 0) return true;
		return Date.now() + this.refreshMarginMs >= credential.expiresAtMs;
	}
	async refreshNow(credential) {
		if (credential.refreshToken === "") {
			if (credential.expiresAtMs > Date.now() + 3e4) return credential;
			throw new Error("workbuddy: access token expired and no refresh token is stored; sign in again in the WorkBuddy desktop app");
		}
		try {
			const outcome = await this.refresh(credential);
			const refreshed = {
				...credential,
				accessToken: outcome.accessToken,
				...outcome.refreshToken === void 0 ? {} : { refreshToken: outcome.refreshToken },
				expiresAtMs: outcome.expiresInSec !== void 0 ? Date.now() + outcome.expiresInSec * 1e3 : credential.expiresAtMs,
				...outcome.domain === void 0 || outcome.domain === "" ? {} : { domain: outcome.domain },
				source: "dsh"
			};
			await this.saveOwn(refreshed);
			return refreshed;
		} catch (error) {
			if (credential.expiresAtMs > Date.now() + 3e4) return credential;
			throw new Error(`workbuddy: token refresh failed and the access token is expired (${String(error)}); open the WorkBuddy desktop app once to sign in again`);
		}
	}
	async saveOwn(credential) {
		await withFileLock(this.ownPath, async () => {
			await writeFileAtomic(this.ownPath, `${JSON.stringify(ownDocument(credential), null, 2)}\n`, {
				mode: 384,
				dirMode: 448
			});
		});
	}
	/**
	* Read the first desktop candidate that exists. Only an absent file
	* (ENOENT) falls through to the next candidate; a file that is present
	* but unparsable is authoritative for its slot, so a stale older-version
	* file never silently wins over a broken newer one.
	*/
	async readDesktop() {
		for (const desktopPath of this.resolveDesktopCandidates()) try {
			return parseWorkBuddyAuth(await readFile(desktopPath, "utf8"));
		} catch (error) {
			if (!isENOENT(error)) throw error;
		}
	}
	async readOwn() {
		try {
			return parseOwnDocument(await readFile(this.ownPath, "utf8"));
		} catch (error) {
			if (isENOENT(error)) return void 0;
			return;
		}
	}
	/** Whether any desktop-file candidate exists as a regular file; diagnostics only. */
	async desktopFilePresent() {
		for (const desktopPath of this.resolveDesktopCandidates()) try {
			if ((await stat(desktopPath)).isFile()) return true;
		} catch {}
		return false;
	}
};
//#endregion
//#region src/account-pool.ts
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
/** On-disk format this reader accepts; other versions are discarded. */
const POOL_FORMAT_VERSION = 1;
/** Basename of the CN variant's account-pool file inside the Harness home. */
const WORKBUDDY_ACCOUNTS_FILENAME = ".workbuddy-accounts.json";
/** Backoff schedule for one cooldown reason. */
const COOLDOWN_BASE_MS = {
	rate: 6e4,
	credit: 36e5,
	session: 216e5
};
/** Ceiling for each reason's exponential backoff. */
const COOLDOWN_CAP_MS = {
	rate: 9e5,
	credit: 864e5,
	session: 864e5
};
/** The backoff an account earns after `strikes` consecutive failures. */
function cooldownDurationMs(reason, strikes) {
	const exponent = Math.max(0, Math.min(strikes - 1, 16));
	const base = COOLDOWN_BASE_MS[reason];
	return Math.min(base * 2 ** exponent, COOLDOWN_CAP_MS[reason]);
}
/** Stable identity key for a credential, shared with catalogs and probes. */
function accountIdOf(uid, enterpriseId) {
	return `${uid}:${enterpriseId ?? ""}`;
}
/** The identity key of a credential. */
function credentialAccountId(credential) {
	return accountIdOf(credential.uid, credential.enterpriseId);
}
/** Project one stored account back into the credential shape the wire layer takes. */
function credentialOf(account) {
	return {
		accessToken: account.accessToken,
		refreshToken: account.refreshToken,
		expiresAtMs: account.expiresAtMs,
		...account.refreshExpiresAtMs === void 0 ? {} : { refreshExpiresAtMs: account.refreshExpiresAtMs },
		domain: account.domain,
		uid: account.uid,
		...account.enterpriseId === void 0 ? {} : { enterpriseId: account.enterpriseId },
		...account.nickname === void 0 ? {} : { nickname: account.nickname },
		source: account.origin === "desktop" ? "desktop" : "dsh"
	};
}
/** Pool-file path for one variant inside the Harness home. */
function workbuddyAccountsPath(filename = WORKBUDDY_ACCOUNTS_FILENAME) {
	return resolve(resolveDshHome(), filename);
}
function optionalString$1(value) {
	return typeof value === "string" && value !== "" ? value : void 0;
}
/** Whether a parsed value is an account row this reader can trust. */
function isAccount(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const row = value;
	if (typeof row["id"] !== "string" || row["id"] === "") return false;
	if (typeof row["uid"] !== "string" || row["uid"] === "") return false;
	if (typeof row["accessToken"] !== "string" || row["accessToken"] === "") return false;
	if (typeof row["domain"] !== "string") return false;
	if (typeof row["enabled"] !== "boolean") return false;
	if (typeof row["expiresAtMs"] !== "number" || !Number.isFinite(row["expiresAtMs"])) return false;
	return true;
}
/** Normalize one parsed row, filling the fields older writes may have omitted. */
function normalizeAccount(row) {
	const now = Date.now();
	const cooldown = row.cooldown;
	const normalized = {
		id: row.id,
		uid: row.uid,
		...optionalString$1(row.enterpriseId) === void 0 ? {} : { enterpriseId: row.enterpriseId },
		...optionalString$1(row.nickname) === void 0 ? {} : { nickname: row.nickname },
		...optionalString$1(row.label) === void 0 ? {} : { label: row.label },
		domain: row.domain,
		accessToken: row.accessToken,
		refreshToken: typeof row.refreshToken === "string" ? row.refreshToken : "",
		expiresAtMs: row.expiresAtMs,
		...typeof row.refreshExpiresAtMs === "number" && Number.isFinite(row.refreshExpiresAtMs) ? { refreshExpiresAtMs: row.refreshExpiresAtMs } : {},
		origin: row.origin === "qr" ? "qr" : row.origin === "cookie" ? "cookie" : "desktop",
		enabled: row.enabled,
		lastUsedAtMs: typeof row.lastUsedAtMs === "number" && Number.isFinite(row.lastUsedAtMs) ? row.lastUsedAtMs : 0,
		...typeof row.addedAtMs === "number" && Number.isFinite(row.addedAtMs) ? { addedAtMs: row.addedAtMs } : { addedAtMs: now },
		updatedAtMs: typeof row.updatedAtMs === "number" && Number.isFinite(row.updatedAtMs) ? row.updatedAtMs : now,
		...row.sessionDead === true ? { sessionDead: true } : {}
	};
	if (cooldown !== void 0 && typeof cooldown === "object" && cooldown !== null && typeof cooldown.untilMs === "number" && Number.isFinite(cooldown.untilMs)) normalized.cooldown = {
		untilMs: cooldown.untilMs,
		reason: cooldown.reason === "credit" || cooldown.reason === "session" ? cooldown.reason : "rate",
		strikes: typeof cooldown.strikes === "number" && cooldown.strikes > 0 ? Math.floor(cooldown.strikes) : 1,
		atMs: typeof cooldown.atMs === "number" && Number.isFinite(cooldown.atMs) ? cooldown.atMs : now
	};
	return normalized;
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
var WorkBuddyAccountPool = class {
	variant;
	path;
	accounts;
	constructor(options) {
		this.variant = options.variant;
		this.path = options.path ?? workbuddyAccountsPath(options.variant.accountFilename);
	}
	/** Resolved pool-file path, for diagnostics and tests. */
	filePath() {
		return this.path;
	}
	/** Which variant this pool belongs to. */
	variantId() {
		return this.variant.id;
	}
	/** Every account, in rotation order. */
	list() {
		return this.load();
	}
	/** One account by identity. */
	get(id) {
		return this.load().find((account) => account.id === id);
	}
	/** Whether the pool could serve a request right now (ignoring cooldowns). */
	hasEnabled() {
		return this.load().some((account) => account.enabled && account.sessionDead !== true);
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
	upsert(input) {
		const accounts = this.load();
		const id = accountIdOf(input.uid, input.enterpriseId);
		const now = Date.now();
		const index = accounts.findIndex((account) => account.id === id);
		if (index < 0) {
			const account = {
				id,
				uid: input.uid,
				...input.enterpriseId === void 0 || input.enterpriseId === "" ? {} : { enterpriseId: input.enterpriseId },
				...input.nickname === void 0 || input.nickname === "" ? {} : { nickname: input.nickname },
				domain: input.domain,
				accessToken: input.accessToken,
				refreshToken: input.refreshToken,
				expiresAtMs: input.expiresAtMs,
				...input.refreshExpiresAtMs === void 0 ? {} : { refreshExpiresAtMs: input.refreshExpiresAtMs },
				origin: input.origin,
				enabled: true,
				lastUsedAtMs: 0,
				addedAtMs: now,
				updatedAtMs: now
			};
			accounts.push(account);
			this.persist();
			return {
				account,
				created: true,
				updated: false
			};
		}
		const previous = accounts[index];
		const updated = {
			...previous,
			...input.enterpriseId === void 0 || input.enterpriseId === "" ? {} : { enterpriseId: input.enterpriseId },
			...input.nickname === void 0 || input.nickname === "" ? {} : { nickname: input.nickname },
			domain: input.domain,
			accessToken: input.accessToken,
			...input.refreshToken === "" ? {} : { refreshToken: input.refreshToken },
			expiresAtMs: input.expiresAtMs,
			...input.refreshExpiresAtMs === void 0 ? {} : { refreshExpiresAtMs: input.refreshExpiresAtMs },
			updatedAtMs: now,
			enabled: true
		};
		delete updated.cooldown;
		delete updated.sessionDead;
		accounts[index] = updated;
		const changed = updated.accessToken !== previous.accessToken || updated.refreshToken !== previous.refreshToken || updated.domain !== previous.domain;
		this.persist();
		return {
			account: updated,
			created: false,
			updated: changed
		};
	}
	/** Merge a token refresh into a stored account. */
	updateTokens(id, tokens) {
		const accounts = this.load();
		const index = accounts.findIndex((account) => account.id === id);
		if (index < 0) return void 0;
		const updated = {
			...accounts[index],
			accessToken: tokens.accessToken,
			...tokens.refreshToken === void 0 || tokens.refreshToken === "" ? {} : { refreshToken: tokens.refreshToken },
			...tokens.expiresAtMs === void 0 ? {} : { expiresAtMs: tokens.expiresAtMs },
			...tokens.domain === void 0 || tokens.domain === "" ? {} : { domain: tokens.domain },
			...tokens.refreshExpiresAtMs === void 0 ? {} : { refreshExpiresAtMs: tokens.refreshExpiresAtMs },
			updatedAtMs: Date.now()
		};
		delete updated.sessionDead;
		accounts[index] = updated;
		this.persist();
		return updated;
	}
	/** Remove one account. */
	remove(id) {
		const accounts = this.load();
		const index = accounts.findIndex((account) => account.id === id);
		if (index < 0) return false;
		accounts.splice(index, 1);
		this.persist();
		return true;
	}
	/** Enable or disable one account. */
	setEnabled(id, enabled) {
		return this.mutate(id, (current) => ({
			...current,
			enabled,
			updatedAtMs: Date.now()
		})) !== void 0;
	}
	/** Set or clear the user's label for one account. */
	setLabel(id, label) {
		const trimmed = label?.trim();
		return this.mutate(id, (current) => {
			const next = {
				...current,
				updatedAtMs: Date.now()
			};
			if (trimmed === void 0 || trimmed === "") delete next.label;
			else next.label = trimmed;
			return next;
		}) !== void 0;
	}
	/**
	* Reorder the pool. Ids not named keep their relative order after the named
	* ones, so a stale client cannot drop an account it did not know about.
	*/
	reorder(ids) {
		const accounts = this.load();
		const byId = new Map(accounts.map((account) => [account.id, account]));
		const ordered = [];
		for (const id of ids) {
			const account = byId.get(id);
			if (account === void 0) continue;
			byId.delete(id);
			ordered.push(account);
		}
		for (const account of accounts) if (byId.has(account.id)) ordered.push(account);
		this.accounts = ordered;
		this.persist();
	}
	/** Mark an account as having just served a request. */
	markUsed(id) {
		this.mutate(id, (current) => ({
			...current,
			lastUsedAtMs: Date.now()
		}));
	}
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
	cooldown(id, reason, retryAfterMs) {
		const now = Date.now();
		let result;
		this.mutate(id, (current) => {
			const strikes = current.cooldown !== void 0 && current.cooldown.untilMs > now ? current.cooldown.strikes + 1 : 1;
			const duration = retryAfterMs !== void 0 && retryAfterMs > 0 ? Math.min(Math.max(retryAfterMs, 1e3), COOLDOWN_CAP_MS[reason]) : cooldownDurationMs(reason, strikes);
			const cooldown = {
				untilMs: now + duration,
				reason,
				strikes,
				atMs: now
			};
			result = cooldown;
			return {
				...current,
				cooldown
			};
		});
		return result;
	}
	/** Clear a benching after a success. */
	clearCooldown(id) {
		this.mutate(id, (current) => {
			if (current.cooldown === void 0) return current;
			const next = { ...current };
			delete next.cooldown;
			return next;
		});
	}
	/** Mark an account's session as permanently dead. */
	markSessionDead(id) {
		this.mutate(id, (current) => ({
			...current,
			sessionDead: true,
			updatedAtMs: Date.now()
		}));
	}
	/** Whether an account may be picked right now. */
	isAvailable(account, now = Date.now()) {
		if (!account.enabled || account.sessionDead === true) return false;
		if (account.cooldown !== void 0 && account.cooldown.untilMs > now) return false;
		return true;
	}
	/**
	* The next account to try, excluding ids already tried in this request.
	*
	* Least-recently-used wins, with pool order as the tiebreak. LRU rather than
	* round-robin because a restart, a new sign-in, or a user reorder all reset
	* a cursor but leave "when did this account last work" meaningful.
	*
	* @param tried - identities already attempted for the request in flight.
	*/
	next(tried, now = Date.now()) {
		let best;
		for (const account of this.load()) {
			if (tried.has(account.id)) continue;
			if (!this.isAvailable(account, now)) continue;
			if (best === void 0 || account.lastUsedAtMs < best.lastUsedAtMs) best = account;
		}
		return best;
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
	primary(preferredId, now = Date.now()) {
		if (preferredId !== void 0) {
			const preferred = this.get(preferredId);
			if (preferred !== void 0 && this.isAvailable(preferred, now)) return preferred;
			if (preferred !== void 0 && preferred.enabled && preferred.sessionDead !== true) return preferred;
		}
		for (const account of this.load()) if (this.isAvailable(account, now)) return account;
		for (const account of this.load()) if (account.enabled && account.sessionDead !== true) return account;
	}
	mutate(id, update) {
		const accounts = this.load();
		const index = accounts.findIndex((account) => account.id === id);
		if (index < 0) return void 0;
		const next = update(accounts[index]);
		accounts[index] = next;
		this.persist();
		return next;
	}
	load() {
		if (this.accounts !== void 0) return this.accounts;
		const accounts = [];
		if (existsSync(this.path)) try {
			const parsed = JSON.parse(readFileSync(this.path, "utf8"));
			if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
				const document = parsed;
				const raw = document["version"] === POOL_FORMAT_VERSION ? document["accounts"] : void 0;
				if (Array.isArray(raw)) {
					const seen = /* @__PURE__ */ new Set();
					for (const value of raw) {
						if (!isAccount(value)) continue;
						const account = normalizeAccount(value);
						if (seen.has(account.id)) continue;
						seen.add(account.id);
						accounts.push(account);
					}
				}
			}
		} catch {}
		this.accounts = accounts;
		return accounts;
	}
	persist() {
		const directory = dirname(this.path);
		try {
			if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
			const document = {
				version: POOL_FORMAT_VERSION,
				accounts: this.load()
			};
			const temporary = resolve(`${this.path}.tmp`);
			writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, { mode: 384 });
			renameSync(temporary, this.path);
		} catch {}
	}
};
//#endregion
//#region src/account-token.ts
/**
* Decode the payload segment of a JWT, without verifying it.
*
* @returns the parsed claims, or undefined when the value is not a JWT with a
*   JSON object payload — which is what a truncated paste looks like.
*/
function decodeTokenPayload(token) {
	const parts = token.trim().split(".");
	if (parts.length !== 3) return void 0;
	const payload = parts[1];
	if (payload === void 0 || payload === "") return void 0;
	try {
		const base64 = payload.replace(/-/gu, "+").replace(/_/gu, "/");
		const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
		const binary = atob(padded);
		const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
		const text = new TextDecoder().decode(bytes);
		const parsed = JSON.parse(text);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return void 0;
		return parsed;
	} catch {
		return;
	}
}
/** Read one claim as a trimmed non-empty string. */
function claim(payload, key) {
	const value = payload[key];
	if (typeof value !== "string") return void 0;
	const trimmed = value.replace(/[\u0000-\u001f\u007f\u00a0\u200b-\u200d\ufeff]/gu, " ").trim();
	return trimmed === "" ? void 0 : trimmed;
}
/**
* The login domain a token's issuer implies.
*
* The CN console issues under `https://www.workbuddy.cn/auth/realms/copilot`
* and the international one under a `workbuddy.ai` host, so the issuer is what
* tells the two products apart when a user pastes a token into the wrong
* dialog. Matching is on the host suffix, not the whole string, because the
* realm path is not part of the contract this plugin relies on.
*/
function domainForIssuer(issuer) {
	if (issuer === void 0) return void 0;
	let host;
	try {
		host = new URL(issuer).host.toLowerCase();
	} catch {
		return;
	}
	if (host === "workbuddy.ai" || host.endsWith(".workbuddy.ai")) return "www.workbuddy.ai";
	if (host === "workbuddy.cn" || host.endsWith(".workbuddy.cn")) return "www.workbuddy.cn";
}
/**
* Read the account a pasted token describes.
*
* @returns the profile, or undefined when the value has no readable `sub` —
*   the one claim the pool cannot work without, because it is the account's
*   identity.
*/
function profileFromToken(token) {
	const payload = decodeTokenPayload(token);
	if (payload === void 0) return void 0;
	const uid = claim(payload, "sub");
	if (uid === void 0) return void 0;
	const nickname = claim(payload, "nickname") ?? claim(payload, "preferred_username");
	const exp = payload["exp"];
	const expiresAtMs = typeof exp === "number" && Number.isFinite(exp) && exp > 0 ? exp * 1e3 : 0;
	const enterpriseId = claim(payload, "enterpriseId") ?? claim(payload, "enterprise_id");
	const domain = domainForIssuer(claim(payload, "iss"));
	return {
		uid,
		...nickname === void 0 ? {} : { nickname },
		...enterpriseId === void 0 ? {} : { enterpriseId },
		expiresAtMs,
		domain: domain ?? ""
	};
}
//#endregion
//#region src/account-service.ts
/** How long a per-account credit figure is reused before it is fetched again. */
const CREDIT_TTL_MS = 6e4;
/**
* Owns the pool's network-facing behaviour for one variant.
*
* Credit figures are cached per account for a minute. That matters because the
* floating window polls while a conversation is open, and an uncached lookup
* would mean one billing request per account per poll — real traffic against
* the user's own quota, for a number that changes slowly.
*/
var WorkBuddyAccountService = class {
	variant;
	pool;
	store;
	client;
	qr;
	logger;
	now;
	credits = /* @__PURE__ */ new Map();
	inflight = /* @__PURE__ */ new Map();
	constructor(options) {
		this.variant = options.variant;
		this.pool = options.pool;
		this.store = options.store;
		this.client = options.client;
		this.qr = options.qr;
		this.logger = options.logger;
		this.now = options.now ?? (() => Date.now());
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
	async captureDesktop() {
		const credential = await this.store.desktopCredential();
		if (credential === void 0) return void 0;
		return this.capture(credential);
	}
	/**
	* Capture a credential that came from anywhere into the pool.
	*
	* The region is not re-checked here: {@link WorkBuddyCredentialStore} already
	* refuses a credential belonging to the other product, and the QR flow checks
	* its own answer before it gets this far.
	*/
	capture(credential) {
		return this.pool.upsert({
			uid: credential.uid,
			...credential.enterpriseId === void 0 ? {} : { enterpriseId: credential.enterpriseId },
			...credential.nickname === void 0 ? {} : { nickname: credential.nickname },
			domain: credential.domain,
			accessToken: credential.accessToken,
			refreshToken: credential.refreshToken,
			expiresAtMs: credential.expiresAtMs,
			...credential.refreshExpiresAtMs === void 0 ? {} : { refreshExpiresAtMs: credential.refreshExpiresAtMs },
			origin: "desktop"
		}).account;
	}
	/** The desktop app's account identity, when the app is signed in. */
	async desktopIdentity() {
		const credential = await this.store.desktopCredential();
		return credential === void 0 ? void 0 : credentialAccountId(credential);
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
	async primaryCredential() {
		const desktopId = await this.desktopIdentity();
		const primary = this.pool.primary(desktopId, this.now());
		if (primary === void 0) return void 0;
		return credentialOf(await this.refreshIfStale(primary));
	}
	/** The identity {@link primaryCredential} would answer for. */
	async primaryIdentity() {
		const desktopId = await this.desktopIdentity();
		return this.pool.primary(desktopId, this.now())?.id;
	}
	/**
	* Refresh an account whose access token is at or near expiry.
	*
	* The pool's own copy is the one that gets updated, so a refresh survives a
	* restart. A failed refresh is not fatal: a token that has not actually
	* expired yet still works, which is the same tolerance the single-account
	* store had.
	*/
	async refreshIfStale(account) {
		if (account.expiresAtMs > this.now() + 3e5) return account;
		if (account.refreshToken === "") return account;
		try {
			const outcome = await this.client.refreshToken(credentialOf(account));
			return this.pool.updateTokens(account.id, {
				accessToken: outcome.accessToken,
				...outcome.refreshToken === void 0 ? {} : { refreshToken: outcome.refreshToken },
				...outcome.expiresInSec === void 0 ? {} : { expiresAtMs: this.now() + outcome.expiresInSec * 1e3 },
				...outcome.domain === void 0 ? {} : { domain: outcome.domain }
			}) ?? account;
		} catch (error) {
			this.logger?.warn(`dsh-workbuddy-connect: ${this.variant.displayName} token refresh failed`, error);
			return account;
		}
	}
	/** Whether the variant has any account at all (enabled, dead, benched or not). */
	hasAccounts() {
		return this.pool.list().length > 0;
	}
	/** Whether the variant has at least one account rotation may use. */
	hasUsableAccount() {
		return this.pool.list().some((account) => this.pool.isAvailable(account, this.now()));
	}
	/**
	* One account's remaining credit, cached.
	*
	* @param force - bypass the cache, for a user-initiated refresh.
	*/
	async creditsFor(account, force = false) {
		const cached = this.credits.get(account.id);
		if (!force && cached !== void 0 && this.now() - cached.atMs < CREDIT_TTL_MS) return cached;
		const existing = this.inflight.get(account.id);
		if (existing !== void 0) return existing;
		const run = (async () => {
			try {
				const entry = {
					total: (await this.client.fetchCredits(credentialOf(account))).total,
					atMs: this.now()
				};
				this.credits.set(account.id, entry);
				return entry;
			} catch (error) {
				const entry = {
					error: (error instanceof Error ? error.message : String(error)).slice(0, 200),
					atMs: this.now()
				};
				this.credits.set(account.id, entry);
				return entry;
			}
		})().finally(() => {
			this.inflight.delete(account.id);
		});
		this.inflight.set(account.id, run);
		return run;
	}
	/** Forget a cached credit figure, e.g. after a request spent some. */
	invalidateCredits(id) {
		if (id === void 0) this.credits.clear();
		else this.credits.delete(id);
	}
	/**
	* The snapshot the card's account tab and the floating window render.
	*
	* @param withCredits - whether to include per-account balances. The floating
	*   window asks for them; a write confirmation does not need them and should
	*   not pay for N billing requests.
	* @param forceCredits - bypass the credit cache.
	*/
	async snapshot(options = {}) {
		const desktopId = await this.desktopIdentity();
		const accounts = this.pool.list();
		const primary = this.pool.primary(desktopId, this.now())?.id;
		const views = [];
		for (const account of accounts) {
			let credits;
			if (options.withCredits === true) credits = await this.creditsFor(account, options.forceCredits === true);
			views.push({
				id: account.id,
				uid: account.uid,
				name: account.label ?? account.nickname ?? `${account.uid.slice(0, 8)}…`,
				...account.label === void 0 ? {} : { label: account.label },
				...account.nickname === void 0 ? {} : { nickname: account.nickname },
				origin: account.origin,
				domain: account.domain,
				renewable: account.refreshToken !== "",
				enabled: account.enabled,
				available: this.pool.isAvailable(account, this.now()),
				...credits?.total === void 0 ? {} : { credits: credits.total },
				...credits?.error === void 0 ? {} : { creditsError: credits.error },
				...credits === void 0 ? {} : { creditsAtMs: credits.atMs },
				expiresAtMs: account.expiresAtMs,
				...account.sessionDead === true ? { sessionDead: true } : {},
				...account.cooldown === void 0 ? {} : { cooldown: {
					untilMs: account.cooldown.untilMs,
					reason: account.cooldown.reason,
					strikes: account.cooldown.strikes
				} },
				lastUsedAtMs: account.lastUsedAtMs,
				addedAtMs: account.addedAtMs
			});
		}
		return {
			accounts: views,
			...primary === void 0 ? {} : { primary },
			...desktopId === void 0 ? {} : { desktop: desktopId }
		};
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
	addCookieAccount(token) {
		const profile = profileFromToken(token);
		if (profile === void 0) return { reason: "that does not look like a sign-in token (no readable payload)" };
		if (profile.domain === "") return { reason: "the token names an issuer this plugin does not recognise" };
		if (regionOf(profile.domain) !== this.variant.region) return { reason: `that is a ${regionOf(profile.domain) === "global" ? "WorkBuddy AI (international)" : "WorkBuddy (CN)"} token; paste it into the matching product's dialog` };
		const result = this.pool.upsert({
			uid: profile.uid,
			...profile.enterpriseId === void 0 ? {} : { enterpriseId: profile.enterpriseId },
			...profile.nickname === void 0 ? {} : { nickname: profile.nickname },
			domain: profile.domain,
			accessToken: token.trim(),
			refreshToken: "",
			expiresAtMs: profile.expiresAtMs,
			origin: "cookie"
		});
		this.invalidateCredits(result.account.id);
		return {
			account: result.account,
			created: result.created
		};
	}
	/** Add one QR sign-in to the pool. */
	addQrAccount(poll) {
		const result = this.pool.upsert({
			uid: poll.uid,
			...poll.enterpriseId === void 0 ? {} : { enterpriseId: poll.enterpriseId },
			...poll.nickname === void 0 ? {} : { nickname: poll.nickname },
			domain: poll.domain,
			accessToken: poll.accessToken,
			refreshToken: poll.refreshToken,
			expiresAtMs: poll.expiresAtMs,
			origin: "qr"
		});
		this.invalidateCredits(result.account.id);
		return {
			account: result.account,
			created: result.created,
			updated: result.updated
		};
	}
	/** Identity key for a uid/enterprise pair, for callers holding raw values. */
	idOf(uid, enterpriseId) {
		return accountIdOf(uid, enterpriseId);
	}
};
//#endregion
//#region src/status-paths.ts
/** Node-free constants and types shared by the Host and browser halves. */
/** Plugin-owned status endpoint consumed by its browser half. */
const WORKBUDDY_STATUS_PATH = "/plugins/dsh-workbuddy-connect/status";
/**
* Plugin-owned probe control endpoint.
*
* Separate from the status route because it accepts writes: the status route's
* loopback Host/Origin guard protects against a DNS-rebinding *page*, which is
* not the same as authorizing a state-changing action. This route therefore
* also requires the in-process key the browser half receives with the status
* document.
*/
const WORKBUDDY_PROBE_PATH = "/plugins/dsh-workbuddy-connect/probe";
/**
* The international (WorkBuddy AI) variant's own pair of routes.
*
* Kept as separate constants rather than a computed suffix so both halves
* reference literal strings: the browser bundle and the host bundle are built
* independently, and a shared expression is one build-config drift away from
* the desk asking a route the host never mounted.
*/
const WORKBUDDY_AI_STATUS_PATH = "/plugins/dsh-workbuddy-connect/ai/status";
const WORKBUDDY_AI_PROBE_PATH = "/plugins/dsh-workbuddy-connect/ai/probe";
/**
* Account-management routes, one pair per variant.
*
* Separate from the probe route because they act on different state (the
* account pool, not probe records) and because a browser that fails to reach
* one must not lose the other. Both are writes and therefore carry the same
* in-process key as the probe route.
*/
const WORKBUDDY_ACCOUNT_PATH = "/plugins/dsh-workbuddy-connect/accounts";
const WORKBUDDY_AI_ACCOUNT_PATH = "/plugins/dsh-workbuddy-connect/ai/accounts";
//#endregion
//#region src/qr-login.ts
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
/** How long a minted QR sign-in stays valid; matches the upstream's own window. */
const STATE_TTL_MS = 3e5;
/** Timeout for one plugin-auth request. */
const AUTH_TIMEOUT_MS = 2e4;
/** The CLI identity the upstream expects on every plugin-auth request. */
const AUTH_UA = "CLI/2.63.2 CodeBuddy/2.63.2";
function isObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function optionalString(value) {
	return typeof value === "string" && value !== "" ? value : void 0;
}
/** Parse the envelope, tolerating a non-JSON body (an edge gateway's HTML 401). */
function parseEnvelope(text) {
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		return;
	}
	if (!isObject(parsed)) return void 0;
	return {
		code: typeof parsed["code"] === "number" ? parsed["code"] : 0,
		msg: typeof parsed["msg"] === "string" ? parsed["msg"] : "",
		data: parsed["data"]
	};
}
/**
* One QR sign-in flow for one variant.
*
* Instances are cheap and stateless beyond the outstanding-state set; the
* plugin keeps one per variant.
*/
var WorkBuddyQrLogin = class {
	variant;
	/**
	* Injectable fetch. Left undefined in production so {@link send} resolves
	* `globalThis.fetch` per call: a test that stubs the global after
	* constructing the flow (which is how every other test in this plugin works)
	* then still reaches the stub, and a proxy or instrumentation installed later
	* is picked up rather than bypassed.
	*/
	injectedFetch;
	now;
	/** States this process minted, and when each was created. */
	states = /* @__PURE__ */ new Map();
	constructor(options) {
		this.variant = options.variant;
		this.injectedFetch = options.fetch;
		this.now = options.now ?? (() => Date.now());
	}
	/** The region every request here goes to, from the variant descriptor. */
	region() {
		return this.variant.region;
	}
	base() {
		return chatBaseForRegion(this.region());
	}
	/** One plugin-auth request, through the injected or the ambient fetch. */
	send(url, init) {
		return (this.injectedFetch ?? globalThis.fetch)(url, init);
	}
	/** The headers the official CLI sends; the upstream checks the UA. */
	headers(extra = {}) {
		const origin = originForRegion(this.region());
		return {
			"Content-Type": "application/json",
			"Accept": "application/json, text/plain, */*",
			"X-Requested-With": "XMLHttpRequest",
			"User-Agent": AUTH_UA,
			"Origin": origin,
			"Referer": `${origin}/`,
			...extra
		};
	}
	/**
	* Mint a challenge: the QR payload and the state to poll.
	*
	* The state is remembered locally. The upstream also validates it, but a
	* local record is what lets {@link poll} answer `invalid` for a state that
	* was never minted here instead of forwarding an arbitrary value upstream.
	*/
	async start() {
		const response = await this.send(`${this.base()}/v2/plugin/auth/state?platform=CLI`, {
			method: "POST",
			headers: this.headers(),
			body: "{}",
			signal: AbortSignal.timeout(AUTH_TIMEOUT_MS)
		});
		const envelope = parseEnvelope(await response.text());
		if (envelope === void 0) throw new Error(`${this.variant.displayName} sign-in: the auth endpoint answered a non-JSON body (http ${response.status})`);
		if (!response.ok || envelope.code !== 0) throw new Error(`${this.variant.displayName} sign-in: could not obtain an authorization link (code ${envelope.code}${envelope.msg === "" ? "" : `: ${envelope.msg.slice(0, 120)}`})`);
		const data = isObject(envelope.data) ? envelope.data : {};
		const state = optionalString(data["state"]);
		const authUrl = optionalString(data["authUrl"]);
		if (state === void 0 || authUrl === void 0) throw new Error(`${this.variant.displayName} sign-in: the auth endpoint returned no state/authUrl`);
		const createdAt = this.now();
		this.states.set(state, createdAt);
		this.prune();
		return {
			state,
			authUrl,
			expiresAtMs: createdAt + STATE_TTL_MS
		};
	}
	/**
	* Poll one challenge.
	*
	* A non-zero business code is the *normal* "still waiting" answer
	* (`11217:login ing...`), not a failure, so it is reported as `waiting`
	* rather than thrown. The account call is what turns a token into the uid
	* the pool keys on; until it answers a uid, the sign-in is not complete.
	*/
	async poll(state) {
		const createdAt = this.states.get(state);
		if (createdAt === void 0) return { status: "invalid" };
		if (this.now() - createdAt > STATE_TTL_MS) {
			this.states.delete(state);
			return { status: "expired" };
		}
		const tokenEnvelope = parseEnvelope(await (await this.send(`${this.base()}/v2/plugin/auth/token?state=${encodeURIComponent(state)}`, {
			method: "GET",
			headers: this.headers(),
			signal: AbortSignal.timeout(AUTH_TIMEOUT_MS)
		})).text());
		if (tokenEnvelope === void 0) return { status: "waiting" };
		const tokenData = isObject(tokenEnvelope.data) ? tokenEnvelope.data : {};
		const accessToken = optionalString(tokenData["accessToken"]);
		if (tokenEnvelope.code !== 0 || accessToken === void 0) return { status: "waiting" };
		const refreshToken = optionalString(tokenData["refreshToken"]) ?? "";
		const expiresInSec = typeof tokenData["expiresIn"] === "number" && tokenData["expiresIn"] > 0 ? tokenData["expiresIn"] : 3600;
		const declaredDomain = optionalString(tokenData["domain"]) ?? "";
		const accountEnvelope = parseEnvelope(await (await this.send(`${this.base()}/v2/plugin/login/account?state=${encodeURIComponent(state)}`, {
			method: "GET",
			headers: this.headers({ Authorization: `Bearer ${accessToken}` }),
			signal: AbortSignal.timeout(AUTH_TIMEOUT_MS)
		})).text());
		const accountData = accountEnvelope !== void 0 && isObject(accountEnvelope.data) ? accountEnvelope.data : {};
		const uid = optionalString(accountData["uid"]);
		if (uid === void 0) return { status: "waiting" };
		this.states.delete(state);
		const domain = declaredDomain !== "" ? declaredDomain : this.defaultDomain();
		if (regionOf(domain) !== this.variant.region) throw new Error(`${this.variant.displayName} sign-in returned a ${regionOf(domain) === "cn" ? "WorkBuddy (CN)" : "WorkBuddy AI"} credential (domain ${JSON.stringify(domain)}); scan the code with the ${this.variant.appName} account instead`);
		return {
			status: "ready",
			uid,
			...optionalString(accountData["enterpriseId"]) === void 0 ? {} : { enterpriseId: accountData["enterpriseId"] },
			...optionalString(accountData["nickname"]) === void 0 ? {} : { nickname: accountData["nickname"] },
			domain,
			accessToken,
			refreshToken,
			expiresAtMs: this.now() + expiresInSec * 1e3
		};
	}
	/** Drop an outstanding challenge (the user closed the dialog). */
	cancel(state) {
		this.states.delete(state);
	}
	/** The domain a variant's credentials carry when the upstream omits one. */
	defaultDomain() {
		return this.variant.region === "global" ? "workbuddy.ai" : "";
	}
	prune() {
		const cutoff = this.now() - STATE_TTL_MS;
		for (const [state, createdAt] of this.states) if (createdAt < cutoff) this.states.delete(state);
	}
};
/** A random opaque id, for logging a challenge without exposing its state. */
function challengeTag() {
	return randomUUID().slice(0, 8);
}
//#endregion
//#region src/catalog.ts
/**
* WorkBuddy model catalog: a static fallback list captured from the live
* endpoint, replaced by the upstream's dynamic answer once it loads.
*
* @module dsh-workbuddy-connect/catalog
*/
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
const FALLBACK_WORKBUDDY_MODELS = [
	{
		id: "auto",
		name: "Auto",
		contextWindow: 168e3,
		maxTokens: 32e3,
		supportsImages: true,
		reasoning: {
			supports: true,
			onlyReasoning: true,
			defaultEffort: "high",
			canDisableThinking: false
		},
		billing: { free: false }
	},
	{
		id: "hy4-preview",
		name: "Hy4 preview",
		contextWindow: 1e6,
		maxTokens: 64e3,
		supportsImages: true,
		reasoning: {
			supports: true,
			onlyReasoning: true,
			supportedEfforts: ["high"],
			defaultEffort: "high",
			canDisableThinking: false
		},
		billing: {
			free: false,
			rateUnknown: true
		}
	},
	{
		id: "hy3",
		name: "Hy3",
		contextWindow: 192e3,
		maxTokens: 64e3,
		supportsImages: true,
		reasoning: {
			supports: true,
			onlyReasoning: true,
			defaultEffort: "high",
			canDisableThinking: false
		},
		billing: {
			free: false,
			rateUnknown: true
		}
	},
	{
		id: "hy3-x",
		name: "Hy3",
		contextWindow: 192e3,
		maxTokens: 64e3,
		supportsImages: true,
		reasoning: {
			supports: true,
			onlyReasoning: true,
			supportedEfforts: ["low", "high"],
			defaultEffort: "high",
			canDisableThinking: false
		},
		billing: {
			credits: "x0.05",
			free: false
		}
	},
	{
		id: "deepseek-v4.1-flash",
		name: "Deepseek-V4.1-Flash",
		contextWindow: 1e6,
		maxTokens: 128e3,
		supportsImages: true,
		reasoning: {
			supports: true,
			onlyReasoning: true,
			defaultEffort: "high",
			canDisableThinking: false
		},
		billing: {
			credits: "x0.03 credits",
			badges: ["独家优惠"],
			free: false
		}
	},
	{
		id: "glm-5.3",
		name: "GLM-5.3",
		contextWindow: 1e6,
		maxTokens: 48e3,
		supportsImages: true,
		reasoning: {
			supports: true,
			onlyReasoning: true,
			supportedEfforts: [
				"low",
				"high",
				"max"
			],
			defaultEffort: "high",
			canDisableThinking: true
		},
		billing: {
			credits: "x0.79",
			free: false
		}
	},
	{
		id: "glm-5.3-flash",
		name: "GLM-5.3-Flash",
		contextWindow: 1e6,
		maxTokens: 32e3,
		supportsImages: true,
		reasoning: {
			supports: true,
			onlyReasoning: true,
			supportedEfforts: [
				"low",
				"high",
				"max"
			],
			defaultEffort: "high",
			canDisableThinking: true
		},
		billing: {
			credits: "x0.06",
			free: false
		}
	},
	{
		id: "glm-5.2",
		name: "GLM-5.2",
		contextWindow: 1e6,
		maxTokens: 48e3,
		supportsImages: true,
		reasoning: {
			supports: true,
			onlyReasoning: true,
			defaultEffort: "medium",
			canDisableThinking: false
		},
		billing: {
			credits: "x0.79 credits",
			badges: ["夜间折扣"],
			free: false
		}
	},
	{
		id: "glm-5.1",
		name: "GLM-5.1",
		contextWindow: 2e5,
		maxTokens: 48e3,
		supportsImages: false,
		reasoning: {
			supports: true,
			onlyReasoning: true,
			defaultEffort: "medium",
			canDisableThinking: false
		},
		billing: {
			credits: "x0.79 credits",
			free: false
		}
	},
	{
		id: "glm-5v-turbo",
		name: "GLM-5v-Turbo",
		contextWindow: 2e5,
		maxTokens: 64e3,
		supportsImages: true,
		reasoning: {
			supports: true,
			onlyReasoning: true,
			defaultEffort: "medium",
			canDisableThinking: false
		},
		billing: {
			credits: "x0.71 credits",
			free: false
		}
	},
	{
		id: "kimi-k3-1",
		name: "Kimi-K3",
		contextWindow: 1e6,
		maxTokens: 32e3,
		supportsImages: true,
		reasoning: {
			supports: true,
			onlyReasoning: true,
			defaultEffort: "medium",
			canDisableThinking: false
		},
		billing: {
			credits: "x1.62 credits",
			free: false
		}
	},
	{
		id: "kimi-k2.8-preview",
		name: "Kimi-K2.8-Preview",
		contextWindow: 1e6,
		maxTokens: 32e3,
		supportsImages: true,
		reasoning: {
			supports: true,
			onlyReasoning: true,
			supportedEfforts: [
				"low",
				"high",
				"max"
			],
			defaultEffort: "high",
			canDisableThinking: true
		},
		billing: {
			credits: "x0.77 credits",
			free: false
		}
	},
	{
		id: "kimi-k2.7",
		name: "Kimi-K2.7-Code",
		contextWindow: 256e3,
		maxTokens: 32e3,
		supportsImages: true,
		reasoning: {
			supports: true,
			onlyReasoning: true,
			defaultEffort: "medium",
			canDisableThinking: false
		},
		billing: {
			credits: "x0.57 credits",
			free: false
		}
	},
	{
		id: "kimi-k2.6",
		name: "Kimi-K2.6",
		contextWindow: 256e3,
		maxTokens: 32e3,
		supportsImages: true,
		reasoning: {
			supports: true,
			onlyReasoning: true,
			defaultEffort: "medium",
			canDisableThinking: false
		},
		billing: {
			credits: "x0.52 credits",
			free: false
		}
	},
	{
		id: "minimax-m3",
		name: "MiniMax-M3",
		contextWindow: 512e3,
		maxTokens: 128e3,
		supportsImages: true,
		reasoning: {
			supports: true,
			onlyReasoning: true,
			defaultEffort: "medium",
			canDisableThinking: false
		},
		billing: {
			credits: "x0.25 credits",
			free: false
		}
	},
	{
		id: "deepseek-v4-pro",
		name: "Deepseek-V4-Pro",
		contextWindow: 1e6,
		maxTokens: 5e4,
		supportsImages: true,
		reasoning: {
			supports: true,
			onlyReasoning: true,
			defaultEffort: "high",
			canDisableThinking: false
		},
		billing: {
			credits: "x0.51 credits",
			free: false
		}
	}
];
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
const FALLBACK_WORKBUDDY_AI_MODELS = [
	{
		id: "default-model",
		name: "Auto",
		contextWindow: 176e3,
		maxTokens: 24e3,
		supportsImages: true,
		reasoning: {
			supports: false,
			onlyReasoning: false,
			canDisableThinking: true
		},
		billing: { free: false }
	},
	{
		id: "fast-model",
		name: "Fast",
		contextWindow: 2e5,
		maxTokens: 32e3,
		supportsImages: true,
		reasoning: {
			supports: true,
			onlyReasoning: true,
			defaultEffort: "medium",
			canDisableThinking: false
		},
		billing: {
			credits: "x0.34",
			free: false
		}
	},
	{
		id: "balanced-model",
		name: "Balanced",
		contextWindow: 256e3,
		maxTokens: 32e3,
		supportsImages: true,
		reasoning: {
			supports: true,
			onlyReasoning: true,
			defaultEffort: "medium",
			canDisableThinking: false
		},
		billing: {
			credits: "x0.59",
			free: false
		}
	},
	{
		id: "primary-model",
		name: "Primary",
		contextWindow: 272e3,
		maxTokens: 72e3,
		supportsImages: true,
		reasoning: {
			supports: true,
			onlyReasoning: true,
			defaultEffort: "high",
			canDisableThinking: false
		},
		billing: {
			credits: "x3.31",
			free: false
		}
	},
	{
		id: "deep-model",
		name: "Deep",
		contextWindow: 176e3,
		maxTokens: 24e3,
		supportsImages: true,
		reasoning: {
			supports: false,
			onlyReasoning: false,
			canDisableThinking: true
		},
		billing: {
			credits: "x3.33",
			free: false
		}
	},
	{
		id: "hy4-preview-f",
		name: "Hy4 preview",
		contextWindow: 3e5,
		maxTokens: 64e3,
		supportsImages: true,
		reasoning: {
			supports: true,
			onlyReasoning: true,
			supportedEfforts: ["high"],
			defaultEffort: "high",
			canDisableThinking: false
		},
		billing: {
			free: false,
			rateUnknown: true
		}
	},
	{
		id: "hy3",
		name: "Hy3",
		contextWindow: 192e3,
		maxTokens: 64e3,
		supportsImages: true,
		reasoning: {
			supports: true,
			onlyReasoning: true,
			supportedEfforts: ["low", "high"],
			defaultEffort: "high",
			canDisableThinking: false
		},
		billing: {
			free: false,
			rateUnknown: true
		}
	},
	{
		id: "deepseek-v4.1-flash",
		name: "Deepseek-V4.1-Flash",
		contextWindow: 3e5,
		maxTokens: 128e3,
		supportsImages: true,
		reasoning: {
			supports: true,
			onlyReasoning: true,
			defaultEffort: "high",
			canDisableThinking: false
		},
		billing: {
			free: false,
			rateUnknown: true
		}
	},
	{
		id: "gpt-6-astra",
		name: "GPT-6-Astra",
		contextWindow: 4e5,
		maxTokens: 128e3,
		supportsImages: true,
		reasoning: {
			supports: true,
			onlyReasoning: true,
			supportedEfforts: [
				"low",
				"medium",
				"high",
				"xhigh",
				"max"
			],
			defaultEffort: "medium",
			canDisableThinking: true
		},
		billing: {
			credits: "x6.67",
			free: false
		}
	},
	{
		id: "gpt-5.6-sol",
		name: "GPT-5.6-Sol",
		contextWindow: 1e6,
		maxTokens: 128e3,
		supportsImages: true,
		reasoning: {
			supports: true,
			onlyReasoning: true,
			supportedEfforts: [
				"low",
				"medium",
				"high",
				"xhigh",
				"max"
			],
			defaultEffort: "medium",
			canDisableThinking: true
		},
		billing: {
			credits: "x3.47",
			free: false
		}
	},
	{
		id: "gpt-5.6-terra",
		name: "GPT-5.6-Terra",
		contextWindow: 1e6,
		maxTokens: 128e3,
		supportsImages: true,
		reasoning: {
			supports: true,
			onlyReasoning: true,
			supportedEfforts: [
				"low",
				"medium",
				"high",
				"xhigh",
				"max"
			],
			defaultEffort: "medium",
			canDisableThinking: true
		},
		billing: {
			credits: "x1.39",
			free: false
		}
	},
	{
		id: "gpt-5.6-luna",
		name: "GPT-5.6-Luna",
		contextWindow: 1e6,
		maxTokens: 128e3,
		supportsImages: true,
		reasoning: {
			supports: true,
			onlyReasoning: true,
			supportedEfforts: [
				"low",
				"medium",
				"high",
				"xhigh",
				"max"
			],
			defaultEffort: "medium",
			canDisableThinking: true
		},
		billing: {
			credits: "x0.14",
			free: false
		}
	},
	{
		id: "gpt-5.5",
		name: "GPT-5.5",
		contextWindow: 1e6,
		maxTokens: 128e3,
		supportsImages: true,
		reasoning: {
			supports: true,
			onlyReasoning: true,
			supportedEfforts: [
				"low",
				"medium",
				"high",
				"xhigh"
			],
			defaultEffort: "medium",
			canDisableThinking: false
		},
		billing: {
			credits: "x3.31",
			free: false
		}
	},
	{
		id: "gpt-5.4",
		name: "GPT-5.4",
		contextWindow: 272e3,
		maxTokens: 72e3,
		supportsImages: true,
		reasoning: {
			supports: true,
			onlyReasoning: true,
			supportedEfforts: [
				"low",
				"medium",
				"high",
				"xhigh"
			],
			defaultEffort: "medium",
			canDisableThinking: false
		},
		billing: {
			credits: "x1.65",
			free: false
		}
	},
	{
		id: "gpt-5.3-codex",
		name: "GPT-5.3-Codex",
		contextWindow: 272e3,
		maxTokens: 72e3,
		supportsImages: true,
		reasoning: {
			supports: true,
			onlyReasoning: true,
			defaultEffort: "medium",
			canDisableThinking: false
		},
		billing: {
			credits: "x1.25",
			free: false
		}
	},
	{
		id: "gemini-3.5-flash",
		name: "Gemini-3.5-Flash",
		contextWindow: 1e6,
		maxTokens: 65536,
		supportsImages: true,
		reasoning: {
			supports: true,
			onlyReasoning: true,
			defaultEffort: "medium",
			canDisableThinking: false
		},
		billing: {
			credits: "x0.99",
			free: false
		}
	},
	{
		id: "glm-5.3",
		name: "GLM-5.3",
		contextWindow: 1e6,
		maxTokens: 48e3,
		supportsImages: true,
		reasoning: {
			supports: true,
			onlyReasoning: true,
			supportedEfforts: [
				"low",
				"high",
				"max"
			],
			defaultEffort: "high",
			canDisableThinking: true
		},
		billing: {
			credits: "x0.79",
			free: false
		}
	},
	{
		id: "glm-5.2",
		name: "GLM-5.2",
		contextWindow: 1e6,
		maxTokens: 48e3,
		supportsImages: true,
		reasoning: {
			supports: true,
			onlyReasoning: true,
			supportedEfforts: ["high", "xhigh"],
			defaultEffort: "high",
			canDisableThinking: true
		},
		billing: {
			credits: "x0.79",
			free: false
		}
	},
	{
		id: "kimi-k3",
		name: "Kimi-K3",
		contextWindow: 1e6,
		maxTokens: 32e3,
		supportsImages: true,
		reasoning: {
			supports: true,
			onlyReasoning: true,
			defaultEffort: "medium",
			canDisableThinking: false
		},
		billing: {
			credits: "x1.62",
			free: false
		}
	},
	{
		id: "kimi-k2.6",
		name: "Kimi-K2.6",
		contextWindow: 256e3,
		maxTokens: 32e3,
		supportsImages: true,
		reasoning: {
			supports: true,
			onlyReasoning: true,
			defaultEffort: "medium",
			canDisableThinking: false
		},
		billing: {
			credits: "x0.52",
			free: false
		}
	}
];
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
var WorkBuddyCatalog = class {
	models;
	visible = true;
	constructor(initial = FALLBACK_WORKBUDDY_MODELS) {
		this.models = initial;
	}
	/** Current entries; empty while the variant has no usable credential. */
	current() {
		if (!this.visible) return [];
		return this.models.map((model) => modelWithCurrentPromotion(model));
	}
	/** Replace the list; callers invalidate their adapter snapshot after this. */
	set(models) {
		this.models = [...models];
	}
	/** Whether this variant's models are exposed at all. */
	isVisible() {
		return this.visible;
	}
	/**
	* Show or hide the whole catalog. Returns whether the value changed, so the
	* caller can skip an invalidation that would re-render an identical list.
	*/
	setVisible(visible) {
		if (this.visible === visible) return false;
		this.visible = visible;
		return true;
	}
	/** Models to fall back to when the upstream fetch fails; ignores visibility. */
	fallback() {
		return this.models;
	}
};
//#endregion
//#region src/version.ts
const WORKBUDDY_CONNECT_VERSION = "0.10.0";
//#endregion
//#region src/host-heartbeat.ts
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
const WORKBUDDY_HOST_HEARTBEAT_FILENAME = ".workbuddy-host-heartbeat.json";
/** Current on-disk heartbeat format; readers reject others. */
const HEARTBEAT_FORMAT_VERSION = 1;
/** Absolute path of the host heartbeat file. */
function workbuddyHostHeartbeatPath() {
	return join(resolveDshHome(), WORKBUDDY_HOST_HEARTBEAT_FILENAME);
}
/**
* Write (or overwrite) the heartbeat after the host bundle registered the
* provider. A failed write is non-fatal: the host is already running, and
* the status CLI will simply report "heartbeat missing" rather than failing.
*/
async function writeHostHeartbeat() {
	const document = {
		version: HEARTBEAT_FORMAT_VERSION,
		package: "dsh-workbuddy-connect",
		pluginVersion: WORKBUDDY_CONNECT_VERSION,
		registeredAt: Date.now(),
		pid: process.pid
	};
	try {
		await writeFile(workbuddyHostHeartbeatPath(), JSON.stringify(document), "utf8");
	} catch {}
}
/** Remove the heartbeat on plugin disposal so a stale file does not linger. */
async function clearHostHeartbeat() {
	try {
		await rm(workbuddyHostHeartbeatPath(), { force: true });
	} catch {}
}
/** Read and validate the heartbeat; returns `undefined` when absent or malformed. */
async function readHostHeartbeat() {
	let raw;
	try {
		raw = await readFile(workbuddyHostHeartbeatPath(), "utf8");
	} catch {
		return;
	}
	try {
		const parsed = JSON.parse(raw);
		if (parsed.version === HEARTBEAT_FORMAT_VERSION && parsed.package === "dsh-workbuddy-connect" && typeof parsed.registeredAt === "number" && typeof parsed.pid === "number") return {
			version: HEARTBEAT_FORMAT_VERSION,
			package: "dsh-workbuddy-connect",
			pluginVersion: typeof parsed.pluginVersion === "string" ? parsed.pluginVersion : "unknown",
			registeredAt: parsed.registeredAt,
			pid: parsed.pid
		};
	} catch {}
}
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
function processStartTimeMs(pid) {
	try {
		if (process.platform === "win32") {
			const m = execFileSync("wmic", [
				"process",
				"where",
				`processid=${pid}`,
				"get",
				"CreationDate"
			], {
				encoding: "utf8",
				windowsHide: true
			}).match(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\.\d+([+-]\d{4})/);
			if (m === null) return void 0;
			const [, y, mo, d, h, mi, s] = m;
			const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
			return Number.isFinite(ms) ? ms : void 0;
		}
		const out = execFileSync("ps", [
			"-o",
			"lstart=",
			"-p",
			String(pid)
		], {
			encoding: "utf8",
			env: {
				...process.env,
				LC_ALL: "C",
				LANG: "C"
			}
		}).trim();
		if (out === "") return void 0;
		const ms = Date.parse(out);
		return Number.isFinite(ms) ? ms : void 0;
	} catch {
		return;
	}
}
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
function isHeartbeatProcessAlive(heartbeat) {
	try {
		process.kill(heartbeat.pid, 0);
	} catch {
		return false;
	}
	const startAtMs = processStartTimeMs(heartbeat.pid);
	if (startAtMs === void 0) return true;
	return startAtMs <= heartbeat.registeredAt;
}
//#endregion
//#region src/variants.ts
/**
* The two WorkBuddy desktop apps this one plugin serves.
*
* Both products are the same client framework in different regions, and both
* write their sign-in into the *same* shared `CodeBuddyExtension` auth
* directory — they differ by file basename, base URL, catalog endpoint, and
* display identity. Everything that varies between them is collected here as
* one descriptor, so no module has to carry its own `if (international)`
* branch and a third variant would be a data change rather than a refactor.
*
* This module is host-side (it names files and env vars). The browser half
* takes the same ids and routes from the Node-free `status-paths.ts`, which
* stays the single source shared by both halves.
*
* @module dsh-workbuddy-connect/variants
*/
/** CN WorkBuddy first: the existing provider keeps its id, paths, and copy. */
const WORKBUDDY_VARIANTS = [{
	id: "workbuddy",
	displayName: "WorkBuddy",
	appName: "WorkBuddy",
	region: "cn",
	env: "WORKBUDDY_AUTH_FILE",
	desktopFilename: "workbuddy-desktop.info",
	ownFilename: ".workbuddy-auth.json",
	accountFilename: ".workbuddy-accounts.json",
	contextFilename: ".workbuddy-context.json",
	probeFilename: ".workbuddy-probe.json",
	catalogFilename: ".workbuddy-catalog.json",
	statusPath: WORKBUDDY_STATUS_PATH,
	accountPath: WORKBUDDY_ACCOUNT_PATH,
	probePath: WORKBUDDY_PROBE_PATH
}, {
	id: "workbuddy-ai",
	displayName: "WorkBuddy AI",
	appName: "WorkBuddy AI",
	region: "global",
	env: "WORKBUDDY_AI_AUTH_FILE",
	desktopFilename: "workbuddy-desktop-ai.info",
	ownFilename: ".workbuddy-ai-auth.json",
	accountFilename: ".workbuddy-ai-accounts.json",
	contextFilename: ".workbuddy-ai-context.json",
	probeFilename: ".workbuddy-ai-probe.json",
	catalogFilename: ".workbuddy-ai-catalog.json",
	statusPath: WORKBUDDY_AI_STATUS_PATH,
	accountPath: WORKBUDDY_AI_ACCOUNT_PATH,
	probePath: WORKBUDDY_AI_PROBE_PATH
}];
/** The CN variant; the plugin's long-standing default and compatibility anchor. */
const CN_VARIANT = WORKBUDDY_VARIANTS[0];
/** The international variant. */
const AI_VARIANT = WORKBUDDY_VARIANTS[1];
/** Look up a variant by provider id. */
function variantFor(id) {
	return WORKBUDDY_VARIANTS.find((variant) => variant.id === id);
}
//#endregion
//#region src/account-cli.ts
/** One row of the human-readable listing. */
function describeCooldown(untilMs, reason, now) {
	const remaining = Math.max(0, untilMs - now);
	const minutes = Math.ceil(remaining / 6e4);
	return `${reason === "credit" ? "额度耗尽" : reason === "session" ? "会话失效" : "限流"}，${minutes} 分钟后重试`;
}
/** Render the pool as one text block per account. */
function formatAccounts(options) {
	const now = options.now ?? Date.now();
	const { snapshot, pool } = options;
	const lines = [];
	const desktop = snapshot.desktop;
	const primary = snapshot.primary;
	lines.push(`${options.variant.displayName}: ${snapshot.accounts.length} account(s) in the pool`);
	if (snapshot.accounts.length === 0) {
		lines.push("  (empty) add one by QR from the plugin card, or sign in to the desktop app");
		return lines.join("\n");
	}
	for (const [index, account] of snapshot.accounts.entries()) {
		const marks = [
			account.id === primary ? "primary" : void 0,
			account.id === desktop ? "desktop" : void 0,
			account.origin === "qr" ? "qr" : void 0,
			account.enabled ? void 0 : "disabled",
			account.sessionDead === true ? "session-dead" : void 0
		].filter((mark) => mark !== void 0);
		const balance = account.credits === void 0 ? account.creditsError === void 0 ? "credit unknown" : `credit unavailable (${account.creditsError})` : `credit ${account.credits}`;
		const expiry = account.expiresAtMs > 0 ? `token expires ${new Date(account.expiresAtMs).toISOString()}` : "token expiry unknown";
		const benched = account.cooldown === void 0 ? void 0 : describeCooldown(account.cooldown.untilMs, account.cooldown.reason, now);
		lines.push([
			`  ${index + 1}. ${account.name}`,
			balance,
			expiry,
			...marks.length === 0 ? [] : [marks.join(", ")],
			...benched === void 0 ? [] : [benched]
		].join(" · "));
	}
	const disabled = pool.list().filter((account) => !account.enabled).length;
	const benched = pool.list().filter((account) => account.cooldown !== void 0 && account.cooldown.untilMs > now).length;
	lines.push(`  ${pool.list().length - disabled - benched} available · ${benched} benched · ${disabled} disabled`);
	return lines.join("\n");
}
/** The machine-readable shape, secret-free by construction. */
function accountsJson(options) {
	return {
		provider: options.variant.id,
		displayName: options.variant.displayName,
		accountsFile: options.pool.filePath(),
		total: options.snapshot.accounts.length,
		primary: options.snapshot.primary,
		desktop: options.snapshot.desktop,
		accounts: options.snapshot.accounts.map((account) => ({
			id: account.id,
			name: account.name,
			origin: account.origin,
			enabled: account.enabled,
			available: account.available,
			...account.credits === void 0 ? {} : { credits: account.credits },
			...account.creditsError === void 0 ? {} : { creditsError: account.creditsError },
			...account.expiresAtMs > 0 ? { accessTokenExpires: new Date(account.expiresAtMs).toISOString() } : {},
			...account.sessionDead === true ? { sessionDead: true } : {},
			...account.cooldown === void 0 ? {} : { cooldown: {
				until: new Date(account.cooldown.untilMs).toISOString(),
				reason: account.cooldown.reason,
				strikes: account.cooldown.strikes
			} }
		}))
	};
}
//#endregion
export { WORKBUDDY_APP_VERSION_FILENAME as $, workbuddyAccountsPath as A, chatBaseForDomain as B, WorkBuddyAccountService as C, cooldownDurationMs as D, accountIdOf as E, defaultDesktopAuthPath as F, originForRegion as G, classifyUpstreamError as H, desktopAuthCandidatesFor as I, prepareInternationalChatBody as J, parseModelCatalog as K, parseWorkBuddyAuth as L, WORKBUDDY_AUTH_FILE_ENV as M, WorkBuddyCredentialStore as N, credentialAccountId as O, defaultDesktopAuthCandidates as P, randomSentinel as Q, workbuddyOwnAuthPath as R, WORKBUDDY_STATUS_PATH as S, WorkBuddyAccountPool as T, modelWithCurrentPromotion as U, chatBaseForRegion as V, normalizeCredits as W, PROBE_EFFORT_CANDIDATES as X, regionOf as Y, probeModel as Z, WorkBuddyCatalog as _, WORKBUDDY_VARIANTS as a, WORKBUDDY_ACCOUNT_PATH as b, clearHostHeartbeat as c, readHostHeartbeat as d, appUserAgent as et, workbuddyHostHeartbeatPath as f, FALLBACK_WORKBUDDY_MODELS as g, FALLBACK_WORKBUDDY_AI_MODELS as h, CN_VARIANT as i, validAppVersion as it, WORKBUDDY_AUTH_FILENAME as j, credentialOf as k, isHeartbeatProcessAlive as l, WORKBUDDY_CONNECT_VERSION as m, formatAccounts as n, readBundleVersion as nt, variantFor as o, writeHostHeartbeat as p, prepareChatBody as q, AI_VARIANT as r, resolveAppVersion as rt, WORKBUDDY_HOST_HEARTBEAT_FILENAME as s, accountsJson as t, installedAppVersion as tt, processStartTimeMs as u, WorkBuddyQrLogin as v, WORKBUDDY_ACCOUNTS_FILENAME as w, WORKBUDDY_PROBE_PATH as x, challengeTag as y, WorkBuddyUpstreamClient as z };
