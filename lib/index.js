import { $ as prepareChatBody, A as credentialAccountId, B as desktopAuthCandidatesFor, D as WorkBuddyAccountPool, E as WORKBUDDY_ACCOUNTS_FILENAME, F as WORKBUDDY_AUTH_FILENAME, G as chatBaseForDomain, H as workbuddyOwnAuthPath, I as WORKBUDDY_AUTH_FILE_ENV, J as isDefinitiveRefreshFailure, K as chatBaseForRegion, L as WorkBuddyCredentialStore, M as workbuddyAccountsPath, N as readStoreDocument, O as accountIdOf, P as writeStoreDocument, Q as parseModelCatalog, R as defaultDesktopAuthCandidates, S as WORKBUDDY_PROFILE_ENTRY_ID, T as WorkBuddyAccountService, U as WorkBuddyAtRestKeyProvider, V as parseWorkBuddyAuth, W as WorkBuddyUpstreamClient, X as normalizeCredits, Y as modelWithCurrentPromotion, Z as originForRegion, _ as WorkBuddyCatalog, _t as validAppVersion, a as WORKBUDDY_VARIANTS, at as CN_APP_VERSION_FILENAME, c as clearHostHeartbeat, ct as fallbackChatIdentity, d as readHostHeartbeat, dt as validCliVersion, et as prepareInternationalChatBody, f as workbuddyHostHeartbeatPath, ft as WORKBUDDY_APP_VERSION_FILENAME, g as FALLBACK_WORKBUDDY_MODELS, gt as resolveAppVersion, h as FALLBACK_WORKBUDDY_AI_MODELS, ht as readBundleVersion, i as CN_VARIANT, it as randomSentinel, j as credentialOf, k as cooldownDurationMs, l as isHeartbeatProcessAlive, lt as readCliVersion, m as WORKBUDDY_CONNECT_VERSION, mt as installedAppVersion, n as formatAccounts, nt as PROBE_EFFORT_CANDIDATES, o as variantFor, ot as FALLBACK_CN_APP_VERSION, p as writeHostHeartbeat, pt as appUserAgent, q as classifyUpstreamError, r as AI_VARIANT, rt as probeModel, s as WORKBUDDY_HOST_HEARTBEAT_FILENAME, st as chatUserAgent, t as accountsJson, tt as regionOf, u as processStartTimeMs, ut as resolveChatIdentity, v as WorkBuddyQrLogin, vt as isJsonObject, w as isWorkBuddySidebarCreditStyle, y as challengeTag, yt as parseJsonObject, z as defaultDesktopAuthPath } from "./account-cli-B-DsjNoF.js";
import z from "@deepseek-ai/schemastery";
import { join, resolve } from "node:path";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { createProvider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { resolveRetryPolicy } from "@deepseek-ai/dsh-llm";
import { PiAiAdapter } from "@deepseek-ai/dsh-llm-pi-ai";
import { createServer } from "node:http";
import { Readable } from "node:stream";
//#region src/config-volatile.ts
/**
* Mark one schema field volatile when the installed schemastery supports it.
*
* @param schema - The field schema (any generation).
* @returns The schema carrying `meta.volatile`, or the schema itself on an
* engine whose schemastery predates `.volatile()`.
*/
function markVolatile(schema) {
	const candidate = schema;
	if (typeof candidate.volatile !== "function") return schema;
	return candidate.volatile();
}
/**
* Mark every field of a Config field dict volatile.
*
* The result is a NEW dict of schema instances: callers that also need an
* UNMARKED schema for the legacy settings generation must build the fields
* twice rather than mutating one dict (see `src/index.ts`).
*
* @param fields - The unmarked field dict.
* @returns A dict whose entries are the marked schemas.
*/
function markVolatileFields(fields) {
	const marked = {};
	for (const [key, field] of Object.entries(fields)) marked[key] = markVolatile(field);
	return marked;
}
/** Whether a value is one of the loader's frozen `{ get() }` references. */
function isVolatileReference(value) {
	return typeof value === "object" && value !== null && typeof value.get === "function" && Object.isFrozen(value);
}
/**
* Read every top-level field through its reference when one is present.
*
* A FRESH object is returned whenever any field was a reference, because a
* reference's identity never changes while its value does — memoising on the
* config object itself would freeze the first read. A plain config is returned
* untouched, which preserves object identity for callers that memo on it.
*
* @param config - The applied config.
* @returns A plain config snapshot, valid until the next volatile update.
*/
function unwrapVolatileConfig(config) {
	let sawReference = false;
	const plain = {};
	for (const [key, value] of Object.entries(config)) if (isVolatileReference(value)) {
		sawReference = true;
		plain[key] = value.get();
	} else plain[key] = value;
	return sawReference ? plain : config;
}
//#endregion
//#region src/loopback.ts
/**
* Shared loopback gates for the plugin's local HTTP surfaces: the loopback
* shim and the same-origin web-status route. Both are only ever meant to be
* addressed through the machine's loopback interface.
*
* @module dsh-workbuddy-connect/loopback
*/
/** Loopback hostnames a local plugin surface may be addressed by. */
const LOOPBACK_HOSTS = /* @__PURE__ */ new Set([
	"127.0.0.1",
	"localhost",
	"[::1]"
]);
/** Strip the optional :port from a Host header value, IPv6-bracket aware. */
function hostnameOfHost(host) {
	let hostname = host.trim().toLowerCase();
	if (hostname.startsWith("[")) {
		const end = hostname.indexOf("]");
		return end === -1 ? hostname : hostname.slice(0, end + 1);
	}
	const colon = hostname.lastIndexOf(":");
	if (colon !== -1 && !hostname.slice(0, colon).includes(":") && /^\d+$/.test(hostname.slice(colon + 1))) hostname = hostname.slice(0, colon);
	return hostname;
}
/**
* The request's Host header must name the loopback interface. A DNS-rebinding
* page (attacker domain re-resolved to 127.0.0.1) sends its own domain in
* Host, so this check drops those before any routing happens.
*/
function hostIsLoopback(host) {
	if (host === void 0 || host.trim() === "") return false;
	return LOOPBACK_HOSTS.has(hostnameOfHost(host));
}
/**
* A browser-sent Origin (present header) must be loopback. Non-browser
* clients (the plugin's own fetch calls) send no Origin at all and pass.
*/
function originIsLoopback(origin) {
	if (origin === void 0 || origin.trim() === "") return true;
	try {
		const { hostname } = new URL(origin);
		return LOOPBACK_HOSTS.has(hostname) || hostname === "::1";
	} catch {
		return false;
	}
}
//#endregion
//#region src/probe-route.ts
/**
* Probe control route: the only state-changing endpoint the plugin exposes.
*
* Two guards, because they stop different things and neither substitutes for
* the other:
*
* 1. **Loopback Host + Origin**, shared with the status route. This drops
*    DNS-rebinding pages, whose requests arrive addressed to the attacker's
*    domain.
* 2. **An in-process random key**, minted per process and handed only to the
*    same-origin card. Loopback alone is *not* authentication — any local
*    process can write `Host: 127.0.0.1` — so a route that spends the user's
*    credit must prove the caller was told the key.
*
* A probe request is never accepted with a prompt, a model id outside the
* live catalog, or a sentinel from the browser: it is assembled entirely
* host-side. (Scope: the `probe` action only — `set-model-visibility`
* deliberately accepts a model id the current catalog no longer lists, since
* a hidden id is kept for when the model returns.)
*
* @module dsh-workbuddy-connect/probe-route
*/
/** Largest control body accepted; these payloads are a few dozen bytes. */
const MAX_BODY_BYTES$1 = 4096;
/** Mint the per-process control key. */
function createProbeKey() {
	return randomBytes(24).toString("hex");
}
/**
* Constant-time key comparison; a length mismatch is a failure, not a crash.
*
* Exported because the caller that registers this route also builds the
* key-accepting predicate for it: a handler that compares keys one way while
* its registration compares them another is exactly the kind of drift that ends
* with a timing side channel in the copy nobody re-read.
*/
function keyMatches$1(expected, presented) {
	if (presented === void 0 || presented.length !== expected.length) return false;
	const a = Buffer.from(expected);
	const b = Buffer.from(presented);
	return a.length === b.length && timingSafeEqual(a, b);
}
function json$2(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Content-Length": Buffer.byteLength(payload)
	});
	res.end(payload);
}
/** Read the request body with a hard ceiling. */
async function readBody$2(req) {
	const chunks = [];
	let total = 0;
	for await (const chunk of req) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		total += buffer.length;
		if (total > MAX_BODY_BYTES$1) return void 0;
		chunks.push(buffer);
	}
	return Buffer.concat(chunks).toString("utf8");
}
/** Parse and shape-check an action; unknown fields are ignored, not trusted. */
function parseAction(text) {
	const wrapped = parseJsonObject(text);
	if (wrapped === void 0) return void 0;
	const action = wrapped["action"];
	if (action === "clear") return { action: "clear" };
	if (action === "refresh") return { action: "refresh" };
	if (action === "set-maximum-context-window") return typeof wrapped["enabled"] === "boolean" ? {
		action: "set-maximum-context-window",
		enabled: wrapped["enabled"]
	} : void 0;
	if (action === "set-model-visibility") {
		const model = wrapped["model"];
		const account = wrapped["account"];
		if (typeof model !== "string" || model.trim() === "") return void 0;
		if (typeof wrapped["visible"] !== "boolean") return void 0;
		if (typeof account !== "string" || account === "") return void 0;
		return {
			action: "set-model-visibility",
			model: model.trim(),
			visible: wrapped["visible"],
			account
		};
	}
	if (action === "set-sidebar-credit-style") {
		const style = wrapped["creditStyle"];
		if (!isWorkBuddySidebarCreditStyle(style)) return void 0;
		return {
			action: "set-sidebar-credit-style",
			creditStyle: style
		};
	}
	if (action === "set-sidebar-credit-visible") {
		const enabled = wrapped["enabled"];
		if (typeof enabled !== "boolean") return void 0;
		return {
			action: "set-sidebar-credit-visible",
			enabled
		};
	}
	if (action === "set-model-allowlist") {
		const account = wrapped["account"];
		const allowlist = wrapped["allowlist"];
		if (typeof account !== "string" || account === "") return void 0;
		if (!Array.isArray(allowlist)) return void 0;
		if (!allowlist.every((id) => typeof id === "string" && id !== "")) return void 0;
		return {
			action: "set-model-allowlist",
			account,
			allowlist: [...new Set(allowlist)]
		};
	}
	if (action === "open-link") {
		const url = wrapped["url"];
		if (typeof url !== "string" || url.trim() === "") return void 0;
		return {
			action: "open-link",
			url: url.trim()
		};
	}
	if (action === "probe") {
		const model = wrapped["model"];
		if (typeof model !== "string" || model.trim() === "") return void 0;
		return {
			action: "probe",
			model: model.trim()
		};
	}
}
/**
* The control route's handler, extracted so tests can mount it on a bare
* server with a known key.
*/
function workBuddyProbeHandler(deps, key) {
	const accepts = typeof key === "string" ? (presented) => keyMatches$1(key, presented) : key;
	return async (req, res) => {
		if (req.method !== "POST") {
			json$2(res, 405, { error: "method not allowed" });
			return;
		}
		if (!hostIsLoopback(req.headers.host) || !originIsLoopback(req.headers.origin)) {
			json$2(res, 403, { error: "request-not-trusted" });
			return;
		}
		if (!accepts(req.headers["x-workbuddy-probe-key"])) {
			json$2(res, 403, { error: "invalid-probe-key" });
			return;
		}
		const body = await readBody$2(req);
		if (body === void 0) {
			json$2(res, 413, { error: "body too large" });
			return;
		}
		const action = parseAction(body);
		if (action === void 0) {
			json$2(res, 400, { error: "invalid action" });
			return;
		}
		try {
			if (action.action === "clear") {
				deps.clear();
				json$2(res, 200, { state: "cleared" });
				return;
			}
			if (action.action === "refresh") {
				if (deps.refresh === void 0) {
					json$2(res, 404, { error: "refresh-not-supported" });
					return;
				}
				json$2(res, 200, await deps.refresh());
				return;
			}
			if (action.action === "set-maximum-context-window") {
				if (deps.setMaximumContextWindow === void 0) {
					json$2(res, 404, { error: "context-window-setting-not-supported" });
					return;
				}
				json$2(res, 200, await deps.setMaximumContextWindow(action.enabled === true));
				return;
			}
			if (action.action === "set-sidebar-credit-style") {
				if (deps.setSidebarCreditStyle === void 0) {
					json$2(res, 404, { error: "sidebar-style-setting-not-supported" });
					return;
				}
				json$2(res, 200, await deps.setSidebarCreditStyle(action.creditStyle));
				return;
			}
			if (action.action === "set-sidebar-credit-visible") {
				if (deps.setSidebarCreditVisible === void 0) {
					json$2(res, 404, { error: "sidebar-visible-setting-not-supported" });
					return;
				}
				json$2(res, 200, await deps.setSidebarCreditVisible(action.enabled === true));
				return;
			}
			if (action.action === "set-model-visibility") {
				if (deps.setModelVisibility === void 0) {
					json$2(res, 404, { error: "visibility-setting-not-supported" });
					return;
				}
				json$2(res, 200, await deps.setModelVisibility(action.model, action.visible === true, action.account));
				return;
			}
			if (action.action === "open-link") {
				if (deps.openExternal === void 0) {
					json$2(res, 404, { error: "open-link-not-supported" });
					return;
				}
				json$2(res, 200, await deps.openExternal(action.url));
				return;
			}
			if (action.action === "set-model-allowlist") {
				if (deps.setModelAllowlist === void 0) {
					json$2(res, 404, { error: "visibility-setting-not-supported" });
					return;
				}
				json$2(res, 200, await deps.setModelAllowlist(action.allowlist, action.account));
				return;
			}
			json$2(res, 200, await deps.probe(action.model));
		} catch (error) {
			json$2(res, 500, { error: error instanceof Error ? error.message : String(error) });
		}
	};
}
/** Mount the POST probe-control route on an optional webServer context. */
function registerWorkBuddyProbeRoute(ctx, deps, key) {
	const path = deps.path ?? "/plugins/dsh-workbuddy-connect/probe";
	ctx.effect(() => {
		const dispose = ctx.webServer.register({
			kind: "exact",
			path,
			handler: workBuddyProbeHandler(deps, key)
		});
		return () => {
			dispose();
		};
	}, "dsh-workbuddy-connect: probe control route");
}
//#endregion
//#region src/account-route.ts
/** Largest control body accepted; these payloads are small. */
const MAX_BODY_BYTES = 16384;
function json$1(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Content-Length": Buffer.byteLength(payload)
	});
	res.end(payload);
}
/** Constant-time key comparison; a length mismatch is a failure, not a crash. */
function keyMatches(expected, presented) {
	if (presented === void 0 || presented.length !== expected.length) return false;
	let mismatch = 0;
	for (let index = 0; index < expected.length; index += 1) mismatch |= expected.charCodeAt(index) ^ (presented.charCodeAt(index) || 0);
	return mismatch === 0;
}
/** Read the request body with a hard ceiling. */
async function readBody$1(req) {
	const chunks = [];
	let total = 0;
	for await (const chunk of req) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		total += buffer.length;
		if (total > MAX_BODY_BYTES) return void 0;
		chunks.push(buffer);
	}
	return Buffer.concat(chunks).toString("utf8");
}
function stringField(value) {
	return typeof value === "string" && value !== "" ? value : void 0;
}
/** Parse and shape-check an action; unknown fields are ignored, not trusted. */
function parseAccountAction(text) {
	const wrapped = parseJsonObject(text);
	if (wrapped === void 0) return void 0;
	switch (wrapped["action"]) {
		case "add": return { action: "add" };
		case "refresh-credits": return { action: "refresh-credits" };
		case "context": {
			const model = stringField(wrapped["model"]);
			const length = wrapped["length"];
			if (model === void 0 || typeof length !== "number" || !Number.isFinite(length) || length <= 0) return void 0;
			return {
				action: "context",
				model,
				length
			};
		}
		case "add-cookie": {
			const token = stringField(wrapped["token"]);
			return token === void 0 ? void 0 : {
				action: "add-cookie",
				token
			};
		}
		case "poll": {
			const state = stringField(wrapped["state"]);
			return state === void 0 ? void 0 : {
				action: "poll",
				state
			};
		}
		case "cancel": {
			const state = stringField(wrapped["state"]);
			return state === void 0 ? void 0 : {
				action: "cancel",
				state
			};
		}
		case "remove": {
			const id = stringField(wrapped["id"]);
			return id === void 0 ? void 0 : {
				action: "remove",
				id
			};
		}
		case "test": {
			const id = stringField(wrapped["id"]);
			return id === void 0 ? void 0 : {
				action: "test",
				id
			};
		}
		case "enable": {
			const id = stringField(wrapped["id"]);
			if (id === void 0 || typeof wrapped["enabled"] !== "boolean") return void 0;
			return {
				action: "enable",
				id,
				enabled: wrapped["enabled"]
			};
		}
		case "label": {
			const id = stringField(wrapped["id"]);
			if (id === void 0) return void 0;
			const label = typeof wrapped["label"] === "string" ? wrapped["label"] : void 0;
			return {
				action: "label",
				id,
				...label === void 0 ? {} : { label }
			};
		}
		case "reorder": {
			const ids = wrapped["ids"];
			if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) return void 0;
			return {
				action: "reorder",
				ids
			};
		}
		default: return;
	}
}
/**
* The control route's handler, extracted so tests can mount it on a bare
* server with a known key.
*/
function workBuddyAccountHandler(deps, key) {
	return async (req, res) => {
		if (req.method !== "POST") {
			json$1(res, 405, { error: "method not allowed" });
			return;
		}
		if (!hostIsLoopback(req.headers.host) || !originIsLoopback(req.headers.origin)) {
			json$1(res, 403, { error: "request-not-trusted" });
			return;
		}
		if (!keyMatches(key, req.headers["x-workbuddy-probe-key"])) {
			json$1(res, 403, { error: "invalid-probe-key" });
			return;
		}
		const body = await readBody$1(req);
		if (body === void 0) {
			json$1(res, 413, { error: "body too large" });
			return;
		}
		const action = parseAccountAction(body);
		if (action === void 0) {
			json$1(res, 400, { error: "invalid action" });
			return;
		}
		try {
			json$1(res, 200, await deps.handle(action));
		} catch (error) {
			json$1(res, 200, {
				state: "failed",
				reason: (error instanceof Error ? error.message : String(error)).slice(0, 300)
			});
		}
	};
}
/** Mount the POST account-control route on an optional webServer context. */
function registerWorkBuddyAccountRoute(ctx, deps, key) {
	const path = deps.path ?? "/plugins/dsh-workbuddy-connect/accounts";
	ctx.effect(() => {
		const dispose = ctx.webServer.register({
			kind: "exact",
			path,
			handler: workBuddyAccountHandler(deps, key)
		});
		return () => {
			dispose();
		};
	}, "dsh-workbuddy-connect: account control route");
}
//#endregion
//#region src/usage-store.ts
/**
* Per-account request accounting: how much this plugin has sent through each
* account, and how much of the prompt the upstream served from its cache.
*
* Why the plugin counts at all: WorkBuddy's billing endpoint answers "how much
* quota is left" but publishes nothing about requests or tokens — the numbers a
* reader wants when asking "what is this account actually costing me". They only
* exist in the chat stream, which this plugin is the path for, so it counts what
* it relays.
*
* What is measured, and what is NOT claimed:
*
* - requests / prompt tokens / completion tokens / cache-read tokens are read
*   from the upstream's own usage block when it sends one, per request;
* - the cache-hit rate is `cacheRead / (cacheRead + uncached prompt)`, which is
*   the definition the upstream's numbers support. It is reported as ABSENT —
*   never as zero — while no response has carried a cache field, because "we do
*   not know" and "nothing was cached" are different answers and a zero would
*   read as the second;
* - the counters are a plain tally since {@link WorkBuddyUsageCounters.sinceMs},
*   not a billing-cycle figure: the cycle's reset instant is a string the
*   billing endpoint words for a human, and inventing a parse for it would put a
*   wrong window behind a right-looking number.
*
* Cost of the accounting: one JSON file per variant, written at most once every
* {@link WorkBuddyUsageStore.flushIntervalMs} (default 5s) — a per-request write
* would turn a chat turn into disk I/O. A failed write is logged, never thrown:
* the counters are a report about the user's traffic, not traffic itself.
*
* @module dsh-workbuddy-connect/usage-store
*/
/** On-disk format this reader accepts; other versions are discarded. */
const USAGE_FORMAT_VERSION = 1;
/** Basename of the CN variant's usage file inside the Harness home. */
const WORKBUDDY_USAGE_FILENAME = ".workbuddy-usage.json";
/** Plugin-owned usage-file path inside the Harness home. */
function workbuddyUsagePath(filename = WORKBUDDY_USAGE_FILENAME) {
	return join(resolveDshHome(), filename);
}
/** Whether a parsed value is a counter record this reader can trust. */
function isCounters(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const entry = value;
	return [
		"requests",
		"reported",
		"promptTokens",
		"completionTokens",
		"cacheReadTokens",
		"cacheWriteTokens",
		"sinceMs",
		"lastAtMs"
	].every((key) => typeof entry[key] === "number" && Number.isFinite(entry[key]));
}
/** One number from a raw usage block, if it is a usable non-negative number. */
function countAt(source, key) {
	const value = source[key];
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return void 0;
	return value;
}
/**
* Read one upstream usage block into {@link WorkBuddyRequestUsage}.
*
* The spellings below are the ones OpenAI-compatible services use in the wild,
* including the nested `prompt_tokens_details.cached_tokens` and the
* Anthropic-style `cache_read_input_tokens` / `cache_creation_input_tokens`
* pair that some gateways pass through. Unknown fields are simply not read:
* {@link WorkBuddyUsageStore.record} has no way to invent a number, and the
* caller reports the keys it actually saw once, so a future shape is discovered
* from a log rather than by guessing here.
*/
function readUsageBlock(block) {
	if (typeof block !== "object" || block === null || Array.isArray(block)) return {};
	const usage = block;
	const details = typeof usage["prompt_tokens_details"] === "object" && usage["prompt_tokens_details"] !== null ? usage["prompt_tokens_details"] : {};
	const cacheRead = countAt(usage, "prompt_cache_hit_tokens") ?? countAt(details, "cached_tokens") ?? countAt(usage, "cache_read_input_tokens") ?? countAt(usage, "cached_tokens");
	const cacheWrite = countAt(usage, "prompt_cache_miss_tokens") === void 0 ? countAt(usage, "cache_creation_input_tokens") : void 0;
	const prompt = countAt(usage, "prompt_tokens") ?? countAt(usage, "input_tokens");
	const completion = countAt(usage, "completion_tokens") ?? countAt(usage, "output_tokens");
	const model = typeof usage["model"] === "string" && usage["model"] !== "" ? usage["model"] : void 0;
	return {
		...prompt === void 0 ? {} : { promptTokens: prompt },
		...completion === void 0 ? {} : { completionTokens: completion },
		...cacheRead === void 0 ? {} : { cacheReadTokens: cacheRead },
		...cacheWrite === void 0 ? {} : { cacheWriteTokens: cacheWrite },
		...model === void 0 ? {} : { model }
	};
}
/**
* Read one SSE body for the usage block it carries, without disturbing it.
*
* Called with one BRANCH of a tee'd body: the other branch is what the user's
* answer streams through, so this reader may take as long as it likes and can
* never stall the reply.
*
* Two tolerances are deliberate. Frames are split on a blank line but a
* truncated tail is still parsed, because the LAST frame before `[DONE]` is
* where OpenAI-compatible services put usage and a stream can be cut short. And
* every `data:` frame is inspected rather than only the last: some gateways
* report usage on each chunk, and taking the final one that parses is the same
* answer with fewer assumptions about which chunk it was.
*
* @param stream - the tee'd body to drain.
* @param onUsage - called once with the last usage block seen; not called at all
*   when the answer carried none.
* @param onFirstBlock - called once with the numeric field names of the first
*   block seen, so an unknown upstream shape is discovered from a log line
*   rather than by guessing at the parser.
*/
async function consumeStreamUsage(stream, onUsage, onFirstBlock) {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let last;
	let announced = false;
	const inspect = (frame) => {
		const line = frame.trim();
		if (!line.startsWith("data:")) return;
		const payload = line.slice(5).trim();
		if (payload === "" || payload === "[DONE]") return;
		const parsed = parseJsonObject(payload);
		if (parsed === void 0) return;
		const block = parsed["usage"];
		if (!isJsonObject(block)) return;
		last = block;
		if (!announced) {
			announced = true;
			onFirstBlock?.(usageFieldNames(block));
		}
	};
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			let boundary = buffer.indexOf("\n\n");
			while (boundary >= 0) {
				inspect(buffer.slice(0, boundary));
				buffer = buffer.slice(boundary + 2);
				boundary = buffer.indexOf("\n\n");
			}
		}
		buffer += decoder.decode();
		if (buffer.trim() !== "") inspect(buffer);
	} finally {
		reader.releaseLock();
	}
	if (last !== void 0) onUsage(readUsageBlock(last));
}
/** The token/usage keys a raw block carried, for a one-time diagnostic log. */
function usageFieldNames(block) {
	if (typeof block !== "object" || block === null || Array.isArray(block)) return [];
	const names = [];
	for (const [key, value] of Object.entries(block)) if (typeof value === "number") names.push(key);
	else if (value !== null && typeof value === "object") {
		for (const [inner, innerValue] of Object.entries(value)) if (typeof innerValue === "number") names.push(`${key}.${inner}`);
	}
	return names.sort();
}
/**
* The per-account request tallies, read once and written atomically.
*
* A failed WRITE degrades to a log rather than a throw: the counters describe
* traffic that already happened, and failing the user's chat turn because a
* report could not be written would put the accounting in front of the work.
*/
var WorkBuddyUsageStore = class {
	path;
	now;
	flushIntervalMs;
	onWriteError;
	accounts;
	dirty = false;
	timer;
	constructor(options = {}) {
		const resolved = typeof options === "string" ? { path: options } : options;
		this.path = resolved.path ?? workbuddyUsagePath();
		this.now = resolved.now ?? (() => Date.now());
		this.flushIntervalMs = resolved.flushIntervalMs ?? 5e3;
		this.onWriteError = resolved.onWriteError;
	}
	/** Resolved state-file path, for tests and diagnostics. */
	filePath() {
		return this.path;
	}
	load() {
		if (this.accounts !== void 0) return this.accounts;
		const accounts = {};
		const counted = readStoreDocument(this.path, USAGE_FORMAT_VERSION, (document) => {
			const raw = document["accounts"];
			return isJsonObject(raw) ? raw : void 0;
		});
		for (const [key, value] of Object.entries(counted ?? {})) if (isCounters(value)) accounts[key] = value;
		this.accounts = accounts;
		return accounts;
	}
	/**
	* Count one request against one account.
	*
	* `reported` is incremented only when the answer carried a usage block, which
	* is what lets the card say "N of M requests reported tokens" instead of
	* presenting a partial tally as complete.
	*/
	record(account, usage) {
		const accounts = { ...this.load() };
		const now = this.now();
		const current = accounts[account] ?? {
			requests: 0,
			reported: 0,
			promptTokens: 0,
			completionTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			sinceMs: now,
			lastAtMs: now
		};
		const hasNumbers = usage !== void 0 && (usage.promptTokens !== void 0 || usage.completionTokens !== void 0 || usage.cacheReadTokens !== void 0);
		accounts[account] = {
			...current,
			requests: current.requests + 1,
			reported: current.reported + (hasNumbers ? 1 : 0),
			promptTokens: current.promptTokens + (usage?.promptTokens ?? 0),
			completionTokens: current.completionTokens + (usage?.completionTokens ?? 0),
			cacheReadTokens: current.cacheReadTokens + (usage?.cacheReadTokens ?? 0),
			cacheWriteTokens: current.cacheWriteTokens + (usage?.cacheWriteTokens ?? 0),
			lastAtMs: now
		};
		this.accounts = accounts;
		this.dirty = true;
		this.schedule();
	}
	/** One account's tally, with the derived rate when it can be stated. */
	summary(account) {
		const counters = this.load()[account];
		if (counters === void 0 || counters.requests === 0) return void 0;
		const rate = counters.cacheReadTokens > 0 && counters.promptTokens > 0 ? counters.cacheReadTokens / counters.promptTokens : void 0;
		return {
			...counters,
			...rate === void 0 ? {} : { cacheHitRate: rate }
		};
	}
	schedule() {
		if (this.flushIntervalMs <= 0) {
			this.flush();
			return;
		}
		this.timer ??= setTimeout(() => {
			this.timer = void 0;
			this.flush();
		}, this.flushIntervalMs);
		this.timer.unref?.();
	}
	/** Write the pending counters now; safe to call repeatedly. */
	flush() {
		if (!this.dirty) return;
		try {
			const document = {
				version: USAGE_FORMAT_VERSION,
				accounts: this.load()
			};
			writeStoreDocument(this.path, document);
			this.dirty = false;
		} catch (error) {
			this.onWriteError?.(error);
		}
	}
	/** Stop the coalescing timer, flushing whatever is pending. */
	close() {
		if (this.timer !== void 0) {
			clearTimeout(this.timer);
			this.timer = void 0;
		}
		this.flush();
	}
};
//#endregion
//#region src/rotation.ts
/**
* Parse an upstream `Retry-After`, which may be seconds or an HTTP date.
* Returns undefined when absent or unparsable.
*/
function parseRetryAfter(value, now = Date.now()) {
	if (value === null || value === void 0) return void 0;
	const trimmed = value.trim();
	if (trimmed === "") return void 0;
	if (/^\d+$/u.test(trimmed)) {
		const seconds = Number(trimmed);
		return Number.isFinite(seconds) && seconds > 0 ? seconds * 1e3 : void 0;
	}
	const at = Date.parse(trimmed);
	if (!Number.isFinite(at)) return void 0;
	const delta = at - now;
	return delta > 0 ? delta : void 0;
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
const RESET_TIME_HINT = /(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})\s*(?:UTC|GMT)(?:\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?)?/u;
/**
* Longest a stated reset is trusted for.
*
* A safeguard, not a policy: the value comes from a server and is far more
* authoritative than any backoff this plugin could invent, so it is used as
* given. This ceiling only bounds what a mistyped or misparsed date could do —
* a week is already past every allowance window either product runs, so a real
* reset can never be cut short by it.
*/
const RESET_HINT_CEILING_MS = 6048e5;
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
function parseResetTimeHint(message, now = Date.now()) {
	const match = RESET_TIME_HINT.exec(message);
	if (match === null) return void 0;
	const [, year, month, day, hour, minute, second, sign, offsetHours, offsetMinutes] = match;
	if (Number(month) < 1 || Number(month) > 12) return void 0;
	if (Number(day) < 1 || Number(day) > 31) return void 0;
	if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return void 0;
	const wallClock = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
	if (!Number.isFinite(wallClock)) return void 0;
	const wait = wallClock - (sign === void 0 ? 0 : (sign === "-" ? -1 : 1) * (Number(offsetHours) * 60 + Number(offsetMinutes ?? 0))) * 6e4 - now;
	if (wait <= 0) return void 0;
	return Math.min(wait, RESET_HINT_CEILING_MS);
}
/** Which cooldown class an upstream failure earns. */
function cooldownReasonFor(kind) {
	if (kind === "soft_rate") return "rate";
	if (kind === "hard_credit") return "credit";
	if (kind === "session_dead") return "session";
}
/** Whether another account could plausibly answer differently. */
function isAccountScoped(kind) {
	return kind === "soft_rate" || kind === "hard_credit" || kind === "session_dead";
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
function aborted(signal) {
	return signal !== void 0 && signal.aborted;
}
/** How the shim should answer when no account could be tried. */
function noAccountResult() {
	return {
		ok: false,
		status: 0,
		kind: "session_dead",
		message: "no WorkBuddy account is currently usable (the pool is empty, or every account is disabled, benched, or signed out)"
	};
}
/**
* Send one chat body, rotating accounts on account-scoped failures.
*
* The body is already prepared for the wire by the caller: this layer chooses
* *who* sends it, never *what* is sent, so a retry is byte-identical to the
* attempt before it.
*/
var WorkBuddyRotation = class {
	pool;
	client;
	onRefreshed;
	onUsage;
	onUsageShape;
	logger;
	constructor(options) {
		this.pool = options.pool;
		this.client = options.client;
		this.onRefreshed = options.onRefreshed;
		this.onUsage = options.onUsage;
		this.onUsageShape = options.onUsageShape;
		this.logger = options.logger;
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
	tapUsage(result, accountId) {
		const onUsage = this.onUsage;
		if (onUsage === void 0) return result;
		const body = result.response.body;
		if (body === null || typeof body.tee !== "function") return result;
		const [relayed, observed] = body.tee();
		consumeStreamUsage(observed, (usage) => {
			onUsage(accountId, usage);
		}, this.onUsageShape).catch((error) => {
			this.logger?.warn("dsh-workbuddy-connect: request usage could not be read", error);
		});
		return {
			ok: true,
			response: new Response(relayed, {
				status: result.response.status,
				statusText: result.response.statusText,
				headers: result.response.headers
			})
		};
	}
	/**
	* Attempt the request until an account answers, or the pool runs out.
	*
	* @param body - the prepared JSON body.
	* @param signal - the caller's abort signal; an aborted request stops the
	*   whole rotation rather than moving on to another account.
	*/
	async send(body, signal) {
		const tried = /* @__PURE__ */ new Set();
		const attempts = [];
		let lastResult;
		let lastAccount;
		for (;;) {
			if (aborted(signal)) return {
				result: lastResult ?? noAccountResult(),
				attempts,
				...lastAccount === void 0 ? {} : { account: lastAccount }
			};
			const account = this.pool.next(tried);
			if (account === void 0) break;
			tried.add(account.id);
			attempts.push(account.id);
			lastAccount = account;
			const result = await this.client.chatStream(credentialOf(account), body, signal);
			if (result.ok) {
				this.pool.clearCooldown(account.id);
				return {
					result: this.tapUsage(result, account.id),
					attempts,
					account
				};
			}
			lastResult = result;
			if (aborted(signal)) return {
				result,
				attempts,
				account
			};
			if (result.kind === "session_dead") {
				const refreshed = await this.tryRefresh(account);
				if (refreshed.outcome === "refreshed") {
					const retry = await this.client.chatStream(credentialOf(refreshed.account), body, signal);
					if (retry.ok) {
						this.pool.clearCooldown(account.id);
						return {
							result: this.tapUsage(retry, refreshed.account.id),
							attempts,
							account: refreshed.account
						};
					}
					lastResult = retry;
					if (retry.kind !== "session_dead") {
						this.bench(refreshed.account, retry);
						continue;
					}
				} else if (refreshed.outcome === "unreachable") {
					this.pool.cooldown(account.id, "rate");
					this.logger?.warn(`dsh-workbuddy-connect: account ${account.id} could not be refreshed (${refreshed.reason}); benched instead of signed out`);
					continue;
				} else if (refreshed.outcome === "sign-in-needed") {}
				this.pool.markSessionDead(account.id);
				this.pool.cooldown(account.id, "session");
				this.logger?.warn(`dsh-workbuddy-connect: account ${account.id} session is dead; sign in again, or re-enable it, to restore it`);
				continue;
			}
			if (isAccountScoped(result.kind)) {
				this.bench(account, result);
				continue;
			}
			return {
				result,
				attempts,
				account
			};
		}
		if (lastResult === void 0) return {
			result: noAccountResult(),
			attempts,
			exhausted: true
		};
		return {
			result: lastResult,
			attempts,
			...lastAccount === void 0 ? {} : { account: lastAccount },
			exhausted: true
		};
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
	bench(account, result) {
		const reason = cooldownReasonFor(result.kind);
		if (reason === void 0) return;
		const hint = parseResetTimeHint(result.message) ?? parseRetryAfter(result.retryAfter);
		this.pool.cooldown(account.id, reason, hint);
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
	async tryRefresh(account) {
		if (account.refreshToken === "") return { outcome: "sign-in-needed" };
		let outcome;
		try {
			outcome = await this.client.refreshToken(credentialOf(account));
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			if (!isDefinitiveRefreshFailure(error)) {
				this.logger?.warn(`dsh-workbuddy-connect: account ${account.id} token refresh could not be completed`, error);
				return {
					outcome: "unreachable",
					reason
				};
			}
			this.logger?.warn(`dsh-workbuddy-connect: account ${account.id} token refresh was refused`, error);
			return {
				outcome: "refused",
				reason
			};
		}
		const updated = this.pool.updateTokens(account.id, {
			accessToken: outcome.accessToken,
			...outcome.refreshToken === void 0 ? {} : { refreshToken: outcome.refreshToken },
			...outcome.expiresInSec === void 0 ? {} : { expiresAtMs: Date.now() + outcome.expiresInSec * 1e3 },
			...outcome.domain === void 0 ? {} : { domain: outcome.domain }
		});
		if (updated === void 0) return {
			outcome: "unreachable",
			reason: "the account was removed while refreshing"
		};
		this.onRefreshed?.(updated, credentialOf(updated));
		return {
			outcome: "refreshed",
			account: updated
		};
	}
};
//#endregion
//#region src/catalog-store.ts
/**
* The last catalog that actually loaded, kept per variant and per account.
*
* Both the plan (§4 "降级顺序为同版同来源的最近成功目录 → 本版内置保守目录")
* and the README promise this fallback, and without it a restart always drops
* the user to the built-in roster even when a good catalog was fetched minutes
* earlier. The built-in roster is a snapshot taken once; a fetched catalog is
* what the upstream actually serves to this account.
*
* What it deliberately is *not*:
*
* - not a cache with a freshness policy — it never prevents a fetch, it only
*   answers when a fetch cannot;
* - not shared across accounts (a different account can see a different roster
*   and different promotions), nor across variants (the CN and international
*   endpoints disagree about rates and windows for the same model id);
* - not a place for secrets: model metadata only, never a token. The account
*   key is a `uid:enterpriseId` identity already visible in the status document.
*
* @module dsh-workbuddy-connect/catalog-store
*/
/** On-disk format this reader accepts; other versions are discarded. */
const CATALOG_FORMAT_VERSION = 1;
/** Basename of the CN variant's saved catalog inside the Harness home. */
const WORKBUDDY_CATALOG_FILENAME = ".workbuddy-catalog.json";
/** Plugin-owned saved-catalog path inside the Harness home. */
function workbuddyCatalogPath(filename = WORKBUDDY_CATALOG_FILENAME) {
	return join(resolveDshHome(), filename);
}
/** Whether a parsed value is a model row worth keeping. */
function isModel(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const row = value;
	return typeof row["id"] === "string" && row["id"] !== "" && typeof row["name"] === "string" && typeof row["contextWindow"] === "number" && Number.isFinite(row["contextWindow"]) && typeof row["maxTokens"] === "number" && Number.isFinite(row["maxTokens"]) && typeof row["supportsImages"] === "boolean";
}
/** Whether a parsed value is a saved catalog this reader can trust. */
function isSaved$1(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const entry = value;
	if (typeof entry["account"] !== "string" || entry["account"] === "") return false;
	if (typeof entry["source"] !== "string" || entry["source"] === "") return false;
	if (typeof entry["fetchedAtMs"] !== "number" || !Number.isFinite(entry["fetchedAtMs"])) return false;
	const models = entry["models"];
	if (!Array.isArray(models) || models.length === 0) return false;
	return models.every(isModel);
}
/**
* The last successful catalog per account, read once and written atomically.
*
* Malformed content reads as "nothing saved" rather than throwing: this file
* is an optimization for the offline and first-seconds cases, and a corrupt one
* must never be able to stop the plugin from serving models.
*/
var WorkBuddyCatalogStore = class {
	path;
	entries;
	constructor(options = {}) {
		this.path = typeof options === "string" ? options : options.path ?? workbuddyCatalogPath();
	}
	/** Resolved state-file path, for the CLI and tests. */
	filePath() {
		return this.path;
	}
	load() {
		if (this.entries !== void 0) return this.entries;
		const entries = {};
		const saved = readStoreDocument(this.path, CATALOG_FORMAT_VERSION, (document) => {
			const raw = document["entries"];
			return isJsonObject(raw) ? raw : void 0;
		});
		for (const [key, value] of Object.entries(saved ?? {})) if (isSaved$1(value)) entries[key] = value;
		this.entries = entries;
		return entries;
	}
	/** The saved catalog for one account, or `undefined` when there is none. */
	get(account) {
		const entry = this.load()[account];
		return entry === void 0 ? void 0 : entry;
	}
	/**
	* Remember a catalog for an account, replacing whatever was saved before.
	*
	* A failed write is swallowed: the plugin has already served these models,
	* and losing the *memory* of them is not worth surfacing.
	*/
	set(account, catalog) {
		const entries = this.load();
		entries[account] = {
			account,
			...catalog
		};
		this.persist();
	}
	/** Forget one account's catalog — used when that account signs out. */
	delete(account) {
		const entries = this.load();
		if (!(account in entries)) return;
		delete entries[account];
		this.persist();
	}
	persist() {
		try {
			const document = {
				version: CATALOG_FORMAT_VERSION,
				entries: this.load()
			};
			writeStoreDocument(this.path, document);
		} catch {}
	}
};
//#endregion
//#region src/visibility-store.ts
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
/** On-disk format this reader accepts; other versions are discarded. */
const VISIBILITY_FORMAT_VERSION = 1;
/** Basename of the CN variant's visibility file inside the Harness home. */
const WORKBUDDY_VISIBILITY_FILENAME = ".workbuddy-model-visibility.json";
/** Plugin-owned visibility-file path inside the Harness home. */
function workbuddyVisibilityPath(filename = WORKBUDDY_VISIBILITY_FILENAME) {
	return join(resolveDshHome(), filename);
}
/** Whether a parsed value is a saved preference entry this reader can trust. */
function isSaved(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const entry = value;
	if (typeof entry["account"] !== "string" || entry["account"] === "") return false;
	if (typeof entry["updatedAtMs"] !== "number" || !Number.isFinite(entry["updatedAtMs"])) return false;
	const disabled = entry["disabled"];
	if (!Array.isArray(disabled)) return false;
	if (!disabled.every((id) => typeof id === "string" && id !== "")) return false;
	const allowlist = entry["allowlist"];
	if (allowlist === void 0) return true;
	return Array.isArray(allowlist) && allowlist.every((id) => typeof id === "string" && id !== "");
}
/**
* The per-account hidden-model lists, read once and written atomically.
*
* Unlike the saved-catalog store, a failed *write* propagates: the caller
* reports it to the user rather than answering "hidden" for a preference that
* did not persist. Reads stay forgiving — a corrupt or unreadable file is
* "nothing hidden", which only ever shows models the account can still pick.
*/
var WorkBuddyVisibilityStore = class {
	path;
	accounts;
	constructor(options = {}) {
		this.path = typeof options === "string" ? options : options.path ?? workbuddyVisibilityPath();
	}
	/** Resolved state-file path, for the CLI and tests. */
	filePath() {
		return this.path;
	}
	load() {
		if (this.accounts !== void 0) return this.accounts;
		const accounts = {};
		const saved = readStoreDocument(this.path, VISIBILITY_FORMAT_VERSION, (document) => {
			const raw = document["accounts"];
			return isJsonObject(raw) ? raw : void 0;
		});
		for (const [key, value] of Object.entries(saved ?? {})) if (isSaved(value)) accounts[key] = value;
		this.accounts = accounts;
		return accounts;
	}
	/** The model ids one account has hidden; empty when it never hid any. */
	disabled(account) {
		return this.load()[account]?.disabled ?? [];
	}
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
	allowlist(account) {
		const saved = this.load()[account]?.allowlist;
		return saved === void 0 || saved.length === 0 ? void 0 : saved;
	}
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
	setAllowlist(account, ids) {
		const current = this.load()[account];
		const next = ids === void 0 || ids.length === 0 ? void 0 : [...new Set(ids)];
		const accounts = { ...this.load() };
		if (next === void 0 && (current === void 0 || current.disabled.length === 0)) {
			delete accounts[account];
			this.persist(accounts);
			this.accounts = accounts;
			return;
		}
		accounts[account] = {
			account,
			disabled: current?.disabled ?? [],
			...next === void 0 ? {} : { allowlist: next },
			updatedAtMs: Date.now()
		};
		this.persist(accounts);
		this.accounts = accounts;
	}
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
	effectiveHidden(account, catalogIds) {
		const saved = this.load()[account];
		if (saved === void 0) return [];
		const allowlist = saved.allowlist;
		const hidden = new Set(saved.disabled);
		if (allowlist !== void 0 && allowlist.length > 0) {
			const allowed = new Set(allowlist);
			for (const id of catalogIds) if (!allowed.has(id)) hidden.add(id);
		}
		return [...hidden];
	}
	/**
	* Show or hide one model for one account, persisting before committing.
	*
	* Re-enabling (showing) the last hidden model removes the account's entry
	* entirely — an absent entry and an empty list mean the same thing
	* (everything visible), and the file should not accumulate empty buckets.
	* Throws when the write fails, leaving the in-memory state untouched so a
	* re-read cannot lie about what was persisted.
	*/
	setVisible(account, model, visible) {
		const current = this.load()[account]?.disabled ?? [];
		const next = visible ? current.filter((id) => id !== model) : [.../* @__PURE__ */ new Set([...current, model])];
		const accounts = { ...this.load() };
		if (next.length === 0) delete accounts[account];
		else accounts[account] = {
			account,
			disabled: next,
			updatedAtMs: Date.now()
		};
		this.persist(accounts);
		this.accounts = accounts;
	}
	persist(accounts) {
		const document = {
			version: VISIBILITY_FORMAT_VERSION,
			accounts
		};
		writeStoreDocument(this.path, document);
	}
};
//#endregion
//#region src/adapter.ts
/**
* The `workbuddy` pi-ai provider: one loopback-backed adapter registered
* into the Harness LLM seam, assembled from public `dsh-llm-pi-ai`
* extension points the way `dsh-codex-connect` assembles its Codex route.
*
* @module dsh-workbuddy-connect/adapter
*/
/** Provider route this bundle owns. */
const WORKBUDDY_PROVIDER = "workbuddy";
/** Provider idle ceiling while one stream read is outstanding. */
const WORKBUDDY_STREAM_IDLE_TIMEOUT_MS = 3e5;
/**
* Image-request budgets at the dsh-llm-pi-ai defaults; the profile type made
* them required in 0.1.1-rc.2. They bound requests to models whose catalog
* entry declares `supportsImages`; text-only models never receive images.
*/
const REQUEST_IMAGE_BUDGETS = {
	maxRequestImageBytes: 20971520,
	requestImagePixelBudget: 4194304,
	requestImageMaxBytes: 1048576
};
/**
* Inert pi-ai auth plane. The workbuddy route authenticates only through the
* shim shared secret resolved per request by `resolveApiKey`, so pi-ai's own
* credential lifecycle and ambient discovery must never manufacture a
* credential for it. `PiAiAdapterOptions.auth` is required since 0.1.1-rc.2;
* every ambient question here answers "nothing stored, nothing set".
*/
const INERT_AUTH = {
	credentials: {
		async read() {},
		async list() {
			return [];
		},
		async modify() {
			throw new Error("dsh-workbuddy-connect: the workbuddy route has no pi-ai credential lifecycle");
		},
		async delete() {}
	},
	authContext: {
		async env() {},
		async fileExists() {
			return false;
		}
	}
};
/** No per-token pricing is knowable for a subscription quota; report zero. */
const NO_COST = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0
};
/**
* Translate the request-image contract across the two attachment-service
* generations a link-installed plugin can straddle.
*
* A `link:` install resolves its platform imports from the *repository's*
* node_modules (Node follows the symlink's real path), so this adapter always
* runs against the pi-ai it was built with — while the attachment service
* comes from the host. Those two generations disagree on what
* `readImageRequest(ref, policyOrTarget)` receives:
*
* - dsh-attachment-local ≤0.1.5: a route policy `{ maxPixels, maxBytes }`,
*   and `validatePolicy` throws `Image request maxPixels must be a positive
*   integer.` when `maxPixels` is missing.
* - 0.1.6+: a per-image target `{ width, height, maxBytes }` with no
*   `maxPixels` at all, validated by `validateTarget`.
*
* A 0.1.6-built pi-ai on a 0.1.5 host therefore hands the old store a target
* the old store rejects, and every image-bearing request fails before it is
* sent. The wrapper below fills the route's own pixel budget into a target
* that lacks it: the 0.1.5 store then computes the same dimensions pi-ai's
* budget already chose, and a 0.1.6 store ignores the extra key.
*/
function withLegacyImageBudget(store) {
	return new Proxy(store, { get(target, property, receiver) {
		if (property !== "readImageRequest") return Reflect.get(target, property, receiver);
		return (...args) => {
			const [ref, policy, signal] = args;
			const present = policy?.maxPixels;
			const withPixels = Number.isSafeInteger(present) && present > 0 ? policy : {
				...policy,
				maxPixels: REQUEST_IMAGE_BUDGETS.requestImagePixelBudget
			};
			return target.readImageRequest(ref, withPixels, signal);
		};
	} });
}
/**
* The suffix appended to a model's display name so its billing rate is visible
* wherever the name is shown.
*
* The separator is a middle dot rather than a hyphen or colon: model names
* already contain hyphens (`GLM-5.3-Flash`, `Deepseek-V4-Flash`), so a hyphen
* separator would be ambiguous about where the name ends and the rate begins.
*/
const RATE_SEPARATOR = " · ";
/**
* Append the billing rate to one model's display name.
*
* The rate AND the declared promo badges ride the *name* alone: since DSH
* 0.1.2 the composer's model seat (`ModelSelect`) renders `model.name` only —
* `description` is no longer read there at all (the 0.1.1-era client rendered
* it, which is why the badges used to be visible in the seat). The `/model`
* popup renders the name too, so a separate `description` copy would either
* duplicate (rate) or vanish (badges) depending on client generation.
*
* This is display-only and cannot affect routing: the wire request is built
* from `model.id` (pi-ai's completions API sets `model: model.id`), the
* selection a picker submits is `{provider, model: id, reasoningEffort}`, and
* `dsh-llm` validates `name` as a non-empty string without comparing its
* contents. Nothing in the host resolves a model *by* name.
*/
/**
* The catalog display suffix: the billing rate followed by the declared promo
* badges (`限时免费`, `夜间折扣`), or undefined when the row carries neither.
* The badge labels are the upstream's own spellings and the host seam has no
* locale service, so non-Chinese UIs see them verbatim — accepted until the
* picker grows a localized badge slot.
*/
function displaySuffix(info) {
	const parts = [normalizeCredits(info.billing?.credits), ...info.billing?.badges ?? []].filter((part) => part !== void 0 && part !== "");
	return parts.length === 0 ? void 0 : parts.join(" · ");
}
/** Append the catalog display suffix to one model's display name. */
function withCatalogDisplay(name, info) {
	const suffix = displaySuffix(info);
	return suffix === void 0 ? name : `${name}${RATE_SEPARATOR}${suffix}`;
}
/**
* Resolve a WorkBuddy model's reasoning capability into pi-ai's
* `thinkingLevelMap` (every level pinned to its wire spelling or `null` for
* unsupported), mirroring `dsh-llm-pi-ai`'s own `resolveModelReasoning`.
*
* Two sources, strictly ordered:
*
* 1. **The declared set.** When the upstream declares a non-empty
*    `supportedEfforts`, exactly those values are offered and nothing else.
*    This always wins: an observation never widens or narrows a declared set.
* 2. **A local observation.** Rows without a declared set (the older
*    `{effort, summary}` shape) normally get no control at all — their
*    selectable set is client-side knowledge the catalog does not carry, and
*    the desktop app differs per model there. If the user authorized a probe
*    and it established that the upstream *validates* the parameter, the
*    verified spellings are offered.
*
* A `non-validating` observation deliberately yields no control: the upstream
* accepts values that cannot exist (measured on `glm-5.2`), so every per-level
* acceptance it produced would be a false positive.
*
* `off` is offered only when the upstream declares `canDisableThinking: true`.
* It is never probed — disabling thinking is a separate capability, and the
* per-model acceptance of `off` cannot be inferred from the row's shape.
*
* The offered set is described internally as "verified accepted", never as
* "verified effective": acceptance proves the upstream did not reject the
* spelling, not that it changes what the model does.
*/
function reasoningFields(info, observed) {
	const reasoning = info.reasoning;
	if (reasoning === void 0 || reasoning.supports !== true) return { reasoning: false };
	const declared = reasoning.supportedEfforts;
	const efforts = declared !== void 0 && declared.length > 0 ? declared : observed?.validation === "validating" && observed.efforts.length > 0 ? observed.efforts : void 0;
	if (efforts === void 0) return { reasoning: false };
	return {
		reasoning: true,
		thinkingLevelMap: {
			off: reasoning.canDisableThinking === true && declared !== void 0 && declared.length > 0 ? "off" : null,
			minimal: null,
			low: efforts.includes("low") ? "low" : null,
			medium: efforts.includes("medium") ? "medium" : null,
			high: efforts.includes("high") ? "high" : null,
			xhigh: efforts.includes("xhigh") ? "xhigh" : null,
			max: efforts.includes("max") ? "max" : null
		}
	};
}
/** Build one pi-ai model descriptor pointing at the loopback shim. */
function toPiModel(info, baseUrl, observed, providerId = WORKBUDDY_PROVIDER) {
	return {
		id: info.id,
		name: info.name,
		api: "openai-completions",
		provider: providerId,
		baseUrl,
		input: info.supportsImages === true ? ["text", "image"] : ["text"],
		...reasoningFields(info, observed),
		cost: NO_COST,
		contextWindow: info.contextWindow,
		maxTokens: info.maxTokens,
		compat: { maxTokensField: "max_tokens" }
	};
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
function createWorkBuddyAdapter(options) {
	const { shim, store, catalog, resolveAttachments, observe, hidden } = options;
	const providerId = options.providerId ?? "workbuddy";
	const displayName = options.displayName ?? "WorkBuddy";
	const buildModels = () => {
		const baseUrl = `${shim.baseUrl()}/v1`;
		return catalog.current().map((info) => {
			const chosen = options.resolveContextWindow?.(info.id, info.supportedContextWindows ?? []);
			return toPiModel(chosen === void 0 ? info : {
				...info,
				contextWindow: chosen
			}, baseUrl, observe?.(info.id), providerId);
		});
	};
	const provider = {
		...createProvider({
			id: providerId,
			name: displayName,
			auth: { apiKey: {
				name: "WorkBuddy OAuth bearer token",
				async resolve({ credential }) {
					const apiKey = credential?.key;
					return apiKey === void 0 || apiKey.length === 0 ? void 0 : {
						auth: { apiKey },
						source: "WorkBuddy"
					};
				}
			} },
			models: buildModels(),
			api: openAICompletionsApi()
		}),
		getModels: () => buildModels()
	};
	const profile = {
		provider: providerId,
		displayName,
		streamIdleTimeoutMs: WORKBUDDY_STREAM_IDLE_TIMEOUT_MS,
		retryPolicy: resolveRetryPolicy(void 0, "dsh-workbuddy-connect retryPolicy"),
		configuredMaxTokens: /* @__PURE__ */ new Map(),
		modelErrors: /* @__PURE__ */ new Map(),
		...REQUEST_IMAGE_BUDGETS,
		piProvider: provider
	};
	let profiles = /* @__PURE__ */ new Map([[providerId, profile]]);
	return {
		adapter: new WorkBuddyPiAiAdapter(catalog, hidden ?? (() => []), {
			profiles: () => profiles,
			auth: INERT_AUTH,
			resolveApiKey: async () => shim.token(),
			...resolveAttachments === void 0 ? {} : { resolveAttachments: () => {
				const store = resolveAttachments();
				return store === void 0 ? void 0 : withLegacyImageBudget(store);
			} }
		}),
		invalidate: () => {
			profiles = /* @__PURE__ */ new Map([[providerId, profile]]);
		}
	};
}
/**
* The WorkBuddy route's adapter: `PiAiAdapter` with the billing rate folded
* into the catalog answers it returns to the DSH model pickers.
*
* `PiAiAdapter.listModels()` and `.resolveModel()` build their answers straight
* from the pi-ai descriptors, which carry no billing fact, so the rate is
* layered on here by looking the model up in the live catalog. Both overrides
* delegate to `super` and then rewrite only the display fields, so streaming,
* capability resolution, and effort mapping stay exactly as `dsh-llm-pi-ai`
* implements them.
*
* A model missing from the catalog (an id the shim would serve but the last
* upstream refresh did not list) falls through with its name untouched rather
* than being dropped: catalog membership is advisory, and the seam tolerates
* serving an unlisted id.
*/
var WorkBuddyPiAiAdapter = class extends PiAiAdapter {
	catalog;
	hidden;
	constructor(catalog, hidden, options) {
		super(options);
		this.catalog = catalog;
		this.hidden = hidden;
	}
	/** Catalog entry for one model id, or undefined when the catalog omits it. */
	infoFor(model) {
		return this.catalog.current().find((entry) => entry.id === model);
	}
	async listModels(provider) {
		const models = await super.listModels(provider);
		const hidden = new Set(this.hidden());
		return models.flatMap((model) => {
			if (hidden.has(model.id)) return [];
			const info = this.infoFor(model.id);
			if (info === void 0) return [model];
			return [{
				...model,
				name: withCatalogDisplay(model.name, info)
			}];
		});
	}
	async resolveModel(provider, model, signal) {
		const resolved = await super.resolveModel(provider, model, signal);
		const info = this.infoFor(model);
		if (info === void 0) return resolved;
		return {
			...resolved,
			name: withCatalogDisplay(resolved.name, info)
		};
	}
};
//#endregion
//#region src/context-preference.ts
/**
* Per-model context-window preference: which of the upstream-declared lengths
* the user wants this model to run at.
*
* Why this is a real setting and not a display toggle: the window is what pi-ai
* uses to clamp a request's output budget
* (`available = contextWindow - promptTokens - safety`), so the chosen value
* changes what actually gets sent. Choosing 1M instead of 200K is the difference
* between a long transcript continuing and being cut off.
*
* Storage is one small JSON document per variant, keyed by model id. A model the
* upstream stops declaring a length for keeps its entry — the preference is the
* user's, and a catalog that comes back with the length again should find the
* choice still made. The value is only *applied* when the upstream still offers
* it, so a stale entry can never widen a window the model does not have.
*
* @module dsh-workbuddy-connect/context-preference
*/
/** On-disk format this reader accepts; other versions are discarded. */
const FORMAT_VERSION = 1;
/** Where one variant's preferences live. */
function workbuddyContextPath(filename) {
	return resolve(resolveDshHome(), filename);
}
/**
* The chosen context lengths for one variant.
*
* Reads are synchronous and cached in memory: the adapter asks for every model
* on every `getModels()`, so a file read per model per call would be absurd for
* a document that changes only when the user clicks.
*/
var WorkBuddyContextPreference = class {
	path;
	models;
	constructor(options) {
		this.path = options.path ?? workbuddyContextPath(options.variant.contextFilename);
		this.models = this.load();
	}
	/** Read the document, treating any problem as "no preferences yet". */
	load() {
		const models = /* @__PURE__ */ new Map();
		const saved = readStoreDocument(this.path, FORMAT_VERSION, (document) => {
			const entries = document["models"];
			return isJsonObject(entries) ? entries : void 0;
		});
		for (const [id, value] of Object.entries(saved ?? {})) if (typeof value === "number" && Number.isFinite(value) && value > 0) models.set(id, value);
		return models;
	}
	/** Persist atomically, so a crash mid-write cannot truncate the document. */
	save() {
		const document = {
			version: FORMAT_VERSION,
			models: Object.fromEntries(this.models)
		};
		try {
			writeStoreDocument(this.path, document);
		} catch {}
	}
	/**
	* The length to use for a model.
	*
	* @param declared - every length the upstream offers for this model.
	* @returns the user's choice when it is still on offer, otherwise the model's
	*   default (the first entry, which is what the catalog reports).
	*/
	resolve(modelId, declared) {
		const chosen = this.models.get(modelId);
		if (chosen !== void 0 && declared.includes(chosen)) return chosen;
	}
	/** Record a choice. Passing a length the model declares is the caller's job. */
	set(modelId, length) {
		this.models.set(modelId, length);
		this.save();
	}
	/** Forget a model's choice, so it runs at the upstream default again. */
	clear(modelId) {
		if (this.models.delete(modelId)) this.save();
	}
	/** Every stored choice, for tests and diagnostics. */
	entries() {
		return this.models;
	}
};
//#endregion
//#region src/shim.ts
/**
* Loopback OpenAI-compatible endpoint. The pi-ai provider points here; the
* shim applies the WorkBuddy wire quirks (forced streaming, string
* `tool_choice`, CLI-shaped headers) and forwards to the real upstream.
* It binds 127.0.0.1 only and never serves another interface.
*
* Inbound hardening: the loopback bind alone is not a trust boundary (any
* local process or a DNS-rebinding page can reach 127.0.0.1), so every
* request must carry a loopback Host header, browser-sent Origins must be
* loopback, chat POSTs must be application/json, and the Authorization
* header must carry the shim's per-process shared secret. The plugin's
* own client satisfies all four by construction; local attackers cannot
* read the secret out of the plugin process's memory.
*
* @module dsh-workbuddy-connect/shim
*/
/**
* A sender backed by one credential store, for tests and for any caller that
* wants the pre-pool behaviour: resolve the single stored credential, send
* once, report the classified failure unchanged.
*/
function createStoreSender(options) {
	return { async send(body, signal) {
		let credential;
		try {
			credential = await options.store.resolve();
		} catch (error) {
			return {
				ok: false,
				status: 0,
				kind: "session_dead",
				message: String(error)
			};
		}
		return options.client.chatStream(credential, body, signal);
	} };
}
const REQUEST_BODY_LIMIT = 67108864;
/** Chat-completion POSTs must carry a JSON body type (simple-request CSRF drops here). */
function isJsonContentType(req) {
	const type = req.headers["content-type"];
	return typeof type === "string" && type.trim().toLowerCase().startsWith("application/json");
}
/** HTTP status each upstream failure class surfaces as. */
const KIND_STATUS = {
	hard_credit: 402,
	soft_rate: 429,
	session_dead: 401,
	not_found: 502,
	server: 502,
	client: 400
};
function writeJson(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Content-Length": Buffer.byteLength(payload)
	});
	res.end(payload);
}
function writeOpenAIError(res, status, kind, message) {
	writeJson(res, status, { error: {
		message,
		type: kind,
		code: kind
	} });
}
/** Read a request body with a size cap; over-limit bodies fail the request. */
function readBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > REQUEST_BODY_LIMIT) {
				reject(/* @__PURE__ */ new Error("request body too large"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks)));
		req.on("error", reject);
	});
}
/**
* Start the loopback endpoint. Requests carry any bearer; the loopback bind
* is the boundary, and the upstream credential is chosen by the sender alone.
*/
function createWorkBuddyShim(options) {
	const { sender, catalog } = options;
	const logger = options.logger;
	const SHARED_SECRET = randomBytes(32).toString("base64url");
	/** Constant-time bearer check; absent or mismatched bearers are rejected. */
	function bearerOk(req) {
		const header = req.headers.authorization;
		if (typeof header !== "string") return false;
		const match = /^Bearer\s+(.+)$/i.exec(header.trim());
		if (match === null) return false;
		const presented = match[1];
		const expected = SHARED_SECRET;
		const a = Buffer.from(presented);
		const b = Buffer.from(expected);
		if (a.length !== b.length) return false;
		return timingSafeEqual(a, b);
	}
	const server = createServer((req, res) => {
		handle(req, res);
	});
	const ready = new Promise((resolve, reject) => {
		server.once("listening", () => resolve());
		server.once("error", reject);
	});
	server.listen(0, "127.0.0.1");
	const baseUrl = () => {
		const address = server.address();
		if (address === null || typeof address === "string") throw new Error("workbuddy shim has no listening address");
		return `http://127.0.0.1:${address.port}`;
	};
	async function handle(req, res) {
		try {
			if (!hostIsLoopback(req.headers.host)) {
				writeOpenAIError(res, 403, "host_not_allowed", "Host header must name the loopback interface");
				return;
			}
			if (!originIsLoopback(req.headers.origin)) {
				writeOpenAIError(res, 403, "origin_not_allowed", "Origin must be a loopback origin");
				return;
			}
			if (!bearerOk(req)) {
				writeOpenAIError(res, 401, "unauthorized", "missing or invalid Authorization bearer");
				return;
			}
			const url = req.url ?? "/";
			if (req.method === "GET" && (url === "/healthz" || url === "/healthz/")) {
				writeJson(res, 200, { ok: true });
				return;
			}
			if (req.method === "GET" && (url === "/v1/models" || url === "/v1/models/")) {
				writeJson(res, 200, {
					object: "list",
					data: catalog.current().map((model) => ({
						id: model.id,
						object: "model",
						created: 0,
						owned_by: "workbuddy"
					}))
				});
				return;
			}
			if (req.method === "POST" && (url === "/v1/chat/completions" || url === "/v1/chat/completions/")) {
				await chatCompletions(req, res);
				return;
			}
			writeOpenAIError(res, 404, "not_found", `no such route: ${req.method} ${url}`);
		} catch (error) {
			if (!res.headersSent) writeOpenAIError(res, 500, "internal", String(error));
			else res.end();
		}
	}
	async function chatCompletions(req, res) {
		if (!isJsonContentType(req)) {
			writeOpenAIError(res, 415, "unsupported_media_type", "Content-Type must be application/json");
			return;
		}
		const raw = (await readBody(req)).toString("utf8");
		const prepared = prepareChatBody(raw);
		const controller = new AbortController();
		req.on("close", () => controller.abort());
		const result = await sender.send(prepared, controller.signal);
		if (!result.ok) {
			const status = KIND_STATUS[result.kind];
			if (result.retryAfter !== void 0) res.setHeader("Retry-After", result.retryAfter);
			writeOpenAIError(res, status, status === 401 ? "not_signed_in" : result.kind, `workbuddy upstream ${result.kind} (http ${result.status}): ${result.message.slice(0, 400)}`);
			return;
		}
		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			"Connection": "keep-alive",
			"X-Accel-Buffering": "no"
		});
		let sawDone = false;
		const body = Readable.fromWeb(result.response.body);
		body.on("data", (chunk) => {
			if (chunk.includes("[DONE]")) sawDone = true;
		});
		body.on("error", (error) => {
			logger?.warn("dsh-workbuddy-connect: upstream stream failed mid-flight", error);
			if (!sawDone && res.writable) res.end("data: [DONE]\n\n");
		});
		body.pipe(res);
	}
	return {
		ready,
		baseUrl,
		token: () => SHARED_SECRET,
		close: () => new Promise((resolve, reject) => {
			server.close(() => resolve());
			server.closeAllConnections();
			server.once("error", reject);
		})
	};
}
//#endregion
//#region src/probe-store.ts
/**
* Local record of reasoning-effort probes.
*
* What this stores is an *observation*, never a claim about the upstream: a
* model's row is only consulted when the catalog carries no explicit
* `supportedEfforts` set, and it always loses to a declared set. A result is
* invalidated whenever the model's catalog row changes — a spelling accepted by
* one build of a model says nothing about the next — so every record carries a
* fingerprint of the fields the probe depended on.
*
* The file lives beside the plugin's own credential copy under `$DSH_HOME`,
* never in the desktop app's files, and carries no token, prompt, or response
* body — only model ids, effort spellings, and timestamps.
*
* @module dsh-workbuddy-connect/probe-store
*/
/** Basename of the probe record inside the Harness home. */
const WORKBUDDY_PROBE_FILENAME = ".workbuddy-probe.json";
/**
* On-disk format this reader accepts; other versions are discarded.
*
* Version 2 nested the records under the account that produced them
* (`records[account][modelId]`), so two accounts no longer overwrite each
* other's observations for the same model. Version 1 files (flat, one record
* per model) are deliberately not migrated: they read as empty and the
* affected models are re-probed on demand, which keeps the reader free of
* half-understood compatibility paths.
*/
const PROBE_FORMAT_VERSION = 2;
/**
* How long an observation stays usable. Conservative on purpose: the plan's
* whole argument is that upstream metadata moves fast, so a result that has
* outlived its fingerprint's usefulness should not quietly keep granting a
* picker entry.
*/
const DEFAULT_TTL_MS = 12096e5;
/**
* Plugin-owned probe record path inside the Harness home.
*
* One file per variant. Same-named models exist on both endpoints (the
* international catalog repeats `glm-5.3`, `glm-5.2`, `hy3`, `kimi-k2.6`), and
* {@link fingerprintModel} covers only `id`/`reasoning`/`supportsImages` —
* never the provider — so a single shared file would let one variant's
* observation answer for the other. The paths differ; the format does not.
*/
function workbuddyProbePath(filename = WORKBUDDY_PROBE_FILENAME) {
	return join(resolveDshHome(), filename);
}
/**
* Fingerprint the catalog fields a probe depends on.
*
* Deliberately excludes display-only fields (`name`, `billing`, `contextWindow`)
* so a rename or a promo badge does not throw away a valid observation, and
* deliberately includes the whole reasoning object so any change to the
* declared shape re-probes.
*/
function fingerprintModel(info) {
	const basis = JSON.stringify({
		id: info.id,
		reasoning: info.reasoning ?? null,
		supportsImages: info.supportsImages ?? null
	});
	return createHash("sha256").update(basis).digest("hex").slice(0, 16);
}
/** Read-and-validate the document on disk; anything malformed reads as empty. */
function readDocument(path) {
	return readStoreDocument(path, PROBE_FORMAT_VERSION, (document) => {
		const stored = document["records"];
		if (!isJsonObject(stored)) return void 0;
		const records = {};
		for (const [account, bucket] of Object.entries(stored)) {
			if (!isJsonObject(bucket)) continue;
			const kept = {};
			for (const [modelId, record] of Object.entries(bucket)) if (isRecord(record)) kept[modelId] = record;
			records[account] = kept;
		}
		return {
			version: PROBE_FORMAT_VERSION,
			records
		};
	});
}
/** One record's shape check; a bad row is dropped rather than trusted. */
function isRecord(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const wrapped = value;
	const validation = wrapped["validation"];
	if (validation !== "validating" && validation !== "non-validating" && validation !== "unknown") return false;
	if (typeof wrapped["fingerprint"] !== "string") return false;
	if (typeof wrapped["probedAtMs"] !== "number" || !Number.isFinite(wrapped["probedAtMs"])) return false;
	if (typeof wrapped["pluginVersion"] !== "string") return false;
	if (typeof wrapped["account"] !== "string" || wrapped["account"] === "") return false;
	const efforts = wrapped["efforts"];
	if (!Array.isArray(efforts) || efforts.some((effort) => typeof effort !== "string")) return false;
	return true;
}
/**
* The plugin's probe records: read once, written atomically, keyed by the
* account that produced each observation, and never trusted across a
* fingerprint change or past the TTL.
*/
var WorkBuddyProbeStore = class {
	path;
	ttlMs;
	pluginVersion;
	now;
	records;
	constructor(options) {
		const opts = typeof options === "string" ? {
			path: options,
			pluginVersion: "0.0.0"
		} : options;
		this.path = opts.path ?? workbuddyProbePath();
		this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
		this.pluginVersion = opts.pluginVersion;
		this.now = opts.now ?? (() => Date.now());
	}
	/** Resolved state-file path, for the CLI and tests. */
	filePath() {
		return this.path;
	}
	load() {
		this.records ??= readDocument(this.path)?.records ?? {};
		return this.records;
	}
	/**
	* The usable record for one account and model, or `undefined` when there is
	* none, it is expired, it was taken against a different catalog row, or it
	* belongs to a different account.
	*
	* @param account - the account in effect, as `uid:enterpriseId`. Records are
	*   only returned for the account that produced them.
	*/
	get(modelId, fingerprint, account) {
		const record = this.load()[account]?.[modelId];
		if (record === void 0) return void 0;
		if (record.fingerprint !== fingerprint) return void 0;
		if (record.account !== account) return void 0;
		if (this.now() - record.probedAtMs > this.ttlMs) return void 0;
		return record;
	}
	/**
	* Store one observation under the account stamped on it. Only a decisive
	* answer (`validating` / `non-validating`) replaces an existing decisive
	* record *of the same account*: a transient `unknown` must not erase
	* knowledge the user already paid for.
	*/
	set(modelId, record) {
		const records = this.load();
		const bucket = records[record.account] ?? (records[record.account] = {});
		const existing = bucket[modelId];
		if (record.validation === "unknown" && existing !== void 0 && existing.fingerprint === record.fingerprint && existing.validation !== "unknown") return;
		bucket[modelId] = record;
		this.persist();
	}
	/** Drop every record of every account; used by the card's explicit "clear" action. */
	clear() {
		this.records = {};
		this.persist();
	}
	/** Every record currently held, grouped by account, for status display. */
	all() {
		const records = this.load();
		return Object.fromEntries(Object.entries(records).map(([account, bucket]) => [account, { ...bucket }]));
	}
	/** Build a record stamped with this store's clock, version, and account. */
	record(fingerprint, validation, efforts, account) {
		return {
			fingerprint,
			validation,
			efforts: validation === "validating" ? [...efforts] : [],
			probedAtMs: this.now(),
			pluginVersion: this.pluginVersion,
			account
		};
	}
	/**
	* Write through a temporary file and rename, so a crash mid-write cannot
	* leave a half-parsed document that reads as "no records" and silently drops
	* every observation.
	*/
	persist() {
		try {
			const document = {
				version: PROBE_FORMAT_VERSION,
				records: this.load()
			};
			writeStoreDocument(this.path, document);
		} catch {}
	}
};
/**
* Order observations newest-first for display.
*
* The store keeps insertion order so the file reads chronologically, but the
* card wants the most recent detection at the top: a sweep the user just ran
* should not appear below every earlier one, which is what appending to an
* insertion-ordered list does.
*/
function newestFirst(records) {
	return [...records].sort((a, b) => b.probedAt - a.probedAt);
}
//#endregion
//#region src/probe-service.ts
/**
* Serial probe runner. One instance is shared by the manual API and any
* future automatic trigger, so the two can never overlap.
*/
var WorkBuddyProbeService = class {
	options;
	queue = Promise.resolve();
	pending = /* @__PURE__ */ new Map();
	running = false;
	constructor(options) {
		this.options = options;
	}
	/** Whether a sweep is in flight right now. */
	isRunning() {
		return this.running;
	}
	/**
	* The record the adapter may use for this model, or `undefined`.
	*
	* Applies the plan's precedence (§5): a declared set always wins, so a model
	* that declares `supportedEfforts` is never answered from an observation.
	*/
	recordFor(modelId) {
		const info = this.options.catalog.current().find((model) => model.id === modelId);
		if (info === void 0) return void 0;
		if (info.reasoning?.supportedEfforts !== void 0 && info.reasoning.supportedEfforts.length > 0) return;
		const account = this.options.account();
		if (account === void 0) return void 0;
		return this.options.store.get(modelId, fingerprintModel(info), account);
	}
	/**
	* Probe one model, serially.
	*
	* The authenticated manual route supplies one-request consent after UI
	* confirmation. Other callers must pass the configured consent gate.
	* Manual consent never changes the automatic-probing configuration.
	* Explicit requests bypass historical results, but share an ongoing run.
	*/
	async probe(modelId, manualConsent = false) {
		if (!manualConsent && !this.options.consent()) return {
			state: "unavailable",
			reason: "probing is not authorized"
		};
		if (this.options.catalog.current().find((model) => model.id === modelId) === void 0) return {
			state: "unavailable",
			reason: `unknown model: ${modelId}`
		};
		const account = this.options.account();
		if (account === void 0) return {
			state: "unavailable",
			reason: "no WorkBuddy credential"
		};
		const pendingKey = JSON.stringify([account, modelId]);
		const pending = this.pending.get(pendingKey);
		if (pending !== void 0) return pending;
		const run = this.queue.then(async () => {
			const current = this.options.catalog.current().find((model) => model.id === modelId);
			if (current === void 0) return {
				state: "unavailable",
				reason: `unknown model: ${modelId}`
			};
			if (!manualConsent && !this.options.consent()) return {
				state: "unavailable",
				reason: "probing is not authorized"
			};
			if (current.reasoning?.supports !== true || (current.reasoning.supportedEfforts?.length ?? 0) > 0) return {
				state: "unavailable",
				reason: "model does not need detection"
			};
			const cached = this.recordFor(modelId);
			if (!manualConsent && cached !== void 0 && cached.validation !== "unknown") return {
				state: "ok",
				validation: cached.validation,
				efforts: cached.efforts,
				requests: 0
			};
			if (this.options.account() !== account) return {
				state: "unavailable",
				reason: "account changed before detection"
			};
			const credential = await this.options.credentials.current();
			if (credential === void 0) return {
				state: "unavailable",
				reason: "no WorkBuddy credential"
			};
			const send = this.options.send === void 0 ? (effort, signal) => this.options.client.probeEffort(credential, modelId, effort, signal) : this.options.send(modelId);
			this.running = true;
			try {
				const outcome = await probeModel({
					send,
					...this.options.sentinel === void 0 ? {} : { sentinel: this.options.sentinel }
				});
				if (this.options.account() !== account) return {
					state: "unavailable",
					reason: "account changed during detection"
				};
				const record = this.options.store.record(fingerprintModel(current), outcome.validation, outcome.efforts, account);
				this.options.store.set(modelId, record);
				if (outcome.validation === "unknown") return {
					state: "unavailable",
					reason: outcome.reason
				};
				return {
					state: "ok",
					validation: outcome.validation,
					efforts: record.efforts,
					requests: outcome.requests
				};
			} finally {
				this.running = false;
			}
		});
		this.queue = run.catch(() => void 0);
		this.pending.set(pendingKey, run);
		try {
			return await run;
		} finally {
			this.pending.delete(pendingKey);
		}
	}
};
//#endregion
//#region src/web-status.ts
/** Redact token-like content before it crosses to the browser. */
function safeMessage(error) {
	return (error instanceof Error ? error.message : String(error)).replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, "[redacted token]").replace(/(\b(?:code|token|refresh_token|access_token)=)[^&\s]+/giu, "$1[redacted]").slice(0, 500);
}
function json(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Content-Length": Buffer.byteLength(payload)
	});
	res.end(payload);
}
/**
* The request must be addressed to the loopback interface, and a
* browser-attached Origin must be loopback too. The Host check drops
* DNS-rebinding pages (their Host is the attacker's domain, not loopback);
* the card's same-origin fetches carry no Origin and pass on Host alone.
*/
function loopbackRequest(req) {
	return hostIsLoopback(req.headers.host) && originIsLoopback(req.headers.origin);
}
/**
* Assemble the card's status document.
*
* Sign-in state is the pool's existence; credit is a live billing answer whose
* failure degrades to `creditsError` rather than failing the whole document.
*/
async function workBuddyWebStatus(deps) {
	if (!deps.accounts.hasAccounts()) {
		const diagnosed = deps.emptyReason?.();
		const authStatus = deps.store === void 0 ? void 0 : await deps.store.status();
		return {
			status: "signed-out",
			reason: diagnosed ?? authStatus?.reason ?? "no account yet: sign in to the desktop app, or add one by QR from this card",
			...await accountSections(deps, await deps.accounts.snapshot({ withCredits: false }).catch(() => ({ accounts: [] })))
		};
	}
	const snapshot = await deps.accounts.snapshot({ withCredits: true });
	const primary = snapshot.accounts.find((account) => account.id === snapshot.primary);
	const sections = accountSections(deps, snapshot);
	/** The last diagnosable desktop-read failure, read once for this document. */
	const desktopError = deps.emptyReason?.();
	const status = {
		status: "signed-in",
		...primary?.nickname === void 0 ? {} : { nickname: primary.nickname },
		...primary === void 0 ? {} : { expiresAt: primary.expiresAtMs },
		...primary === void 0 ? {} : { domain: primary.domain },
		...primary === void 0 ? {} : { source: primary.origin },
		...desktopError === void 0 ? {} : { desktopError },
		...sections
	};
	const modelsField = deps.models().map((model) => {
		const rate = normalizeCredits(model.billing?.credits);
		const supported = model.supportedContextWindows ?? [];
		const maxContextWindow = supported.length > 0 ? Math.max(...supported) : void 0;
		const effective = deps.resolveContextWindow?.(model.id, supported) ?? model.contextWindow;
		const defaultContextWindow = model.defaultContextWindow ?? model.contextWindow;
		const choices = supported.length > 1 ? [...supported].sort((left, right) => left - right) : void 0;
		return {
			id: model.id,
			name: model.name,
			...model.billing?.free === true ? { free: true } : {},
			...model.billing?.badges !== void 0 && model.billing.badges.length > 0 ? { badges: model.billing.badges } : {},
			...rate === void 0 ? {} : { credits: rate },
			...model.billing?.rateUnknown === true ? { rateUnknown: true } : {},
			...typeof effective === "number" && effective > 0 ? { contextWindow: effective } : {},
			...typeof defaultContextWindow === "number" && defaultContextWindow > 0 && defaultContextWindow < effective ? { defaultContextWindow } : {},
			...choices === void 0 ? {} : {
				contextChoices: choices,
				contextChoice: effective
			},
			...maxContextWindow === void 0 || maxContextWindow <= effective ? {} : { maxContextWindow },
			...typeof model.maxInputTokens === "number" && model.maxInputTokens > 0 ? { maxInputTokens: model.maxInputTokens } : {}
		};
	});
	const catalog = deps.catalog?.();
	const withCatalog = catalog === void 0 ? status : {
		...status,
		catalog
	};
	const visibility = deps.visibility?.();
	const withVisibility = visibility === void 0 ? withCatalog : {
		...withCatalog,
		visibility
	};
	const statusWithModels = modelsField.length > 0 ? {
		...withVisibility,
		models: modelsField
	} : withVisibility;
	let probed = statusWithModels;
	if (deps.probe !== void 0) {
		const maximumContextWindow = deps.useMaximumContextWindow?.();
		probed = {
			...statusWithModels,
			probe: deps.probe(),
			...deps.probeKey === void 0 ? {} : { probeKey: deps.probeKey },
			...maximumContextWindow === void 0 ? {} : { useMaximumContextWindow: maximumContextWindow }
		};
	}
	try {
		const credential = await deps.accounts.primaryCredential();
		if (credential !== void 0) {
			const credits = await deps.client.fetchCredits(credential);
			return {
				...probed,
				credits
			};
		}
	} catch (error) {
		return {
			...probed,
			creditsError: safeMessage(error)
		};
	}
	return probed;
}
/**
* The account section plus the control key, shared by both sign-in states.
*
* One helper rather than two copies because the signed-out document needs both
* for the same reason: adding the first account is a write, and the write is
* authorized by the key this same document hands out.
*/
function accountSections(deps, snapshot) {
	return {
		accounts: {
			accounts: snapshot.accounts,
			...snapshot.primary === void 0 ? {} : { primary: snapshot.primary },
			...snapshot.desktop === void 0 ? {} : { desktop: snapshot.desktop }
		},
		...deps.probeKey === void 0 ? {} : { probeKey: deps.probeKey },
		...deps.preferences?.()
	};
}
/** The status route's request handler, extracted so tests can mount it on a bare server. */
function workBuddyStatusHandler(deps) {
	return async (req, res) => {
		if (req.method !== "GET") {
			json(res, 405, { error: "method not allowed" });
			return;
		}
		if (!loopbackRequest(req)) {
			json(res, 403, { error: "request-not-trusted" });
			return;
		}
		try {
			json(res, 200, await workBuddyWebStatus(deps));
		} catch (error) {
			json(res, 500, { error: safeMessage(error) });
		}
	};
}
/** Mount the GET status route on an optional webServer context. */
function registerWorkBuddyStatusRoute(ctx, deps) {
	const path = deps.path ?? "/plugins/dsh-workbuddy-connect/status";
	ctx.effect(() => {
		const dispose = ctx.webServer.register({
			kind: "exact",
			path,
			handler: workBuddyStatusHandler(deps)
		});
		return () => {
			dispose();
		};
	}, "dsh-workbuddy-connect: Web status route");
}
//#endregion
//#region src/open-link.ts
/**
* Opening an HTTP(S) link in the user's own browser, from the host process.
*
* Why this exists at all: the plugin's sign-in routes hand the user a URL that
* lives on the *provider's* site and has to be visited with their existing
* session and password manager — singling out that browser's storage is the
* whole reason the browser route is usable. In a desktop WebView the page has
* no way to do that itself: `window.open` is answered by the shell, which
* in the current DSH desktop answers nothing at all, and the sidebar browser
* DSH uses for its own Markdown links is a WebView on a shared profile — the
* wrong jar for this.
*
* The host is the one place that can ask the operating system, so the client
* asks it over the same key-bearing control route as every other write. The
* process spawn is deliberately detached and unwaited: the launcher exits long
* before the user is done reading the page, and `unref` keeps its lifetime
* from belonging to the plugin's.
*
* The URL is validated here, host-side, immediately before it reaches the OS —
* not in the browser, where the check would only bind well-behaved callers.
* Only `http:` and `https:` are ever handed to the launcher, so
* `file:`, `javascript:` and every registered custom scheme (an app
* launcher on any desktop) are refused rather than passed along to the shell.
*
* @module dsh-workbuddy-connect/open-link
*/
/**
* How one platform hands a URL to the user's default browser.
*
* `open` on macOS and `xdg-open` on Linux are the platform's own
* "open this with the default handler" entry points. Windows has no equivalent
* executable: the documented one is `rundll32 url.dll,FileProtocolHandler`,
* where the comma-joined argument is ONE argument, not two — splitting it asks
* rundll32 to load a module named `url.dll,`.
*/
function launcherFor(platform) {
	if (platform === "win32") return {
		command: "rundll32.exe",
		args: (url) => ["url.dll,FileProtocolHandler", url]
	};
	if (platform === "darwin") return {
		command: "open",
		args: (url) => [url]
	};
	return {
		command: "xdg-open",
		args: (url) => [url]
	};
}
/**
* Whether a value is a link this module may open.
*
* Only `http` and `https`, and only absolute: a scheme-relative or
* relative address would be resolved by the launcher's own guess about a base,
* which is not a decision this module is entitled to make for the user.
*/
function isOpenableLink(value) {
	if (typeof value !== "string" || value.trim() === "") return false;
	try {
		const parsed = new URL(value);
		return parsed.protocol === "http:" || parsed.protocol === "https:";
	} catch {
		return false;
	}
}
/** The production harness: spawn detached, resolve on `spawn`, reject on `error`. */
const PRODUCTION_HARNESS = {
	platform: process.platform,
	spawn: (command, args) => new Promise((resolve, reject) => {
		const child = spawn(command, [...args], {
			detached: true,
			stdio: "ignore",
			windowsHide: true
		});
		child.once("error", reject);
		child.once("spawn", () => {
			child.unref();
			resolve();
		});
	})
};
/**
* Hand one link to the operating system's default browser.
*
* Resolves with a state rather than throwing, so the control route can answer
* the card with a reason it can show: `invalid-link` is the caller's fault
* and `failed` is the machine's, and the card reports them differently from
* a successful hand-off.
*/
async function openWorkBuddyLink(url, harness = PRODUCTION_HARNESS) {
	if (!isOpenableLink(url)) return {
		state: "invalid-link",
		reason: "only absolute http and https links can be opened"
	};
	const launcher = launcherFor(harness.platform);
	try {
		await harness.spawn(launcher.command, launcher.args(url));
		return { state: "opened" };
	} catch (error) {
		return {
			state: "failed",
			reason: error instanceof Error ? error.message.slice(0, 300) : String(error)
		};
	}
}
//#endregion
//#region src/preferences.ts
/**
* The plugin-wide display preferences, declared once.
*
* A preference the sidebar draws exists in three shapes that have to agree: a
* field in this plugin's own config schema (with its default), the value the
* status document states, and the rule that turns the first into the second.
* Written out per preference those three drift — the schema defaults one way
* while the projection excuses the other, and the symptom is a setting that
* looks saved and behaves reset, or a sidebar that empties itself the first time
* the config file is hand-edited.
*
* One row per preference is what makes a new one cheap: the field, its default,
* and its projection are here, so the rest of the host reads the whole set
* through {@link statedPreferences} and never names an individual preference
* again. What is deliberately NOT here is the write path — each preference is
* written through its own named route action, and a route's name, its refusal
* messages, and what it is willing to accept are part of the route contract
* rather than of the value.
*
* @module dsh-workbuddy-connect/preferences
*/
/**
* Every plugin-wide preference, by the name of its config field.
*
* Both products' surfaces draw these, and each is written once but read from
* whichever document carries it — see `client/status-document.ts`.
*/
const WORKBUDDY_PREFERENCES = {
	/**
	* How the sidebar card states each product's credit.
	*
	* `'remaining'` (default) is one line per product — "WorkBuddy 剩余额度 5,266";
	* `'usage'` is the reference card's shape — a "used / total" pair over a bar of
	* that ratio. Both describe the same pool; they differ in which figure leads,
	* and that is a matter of taste rather than of correctness, which is why it is
	* a setting instead of a decision this plugin makes for the user.
	*/
	sidebarCreditStyle: {
		field: z.union(["remaining", "usage"]).default("remaining").description("Sidebar credit line: \"remaining\" states the balance per product; \"usage\" shows used / total over a bar"),
		stated: (value) => value === "usage" ? "usage" : "remaining"
	},
	/**
	* Whether the sidebar keeps its credit card at all.
	*
	* The one preference here that REMOVES a surface instead of reshaping it:
	* `false` takes the card out of the sidebar's foot, which is where both the
	* resident credit summary and the way into the dashboard live. The dashboard
	* therefore stays reachable from the settings page while this is off — a
	* switch that stranded a destination would be a trap rather than a setting.
	*/
	sidebarCreditVisible: {
		field: z.boolean().default(true).description("Show the WorkBuddy credit card at the bottom of the sidebar (off: the dashboard stays reachable from this settings page)"),
		stated: (value) => value !== false
	}
};
/**
* Project every stored preference onto what the status document states.
*
* A preference whose projection answers `undefined` is omitted rather than
* written as `undefined`, which matters on a JSON wire and for the browser
* half's `in`-style reads alike.
*
* @param config - the live config, already unwrapped from its volatile refs.
*/
function statedPreferences(config) {
	const stated = {};
	for (const key of Object.keys(WORKBUDDY_PREFERENCES)) {
		const value = WORKBUDDY_PREFERENCES[key].stated(config[key]);
		if (value !== void 0) Object.assign(stated, { [key]: value });
	}
	return stated;
}
//#endregion
//#region src/index.ts
/** Stable Cordis plugin name. */
const name = "llm-workbuddy";
/** The model registry required before the provider can register. */
const inject = ["llm"];
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
const WORKBUDDY_AI_SETTINGS_NS = "workbuddy-ai";
/**
* The plugin's own row id in the active profile's composition.
*
* On DSH 0.1.7 a settings form write is addressed by this id — the Loader row's
* `id` field, which `cordis.patch.yml` declares as `llm-workbuddy` — rather
* than by a per-variant namespace. It is a fallback only: the live id is read
* back from `configEditor.entries()`, so a profile that renamed the row still
* writes through the right one.
*/
const PROFILE_ENTRY_ID = WORKBUDDY_PROFILE_ENTRY_ID;
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
const CREDENTIAL_POLL_MS = 3e4;
/** Floor and ceiling for the overridable poll interval. */
const MIN_POLL_MS = 100;
const MAX_POLL_MS = 864e5;
/** Resolve the sweep interval, honoring the override when it is usable. */
function credentialPollMs() {
	const override = Number(process.env["DSH_WORKBUDDY_POLL_MS"]);
	if (!Number.isFinite(override) || override < MIN_POLL_MS) return CREDENTIAL_POLL_MS;
	return Math.min(override, MAX_POLL_MS);
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
const CATALOG_RETRY_SWEEPS = 10;
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
	authFile: z.string().description("WorkBuddy desktop auth file (defaults to the app's own location)"),
	authFileAI: z.string().description("WorkBuddy AI desktop auth file (defaults to the app's own location)"),
	probeConsent: z.boolean().default(false).description("Authorize reasoning-effort probes (each probe sends real requests that may consume credit)"),
	useMaximumContextWindow: z.boolean().default(true).description("Use the largest context window declared by WorkBuddy AI when alternatives are available (on by default)"),
	...Object.fromEntries(Object.entries(WORKBUDDY_PREFERENCES).map(([key, preference]) => [key, preference.field]))
};
/**
* The composition schema: what the loader reads and what 0.1.7's settings forms
* project.
*
* Every field is marked volatile, so a write through the 0.1.7 settings wire
* commits IN PLACE (no fiber remount) and notifies this plugin through
* `loader/volatile-update`. `apply()` therefore reads the live values through
* `current()`, which unwraps the references on every call.
*/
const Config = z.object(markVolatileFields(CONFIG_FIELDS));
/**
* The settings namespace this plugin's fields are served under.
*
* On 0.1.7 a plugin's composition entry IS its settings namespace, so this is
* the profile row id (see {@link PROFILE_ENTRY_ID}) rather than a name the
* plugin installs. Kept exported because the host CLI and the tests resolve
* the served descriptor by it.
*/
const WORKBUDDY_SETTINGS_NS = PROFILE_ENTRY_ID;
/** Stable identity key used by credentials, probe records, and catalog entries. */
function credentialIdentity(credential) {
	return `${credential.uid}:${credential.enterpriseId ?? ""}`;
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
function visibilityAccountOf(credential) {
	return credential.uid === "" ? void 0 : credentialIdentity(credential);
}
/** Read the configured explicit auth-file path for one variant. */
function configuredAuthFile(config, variant) {
	return variant.id === CN_VARIANT.id ? config.authFile : config.authFileAI;
}
/**
* The static catalog a variant serves before its first successful fetch.
*
* Each variant has its own roster: the two endpoints share several model ids
* but not their billing, context windows, or reasoning sets, so one shared
* fallback would misdescribe whichever variant it was not captured from.
*/
function fallbackFor(variant) {
	return variant.id === CN_VARIANT.id ? FALLBACK_WORKBUDDY_MODELS : FALLBACK_WORKBUDDY_AI_MODELS;
}
/** Build one variant's stores and probe state. */
function createVariantRuntime(config, variant, current, identityOf, accountOf, keyProvider, onDesktopReadError, warn) {
	const client = new WorkBuddyUpstreamClient();
	const configured = configuredAuthFile(current(), variant);
	const store = new WorkBuddyCredentialStore({
		variant,
		...configured === void 0 ? {} : { desktopPath: configured },
		...keyProvider === void 0 ? {} : { keyProvider },
		refresh: (credential) => client.refreshToken(credential)
	});
	const pool = new WorkBuddyAccountPool({ variant });
	const contextPreference = new WorkBuddyContextPreference({ variant });
	const qr = new WorkBuddyQrLogin({ variant });
	const accounts = new WorkBuddyAccountService({
		variant,
		pool,
		store,
		client,
		qr,
		usageFor: (accountId) => usageStore.summary(accountId),
		onDesktopReadError
	});
	const fallback = fallbackFor(variant);
	const catalog = new WorkBuddyCatalog(fallback);
	if (variant.id !== CN_VARIANT.id) catalog.setUseMaximumContextWindow(current().useMaximumContextWindow === true);
	catalog.setVisible(false);
	const probeStore = new WorkBuddyProbeStore({
		pluginVersion: WORKBUDDY_CONNECT_VERSION,
		path: workbuddyProbePath(variant.probeFilename)
	});
	const savedCatalogs = new WorkBuddyCatalogStore(workbuddyCatalogPath(variant.catalogFilename));
	const visibilityStore = new WorkBuddyVisibilityStore(workbuddyVisibilityPath(variant.visibilityFilename));
	const usageStore = new WorkBuddyUsageStore({
		path: workbuddyUsagePath(variant.usageFilename),
		onWriteError: (error) => {
			warn("dsh-workbuddy-connect: usage tally could not be written", error);
		}
	});
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
		probeService: new WorkBuddyProbeService({
			store: probeStore,
			catalog,
			credentials: accountsAsCredentialSource(accounts),
			client,
			consent: () => current().probeConsent === true,
			account: () => identityOf(variant.id)
		}),
		savedCatalogs,
		visibilityStore,
		usageStore,
		account: () => accountOf(variant.id),
		fallback,
		catalogSource: "fallback",
		catalogFetchedAtMs: void 0,
		catalogError: void 0,
		lastFetchAtMs: 0,
		catalogGeneration: 0,
		inflightFetch: void 0,
		invalidate: () => {},
		registered: false
	};
}
/** The catalog provenance the card displays. */
function catalogSection(runtime) {
	const fetch = runtime.client.lastCatalog;
	return {
		source: runtime.catalogSource,
		...runtime.catalogFetchedAtMs === void 0 ? {} : { fetchedAt: runtime.catalogFetchedAtMs },
		...fetch?.appVersion === void 0 ? {} : { appVersion: fetch.appVersion.version },
		...runtime.catalogError === void 0 ? {} : { error: runtime.catalogError }
	};
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
function isProbeCandidate(info) {
	if (info.reasoning?.supports !== true) return false;
	return (info.reasoning.supportedEfforts?.length ?? 0) === 0;
}
/** Compact probe state for one card: consent, candidates, observations. */
function probeSection(runtime, consent) {
	const models = runtime.catalog.current();
	const results = models.flatMap((info) => {
		const record = runtime.probeService.recordFor(info.id);
		if (record === void 0) return [];
		return [{
			id: info.id,
			name: info.name,
			validation: record.validation,
			efforts: record.efforts,
			probedAt: record.probedAtMs
		}];
	});
	return {
		consent,
		running: runtime.probeService.isRunning(),
		candidates: models.filter(isProbeCandidate).map((info) => info.id),
		results: newestFirst(results)
	};
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
function accountsAsCredentialSource(accounts) {
	return {
		current: () => accounts.primaryCredential(),
		resolve: async () => {
			const credential = await accounts.primaryCredential();
			if (credential === void 0) throw new Error("workbuddy: no account is available for this provider; add one from the plugin card");
			return credential;
		}
	};
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
async function startVariant(ctx, runtime) {
	const { variant, client, catalog, probeService, pool, accounts } = runtime;
	const rotation = new WorkBuddyRotation({
		pool,
		client,
		logger: ctx.logger,
		onUsage: (accountId, usage) => {
			runtime.usageStore.record(accountId, usage);
		},
		onUsageShape: (fields) => {
			ctx.logger.info(`dsh-workbuddy-connect: ${variant.displayName} upstream usage fields: ${fields.join(", ") || "(none)"}`);
		}
	});
	const shim = createWorkBuddyShim({
		sender: { send: async (body, signal) => (await rotation.send(body, signal)).result },
		catalog,
		logger: ctx.logger
	});
	try {
		await shim.ready;
	} catch (error) {
		ctx.logger.error(`dsh-workbuddy-connect: ${variant.displayName} loopback endpoint failed to start`, error);
		return false;
	}
	try {
		const workbuddy = createWorkBuddyAdapter({
			providerId: variant.id,
			displayName: variant.displayName,
			shim,
			store: accountsAsCredentialSource(accounts),
			catalog,
			resolveAttachments: () => ctx.get("attachments"),
			observe: (modelId) => probeService.recordFor(modelId),
			resolveContextWindow: (modelId, declared) => runtime.contextPreference.resolve(modelId, declared),
			hidden: () => {
				const account = runtime.account();
				if (account === void 0) return [];
				return runtime.visibilityStore.effectiveHidden(account, runtime.catalog.current().map((model) => model.id));
			}
		});
		runtime.invalidate = () => {
			workbuddy.invalidate();
			ctx.emit("llm/adapters-updated");
		};
		const releaseDirectory = ctx.llm.registerConfigurableProviders([{
			provider: variant.id,
			displayName: variant.displayName,
			settingsNs: WORKBUDDY_SETTINGS_NS,
			settingsPath: []
		}]);
		const releaseAdapter = ctx.llm.registerAdapter([variant.id], workbuddy.adapter);
		try {
			ctx.effect(() => () => {
				releaseDirectory();
				releaseAdapter();
				shim.close();
			});
		} catch {
			releaseAdapter();
			shim.close();
		}
		runtime.registered = true;
		return true;
	} catch (error) {
		ctx.logger.error(`dsh-workbuddy-connect: ${variant.displayName} provider registration failed`, error);
		shim.close();
		return false;
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
function apply(ctx, config) {
	let appliedSource = () => config;
	let current = () => unwrapVolatileConfig(appliedSource());
	/** Timers and in-flight work belonging to this plugin instance. */
	let stopped = false;
	const timers = [];
	/**
	* The account identity each variant last published a catalog for. Keeps a
	* same-identity token rotation from re-fetching, and lets a late response
	* from a previous identity be discarded instead of overwriting a newer one.
	*/
	const lastIdentities = /* @__PURE__ */ new Map();
	/**
	* The last diagnosable failure while capturing the desktop app's sign-in,
	* per variant. Surfaced by the card when the pool is empty, because that is
	* the case where "signed out" is an unhelpful answer — a file holding the
	* other product's credential is the common cause and it names the file.
	*/
	const desktopReadError = /* @__PURE__ */ new Map();
	/**
	* The visibility account key each variant last adopted, parallel to
	* {@link lastIdentities}: same credential, second key — undefined both when
	* signed out and when the credential carried no uid, which is exactly the
	* case that must not fall back to a shared preference bucket.
	*/
	const lastAccounts = /* @__PURE__ */ new Map();
	const atRestKeysFor = (variant) => new WorkBuddyAtRestKeyProvider({ discovery: variant.id === CN_VARIANT.id ? "macos-workbuddy" : "none" });
	const runtimes = WORKBUDDY_VARIANTS.map((variant) => createVariantRuntime(current(), variant, () => current(), (id) => lastIdentities.get(id), (id) => lastAccounts.get(id), atRestKeysFor(variant), (message) => {
		desktopReadError.set(variant.id, message.slice(0, 300));
	}, (message, error) => {
		ctx.logger.warn(message, error);
	}));
	const probeKey = createProbeKey();
	let setMaximumContextWindow;
	/**
	* Writes the sidebar credit-line style through the same settings service the
	* maximum-context preference uses. Undefined on a host with no settings
	* service: the status document then carries no style, and the card keeps its
	* default rather than rendering a control that could not be saved.
	*/
	let setSidebarCreditStyle;
	/**
	* Writes whether the sidebar keeps its credit card, through the same settings
	* service. Undefined on a host with no settings service, exactly like the
	* style beside it: the status document then carries no value and the card
	* keeps its default (present) rather than vanishing on a write that could not
	* have been saved.
	*/
	let setSidebarCreditVisible;
	/**
	* Whether the host mounted a settings service this plugin can write through.
	* Decided once, inside the `settings` inject. The maximum-context getter
	* answers `undefined` while this is false, and a status document without the
	* field is what keeps the card from rendering a checkbox that could not be
	* saved.
	*/
	let settingsAvailable = false;
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
	const adoptIdentity = (runtime, identity, account) => {
		const id = runtime.variant.id;
		const known = lastIdentities.get(id);
		if (known === identity) return;
		const hadCredential = known !== void 0;
		if (identity === void 0) lastIdentities.delete(id);
		else lastIdentities.set(id, identity);
		if (account === void 0) lastAccounts.delete(id);
		else lastAccounts.set(id, account);
		runtime.catalogGeneration += 1;
		runtime.inflightFetch?.controller.abort();
		runtime.inflightFetch = void 0;
		if (hadCredential && known !== identity) runtime.invalidate();
		if (identity === void 0) {
			if (known !== void 0) runtime.savedCatalogs.delete(known);
			runtime.catalog.set(runtime.fallback);
			runtime.catalogSource = "fallback";
			runtime.catalogFetchedAtMs = void 0;
			runtime.catalogError = void 0;
			if (runtime.catalog.setVisible(false)) runtime.invalidate();
			return;
		}
		const saved = runtime.savedCatalogs.get(identity);
		if (saved !== void 0) {
			runtime.catalog.set([...saved.models]);
			runtime.catalogSource = "saved";
			runtime.catalogFetchedAtMs = saved.fetchedAtMs;
		} else {
			runtime.catalog.set(runtime.fallback);
			runtime.catalogSource = "fallback";
			runtime.catalogFetchedAtMs = void 0;
		}
		runtime.catalogError = void 0;
		runtime.catalog.setVisible(true);
		runtime.invalidate();
	};
	ctx.inject(["webServer"], (webCtx) => {
		for (const runtime of runtimes) {
			registerWorkBuddyStatusRoute(webCtx, {
				path: runtime.variant.statusPath,
				accounts: runtime.accounts,
				client: runtime.client,
				models: () => runtime.catalog.current(),
				resolveContextWindow: (modelId, declared) => runtime.contextPreference.resolve(modelId, declared),
				catalog: () => catalogSection(runtime),
				probe: () => probeSection(runtime, current().probeConsent === true),
				preferences: () => statedPreferences(current()),
				emptyReason: () => desktopReadError.get(runtime.variant.id),
				store: runtime.store,
				probeKey,
				visibility: () => {
					const account = runtime.account();
					if (account === void 0) return void 0;
					const allowlist = runtime.visibilityStore.allowlist(account);
					return {
						account,
						disabled: runtime.visibilityStore.disabled(account),
						...allowlist === void 0 ? {} : { allowlist }
					};
				},
				...runtime.variant.id === CN_VARIANT.id ? {} : { useMaximumContextWindow: () => settingsAvailable ? current().useMaximumContextWindow === true : void 0 }
			});
			registerWorkBuddyAccountRoute(webCtx, {
				path: runtime.variant.accountPath,
				handle: async (action) => {
					const result = await handleAccountAction(runtime, action);
					if (action.action !== "poll" && action.action !== "add" && action.action !== "cancel") await syncVariant(runtime);
					return result;
				}
			}, probeKey);
			registerWorkBuddyProbeRoute(webCtx, {
				path: runtime.variant.probePath,
				probe: async (modelId) => {
					const result = await runtime.probeService.probe(modelId, true);
					if (result.state === "ok") runtime.invalidate();
					return result;
				},
				clear: () => {
					runtime.probeStore.clear();
					runtime.invalidate();
				},
				refresh: async () => {
					if (stopped) return {
						state: "failed",
						reason: "plugin is stopping"
					};
					let credential;
					try {
						await runtime.accounts.captureDesktop();
						credential = await runtime.accounts.primaryCredential();
					} catch (error) {
						return {
							state: "failed",
							reason: error instanceof Error ? error.message.slice(0, 300) : String(error)
						};
					}
					if (credential === void 0) {
						adoptIdentity(runtime, void 0, void 0);
						return { state: "signed-out" };
					}
					const identity = credentialAccountId(credential);
					adoptIdentity(runtime, identity, visibilityAccountOf(credential));
					await fetchCatalog(runtime, identity);
					return runtime.catalogError === void 0 ? {
						state: "refreshed",
						reason: `${runtime.catalog.current().length} models`
					} : {
						state: "failed",
						reason: runtime.catalogError
					};
				},
				...runtime.variant.id === CN_VARIANT.id ? {} : { setMaximumContextWindow: async (enabled) => {
					if (setMaximumContextWindow === void 0) return {
						state: "failed",
						reason: "settings are unavailable"
					};
					return setMaximumContextWindow(enabled);
				} },
				setSidebarCreditStyle: async (style) => {
					if (setSidebarCreditStyle === void 0) return {
						state: "failed",
						reason: "settings are unavailable"
					};
					const result = await setSidebarCreditStyle(style);
					if (result.state === "updated") ctx.emit("llm/adapters-updated");
					return result;
				},
				setSidebarCreditVisible: async (visible) => {
					if (setSidebarCreditVisible === void 0) return {
						state: "failed",
						reason: "settings are unavailable"
					};
					const result = await setSidebarCreditVisible(visible);
					if (result.state === "updated") ctx.emit("llm/adapters-updated");
					return result;
				},
				openExternal: (url) => openWorkBuddyLink(url),
				setModelVisibility: async (modelId, visible, expectedAccount) => {
					const account = runtime.account();
					if (account === void 0) return {
						state: "failed",
						reason: "model visibility needs a signed-in account with a stable user id"
					};
					if (expectedAccount !== account) return {
						state: "stale-account",
						reason: "the signed-in account changed"
					};
					try {
						runtime.visibilityStore.setVisible(account, modelId, visible);
					} catch (error) {
						return {
							state: "failed",
							reason: error instanceof Error ? error.message.slice(0, 300) : String(error)
						};
					}
					runtime.invalidate();
					return { state: "updated" };
				},
				setModelAllowlist: async (ids, expectedAccount) => {
					const account = runtime.account();
					if (account === void 0) return {
						state: "failed",
						reason: "model visibility needs a signed-in account with a stable user id"
					};
					if (expectedAccount !== account) return {
						state: "stale-account",
						reason: "the signed-in account changed"
					};
					try {
						runtime.visibilityStore.setAllowlist(account, ids);
					} catch (error) {
						return {
							state: "failed",
							reason: error instanceof Error ? error.message.slice(0, 300) : String(error)
						};
					}
					runtime.invalidate();
					return { state: "updated" };
				}
			}, (presented) => keyMatches$1(probeKey, presented));
		}
	});
	ctx.inject(["settings"], (settingsCtx) => {
		const forms = settingsCtx.settings;
		if (typeof forms.configure !== "function") {
			ctx.logger.warn("dsh-workbuddy-connect: host settings service has no configure API; the store-backed preferences are read-only");
			return;
		}
		const configure = forms.configure.bind(forms);
		ctx.effect(() => configure({ auto: false }, ctx.fiber), "dsh-workbuddy-connect: settings page policy");
		settingsAvailable = true;
		ctx.on("loader/volatile-update", () => {
			const next = current();
			applyMaximumContextWindow(next);
			for (const runtime of runtimes) runtime.store.setDesktopPath(configuredAuthFile(next, runtime.variant));
		});
		const entryId = () => {
			return (settingsCtx.get("configEditor")?.entries().find((entry) => entry.fiber === ctx.fiber))?.options.id;
		};
		setMaximumContextWindow = async (enabled) => {
			if (forms.update === void 0) return {
				state: "failed",
				reason: "this host does not accept settings writes"
			};
			try {
				await forms.update(entryId() ?? PROFILE_ENTRY_ID, { useMaximumContextWindow: enabled });
			} catch (error) {
				return {
					state: "failed",
					reason: error instanceof Error ? error.message.slice(0, 300) : String(error)
				};
			}
			return { state: "updated" };
		};
		setSidebarCreditStyle = async (style) => {
			if (forms.update === void 0) return {
				state: "failed",
				reason: "this host does not accept settings writes"
			};
			if (!isWorkBuddySidebarCreditStyle(style)) return {
				state: "failed",
				reason: "unknown sidebar credit style"
			};
			try {
				await forms.update(entryId() ?? PROFILE_ENTRY_ID, { sidebarCreditStyle: style });
			} catch (error) {
				return {
					state: "failed",
					reason: error instanceof Error ? error.message.slice(0, 300) : String(error)
				};
			}
			return { state: "updated" };
		};
		setSidebarCreditVisible = async (visible) => {
			if (forms.update === void 0) return {
				state: "failed",
				reason: "this host does not accept settings writes"
			};
			try {
				await forms.update(entryId() ?? PROFILE_ENTRY_ID, { sidebarCreditVisible: visible });
			} catch (error) {
				return {
					state: "failed",
					reason: error instanceof Error ? error.message.slice(0, 300) : String(error)
				};
			}
			return { state: "updated" };
		};
	});
	/**
	* Push the maximum-window preference into the AI catalog.
	*
	* The catalog keeps it as a flag, so this is the only path by which a saved
	* choice reaches a request \u2014 at startup and again on every settings write.
	*/
	function applyMaximumContextWindow(next) {
		const runtime = runtimes.find((candidate) => candidate.variant.id !== CN_VARIANT.id);
		if (runtime?.catalog.setUseMaximumContextWindow(next.useMaximumContextWindow === true)) runtime.invalidate();
	}
	ctx.effect(() => () => {
		stopped = true;
		for (const timer of timers) clearInterval(timer);
		timers.length = 0;
		clearHostHeartbeat();
	});
	/**
	* Execute one account-pool action from the card.
	*
	* Everything credential-shaped happens here, host-side: the browser sends a
	* verb and an id, never a token, and the QR flow's state is the only opaque
	* value that travels in either direction.
	*/
	const handleAccountAction = async (runtime, action) => {
		const { pool, accounts, qr, client } = runtime;
		switch (action.action) {
			case "add": {
				const challenge = await qr.start();
				return {
					state: "ok",
					challenge: {
						state: challenge.state,
						authUrl: challenge.authUrl,
						expiresAtMs: challenge.expiresAtMs
					}
				};
			}
			case "add-cookie": {
				const added = accounts.addCookieAccount(action.token);
				if (added.account === void 0) return {
					state: "failed",
					reason: added.reason ?? "the token was refused"
				};
				return {
					state: "added",
					name: added.account.label ?? added.account.nickname ?? added.account.uid.slice(0, 8),
					created: added.created === true,
					...added.created === true ? {} : { reason: "already in the pool; its token was replaced" }
				};
			}
			case "context": {
				const model = runtime.catalog.current().find((entry) => entry.id === action.model);
				if (model === void 0) return {
					state: "failed",
					reason: "no such model"
				};
				if (!(model.supportedContextWindows ?? []).includes(action.length)) return {
					state: "failed",
					reason: "that model does not offer that context length"
				};
				runtime.contextPreference.set(action.model, action.length);
				runtime.invalidate?.();
				return { state: "ok" };
			}
			case "cancel":
				qr.cancel(action.state);
				return { state: "ok" };
			case "poll": {
				let poll;
				try {
					poll = await qr.poll(action.state);
				} catch (error) {
					return {
						state: "failed",
						reason: error instanceof Error ? error.message.slice(0, 300) : String(error)
					};
				}
				if (poll.status !== "ready") return { state: poll.status };
				const added = accounts.addQrAccount(poll);
				return {
					state: "added",
					name: added.account.label ?? added.account.nickname ?? added.account.uid.slice(0, 8),
					created: added.created,
					...added.created ? {} : { reason: "already in the pool; its sign-in tokens were refreshed" }
				};
			}
			case "remove":
				if (!pool.remove(action.id)) return {
					state: "failed",
					reason: "no such account"
				};
				accounts.invalidateCredits(action.id);
				return { state: "ok" };
			case "enable":
				if (!pool.setEnabled(action.id, action.enabled)) return {
					state: "failed",
					reason: "no such account"
				};
				if (action.enabled) pool.clearCooldown(action.id);
				return { state: "ok" };
			case "label":
				if (!pool.setLabel(action.id, action.label)) return {
					state: "failed",
					reason: "no such account"
				};
				return { state: "ok" };
			case "reorder":
				pool.reorder(action.ids);
				return { state: "ok" };
			case "refresh-credits":
				for (const account of pool.list()) accounts.invalidateCredits(account.id);
				return { state: "ok" };
			case "test": {
				const account = pool.get(action.id);
				if (account === void 0) return {
					state: "failed",
					reason: "no such account"
				};
				const model = runtime.catalog.current()[0]?.id ?? "auto";
				const result = await client.chatStream(credentialOf(account), JSON.stringify({
					model,
					stream: true,
					messages: [{
						role: "user",
						content: "ping"
					}],
					max_tokens: 1
				}), AbortSignal.timeout(3e4));
				if (result.ok) {
					const body = result.response.body;
					if (body !== null) {
						const reader = body.getReader();
						try {
							if ((await reader.read()).done) return {
								state: "ok",
								test: {
									ok: false,
									message: "上游没有返回任何数据"
								}
							};
							return {
								state: "ok",
								test: {
									ok: true,
									message: "连通正常"
								}
							};
						} catch (error) {
							return {
								state: "ok",
								test: {
									ok: false,
									message: `读取流失败: ${String(error)}`
								}
							};
						} finally {
							await reader.cancel().catch(() => {});
						}
					}
					return {
						state: "ok",
						test: {
							ok: true,
							message: "连通正常"
						}
					};
				}
				return {
					state: "ok",
					test: {
						ok: false,
						message: `上游返回 ${result.kind} (http ${result.status}): ${result.message.slice(0, 200)}`
					}
				};
			}
		}
	};
	/**
	* Fetch one variant's catalog for the current credential.
	*
	* Shared by the credential sweep and the card's manual refresh, and written
	* so that concurrent callers cost one request and cannot interleave badly:
	*
	* - **One request at a time.** A second caller joins the in-flight fetch
	*   instead of starting its own, so one variant never has two catalog
	*   requests open at once.
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
	const fetchCatalog = async (runtime, identity) => {
		const inflight = runtime.inflightFetch;
		const generation = runtime.catalogGeneration;
		if (inflight !== void 0 && inflight.identity === identity && inflight.generation === generation) return inflight.promise;
		inflight?.controller.abort();
		const controller = new AbortController();
		let run;
		run = (async () => {
			let models;
			try {
				const credential = await runtime.accounts.primaryCredential();
				if (credential === void 0) {
					adoptIdentity(runtime, void 0, void 0);
					return;
				}
				const resolvedIdentity = credentialAccountId(credential);
				if (resolvedIdentity !== identity) {
					adoptIdentity(runtime, resolvedIdentity, visibilityAccountOf(credential));
					await fetchCatalog(runtime, resolvedIdentity);
					return;
				}
				models = await runtime.client.fetchModels(credential, controller.signal);
				const latest = await runtime.accounts.primaryCredential();
				const latestIdentity = latest === void 0 ? void 0 : credentialAccountId(latest);
				if (latestIdentity !== identity) {
					adoptIdentity(runtime, latestIdentity, latest === void 0 ? void 0 : visibilityAccountOf(latest));
					if (latestIdentity !== void 0) await fetchCatalog(runtime, latestIdentity);
					return;
				}
			} catch (error) {
				if (stopped || runtime.catalogGeneration !== generation) return;
				runtime.lastFetchAtMs = Date.now();
				runtime.catalogError = error instanceof Error ? error.message.slice(0, 300) : String(error);
				ctx.logger.warn(`dsh-workbuddy-connect: ${runtime.variant.displayName} catalog unavailable; serving the fallback list`, error);
				runtime.invalidate();
				return;
			}
			if (stopped || runtime.catalogGeneration !== generation) return;
			runtime.lastFetchAtMs = Date.now();
			runtime.catalog.set([...models]);
			runtime.catalogSource = "live";
			runtime.catalogFetchedAtMs = runtime.client.lastCatalog?.fetchedAtMs ?? Date.now();
			runtime.catalogError = void 0;
			if (lastIdentities.get(runtime.variant.id) === identity) runtime.savedCatalogs.set(identity, {
				source: runtime.client.lastCatalog?.source ?? "unknown",
				fetchedAtMs: runtime.client.lastCatalog?.fetchedAtMs ?? Date.now(),
				models: [...models],
				...runtime.client.lastCatalog?.appVersion === void 0 ? {} : { appVersion: runtime.client.lastCatalog.appVersion.version }
			});
			runtime.invalidate();
		})().finally(() => {
			if (runtime.inflightFetch?.promise === run) runtime.inflightFetch = void 0;
		});
		runtime.inflightFetch = {
			identity,
			generation,
			controller,
			promise: run
		};
		return run;
	};
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
	const syncVariant = async (runtime) => {
		if (stopped || !runtime.registered) return;
		await runtime.accounts.captureDesktop().then(() => {
			desktopReadError.delete(runtime.variant.id);
		}, (error) => {
			desktopReadError.set(runtime.variant.id, error instanceof Error ? error.message.slice(0, 300) : String(error));
			ctx.logger.warn(`dsh-workbuddy-connect: ${runtime.variant.displayName} credential read failed`, error);
		});
		if (stopped) return;
		const credential = await runtime.accounts.primaryCredential().catch((error) => {
			ctx.logger.warn(`dsh-workbuddy-connect: ${runtime.variant.displayName} account resolution failed`, error);
		});
		if (credential === void 0) {
			adoptIdentity(runtime, void 0, void 0);
			return;
		}
		const identity = credentialAccountId(credential);
		if (lastIdentities.get(runtime.variant.id) === identity && runtime.catalog.isVisible()) {
			const stale = runtime.catalogSource !== "live";
			const due = Date.now() - runtime.lastFetchAtMs >= credentialPollMs() * CATALOG_RETRY_SWEEPS;
			if (stale && due) await fetchCatalog(runtime, identity);
			return;
		}
		adoptIdentity(runtime, identity, visibilityAccountOf(credential));
		await fetchCatalog(runtime, identity);
	};
	/** Run one reconcile sweep across both variants. */
	const syncAll = async () => {
		for (const runtime of runtimes) await syncVariant(runtime);
	};
	Promise.all(runtimes.map(async (runtime) => startVariant(ctx, runtime))).then(() => {
		if (stopped) return;
		if (runtimes.some((runtime) => runtime.registered)) writeHostHeartbeat();
		syncAll();
		const timer = setInterval(() => {
			syncAll();
		}, credentialPollMs());
		timer.unref?.();
		timers.push(timer);
	});
}
//#endregion
export { AI_VARIANT, CN_APP_VERSION_FILENAME, CN_VARIANT, Config, FALLBACK_CN_APP_VERSION, FALLBACK_WORKBUDDY_AI_MODELS, FALLBACK_WORKBUDDY_MODELS, PROBE_EFFORT_CANDIDATES, PROFILE_ENTRY_ID, WORKBUDDY_ACCOUNTS_FILENAME, WORKBUDDY_AI_SETTINGS_NS, WORKBUDDY_APP_VERSION_FILENAME, WORKBUDDY_AUTH_FILENAME, WORKBUDDY_AUTH_FILE_ENV, WORKBUDDY_CATALOG_FILENAME, WORKBUDDY_HOST_HEARTBEAT_FILENAME, WORKBUDDY_PROBE_FILENAME, WORKBUDDY_PROVIDER, WORKBUDDY_SETTINGS_NS, WORKBUDDY_STREAM_IDLE_TIMEOUT_MS, WORKBUDDY_VARIANTS, WORKBUDDY_VISIBILITY_FILENAME, WorkBuddyAccountPool, WorkBuddyAccountService, WorkBuddyCatalog, WorkBuddyCatalogStore, WorkBuddyCredentialStore, WorkBuddyProbeService, WorkBuddyProbeStore, WorkBuddyQrLogin, WorkBuddyRotation, WorkBuddyUpstreamClient, WorkBuddyVisibilityStore, accountIdOf, accountsJson, appUserAgent, apply, challengeTag, chatBaseForDomain, chatBaseForRegion, chatUserAgent, classifyUpstreamError, clearHostHeartbeat, cooldownDurationMs, cooldownReasonFor, createStoreSender, createWorkBuddyAdapter, createWorkBuddyShim, credentialAccountId, credentialOf, defaultDesktopAuthCandidates, defaultDesktopAuthPath, desktopAuthCandidatesFor, fallbackChatIdentity, fingerprintModel, formatAccounts, inject, installedAppVersion, isAccountScoped, isHeartbeatProcessAlive, modelWithCurrentPromotion, name, normalizeCredits, originForRegion, parseAccountAction, parseModelCatalog, parseRetryAfter, parseWorkBuddyAuth, prepareChatBody, prepareInternationalChatBody, probeModel, processStartTimeMs, randomSentinel, readBundleVersion, readCliVersion, readHostHeartbeat, regionOf, registerWorkBuddyAccountRoute, resolveAppVersion, resolveChatIdentity, validAppVersion, validCliVersion, variantFor, visibilityAccountOf, workBuddyAccountHandler, workbuddyAccountsPath, workbuddyCatalogPath, workbuddyHostHeartbeatPath, workbuddyOwnAuthPath, workbuddyProbePath, workbuddyVisibilityPath };
