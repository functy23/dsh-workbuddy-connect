window.__ModuleLoader__.load({
	id: "dsh-workbuddy-connect",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_dom = require("react-dom");
		let react_jsx_runtime = require("react/jsx-runtime");
		/** Both products, in display order. */
		const CARD_VARIANTS = [{
			id: "workbuddy",
			titleKey: "title",
			introKey: "intro",
			signedOutKey: "signedOutHint",
			statusPath: "/plugins/dsh-workbuddy-connect/status",
			probePath: "/plugins/dsh-workbuddy-connect/probe",
			accountPath: "/plugins/dsh-workbuddy-connect/accounts"
		}, {
			id: "workbuddy-ai",
			titleKey: "titleAI",
			introKey: "introAI",
			signedOutKey: "signedOutHintAI",
			statusPath: "/plugins/dsh-workbuddy-connect/ai/status",
			probePath: "/plugins/dsh-workbuddy-connect/ai/probe",
			accountPath: "/plugins/dsh-workbuddy-connect/ai/accounts"
		}];
		//#endregion
		//#region src/client/WorkBuddyFloatingAccounts.tsx
		/**
		* The floating account window: both variants' accounts, over the conversation.
		*
		* Why a portal instead of a slot occupant that lays out in place: the window has
		* to sit over the conversation's top-right corner *without* taking header space,
		* and the only slot that renders inside the conversation is the header itself.
		* So the occupant renders nothing in flow, and everything it has to show goes
		* through a portal onto \`document.body\` with a fixed position derived from the
		* conversation's own scroll container.
		*
		* That derivation is the part worth reading: the offsets come from
		* \`[data-conversation-scroll]\`'s bounding box rather than from hardcoded
		* pixels, so the window follows the conversation when the sidebars open, the
		* window resizes, or the header height changes. A missing anchor falls back to a
		* viewport-relative corner, which keeps the window usable if DSH's markup moves.
		*
		* @module dsh-workbuddy-connect/client/floating-accounts
		*/
		/** How often the window re-reads both status documents. */
		const POLL_INTERVAL_MS$1 = 6e4;
		/** Distance from the conversation's top-right corner, in px. */
		const INSET = 16;
		/** Remembered collapsed/expanded state; a preference, not session state. */
		const COLLAPSED_KEY = "dsh-workbuddy-connect:floating-collapsed";
		const panelStyle = {
			position: "fixed",
			zIndex: 900,
			display: "flex",
			flexDirection: "column",
			gap: 8,
			width: 232,
			maxHeight: "min(60vh, 420px)",
			overflowY: "auto",
			padding: "10px 12px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 14,
			background: "var(--dsw-alias-bg-layer-1, rgba(255, 255, 255, 0.96))",
			boxShadow: "var(--dsw-shadow-lv2)",
			color: "var(--dsw-alias-label-primary)",
			fontSize: 12,
			lineHeight: "18px",
			overscrollBehavior: "contain"
		};
		const headerStyle = {
			display: "flex",
			alignItems: "center",
			justifyContent: "space-between",
			gap: 8
		};
		const titleStyle = {
			fontSize: 12,
			fontWeight: 600,
			color: "var(--dsw-alias-label-secondary)"
		};
		const iconButtonStyle = {
			display: "inline-flex",
			alignItems: "center",
			justifyContent: "center",
			width: 20,
			height: 20,
			padding: 0,
			border: 0,
			borderRadius: 5,
			background: "transparent",
			color: "var(--dsw-alias-label-tertiary)",
			font: "inherit",
			fontSize: 14,
			lineHeight: 1,
			cursor: "pointer"
		};
		const groupStyle$1 = {
			display: "flex",
			flexDirection: "column",
			gap: 4
		};
		const groupNameStyle = {
			fontSize: 11,
			color: "var(--dsw-alias-label-tertiary)"
		};
		const accountRowStyle = {
			display: "flex",
			alignItems: "center",
			justifyContent: "space-between",
			gap: 8
		};
		const accountNameStyle = {
			display: "flex",
			alignItems: "center",
			gap: 6,
			minWidth: 0,
			overflow: "hidden",
			textOverflow: "ellipsis",
			whiteSpace: "nowrap"
		};
		const valueStyle = {
			flex: "0 0 auto",
			fontVariantNumeric: "tabular-nums",
			color: "var(--dsw-alias-label-secondary)"
		};
		const waitingStyle = {
			...valueStyle,
			color: "var(--dsw-alias-state-warning-primary, #b45309)"
		};
		const collapsedStyle = {
			...panelStyle,
			width: "auto",
			maxHeight: "none",
			padding: "6px 10px"
		};
		function statusColor$1(status) {
			if (status === "signed-in") return "var(--dsw-alias-state-success-primary, #22a06b)";
			if (status === "error") return "var(--dsw-alias-state-error-primary, #d92d20)";
			return "var(--dsw-alias-label-dimmed, #9aa0a6)";
		}
		const dotStyle$1 = {
			width: 7,
			height: 7,
			borderRadius: "50%",
			flex: "0 0 auto"
		};
		/**
		* Compute the window's viewport position from the conversation's scroll area.
		*
		* Falls back to a viewport corner when the anchor is absent (a different DSH
		* build, or the settings page — where the window does not render at all).
		*/
		function anchorNow() {
			const container = document.querySelector("[data-conversation-scroll]");
			if (container === null) return {
				top: 64,
				right: INSET
			};
			const rect = container.getBoundingClientRect();
			const right = Math.max(INSET, window.innerWidth - rect.right + INSET);
			return {
				top: Math.max(INSET, rect.top + INSET),
				right
			};
		}
		/** One account's line inside the window. */
		function AccountLine({ account, now, t }) {
			const cooldown = account.cooldown;
			const waiting = cooldown !== void 0 && cooldown.untilMs > now;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: accountRowStyle,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					style: accountNameStyle,
					title: account.name,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						"aria-hidden": "true",
						style: {
							...dotStyle$1,
							background: account.available ? "var(--dsw-alias-state-success-primary, #22a06b)" : waiting ? "var(--dsw-alias-state-warning-primary, #b45309)" : "var(--dsw-alias-label-dimmed, #9aa0a6)"
						}
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: {
							overflow: "hidden",
							textOverflow: "ellipsis"
						},
						children: account.name
					})]
				}), waiting ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: waitingStyle,
					children: t("floatingRetryIn", { minutes: Math.max(1, Math.ceil(((cooldown?.untilMs ?? 0) - now) / 6e4)) })
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: valueStyle,
					children: account.credits === void 0 ? "—" : new Intl.NumberFormat(void 0, {
						notation: "compact",
						maximumFractionDigits: 1
					}).format(account.credits)
				})]
			});
		}
		/**
		* The window itself, driven by both variants' status documents.
		*
		* Registered **once**, not per variant: the window merges both products' pools,
		* so a per-variant occupant would paint two identical windows on top of each
		* other. The occupant renders nothing in flow — its output is the portal below.
		*/
		function WorkBuddyFloatingAccounts({ t }) {
			const [statuses, setStatuses] = (0, react.useState)({});
			const [anchor, setAnchor] = (0, react.useState)();
			const [collapsed, setCollapsed] = (0, react.useState)(() => {
				try {
					return window.localStorage.getItem(COLLAPSED_KEY) === "1";
				} catch {
					return false;
				}
			});
			const mounted = (0, react.useRef)(true);
			(0, react.useEffect)(() => {
				mounted.current = true;
				return () => {
					mounted.current = false;
				};
			}, []);
			const readAll = (0, react.useCallback)(async (signal) => {
				const entries = await Promise.all(CARD_VARIANTS.map(async (variant) => {
					try {
						const response = await fetch(variant.statusPath, {
							headers: { accept: "application/json" },
							credentials: "same-origin",
							...signal === void 0 ? {} : { signal }
						});
						if (!response.ok) return void 0;
						return [variant.id, await response.json()];
					} catch {
						return;
					}
				}));
				if (!mounted.current || signal?.aborted === true) return;
				const next = {};
				for (const entry of entries) if (entry !== void 0) next[entry[0]] = entry[1];
				setStatuses(next);
			}, []);
			(0, react.useEffect)(() => {
				const controller = new AbortController();
				readAll(controller.signal);
				const timer = window.setInterval(() => {
					readAll(controller.signal);
				}, POLL_INTERVAL_MS$1);
				return () => {
					window.clearInterval(timer);
					controller.abort();
				};
			}, [readAll]);
			(0, react.useEffect)(() => {
				const update = () => {
					setAnchor(anchorNow());
				};
				update();
				window.addEventListener("resize", update);
				const container = document.querySelector("[data-conversation-scroll]");
				const observer = typeof ResizeObserver === "undefined" ? void 0 : new ResizeObserver(update);
				if (container !== null) observer?.observe(container);
				observer?.observe(document.body);
				return () => {
					window.removeEventListener("resize", update);
					observer?.disconnect();
				};
			}, []);
			const toggle = (0, react.useCallback)(() => {
				setCollapsed((previous) => {
					const next = !previous;
					try {
						window.localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
					} catch {}
					return next;
				});
			}, []);
			const [now, setNow] = (0, react.useState)(() => Date.now());
			(0, react.useEffect)(() => {
				const timer = window.setInterval(() => {
					setNow(Date.now());
				}, 3e4);
				return () => {
					window.clearInterval(timer);
				};
			}, []);
			const showing = CARD_VARIANTS.filter((variant) => statuses[variant.id] !== void 0);
			if (showing.length === 0 || anchor === void 0) return null;
			if (!showing.some((variant) => {
				const status = statuses[variant.id];
				return status?.status === "signed-in" && status.accounts?.floatingWindow === true;
			})) return null;
			return (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					...collapsed ? collapsedStyle : panelStyle,
					top: anchor.top,
					right: anchor.right
				},
				role: "complementary",
				"aria-label": t("floatingTitle"),
				"data-workbuddy-floating-accounts": "",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: headerStyle,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: titleStyle,
						children: collapsed ? t("floatingTitle") : t("floatingTitle")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						style: iconButtonStyle,
						"aria-expanded": !collapsed,
						"aria-label": t(collapsed ? "floatingExpand" : "floatingCollapse"),
						title: t(collapsed ? "floatingExpand" : "floatingCollapse"),
						onClick: toggle,
						children: collapsed ? "⌃" : "⌄"
					})]
				}), collapsed ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: {
						...groupNameStyle,
						display: "flex",
						gap: 6,
						alignItems: "center"
					},
					children: showing.map((variant) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						"aria-hidden": "true",
						style: {
							...dotStyle$1,
							background: statusColor$1(statuses[variant.id]?.status)
						}
					}, variant.id))
				}) : showing.map((variant) => {
					const status = statuses[variant.id];
					const accounts = status?.status === "signed-in" ? status.accounts : void 0;
					return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: groupStyle$1,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: groupNameStyle,
							children: t(variant.titleKey)
						}), accounts === void 0 || accounts.accounts.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: groupNameStyle,
							children: t("floatingNoAccount")
						}) : accounts.accounts.filter((account) => account.enabled).map((account) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AccountLine, {
							account,
							now,
							t
						}, account.id))]
					}, variant.id);
				})]
			}), document.body);
		}
		//#endregion
		//#region src/client/WorkBuddyProbeControl.tsx
		/**
		* Per-model reasoning-effort entry beside the Composer's model selector.
		*
		* Interaction follows the Fast Mode control `dsh-codex-connect` ships in this
		* same seat, which is the established shape for composer chrome here:
		*
		* - a **static inline label** next to the icon names the feature ("Reasoning
		*   levels"), set smaller and dimmer than the surrounding chrome so it reads as
		*   an annotation on the icon. It never carries state: the verified levels
		*   already appear in the model dropdown (the adapter exposes them as
		*   selectable efforts), so repeating them here would duplicate the real answer
		*   and make the label's width jump as results change.
		* - a **hover/focus tooltip** carries the state and the click's purpose, the way
		*   Fast Mode's tooltip explains its current speed.
		* - the **confirmation** is a small bubble anchored to the control, not a
		*   `window.confirm`. Probing spends real credit, so a confirmation stays — but
		*   it belongs next to the thing it acts on, sized to one line plus two small
		*   buttons.
		*
		* @module dsh-workbuddy-connect/client/probe-control
		*/
		/**
		* The card (and therefore the routes) a selected provider belongs to.
		*
		* The control serves both WorkBuddy providers from one seat, so the provider id
		* is what selects the status and probe endpoints. Returning `undefined` for any
		* other provider is what keeps the icon off every non-WorkBuddy model.
		*/
		function cardVariantFor(provider) {
			return CARD_VARIANTS.find((card) => card.id === provider);
		}
		/** How often the control re-checks state when the window regains focus. */
		const RECONCILE_MS = 6e4;
		const wrapperStyle = {
			display: "inline-flex",
			position: "relative",
			alignItems: "center",
			transform: "translateY(2px)",
			marginRight: -8
		};
		const buttonStyle$1 = {
			display: "inline-flex",
			alignItems: "center",
			justifyContent: "center",
			gap: 2,
			height: 30,
			padding: "0 6px",
			border: 0,
			borderRadius: 8,
			background: "transparent",
			color: "var(--dsw-alias-label-secondary)",
			font: "inherit",
			whiteSpace: "nowrap",
			cursor: "pointer"
		};
		/**
		* The inline label. Smaller and dimmer than the surrounding chrome on purpose:
		* it names the feature, so it should read as an annotation attached to the icon
		* rather than compete with the adjacent model selector.
		*/
		const labelStyle = {
			fontSize: 11,
			lineHeight: "16px",
			color: "var(--dsw-alias-label-tertiary)"
		};
		/** Tooltip bubble: the Fast Mode shape (nowrap, one line, above the control). */
		const tooltipStyle = {
			position: "absolute",
			left: "50%",
			bottom: "calc(100% + 8px)",
			zIndex: 1e3,
			transform: "translateX(-50%)",
			padding: "4px 8px",
			borderRadius: 6,
			background: "var(--dsw-specific-tip, #1f2329)",
			boxShadow: "var(--dsw-shadow-lv2)",
			color: "var(--dsw-alias-label-primary, #fff)",
			fontSize: 12,
			lineHeight: "18px",
			whiteSpace: "nowrap",
			pointerEvents: "none"
		};
		/** Confirmation bubble: same anchor, but interactive and allowed to wrap. */
		const confirmStyle = {
			position: "absolute",
			right: 0,
			bottom: "calc(100% + 8px)",
			zIndex: 1001,
			display: "flex",
			flexDirection: "column",
			gap: 8,
			width: 260,
			padding: "10px 12px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 8,
			background: "var(--dsw-alias-bg-layer-1, #fff)",
			boxShadow: "var(--dsw-shadow-lv2)",
			color: "var(--dsw-alias-label-primary)",
			fontSize: 12,
			lineHeight: "18px"
		};
		const confirmRowStyle = {
			display: "flex",
			justifyContent: "flex-end",
			gap: 8
		};
		const confirmButtonStyle = {
			padding: "3px 10px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 6,
			background: "transparent",
			color: "inherit",
			font: "inherit",
			fontSize: 12,
			cursor: "pointer"
		};
		/**
		* Primary action inside the confirmation bubble.
		*
		* The fill and its text colour must come as a pair: `brand-primary` resolves to
		* a light accent in this theme, so hardcoding `color: #fff` on top of it renders
		* white-on-white. `button-primary-fill` + `label-primary-foreground` is the
		* theme's own pair for exactly this, and is what `dsh-codex-connect` uses for
		* the same job.
		*/
		const primaryButtonStyle = {
			...confirmButtonStyle,
			border: "1px solid var(--dsw-alias-button-primary-fill)",
			background: "var(--dsw-alias-button-primary-fill)",
			color: "var(--dsw-alias-label-primary-foreground)"
		};
		/**
		* Result note: a single line + a dismiss button, anchored to the control's
		* right side. Smaller than the confirmation bubble because it carries an
		* *outcome*, not a *decision* — the work is done, the user only has to read
		* and dismiss.
		*/
		const noteStyle = {
			position: "absolute",
			right: 0,
			bottom: "calc(100% + 8px)",
			zIndex: 1001,
			display: "flex",
			alignItems: "center",
			gap: 12,
			padding: "6px 10px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 8,
			background: "var(--dsw-alias-bg-layer-1)",
			boxShadow: "var(--dsw-shadow-lv2)",
			color: "var(--dsw-alias-label-primary)",
			fontSize: 12,
			lineHeight: "18px",
			whiteSpace: "nowrap"
		};
		/**
		* The note's dismiss action. Outlined rather than bare text: inside an already
		* bordered bubble, an unbordered word does not read as something you can click.
		* Matches the outlined pill convention the plugin's other secondary actions use.
		*/
		const noteDismissStyle = {
			padding: "2px 8px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 6,
			background: "transparent",
			color: "var(--dsw-alias-label-secondary)",
			font: "inherit",
			fontSize: 12,
			lineHeight: "18px",
			cursor: "pointer"
		};
		/**
		* The feature's static inline label. Deliberately not a state readout — see the
		* module comment.
		*/
		function useLabel(t) {
			return t("probeLabel");
		}
		/** Pick the model's recorded observation out of the probe section. */
		function resultFor(status, model) {
			if (status.status !== "signed-in") return void 0;
			return status.probe?.results.find((result) => result.id === model);
		}
		/**
		* The one-line tooltip: current state first, then what a click does — the same
		* two-part shape Fast Mode uses.
		*/
		function tooltipText(t, model, state) {
			if (state.busy) return t("probeRunning", { model });
			if (state.failed) return t("probeTooltipRetry");
			const result = state.result;
			if (result === void 0) return t("probeTooltipIdle", { model });
			if (result.validation === "validating" && result.efforts.length > 0) return t("probeTooltipVerified", { levels: result.efforts.join(" / ") });
			if (result.validation === "non-validating") return t("probeTooltipNotValidating");
			return t("probeTooltipRetry");
		}
		/** Model-independent shell: resolves the selection, then delegates per model. */
		function WorkBuddyProbeControl({ directory, t }) {
			const subscribe = (0, react.useCallback)((listener) => directory.subscribe(listener), [directory]);
			const snapshot = (0, react.useCallback)(() => directory.getSnapshot(), [directory]);
			const selection = (0, react.useSyncExternalStore)(subscribe, snapshot, snapshot).current;
			const card = selection === void 0 ? void 0 : cardVariantFor(selection.provider);
			const key = card === void 0 || selection === void 0 ? void 0 : `${card.id}:${selection.model}`;
			return card === void 0 || selection === void 0 || key === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelProbe, {
				model: selection.model,
				card,
				label: useLabel(t),
				t
			}, key);
		}
		function ModelProbe({ model, card, label, t }) {
			const [status, setStatus] = (0, react.useState)();
			const [busy, setBusy] = (0, react.useState)(false);
			const [confirming, setConfirming] = (0, react.useState)(false);
			const [tooltipVisible, setTooltipVisible] = (0, react.useState)(false);
			const [failed, setFailed] = (0, react.useState)(false);
			const [note, setNote] = (0, react.useState)();
			const inFlight = (0, react.useRef)(false);
			const mounted = (0, react.useRef)(false);
			const tooltipId = (0, react.useId)();
			const refresh = (0, react.useCallback)(async (signal) => {
				const response = await fetch(card.statusPath, {
					credentials: "same-origin",
					headers: { accept: "application/json" },
					...signal === void 0 ? {} : { signal }
				});
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				const value = await response.json();
				if (mounted.current && !signal?.aborted) setStatus(value);
			}, [card.statusPath]);
			(0, react.useEffect)(() => {
				mounted.current = true;
				const controller = new AbortController();
				const load = () => {
					refresh(controller.signal).catch(() => {});
				};
				load();
				const timer = window.setInterval(load, RECONCILE_MS);
				window.addEventListener("focus", load);
				return () => {
					mounted.current = false;
					controller.abort();
					window.clearInterval(timer);
					window.removeEventListener("focus", load);
				};
			}, [refresh]);
			const probe = status?.status === "signed-in" ? status.probe : void 0;
			const key = status?.status === "signed-in" ? status.probeKey : void 0;
			const result = status === void 0 ? void 0 : resultFor(status, model);
			const visible = probe?.candidates.includes(model) === true || result !== void 0;
			(0, react.useEffect)(() => {
				setConfirming(false);
				setNote(void 0);
			}, [model]);
			const detect = async () => {
				if (key === void 0 || inFlight.current || probe?.running === true) return;
				inFlight.current = true;
				setNote(void 0);
				setConfirming(false);
				setBusy(true);
				setFailed(false);
				try {
					const response = await fetch(card.probePath, {
						method: "POST",
						credentials: "same-origin",
						headers: {
							"Content-Type": "application/json",
							"X-WorkBuddy-Probe-Key": key
						},
						body: JSON.stringify({
							action: "probe",
							model
						})
					});
					const body = await response.json();
					if (!response.ok || body.state !== "ok" || body.validation !== "validating" && body.validation !== "non-validating" || !Array.isArray(body.efforts) || !body.efforts.every((effort) => typeof effort === "string")) throw new Error("probe failed");
					if (mounted.current) {
						const completed = {
							id: model,
							name: model,
							validation: body.validation,
							efforts: body.efforts,
							probedAt: Date.now()
						};
						setNote(completed);
					}
					refresh().catch(() => {});
				} catch {
					if (mounted.current) setFailed(true);
				} finally {
					inFlight.current = false;
					if (mounted.current) setBusy(false);
				}
			};
			if (!visible) return null;
			const text = tooltipText(t, model, {
				busy,
				result,
				failed
			});
			const disabled = busy || probe?.running === true || key === void 0;
			const showTooltip = tooltipVisible && !confirming && note === void 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				style: wrapperStyle,
				onMouseEnter: () => {
					setTooltipVisible(true);
				},
				onMouseLeave: () => {
					setTooltipVisible(false);
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						"aria-label": text,
						"aria-describedby": showTooltip ? tooltipId : void 0,
						"aria-busy": busy,
						"aria-expanded": confirming,
						disabled,
						onClick: () => {
							setConfirming(true);
						},
						onFocus: () => {
							setTooltipVisible(true);
						},
						onBlur: () => {
							setTooltipVisible(false);
						},
						style: {
							...buttonStyle$1,
							opacity: disabled && !confirming ? .6 : 1,
							cursor: disabled ? "default" : "pointer"
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
							width: "16",
							height: "16",
							viewBox: "0 0 24 24",
							fill: "none",
							stroke: "currentColor",
							strokeWidth: "1.6",
							"aria-hidden": "true",
							focusable: "false",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
									cx: "12",
									cy: "12",
									r: "9"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
									cx: "12",
									cy: "12",
									r: "4"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M12 12 20 4" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
									cx: "12",
									cy: "12",
									r: "1"
								})
							]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: labelStyle,
							children: label
						})]
					}),
					showTooltip && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						id: tooltipId,
						role: "tooltip",
						style: tooltipStyle,
						children: text
					}),
					confirming && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						style: confirmStyle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("probeBubbleBody") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: confirmRowStyle,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: confirmButtonStyle,
								onClick: () => {
									setConfirming(false);
								},
								children: t("cancel")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: primaryButtonStyle,
								onClick: () => {
									detect();
								},
								children: t("probeConfirmAction")
							})]
						})]
					}),
					note === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						role: "status",
						"aria-live": "polite",
						style: noteStyle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: noteText(t, note) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: noteDismissStyle,
							onClick: () => {
								setNote(void 0);
							},
							children: t("probeNoteDismiss")
						})]
					})
				]
			});
		}
		/** Compose the one-line outcome string the note bubble shows. */
		function noteText(t, result) {
			if (result.validation === "validating" && result.efforts.length > 0) return t("probeNoteVerified", { levels: result.efforts.join(" / ") });
			if (result.validation === "non-validating") return t("probeNoteNotValidating");
			return t("probeNoteUnknown");
		}
		//#endregion
		//#region src/client/qr-code.ts
		/** Mode indicator for 8-bit byte mode. */
		const MODE_BYTE = 4;
		/**
		* Data capacity, in bytes, for levels M by version (1-20), byte mode.
		*
		* From the Model 2 capacity tables: total codewords minus the error-correction
		* codewords for that version, minus the mode/length header, rounded down. Held
		* as a table because the block structures below are also tabulated and driving
		* one from the other invites an off-by-one that only shows up at one version.
		*/
		const BYTE_CAPACITY_M = [
			14,
			26,
			42,
			62,
			84,
			106,
			122,
			152,
			180,
			213,
			251,
			287,
			331,
			362,
			412,
			450,
			504,
			560,
			624,
			666
		];
		const BLOCKS_M = [
			{
				ecPerBlock: 10,
				groups: [[1, 16]]
			},
			{
				ecPerBlock: 16,
				groups: [[1, 28]]
			},
			{
				ecPerBlock: 26,
				groups: [[1, 44]]
			},
			{
				ecPerBlock: 18,
				groups: [[2, 32]]
			},
			{
				ecPerBlock: 24,
				groups: [[2, 43]]
			},
			{
				ecPerBlock: 16,
				groups: [[4, 27]]
			},
			{
				ecPerBlock: 18,
				groups: [[4, 31]]
			},
			{
				ecPerBlock: 22,
				groups: [[2, 38], [2, 39]]
			},
			{
				ecPerBlock: 22,
				groups: [[3, 36], [2, 37]]
			},
			{
				ecPerBlock: 26,
				groups: [[4, 43], [1, 44]]
			},
			{
				ecPerBlock: 30,
				groups: [[1, 50], [4, 51]]
			},
			{
				ecPerBlock: 22,
				groups: [[6, 36], [2, 37]]
			},
			{
				ecPerBlock: 22,
				groups: [[8, 37], [1, 38]]
			},
			{
				ecPerBlock: 24,
				groups: [[4, 40], [5, 41]]
			},
			{
				ecPerBlock: 24,
				groups: [[5, 41], [5, 42]]
			},
			{
				ecPerBlock: 28,
				groups: [[7, 45], [3, 46]]
			},
			{
				ecPerBlock: 28,
				groups: [[10, 46], [1, 47]]
			},
			{
				ecPerBlock: 26,
				groups: [[9, 43], [4, 44]]
			},
			{
				ecPerBlock: 26,
				groups: [[3, 44], [11, 45]]
			},
			{
				ecPerBlock: 26,
				groups: [[3, 41], [13, 42]]
			}
		];
		/**
		* Alignment pattern centre coordinates per version.
		*
		* The spec's own table; the arithmetic rule that generates it has exceptions at
		* the low versions and the table is shorter to read than the rule.
		*/
		const ALIGNMENT_CENTRES = [
			[],
			[6, 18],
			[6, 22],
			[6, 26],
			[6, 30],
			[6, 34],
			[
				6,
				22,
				38
			],
			[
				6,
				24,
				42
			],
			[
				6,
				26,
				46
			],
			[
				6,
				28,
				50
			],
			[
				6,
				30,
				54
			],
			[
				6,
				32,
				58
			],
			[
				6,
				34,
				62
			],
			[
				6,
				26,
				46,
				66
			],
			[
				6,
				26,
				48,
				70
			],
			[
				6,
				26,
				50,
				74
			],
			[
				6,
				30,
				54,
				78
			],
			[
				6,
				30,
				56,
				82
			],
			[
				6,
				30,
				58,
				86
			],
			[
				6,
				34,
				62,
				90
			]
		];
		function encodeQrCode(text, options = {}) {
			const bytes = new TextEncoder().encode(text);
			const version = smallestVersion(bytes.length);
			if (version === void 0) throw new Error(`QR payload of ${String(bytes.length)} bytes exceeds the supported capacity`);
			const size = version * 4 + 17;
			return {
				size,
				modules: placeCodewords(buildCodewords(bytes, version), version, size, options.mask)
			};
		}
		/** The lowest version whose level-M byte capacity fits, or undefined. */
		function smallestVersion(byteLength) {
			for (let index = 0; index < BYTE_CAPACITY_M.length; index += 1) if (byteLength <= BYTE_CAPACITY_M[index]) return index + 1;
		}
		/**
		* The final codeword sequence: mode + length + data + terminator + padding,
		* split into blocks, each block extended with its own Reed–Solomon codewords,
		* then interleaved in the spec's order.
		*/
		function buildCodewords(bytes, version) {
			const layout = BLOCKS_M[version - 1];
			const totalData = layout.groups.reduce((sum, [count, per]) => sum + count * per, 0);
			const bits = [];
			pushBits(bits, MODE_BYTE, 4);
			pushBits(bits, bytes.length, version < 10 ? 8 : 16);
			for (const byte of bytes) pushBits(bits, byte, 8);
			const capacityBits = totalData * 8;
			pushBits(bits, 0, Math.min(4, capacityBits - bits.length));
			pushBits(bits, 0, (8 - bits.length % 8) % 8);
			const data = [];
			for (let index = 0; index < bits.length; index += 8) {
				let value = 0;
				for (let offset = 0; offset < 8; offset += 1) value = value << 1 | (bits[index + offset] ?? 0);
				data.push(value);
			}
			const PAD = [236, 17];
			for (let index = 0; data.length < totalData; index += 1) data.push(PAD[index % 2]);
			const blocks = [];
			let cursor = 0;
			for (const [count, per] of layout.groups) for (let block = 0; block < count; block += 1) {
				blocks.push(data.slice(cursor, cursor + per));
				cursor += per;
			}
			const ecBlocks = blocks.map((block) => reedSolomon(block, layout.ecPerBlock));
			const out = [];
			const maxData = Math.max(...blocks.map((block) => block.length));
			for (let index = 0; index < maxData; index += 1) for (const block of blocks) {
				const value = block[index];
				if (value !== void 0) out.push(value);
			}
			for (let index = 0; index < layout.ecPerBlock; index += 1) for (const block of ecBlocks) {
				const value = block[index];
				if (value !== void 0) out.push(value);
			}
			return out;
		}
		/** Append the low `count` bits of `value`, most significant first. */
		function pushBits(bits, value, count) {
			for (let shift = count - 1; shift >= 0; shift -= 1) bits.push(value >> shift & 1);
		}
		/**
		* Reed–Solomon codewords over GF(256) with the QR primitive polynomial 0x11d.
		*
		* The remainder of the message times `x^ecLength` divided by the generator
		* polynomial, computed with the shift register the spec describes.
		*/
		function reedSolomon(data, ecLength) {
			const generator = generatorPolynomial(ecLength).slice(1);
			const remainder = new Array(ecLength).fill(0);
			for (const byte of data) {
				const factor = byte ^ remainder[0];
				remainder.shift();
				remainder.push(0);
				for (let index = 0; index < ecLength; index += 1) remainder[index] = remainder[index] ^ gfMultiply(factor, generator[index]);
			}
			return remainder;
		}
		/**
		* The degree-`ecLength` generator polynomial, as coefficients with the leading
		* 1 dropped: `(x - a^0)(x - a^1)...(x - a^(ecLength-1))`.
		*/
		function generatorPolynomial(ecLength) {
			let polynomial = [1];
			for (let index = 0; index < ecLength; index += 1) {
				const next = new Array(polynomial.length + 1).fill(0);
				for (let term = 0; term < polynomial.length; term += 1) {
					next[term] = next[term] ^ polynomial[term];
					next[term + 1] = next[term + 1] ^ gfMultiply(polynomial[term], gfPower(index));
				}
				polynomial = next;
			}
			return polynomial;
		}
		/** Multiply two GF(256) elements modulo the QR primitive polynomial. */
		function gfMultiply(left, right) {
			let result = 0;
			let a = left;
			let b = right;
			while (b > 0) {
				if ((b & 1) === 1) result ^= a;
				a <<= 1;
				if (a > 255) a ^= 285;
				b >>= 1;
			}
			return result;
		}
		/** `2` raised to the `power`-th in GF(256), used to build the generator. */
		function gfPower(power) {
			let value = 1;
			for (let index = 0; index < power; index += 1) value = gfMultiply(value, 2);
			return value;
		}
		function placeCodewords(codewords, version, size, forced) {
			if (forced !== void 0) {
				const matrix = new Matrix(size);
				drawFunctionPatterns(matrix, version);
				drawCodewords(matrix, codewords);
				applyMask(matrix, forced);
				drawFormatBits(matrix, forced);
				return matrix.modules.slice();
			}
			const matrix = new Matrix(size);
			drawFunctionPatterns(matrix, version);
			drawCodewords(matrix, codewords);
			let best;
			let bestScore = Number.POSITIVE_INFINITY;
			for (let mask = 0; mask < 8; mask += 1) {
				const candidate = new Matrix(size);
				drawFunctionPatterns(candidate, version);
				drawCodewords(candidate, codewords);
				applyMask(candidate, mask);
				drawFormatBits(candidate, mask);
				const score = penalty(candidate);
				if (score < bestScore) {
					bestScore = score;
					best = candidate.modules.slice();
				}
			}
			if (best === void 0) throw new Error("QR mask selection produced no candidate");
			return best;
		}
		/** A square of modules with typed access, so the builder reads as coordinates. */
		var Matrix = class {
			size;
			modules;
			/** Which modules are function patterns and must not be masked or overwritten. */
			reserved;
			constructor(size) {
				this.size = size;
				this.modules = new Array(size * size).fill(false);
				this.reserved = new Array(size * size).fill(false);
			}
			get(x, y) {
				return this.modules[y * this.size + x] === true;
			}
			set(x, y, dark) {
				if (x < 0 || y < 0 || x >= this.size || y >= this.size) return;
				this.modules[y * this.size + x] = dark;
			}
			mark(x, y) {
				if (x < 0 || y < 0 || x >= this.size || y >= this.size) return;
				this.reserved[y * this.size + x] = true;
			}
		};
		/** Finder patterns, separators, timing, alignment, and the dark module. */
		function drawFunctionPatterns(matrix, version) {
			const size = matrix.size;
			for (const [originX, originY] of [
				[0, 0],
				[size - 7, 0],
				[0, size - 7]
			]) for (let y = -1; y <= 7; y += 1) for (let x = -1; x <= 7; x += 1) {
				const px = originX + x;
				const py = originY + y;
				const inside = x >= 0 && x <= 6 && y >= 0 && y <= 6;
				const edge = inside && (x === 0 || x === 6 || y === 0 || y === 6);
				const core = x >= 2 && x <= 4 && y >= 2 && y <= 4;
				matrix.set(px, py, inside && (edge || core));
				matrix.mark(px, py);
			}
			for (let index = 8; index < size - 8; index += 1) {
				const dark = index % 2 === 0;
				matrix.set(index, 6, dark);
				matrix.mark(index, 6);
				matrix.set(6, index, dark);
				matrix.mark(6, index);
			}
			const centres = ALIGNMENT_CENTRES[version - 1];
			for (const centreY of centres) for (const centreX of centres) {
				if (centreX === 6 && centreY === 6 || centreX === 6 && centreY === size - 7 || centreX === size - 7 && centreY === 6) continue;
				for (let y = -2; y <= 2; y += 1) for (let x = -2; x <= 2; x += 1) {
					const dark = Math.max(Math.abs(x), Math.abs(y)) !== 1;
					matrix.set(centreX + x, centreY + y, dark);
					matrix.mark(centreX + x, centreY + y);
				}
			}
			reserveFormatAreas(matrix, version);
			matrix.set(8, size - 8, true);
			matrix.mark(8, size - 8);
		}
		/** Mark the format/version modules as reserved so data never lands on them. */
		function reserveFormatAreas(matrix, version) {
			const size = matrix.size;
			for (let index = 0; index < 9; index += 1) {
				matrix.mark(index, 8);
				matrix.mark(8, index);
			}
			for (let index = 0; index < 8; index += 1) {
				matrix.mark(size - 1 - index, 8);
				matrix.mark(8, size - 1 - index);
			}
			if (version >= 7) for (let y = 0; y < 6; y += 1) for (let x = size - 11; x < size - 8; x += 1) {
				matrix.mark(x, y);
				matrix.mark(y, x);
			}
		}
		/**
		* Walk the symbol in the spec's zigzag — right to left in two-column pairs,
		* alternating upward and downward — placing the codeword bits.
		*/
		function drawCodewords(matrix, codewords) {
			const size = matrix.size;
			let bitIndex = 0;
			let upward = true;
			for (let right = size - 1; right >= 1; right -= 2) {
				if (right === 6) right = 5;
				for (let step = 0; step < size; step += 1) {
					const y = upward ? size - 1 - step : step;
					for (const x of [right, right - 1]) {
						if (matrix.reserved[y * size + x] === true) continue;
						const byte = codewords[bitIndex >> 3];
						const dark = byte === void 0 ? false : (byte >> 7 - (bitIndex & 7) & 1) === 1;
						matrix.set(x, y, dark);
						bitIndex += 1;
					}
				}
				upward = !upward;
			}
		}
		/** XOR the mask pattern over every non-function module. */
		function applyMask(matrix, mask) {
			const size = matrix.size;
			for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
				if (matrix.reserved[y * size + x] === true) continue;
				if (!maskApplies(mask, x, y)) continue;
				matrix.modules[y * size + x] = !matrix.get(x, y);
			}
		}
		/** The eight mask conditions of the spec, by index. */
		function maskApplies(mask, x, y) {
			switch (mask) {
				case 0: return (x + y) % 2 === 0;
				case 1: return y % 2 === 0;
				case 2: return x % 3 === 0;
				case 3: return (x + y) % 3 === 0;
				case 4: return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
				case 5: return x * y % 2 + x * y % 3 === 0;
				case 6: return (x * y % 2 + x * y % 3) % 2 === 0;
				case 7: return ((x + y) % 2 + x * y % 3) % 2 === 0;
				default: return false;
			}
		}
		/** Write the format information for `mask` (and the version blocks, if any). */
		function drawFormatBits(matrix, mask) {
			const size = matrix.size;
			const data = 0 | mask;
			let shifted = data << 10;
			for (let index = 14; index >= 10; index -= 1) if ((shifted >> index & 1) === 1) shifted ^= 1335 << index - 10;
			const bits = (data << 10 | shifted) ^ 21522;
			const bit = (index) => (bits >> index & 1) === 1;
			for (let index = 0; index <= 5; index += 1) matrix.set(8, index, bit(index));
			matrix.set(8, 7, bit(6));
			matrix.set(8, 8, bit(7));
			matrix.set(7, 8, bit(8));
			for (let index = 9; index <= 14; index += 1) matrix.set(14 - index, 8, bit(index));
			for (let index = 0; index <= 7; index += 1) matrix.set(size - 1 - index, 8, bit(index));
			for (let index = 8; index <= 14; index += 1) matrix.set(8, size - 15 + index, bit(index));
			matrix.set(8, size - 8, true);
			const version = (size - 17) / 4;
			if (version < 7) return;
			let versionRemainder = version;
			for (let index = 0; index < 12; index += 1) versionRemainder = versionRemainder << 1 ^ (versionRemainder >> 11 & 1) * 7973;
			const versionBits = version << 12 | versionRemainder;
			for (let index = 0; index < 18; index += 1) {
				const dark = (versionBits >> index & 1) === 1;
				const a = Math.floor(index / 3);
				const b = index % 3;
				matrix.set(size - 11 + b, a, dark);
				matrix.set(a, size - 11 + b, dark);
			}
		}
		/** The spec's four penalty rules, summed. Lower is a better mask. */
		function penalty(matrix) {
			const size = matrix.size;
			let score = 0;
			for (let y = 0; y < size; y += 1) {
				let runColour = matrix.get(0, y);
				let runLength = 1;
				for (let x = 1; x < size; x += 1) {
					const colour = matrix.get(x, y);
					if (colour === runColour) runLength += 1;
					else {
						if (runLength >= 5) score += runLength - 2;
						runColour = colour;
						runLength = 1;
					}
				}
				if (runLength >= 5) score += runLength - 2;
			}
			for (let x = 0; x < size; x += 1) {
				let runColour = matrix.get(x, 0);
				let runLength = 1;
				for (let y = 1; y < size; y += 1) {
					const colour = matrix.get(x, y);
					if (colour === runColour) runLength += 1;
					else {
						if (runLength >= 5) score += runLength - 2;
						runColour = colour;
						runLength = 1;
					}
				}
				if (runLength >= 5) score += runLength - 2;
			}
			for (let y = 0; y < size - 1; y += 1) for (let x = 0; x < size - 1; x += 1) {
				const colour = matrix.get(x, y);
				if (colour === matrix.get(x + 1, y) && colour === matrix.get(x, y + 1) && colour === matrix.get(x + 1, y + 1)) score += 3;
			}
			const DARK_LIGHT_RUN = 1488;
			const LIGHT_DARK_RUN = 93;
			for (let y = 0; y < size; y += 1) {
				let across = 0;
				let down = 0;
				for (let index = 0; index < size; index += 1) {
					across = across << 1 & 2047 | (matrix.get(index, y) ? 1 : 0);
					if (index >= 10 && (across === DARK_LIGHT_RUN || across === LIGHT_DARK_RUN)) score += 40;
					down = down << 1 & 2047 | (matrix.get(y, index) ? 1 : 0);
					if (index >= 10 && (down === DARK_LIGHT_RUN || down === LIGHT_DARK_RUN)) score += 40;
				}
			}
			let dark = 0;
			for (const module of matrix.modules) if (module) dark += 1;
			const steps = Math.abs(Math.ceil(dark * 100 / (size * size) / 5) - 10);
			score += steps * 10;
			return score;
		}
		//#endregion
		//#region src/client/segmented.tsx
		/**
		* The two-or-more-way segmented switch, with a sliding selection.
		*
		* One component for every switch in this plugin — the sign-in method, and a
		* model's context length — because they are the same control: a small set of
		* mutually exclusive choices where the selection is what matters, not the
		* buttons. Keeping one implementation is also what makes the motion consistent;
		* two copies would drift the first time one of them was adjusted.
		*
		* The selection is an absolutely positioned pill that translates between slots,
		* rather than each button painting its own background. That is what makes the
		* movement read as *the selection moving* instead of one thing vanishing and
		* another appearing, and it is why the pill is measured from the buttons rather
		* than given an equal share of the track: the buttons size themselves to their
		* labels, so equal shares would drift out of alignment.
		*
		* @module dsh-workbuddy-connect/client/segmented
		*/
		const trackStyle = {
			position: "relative",
			display: "inline-flex",
			alignItems: "stretch",
			padding: 3,
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 999,
			background: "var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.05))",
			overflow: "hidden"
		};
		const itemStyle = {
			position: "relative",
			zIndex: 1,
			border: 0,
			borderRadius: 999,
			background: "transparent",
			color: "var(--dsw-alias-label-secondary)",
			fontFamily: "inherit",
			cursor: "pointer",
			whiteSpace: "nowrap",
			transition: "color 160ms ease"
		};
		/**
		* The moving selection.
		*
		* Colour and shadow live here so the buttons stay flat; only the text colour
		* changes on the selected one, which is what lets the pill animate underneath
		* without the label flashing.
		*/
		const pillStyle = {
			position: "absolute",
			top: 3,
			bottom: 3,
			zIndex: 0,
			borderRadius: 999,
			background: "var(--dsw-alias-bg-layer-1, #fff)",
			boxShadow: "var(--dsw-shadow-lv1, 0 1px 2px rgba(0, 0, 0, 0.08))",
			transition: "transform 220ms cubic-bezier(0.4, 0, 0.2, 1), width 220ms cubic-bezier(0.4, 0, 0.2, 1)"
		};
		/** Whether the user has asked for less motion. */
		function prefersReducedMotion() {
			try {
				return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
			} catch {
				return false;
			}
		}
		function SegmentedControl({ options, value, onChange, label, disabled, dense, block }) {
			const trackRef = (0, react.useRef)(null);
			/** The selected slot's geometry within the track, in px. */
			const [pill, setPill] = (0, react.useState)();
			const [animate, setAnimate] = (0, react.useState)(false);
			const selectedIndex = options.findIndex((option) => option.value === value);
			/**
			* Measure the selected button.
			*
			* `useLayoutEffect` rather than an effect: measuring after paint would show
			* the pill at its previous position for one frame on first render, which reads
			* as a flicker. The measurement is repeated on resize because the labels'
			* widths depend on the font the browser actually resolved.
			*/
			(0, react.useLayoutEffect)(() => {
				const track = trackRef.current;
				if (track === null) return;
				const measure = () => {
					const button = [...track.querySelectorAll("button")][selectedIndex];
					if (button === void 0) return;
					setPill({
						left: button.offsetLeft,
						width: button.offsetWidth
					});
				};
				measure();
				if (typeof ResizeObserver === "undefined") return;
				const observer = new ResizeObserver(measure);
				observer.observe(track);
				return () => {
					observer.disconnect();
				};
			}, [
				selectedIndex,
				options,
				dense,
				block
			]);
			(0, react.useEffect)(() => {
				if (pill === void 0) return;
				const timer = window.setTimeout(() => {
					setAnimate(true);
				}, 30);
				return () => {
					window.clearTimeout(timer);
				};
			}, [pill === void 0]);
			const reduced = prefersReducedMotion();
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref: trackRef,
				role: "radiogroup",
				"aria-label": label,
				style: {
					...trackStyle,
					...block === true ? { display: "flex" } : {},
					...disabled === true ? { opacity: .6 } : {}
				},
				children: [pill === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					"aria-hidden": "true",
					style: {
						...pillStyle,
						transform: `translateX(${String(pill.left - 3)}px)`,
						width: pill.width,
						...animate && !reduced ? {} : { transition: "none" }
					}
				}), options.map((option, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					role: "radio",
					"aria-checked": index === selectedIndex,
					"aria-label": option.title ?? option.label,
					disabled: disabled === true,
					onClick: () => {
						if (index !== selectedIndex) onChange(option.value);
					},
					style: {
						...itemStyle,
						...dense === true ? {
							padding: "2px 10px",
							fontSize: 12,
							lineHeight: "18px"
						} : {
							padding: "5px 18px",
							fontSize: 13,
							lineHeight: "18px"
						},
						...block === true ? { flex: 1 } : {},
						...index === selectedIndex ? {
							color: "var(--dsw-alias-label-primary)",
							fontWeight: 600
						} : {}
					},
					children: option.label
				}, String(option.value)))]
			});
		}
		//#endregion
		//#region src/client/WorkBuddySettingsPage.tsx
		/**
		* The WorkBuddy settings page: every pooled account, for both products, with
		* the total credit each product has left.
		*
		* Why this is a settings *page* rather than a card in the Plugins tab: the two
		* products together are a resource the user checks and acts on — add an
		* account, see what is left, delete one that lapsed — and that is a destination,
		* not a footnote under a plugin list. The Plugins tab keeps the plugin's own
		* card; this page is where the accounts live.
		*
		* Layout, per product:
		*
		*   [grey heading  WorkBuddy]                     [+ Add account]
		*   [account rows: name, balance, test, remove]
		*   [total credit]
		*
		* The two products stay separate all the way down — separate pools, separate
		* totals — because a sum across them would be a number that describes nothing:
		* the credits are not convertible and the accounts are not interchangeable.
		*
		* @module dsh-workbuddy-connect/client/settings-page
		*/
		/** How often a QR challenge is checked. */
		const POLL_INTERVAL_MS = 2e3;
		/** How often the page re-reads both products while it is open. */
		const REFRESH_INTERVAL_MS = 6e4;
		const pageStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 16,
			padding: "4px 0 24px"
		};
		const cardStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 18,
			padding: "18px 20px 20px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 14,
			background: "var(--dsw-alias-bg-module-platform)"
		};
		const groupStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 10
		};
		const groupHeadStyle = {
			display: "flex",
			alignItems: "center",
			justifyContent: "space-between",
			gap: 12
		};
		/**
		* The product heading. Deliberately small, grey, and unprominent: it labels a
		* block inside one card, and a full-size heading here would read as a second
		* card boundary.
		*/
		const groupTitleStyle = {
			margin: 0,
			fontSize: 12,
			lineHeight: "18px",
			fontWeight: 600,
			letterSpacing: .2,
			color: "var(--dsw-alias-label-tertiary)"
		};
		const rowStyle = {
			display: "flex",
			alignItems: "center",
			justifyContent: "space-between",
			gap: 12,
			padding: "9px 12px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 10,
			background: "var(--dsw-alias-bg-layer-1)"
		};
		const rowMainStyle = {
			display: "flex",
			alignItems: "center",
			gap: 8,
			minWidth: 0
		};
		const dotStyle = {
			width: 8,
			height: 8,
			borderRadius: "50%",
			flex: "0 0 auto"
		};
		const nameStyle = {
			fontSize: 14,
			lineHeight: "20px",
			color: "var(--dsw-alias-label-primary)",
			overflow: "hidden",
			textOverflow: "ellipsis",
			whiteSpace: "nowrap"
		};
		const balanceStyle = {
			fontSize: 13,
			lineHeight: "20px",
			fontVariantNumeric: "tabular-nums",
			color: "var(--dsw-alias-label-secondary)",
			whiteSpace: "nowrap"
		};
		const metaStyle = {
			fontSize: 12,
			lineHeight: "18px",
			color: "var(--dsw-alias-label-tertiary)"
		};
		/** A promotional or "free" chip beside a model name. */
		const badgeStyle = {
			flex: "0 0 auto",
			padding: "1px 8px",
			borderRadius: 999,
			fontSize: 11,
			lineHeight: "18px",
			background: "var(--dsw-alias-state-success-subtle, rgba(34, 160, 107, 0.12))",
			color: "var(--dsw-alias-state-success-primary, #22a06b)",
			whiteSpace: "nowrap"
		};
		const rowEndStyle = {
			display: "inline-flex",
			alignItems: "center",
			gap: 6,
			flex: "0 0 auto"
		};
		const buttonStyle = {
			boxSizing: "border-box",
			minHeight: 30,
			padding: "4px 12px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 15,
			background: "var(--dsw-alias-bg-layer-1)",
			color: "var(--dsw-alias-label-primary)",
			font: "inherit",
			fontSize: 13,
			lineHeight: "18px",
			cursor: "pointer",
			whiteSpace: "nowrap"
		};
		const dangerStyle = {
			...buttonStyle,
			color: "var(--dsw-alias-state-error-primary, #d92d20)"
		};
		const primaryStyle = {
			...buttonStyle,
			border: "1px solid var(--dsw-alias-button-primary-fill)",
			background: "var(--dsw-alias-button-primary-fill)",
			color: "var(--dsw-alias-label-primary-foreground)"
		};
		const totalRowStyle = {
			display: "flex",
			alignItems: "baseline",
			justifyContent: "space-between",
			gap: 12,
			paddingTop: 10,
			borderTop: "1px solid var(--dsw-alias-border-l2)"
		};
		const totalLabelStyle = {
			fontSize: 12,
			lineHeight: "18px",
			color: "var(--dsw-alias-label-tertiary)"
		};
		const totalValueStyle = {
			fontSize: 20,
			lineHeight: "26px",
			fontWeight: 600,
			fontVariantNumeric: "tabular-nums",
			color: "var(--dsw-alias-label-primary)"
		};
		const overlayStyle = {
			position: "fixed",
			inset: 0,
			zIndex: 4e3,
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			padding: 24,
			background: "rgba(0, 0, 0, 0.45)"
		};
		const dialogStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 14,
			width: "min(400px, 100%)",
			maxHeight: "100%",
			overflowY: "auto",
			padding: "18px 18px 16px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 14,
			background: "var(--dsw-alias-bg-layer-1, #fff)",
			boxShadow: "var(--dsw-shadow-lv2)",
			color: "var(--dsw-alias-label-primary)"
		};
		const dialogTitleStyle = {
			margin: 0,
			fontSize: 16,
			lineHeight: "24px",
			fontWeight: 600,
			textAlign: "center"
		};
		const dialogBodyStyle = {
			margin: 0,
			fontSize: 13,
			lineHeight: "20px",
			color: "var(--dsw-alias-label-secondary)"
		};
		const dialogActionsStyle = {
			display: "flex",
			justifyContent: "flex-end",
			gap: 8
		};
		const qrFrameStyle = {
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			padding: 12,
			borderRadius: 10,
			background: "#fff"
		};
		const tokenAreaStyle = {
			boxSizing: "border-box",
			width: "100%",
			minHeight: 96,
			padding: "10px 12px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 10,
			background: "var(--dsw-alias-bg-module-platform)",
			color: "var(--dsw-alias-label-primary)",
			font: "inherit",
			fontSize: 12,
			lineHeight: "18px",
			fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
			resize: "vertical",
			wordBreak: "break-all"
		};
		/**
		* Paint a QR symbol into a canvas.
		*
		* An integer number of device pixels per module: a fractional scale softens the
		* module edges, which is the one thing that makes a camera struggle to lock on.
		*/
		function QrCanvas({ text, modulePixels }) {
			const ref = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				const canvas = ref.current;
				if (canvas === null) return;
				let code;
				try {
					code = encodeQrCode(text);
				} catch {
					return;
				}
				const ratio = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
				const moduleSize = Math.max(1, Math.floor(modulePixels * ratio / code.size));
				const side = moduleSize * code.size;
				canvas.width = side;
				canvas.height = side;
				canvas.style.width = `${String(Math.round(side / ratio))}px`;
				canvas.style.height = `${String(Math.round(side / ratio))}px`;
				const context = canvas.getContext("2d");
				if (context === null) return;
				context.fillStyle = "#fff";
				context.fillRect(0, 0, side, side);
				context.fillStyle = "#000";
				for (let y = 0; y < code.size; y += 1) for (let x = 0; x < code.size; x += 1) {
					if (code.modules[y * code.size + x] !== true) continue;
					context.fillRect(x * moduleSize, y * moduleSize, moduleSize, moduleSize);
				}
			}, [text, modulePixels]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("canvas", {
				ref,
				role: "img",
				"aria-label": "QR",
				style: { display: "block" }
			});
		}
		/** The dot's colour: what rotation thinks of this account right now. */
		function statusColor(account, now) {
			if (account.sessionDead === true || account.enabled !== true) return "var(--dsw-alias-label-dimmed, #9aa0a6)";
			const cooldown = account.cooldown;
			if (cooldown !== void 0 && cooldown.untilMs > now) return "var(--dsw-alias-state-warning-primary, #b45309)";
			return "var(--dsw-alias-state-success-primary, #22a06b)";
		}
		/** One account row: name, balance, and the two things you can do to it. */
		function AccountRow({ account, busy, now, t, onAction }) {
			const cooldown = account.cooldown;
			const waiting = cooldown !== void 0 && cooldown.untilMs > now;
			const expired = account.expiresAtMs > 0 && account.expiresAtMs <= now && account.renewable !== true;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: rowStyle,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					style: rowMainStyle,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						"aria-hidden": "true",
						style: {
							...dotStyle,
							background: statusColor(account, now)
						}
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: nameStyle,
						title: account.name,
						children: account.name
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					style: rowEndStyle,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: waiting ? {
								...balanceStyle,
								color: "var(--dsw-alias-state-warning-primary, #b45309)"
							} : balanceStyle,
							children: waiting ? t("accountStateWaiting", {
								reason: t(cooldown?.reason === "credit" ? "accountStateExhausted" : cooldown?.reason === "session" ? "accountStateSessionDead" : "accountStateLimited"),
								minutes: Math.max(1, Math.ceil(((cooldown?.untilMs ?? 0) - now) / 6e4))
							}) : expired ? t("accountExpired") : account.credits === void 0 ? t("accountCreditsPending") : t("accountCredits", { total: new Intl.NumberFormat(void 0).format(account.credits) })
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: buttonStyle,
							disabled: busy,
							onClick: () => {
								onAction({
									action: "test",
									id: account.id
								});
							},
							children: t("accountTest")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: dangerStyle,
							disabled: busy,
							onClick: () => {
								if (window.confirm(t("accountRemoveConfirm", { name: account.name }))) onAction({
									action: "remove",
									id: account.id
								});
							},
							children: t("accountRemove")
						})
					]
				})]
			});
		}
		/** A token count as the switch's label: 1M reads better than 1000000. */
		function shortTokens(tokens) {
			if (tokens >= 1e6 && tokens % 1e6 === 0) return `${String(tokens / 1e6)}M`;
			if (tokens >= 1e3 && tokens % 1e3 === 0) return `${String(tokens / 1e3)}K`;
			return String(tokens);
		}
		/**
		* The model list for one product, with a context-length switch where there is a
		* choice and a detection button per model.
		*
		* The switch is the reason this block is not read-only: a model the upstream
		* publishes several windows for runs at whichever one is selected, which is what
		* lets a long transcript continue. It is a write, so it goes through the same
		* key-bearing route the account actions use.
		*/
		function ModelsBlock({ variant, status, busy, t, onContext, onRefresh }) {
			const signedIn = status !== void 0 && status.status === "signed-in" ? status : void 0;
			const models = signedIn?.models ?? [];
			const catalog = signedIn?.catalog;
			const format = new Intl.DateTimeFormat(void 0, {
				dateStyle: "short",
				timeStyle: "short"
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: groupStyle,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: groupHeadStyle,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("h3", {
						style: groupTitleStyle,
						children: [t("modelsHeading"), models.length === 0 ? "" : ` · ${t("modelsCount", { count: models.length })}`]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						style: rowEndStyle,
						children: [catalog === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: metaStyle,
							children: catalog.source === "live" && catalog.fetchedAt !== void 0 ? t("modelsSourceLive", { time: format.format(new Date(catalog.fetchedAt)) }) : catalog.source === "saved" && catalog.fetchedAt !== void 0 ? t("modelsSourceSaved", { time: format.format(new Date(catalog.fetchedAt)) }) : t("modelsSourceFallback")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: buttonStyle,
							disabled: busy,
							onClick: onRefresh,
							children: t("modelsRefresh")
						})]
					})]
				}), models.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					style: metaStyle,
					children: t("modelsEmpty")
				}) : models.map((model) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: rowStyle,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						style: rowMainStyle,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: nameStyle,
								title: model.name,
								children: model.name
							}),
							model.badges?.map((badge) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: badgeStyle,
								children: badge
							}, badge)),
							model.free === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: badgeStyle,
								children: t("freeModel")
							}) : null,
							model.credits === void 0 ? model.rateUnknown === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: metaStyle,
								children: t("rateUnknown")
							}) : null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: metaStyle,
								children: t("rate", { rate: model.credits })
							})
						]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: rowEndStyle,
						children: model.contextChoices === void 0 || model.contextChoices.length < 2 ? model.contextWindow === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: metaStyle,
							children: [
								t("contextHeading"),
								" ",
								shortTokens(model.contextWindow)
							]
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SegmentedControl, {
							dense: true,
							label: `${t("contextLabel")}: ${model.name}`,
							disabled: busy,
							value: model.contextChoice ?? model.contextChoices[0] ?? 0,
							options: model.contextChoices.map((length) => ({
								value: length,
								label: shortTokens(length),
								title: t("contextSwitchTitle", { size: shortTokens(length) })
							})),
							onChange: (length) => {
								onContext(model.id, length);
							}
						})
					})]
				}, model.id))]
			});
		}
		/** Everything one product's block contains. */
		function VariantBlock({ variant, status, busy, now, t, onAdd, onAction, onContext, onRefreshModels }) {
			const list = (status !== void 0 && "accounts" in status ? status.accounts : void 0)?.accounts ?? [];
			const known = list.map((account) => account.credits).filter((value) => typeof value === "number");
			const total = known.reduce((sum, value) => sum + value, 0);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: groupStyle,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: groupHeadStyle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							style: groupTitleStyle,
							children: t(variant.titleKey)
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: buttonStyle,
							disabled: busy,
							onClick: () => {
								onAdd(variant);
							},
							children: t("accountAdd")
						})]
					}),
					list.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: metaStyle,
						children: t("accountEmpty")
					}) : list.map((account) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AccountRow, {
						account,
						busy,
						now,
						t,
						onAction
					}, account.id)),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: totalRowStyle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: totalLabelStyle,
							children: t("accountTotalCredits")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: totalValueStyle,
							children: known.length === 0 ? "—" : new Intl.NumberFormat(void 0, { maximumFractionDigits: 1 }).format(total)
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelsBlock, {
						variant,
						status,
						busy,
						t,
						onContext,
						onRefresh: onRefreshModels
					})
				]
			});
		}
		/** The list a user picks a product from before the login dialog opens. */
		function ProductPicker({ t, onPick, onCancel }) {
			return (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: overlayStyle,
				role: "presentation",
				onClick: (event) => {
					if (event.target === event.currentTarget) onCancel();
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: dialogStyle,
					role: "dialog",
					"aria-modal": "true",
					"aria-label": t("accountAddTitle"),
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							style: dialogTitleStyle,
							children: t("accountAddTitle")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: buttonStyle,
							onClick: () => {
								onPick(CARD_VARIANTS[0]);
							},
							children: t("accountAddCn")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: buttonStyle,
							onClick: () => {
								onPick(CARD_VARIANTS[1]);
							},
							children: t("accountAddAi")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: dialogActionsStyle,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: buttonStyle,
								onClick: onCancel,
								children: t("cancel")
							})
						})
					]
				})
			}), document.body);
		}
		/**
		* The sign-in dialog for one product.
		*
		* The CN product offers both routes; the international one offers only the
		* pasted token, because there is no app that can scan for it — the QR endpoint
		* answers, but there is nothing on the user's phone that completes it, so
		* showing the segment would be offering a path that cannot be walked.
		*/
		function AddAccountDialog({ variant, t, busy, error, onCancel, onSubmitQr, onPollQr, onSubmitToken }) {
			const qrSupported = variant.id === "workbuddy";
			const [mode, setMode] = (0, react.useState)(qrSupported ? "qr" : "token");
			const [challenge, setChallenge] = (0, react.useState)();
			const [token, setToken] = (0, react.useState)("");
			const [remaining, setRemaining] = (0, react.useState)(0);
			const stopped = (0, react.useRef)(false);
			/**
			* Whether this dialog has already asked for a challenge.
			*
			* A ref, not the `challenge` state: a failed `add` answers with no challenge
			* at all, so keying the effect on the state alone would re-run it on every
			* render the failure caused, firing `add` in a loop. The dialog asks once per
			* opening and offers the explicit actions below after that.
			*/
			const asked = (0, react.useRef)(false);
			(0, react.useEffect)(() => {
				if (mode !== "qr" || asked.current) return;
				asked.current = true;
				stopped.current = false;
				onSubmitQr().then((next) => {
					if (stopped.current || next === void 0) return;
					setChallenge(next);
				});
			}, [mode, onSubmitQr]);
			(0, react.useEffect)(() => {
				if (challenge === void 0) return;
				setRemaining(Math.max(0, challenge.expiresAtMs - Date.now()));
				const tick = window.setInterval(() => {
					setRemaining(Math.max(0, challenge.expiresAtMs - Date.now()));
				}, 1e3);
				return () => {
					window.clearInterval(tick);
				};
			}, [challenge]);
			(0, react.useEffect)(() => {
				if (challenge === void 0 || stopped.current) return;
				const poll = window.setInterval(() => {
					onPollQr(challenge.state).then((keep) => {
						if (!keep) stopped.current = true;
					});
				}, POLL_INTERVAL_MS);
				return () => {
					window.clearInterval(poll);
				};
			}, [challenge, onPollQr]);
			(0, react.useEffect)(() => {
				const onKey = (event) => {
					if (event.key === "Escape") onCancel();
				};
				window.addEventListener("keydown", onKey);
				return () => {
					window.removeEventListener("keydown", onKey);
				};
			}, [onCancel]);
			(0, react.useEffect)(() => () => {
				stopped.current = true;
			}, []);
			return (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: overlayStyle,
				role: "presentation",
				onClick: (event) => {
					if (event.target === event.currentTarget) onCancel();
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: dialogStyle,
					role: "dialog",
					"aria-modal": "true",
					"aria-label": t(variant.titleKey),
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							style: dialogTitleStyle,
							children: t("accountAddTitle")
						}),
						qrSupported ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								display: "flex",
								justifyContent: "center"
							},
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SegmentedControl, {
								label: t("accountActionLogin"),
								value: mode,
								options: [{
									value: "qr",
									label: t("accountLoginQr")
								}, {
									value: "token",
									label: t("accountLoginToken")
								}],
								onChange: setMode
							})
						}) : null,
						mode === "qr" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: dialogBodyStyle,
								children: t("accountAddBody")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: qrFrameStyle,
								children: challenge === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: metaStyle,
									children: t("loading")
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(QrCanvas, {
									text: challenge.authUrl,
									modulePixels: 232
								})
							}),
							challenge === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: dialogBodyStyle,
								children: t("accountAddWaiting", { seconds: Math.ceil(remaining / 1e3) })
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: dialogActionsStyle,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: buttonStyle,
									disabled: challenge === void 0,
									onClick: () => {
										if (challenge !== void 0) window.open(challenge.authUrl, "_blank", "noopener,noreferrer");
									},
									children: t("accountOpenLink")
								})
							})
						] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: dialogBodyStyle,
								children: t("accountTokenBody")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
								style: tokenAreaStyle,
								value: token,
								placeholder: t("accountTokenPlaceholder"),
								spellCheck: false,
								onChange: (event) => {
									setToken(event.target.value);
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: dialogActionsStyle,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: primaryStyle,
									disabled: busy || token.trim() === "",
									onClick: () => {
										onSubmitToken(token);
									},
									children: busy ? t("accountChecking") : t("accountSubmit")
								})
							})
						] }),
						error === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: {
								...dialogBodyStyle,
								color: "var(--dsw-alias-state-error-primary, #d92d20)"
							},
							children: error
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: dialogActionsStyle,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: buttonStyle,
								onClick: onCancel,
								children: t("cancel")
							})
						})
					]
				})
			}), document.body);
		}
		/**
		* The page itself: one card, two product blocks.
		*
		* Each product is driven by its own status document, so a failure or a slow
		* answer on one never blocks or blanks the other.
		*/
		function WorkBuddySettingsPage({ t }) {
			const [statuses, setStatuses] = (0, react.useState)({});
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)();
			const [picking, setPicking] = (0, react.useState)(false);
			const [adding, setAdding] = (0, react.useState)();
			const [now, setNow] = (0, react.useState)(() => Date.now());
			const mounted = (0, react.useRef)(true);
			(0, react.useEffect)(() => {
				mounted.current = true;
				return () => {
					mounted.current = false;
				};
			}, []);
			(0, react.useEffect)(() => {
				const tick = window.setInterval(() => {
					setNow(Date.now());
				}, 3e4);
				return () => {
					window.clearInterval(tick);
				};
			}, []);
			const readAll = (0, react.useCallback)(async (signal) => {
				const answers = await Promise.all(CARD_VARIANTS.map(async (variant) => {
					try {
						const response = await fetch(variant.statusPath, {
							headers: { accept: "application/json" },
							credentials: "same-origin",
							...signal === void 0 ? {} : { signal }
						});
						if (!response.ok) return void 0;
						return [variant.id, await response.json()];
					} catch {
						return;
					}
				}));
				if (!mounted.current || signal?.aborted === true) return;
				const next = {};
				for (const answer of answers) if (answer !== void 0) next[answer[0]] = answer[1];
				setStatuses(next);
			}, []);
			(0, react.useEffect)(() => {
				const controller = new AbortController();
				readAll(controller.signal);
				const tick = window.setInterval(() => {
					readAll(controller.signal);
				}, REFRESH_INTERVAL_MS);
				return () => {
					window.clearInterval(tick);
					controller.abort();
				};
			}, [readAll]);
			/** The control key, which the status documents hand out in both sign-in states. */
			const keyFor = (0, react.useCallback)((variant) => {
				const status = statuses[variant.id];
				return status !== void 0 && "probeKey" in status ? status.probeKey : void 0;
			}, [statuses]);
			const run = (0, react.useCallback)(async (variant, action) => {
				const key = keyFor(variant);
				if (key === void 0) {
					setError(t("requestFailed"));
					return;
				}
				const response = await fetch(variant.accountPath, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"X-WorkBuddy-Probe-Key": key
					},
					credentials: "same-origin",
					body: JSON.stringify(action)
				});
				const value = await response.json().catch(() => void 0);
				if (!response.ok) {
					const message = typeof value === "object" && value !== null && "error" in value ? String(value["error"]) : `HTTP ${String(response.status)}`;
					setError(message);
					return;
				}
				return value;
			}, [keyFor, t]);
			const submitQr = (0, react.useCallback)(async (variant) => {
				setError(void 0);
				setBusy(true);
				try {
					const result = await run(variant, { action: "add" });
					if (result?.challenge === void 0) {
						setError(result?.reason ?? t("requestFailed"));
						return;
					}
					return result.challenge;
				} finally {
					if (mounted.current) setBusy(false);
				}
			}, [run, t]);
			const pollQr = (0, react.useCallback)(async (variant, state) => {
				const result = await run(variant, {
					action: "poll",
					state
				});
				if (result === void 0) return false;
				if (result.state === "waiting") return true;
				if (result.state === "added") {
					setAdding(void 0);
					setError(void 0);
					await readAll();
					return false;
				}
				setError(result.reason ?? t(result.state === "expired" ? "accountQrExpired" : "accountQrInvalid"));
				return false;
			}, [
				readAll,
				run,
				t
			]);
			const submitToken = (0, react.useCallback)(async (variant, token) => {
				setError(void 0);
				setBusy(true);
				try {
					const result = await run(variant, {
						action: "add-cookie",
						token
					});
					if (result === void 0) return false;
					if (result.state !== "added") {
						setError(result.reason ?? t("requestFailed"));
						return false;
					}
					setAdding(void 0);
					await readAll();
					return true;
				} finally {
					if (mounted.current) setBusy(false);
				}
			}, [
				readAll,
				run,
				t
			]);
			/**
			* Ask the host to re-fetch this product's model list.
			*
			* Shares the probe route's `refresh` action rather than the account route:
			* the work is a catalog fetch, and that is what the probe route already does.
			*/
			const refreshModels = (0, react.useCallback)((variant) => {
				const key = keyFor(variant);
				if (key === void 0) return;
				setBusy(true);
				setError(void 0);
				fetch(variant.probePath, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"X-WorkBuddy-Probe-Key": key
					},
					credentials: "same-origin",
					body: JSON.stringify({ action: "refresh" })
				}).then(async (response) => {
					const value = await response.json().catch(() => void 0);
					if (!response.ok) setError(`HTTP ${String(response.status)}`);
					else if (typeof value === "object" && value !== null && "state" in value && value.state === "failed") setError(String(value["reason"] ?? t("requestFailed")));
					await readAll();
				}).catch((cause) => {
					setError(cause instanceof Error ? cause.message : t("requestFailed"));
				}).finally(() => {
					if (mounted.current) setBusy(false);
				});
			}, [
				keyFor,
				readAll,
				t
			]);
			const accountAction = (0, react.useCallback)((variant, action) => {
				setError(void 0);
				setBusy(true);
				run(variant, action).then(async (result) => {
					if (result === void 0) return;
					if (result.state === "failed") setError(result.reason ?? t("requestFailed"));
					else if (action.action === "test" && result.test !== void 0) setError(result.test.ok ? void 0 : `${t("accountTestFailed")}: ${result.test.message}`);
					await readAll();
				}).finally(() => {
					if (mounted.current) setBusy(false);
				});
			}, [
				readAll,
				run,
				t
			]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: pageStyle,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: cardStyle,
						children: CARD_VARIANTS.map((variant) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(VariantBlock, {
							variant,
							status: statuses[variant.id],
							busy,
							now,
							t,
							onAdd: () => {
								setError(void 0);
								setPicking(true);
							},
							onAction: (action) => {
								accountAction(variant, action);
							},
							onContext: (model, length) => {
								accountAction(variant, {
									action: "context",
									model,
									length
								});
							},
							onRefreshModels: () => {
								refreshModels(variant);
							}
						}, variant.id))
					}),
					error === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: {
							...metaStyle,
							color: "var(--dsw-alias-state-error-primary, #d92d20)"
						},
						children: error
					}),
					picking ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProductPicker, {
						t,
						onPick: (picked) => {
							setPicking(false);
							setAdding(picked);
						},
						onCancel: () => {
							setPicking(false);
						}
					}) : null,
					adding === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AddAccountDialog, {
						variant: adding,
						t,
						busy,
						...error === void 0 ? {} : { error },
						onCancel: () => {
							setAdding(void 0);
							setError(void 0);
						},
						onSubmitQr: () => submitQr(adding),
						onPollQr: (state) => pollQr(adding, state),
						onSubmitToken: (token) => submitToken(adding, token)
					})
				]
			});
		}
		//#endregion
		//#region src/client/locales.ts
		const en = {
			title: "DSH WorkBuddy Connect",
			intro: "Use the models in the WorkBuddy desktop app directly in DSH — zero configuration, ready out of the box.",
			titleAI: "DSH WorkBuddy AI Connect",
			introAI: "Use the models in the WorkBuddy AI international desktop app directly in DSH — zero configuration, ready out of the box.",
			expand: "Expand",
			collapse: "Collapse",
			loading: "Loading account…",
			signedOut: "Not signed in",
			signedOutHint: "Sign in once in the WorkBuddy desktop app; this plugin follows that sign-in automatically.",
			signedOutHintAI: "Sign in once in the WorkBuddy AI desktop app; this plugin follows that sign-in automatically.",
			signedInAs: "Signed in as {nickname}",
			accessTokenExpires: "Access token expires {time} (refresh is automatic)",
			creditsHeading: "Remaining credit",
			tabStatus: "Status",
			tabContext: "Context window",
			tabDetails: "Credit details",
			creditsDetailHeading: "By package",
			creditsTotal: "Total: {total}",
			percentRemaining: "{percent}% remaining",
			exactRemaining: "{remain} / {size} remaining",
			creditPackageUnknownSize: "{remain} remaining",
			creditsError: "Credit unavailable: {message}",
			refresh: "Refresh",
			refreshing: "Refreshing…",
			refreshModels: "Refresh model list",
			refreshingModels: "Refreshing models…",
			catalogLive: "Model list updated {time}",
			catalogSaved: "Showing the saved model list from {time}",
			catalogFallback: "Showing the built-in model list (not yet updated from WorkBuddy)",
			catalogError: "Last update failed: {message}",
			catalogAppVersion: "App version {version}",
			requestFailed: "Request failed",
			accountHeading: "Account",
			modelsOffersHeading: "Model offers",
			contextHeading: "Context window",
			contextUpTo: "up to {size}",
			freeModel: "Free",
			badgeLimitedFree: "Limited-time free",
			badgeNightDiscount: "Night discount",
			badgeFreeNow: "Free now",
			rate: "{rate} credits per message",
			rateUnknown: "Price unavailable — refresh to update",
			probeLabel: "Reasoning levels",
			probeTooltipIdle: "Detect the reasoning levels {model} accepts",
			probeTooltipVerified: "Accepted levels: {levels} · click to detect again",
			probeTooltipNotValidating: "This model does not check the effort parameter",
			probeTooltipRetry: "Detection did not complete · click to retry",
			probeBubbleBody: "Send test requests to confirm the available reasoning levels. May consume a small amount of credit.",
			probeConfirmAction: "Confirm",
			probeNoteVerified: "Detected: {levels}",
			probeNoteNotValidating: "This model does not check the effort parameter",
			probeNoteUnknown: "Detection did not complete",
			probeNoteDismiss: "Got it",
			probeHeading: "Reasoning effort detection",
			probeResultNoLevels: "No tested levels were accepted.",
			probeIntro: "Some models reason but declare no selectable effort levels. Detecting which levels a model accepts sends a few real requests that may consume credit.",
			probeConsentHint: "Each detection sends test requests to one model to confirm its available reasoning levels, and may consume a small amount of credit.",
			probeStart: "Detect",
			probeRedetect: "Detect again",
			probeRunning: "Detecting {model}…",
			probeRunningGeneric: "Detecting…",
			probeClear: "Clear detected results",
			probeCandidates: "Detectable models: {count}",
			probeConfirmBody: "Send test requests to {model} to confirm its available reasoning levels. May consume a small amount of credit.",
			cancel: "Cancel",
			probeResultVerified: "Verified levels: {levels}",
			probeResultNotValidating: "This model does not check the effort parameter",
			probeResultUnknown: "Detection did not complete",
			probeResultAt: "Detected {time}",
			probeResultEmpty: "No detectable models right now.",
			probeFailed: "Detection failed: {message}",
			tabAccounts: "Accounts",
			accountAdd: "Add by QR",
			accountAddTitle: "Scan to add an account",
			accountAddBody: "Open the mobile app, sign in, and scan this code. The account is added to the plugin only — it does not change the desktop app's sign-in.",
			accountAddWaiting: "Waiting for the scan… ({seconds}s left)",
			accountCheckNow: "Check now",
			accountChecking: "Checking…",
			accountQrExpired: "This code expired. Close the dialog and start again.",
			accountQrInvalid: "This sign-in is no longer valid. Start again.",
			accountEmpty: "No accounts yet. Sign in to the desktop app, or add one by QR.",
			accountUnavailable: "The host did not report its account pool. Update the plugin, or restart DSH.",
			navWorkBuddy: "DSH-WorkBuddy",
			accountPageTitle: "Accounts and credit",
			accountAddCn: "Add WorkBuddy account",
			accountAddAi: "Add WorkBuddy AI account",
			accountLoginQr: "Scan to sign in",
			accountLoginToken: "Sign-in token",
			accountActionLogin: "Add account",
			accountTotalCredits: "Total credit",
			accountTokenBody: "Paste the sign-in token from the WorkBuddy web console. It is stored on this machine only, and it cannot renew itself — when it expires you paste a new one.",
			accountTokenPlaceholder: "Paste the token here (it starts with eyJ…)",
			accountSubmit: "Add",
			accountOpenLink: "Open sign-in page",
			accountExpired: "Sign-in expired",
			modelsHeading: "Models",
			modelsRefresh: "Refresh list",
			modelsCount: "{count} models",
			contextLabel: "Context length",
			contextSwitchTitle: "Run this model at {size}",
			modelsEmpty: "No models yet. Refresh the list, or check the account above.",
			modelsSourceLive: "Updated {time}",
			modelsSourceSaved: "Saved list from {time}",
			modelsSourceFallback: "Built-in list",
			accountRotateHint: "Requests rotate between these accounts; one that answers \"too many requests\" is set aside for a while and tried again later.",
			accountRefreshCredits: "Refresh balances",
			accountTest: "Test",
			accountEnable: "Enable",
			accountDisable: "Disable",
			accountRename: "Rename",
			accountRemove: "Remove",
			accountRemoveConfirm: "Remove {name}? Its stored sign-in is deleted and cannot be recovered without scanning again.",
			accountCredits: "Credits {total}",
			accountCreditsPending: "Credits —",
			accountOriginDesktop: "From the desktop app",
			accountOriginQr: "Added by QR",
			accountTokenExpires: "Token expires {time}",
			accountTokenUnknown: "Token expiry unknown",
			accountStateDisabled: "Off",
			accountStateLimited: "rate limited",
			accountStateExhausted: "out of quota",
			accountStateSessionDead: "sign-in expired",
			accountStateWaiting: "{reason} · retry in {minutes} min",
			accountAdded: "Added {name}",
			accountUpdated: "That account was already here; its sign-in was refreshed.",
			accountTestOk: "Connected",
			accountTestFailed: "Test failed",
			floatingTitle: "Accounts",
			floatingCollapse: "Hide",
			floatingExpand: "Show",
			floatingNoAccount: "No account",
			floatingRetryIn: "retry {minutes} min",
			floatingSettingLabel: "Floating account window",
			floatingSettingHint: "Show each account and its remaining balance over the conversation."
		};
		const zh = {
			title: "DSH WorkBuddy Connect",
			intro: "在 DSH 中直接使用 WorkBuddy 桌面 App 包含的模型，开箱即用，无需额外配置。",
			titleAI: "DSH WorkBuddy AI Connect",
			introAI: "在 DSH 中直接使用 WorkBuddy AI 国际版桌面 App 包含的模型，开箱即用，无需额外配置。",
			expand: "展开",
			collapse: "收起",
			loading: "正在读取账号…",
			signedOut: "未登录",
			signedOutHint: "在 WorkBuddy 桌面 App 里登录一次即可，插件会自动跟随当前登录的账号。",
			signedOutHintAI: "在 WorkBuddy AI 国际版桌面 App 里登录一次即可，插件会自动跟随当前登录的账号。",
			signedInAs: "已登录：{nickname}",
			accessTokenExpires: "访问令牌 {time} 过期（自动续期）",
			creditsHeading: "剩余积分",
			tabStatus: "状态",
			tabContext: "上下文窗口",
			tabDetails: "积分详情",
			creditsDetailHeading: "按套餐",
			creditsTotal: "合计：{total}",
			percentRemaining: "剩余 {percent}%",
			exactRemaining: "剩余 {remain} / {size}",
			creditPackageUnknownSize: "剩余 {remain}",
			creditsError: "积分查询失败：{message}",
			refresh: "刷新",
			refreshing: "正在刷新…",
			refreshModels: "刷新模型列表",
			refreshingModels: "正在刷新模型…",
			catalogLive: "模型列表更新于 {time}",
			catalogSaved: "当前显示已保存的模型列表，更新于 {time}",
			catalogFallback: "当前显示内置模型列表（尚未从 WorkBuddy 更新）",
			catalogError: "上次更新失败：{message}",
			catalogAppVersion: "App 版本 {version}",
			requestFailed: "请求失败",
			accountHeading: "账号",
			modelsOffersHeading: "模型优惠",
			contextHeading: "上下文窗口",
			contextUpTo: "最高 {size}",
			freeModel: "免费",
			badgeLimitedFree: "限时免费",
			badgeNightDiscount: "夜间折扣",
			badgeFreeNow: "限时免费",
			rate: "{rate} 积分/次",
			rateUnknown: "价格未知 — 刷新后更新",
			probeLabel: "推理等级",
			probeTooltipIdle: "检测 {model} 可用的推理档位",
			probeTooltipVerified: "已接受：{levels} · 点击可重新检测",
			probeTooltipNotValidating: "该模型不校验该参数",
			probeTooltipRetry: "检测未完成 · 点击重试",
			probeBubbleBody: "发送探测请求以确认可用推理档位。可能消耗少量积分。",
			probeConfirmAction: "确认检测",
			probeNoteVerified: "已检测：{levels}",
			probeNoteNotValidating: "该模型不校验该参数",
			probeNoteUnknown: "检测未完成",
			probeNoteDismiss: "知道了",
			probeHeading: "推理档位检测",
			probeResultNoLevels: "本次测试的档位均未被接受。",
			probeIntro: "部分模型具备思考能力，但没有声明可选档位。检测会发送少量真实请求，可能消耗积分。",
			probeConsentHint: "每次检测会向该模型发送探测请求，以确认可用推理档位，可能消耗少量积分。",
			probeStart: "开始检测",
			probeRedetect: "重新检测",
			probeRunning: "正在检测 {model}…",
			probeRunningGeneric: "正在检测…",
			probeClear: "清除已探测结果",
			probeCandidates: "可检测模型：{count} 个",
			probeConfirmBody: "向 {model} 发送探测请求，以确认可用推理档位。可能消耗少量积分。",
			cancel: "取消",
			probeResultVerified: "已验证接受的档位：{levels}",
			probeResultNotValidating: "该模型不校验该参数",
			probeResultUnknown: "检测未完成",
			probeResultAt: "检测于 {time}",
			probeResultEmpty: "当前没有可检测的模型。",
			probeFailed: "检测失败：{message}",
			tabAccounts: "账号",
			accountAdd: "扫码添加",
			accountAddTitle: "扫码添加账号",
			accountAddBody: "打开手机 App 登录后扫描此二维码。账号只加入本插件，不会改变桌面 App 的登录状态。",
			accountAddWaiting: "等待扫码…（剩余 {seconds} 秒）",
			accountCheckNow: "立即检查",
			accountChecking: "检查中…",
			accountQrExpired: "二维码已过期，关闭后重新发起。",
			accountQrInvalid: "该登录已失效，请重新发起。",
			accountEmpty: "还没有账号。可在桌面 App 登录，或在此扫码添加。",
			accountUnavailable: "宿主未返回账号列表。请更新插件或重启 DSH。",
			navWorkBuddy: "DSH-WorkBuddy",
			accountPageTitle: "账号与积分",
			accountAddCn: "添加 WorkBuddy 账号",
			accountAddAi: "添加 WorkBuddy AI 账号",
			accountLoginQr: "扫码登录",
			accountLoginToken: "Cookie 登录",
			accountActionLogin: "添加账号",
			accountTotalCredits: "总积分",
			accountTokenBody: "粘贴 WorkBuddy 网页控制台里的登录令牌。它只保存在本机，且无法自动续期 —— 过期后重新粘贴一份即可。",
			accountTokenPlaceholder: "在此粘贴令牌（以 eyJ 开头）",
			accountSubmit: "添加",
			accountOpenLink: "打开登录页面",
			accountExpired: "登录已过期",
			modelsHeading: "模型列表",
			modelsRefresh: "刷新列表",
			modelsCount: "{count} 个模型",
			contextLabel: "上下文长度",
			contextSwitchTitle: "以 {size} 运行该模型",
			modelsEmpty: "暂无模型。可刷新列表，或检查上方账号。",
			modelsSourceLive: "更新于 {time}",
			modelsSourceSaved: "已保存的列表，更新于 {time}",
			modelsSourceFallback: "内置列表",
			accountRotateHint: "请求会在这些账号之间轮换；被上游限流的账号会暂时搁置，稍后自动重试。",
			accountRefreshCredits: "刷新积分",
			accountTest: "测试",
			accountEnable: "启用",
			accountDisable: "停用",
			accountRename: "重命名",
			accountRemove: "删除",
			accountRemoveConfirm: "确定删除 {name}？其保存的登录凭证会被清除，除非重新扫码否则无法恢复。",
			accountCredits: "积分 {total}",
			accountCreditsPending: "积分 —",
			accountOriginDesktop: "来自桌面 App",
			accountOriginQr: "扫码添加",
			accountTokenExpires: "令牌 {time} 过期",
			accountTokenUnknown: "令牌过期时间未知",
			accountStateDisabled: "已停用",
			accountStateLimited: "限流中",
			accountStateExhausted: "额度耗尽",
			accountStateSessionDead: "登录失效",
			accountStateWaiting: "{reason} · {minutes} 分钟后重试",
			accountAdded: "已添加 {name}",
			accountUpdated: "该账号已存在，已更新其登录凭证。",
			accountTestOk: "连通正常",
			accountTestFailed: "测试失败",
			floatingTitle: "账号",
			floatingCollapse: "收起",
			floatingExpand: "展开",
			floatingNoAccount: "暂无账号",
			floatingRetryIn: "{minutes} 分钟后重试",
			floatingSettingLabel: "悬浮账号窗",
			floatingSettingHint: "在对话内容右上角显示各账号及其剩余积分。"
		};
		//#endregion
		//#region src/client/index.tsx
		/** Stable browser-plugin name. */
		const name = "dsh-workbuddy-connect-client";
		/**
		* Client services required by the Plugin configuration contribution.
		*
		* DSH 0.1.2 removed `@deepseek-ai/dsh-client-runtime` (the package that used to
		* hold the browser `ClientContext` alias and the `slots` service). The services
		* this card relies on now come from narrower packages: the `slots` registry
		* moved to `@deepseek-ai/dsh-client-ui-renderer`, `locale` stayed in
		* `@deepseek-ai/dsh-client-locale`, and the `settings.plugin.item` slot is
		* declared by `@deepseek-ai/dsh-client-ui-settings-plugins`. All three are
		* named in the package's `dsh.client.inject` list, so cordis has activated
		* them before this plugin's fiber starts.
		*/
		const inject = ["slots", "locale"];
		/**
		* Register card copy and the WorkBuddy card under Plugin configuration.
		*
		* The entire body is wrapped so that a DSH slot-API breaking change (for
		* example the rc.6→rc.7 `id`→`key` / `order`→`priority` rename) degrades
		* to a `console.error` instead of throwing into the DSH loader and raising
		* the red "Failed to load plugins" banner. The host provider keeps working:
		* the `workbuddy` model channel is unaffected, and `dsh-workbuddy-connect
		* status` reports host health via the heartbeat file.
		*
		* NOTE: the try/catch boundary of this function is mirrored (duplicated) in
		* `tests/client-fallback.spec.ts`, because the real client entry imports
		* browser-only DSH packages that cannot load in the Node test environment.
		* That test therefore does not import this function — it replicates its
		* shape. If you change the guarded body or the `console.error` message here,
		* update the mirrored `apply()` in that spec too, or the fallback test will
		* silently diverge from this real implementation.
		*/
		function apply(ctx) {
			try {
				const namespace = "settings.workbuddy";
				ctx.effect(() => ctx.locale.register(namespace, {
					zh,
					en
				}), "dsh-workbuddy-connect: settings copy");
				const t = ctx.locale.bind(namespace);
				/**
				* The accounts live on their own settings page, not in the Plugins list.
				*
				* `settings.section` is what puts a destination in the settings navigation:
				* the owner renders one page per entry and uses `label` as the nav text,
				* re-registering on a locale change. So the pool, the balances, and the
				* sign-in dialogs become a place a user can go to, while the Plugins tab
				* goes back to describing plugins.
				*/
				ctx.slots.inject("settings.section", () => ctx.slots.register({
					name: "settings.section",
					id: "dsh-workbuddy",
					order: 40,
					label: () => t("navWorkBuddy"),
					locale: namespace,
					inject: () => ({ t })
				}, WorkBuddySettingsPage));
				ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
					name: "conversation.session.header.utilities",
					id: "workbuddy-floating-accounts",
					order: 90,
					inject: () => ({ t })
				}, WorkBuddyFloatingAccounts));
				ctx.inject(["modelDirectories"], (scope) => {
					scope.slots.inject("conversation.input.right", () => scope.slots.register({
						name: "conversation.input.right",
						id: "workbuddy-probe",
						order: 10,
						inject: (sessionId) => ({
							directory: scope.modelDirectories.directoryFor(sessionId).store,
							t
						})
					}, WorkBuddyProbeControl));
				});
			} catch (error) {
				console.error("[dsh-workbuddy-connect] client card failed to load (host provider unaffected):", error);
			}
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});
