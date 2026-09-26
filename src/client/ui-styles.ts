/**
 * Two stylesheets for the WorkBuddy surfaces: the settings page (and the
 * Models-page provider card, which shares its classes) and the plans panel
 * (the sidebar footer card plus the dashboard it opens).
 *
 * Returned as strings rather than injected here so the modules stay free of DOM
 * side effects at import time: `./index.tsx` installs each once, keyed by its
 * own `data-plugin-css` id. The metrics are the harness's own settings pages'
 * — read out of the 0.1.7 bundles so these surfaces sit beside General and
 * Models without looking foreign: a row is 16px of padding over a 0.5px
 * border-l2 hairline, its title 14/22 label-primary, its description 12/18
 * label-tertiary, the control on the right. Inputs are 32px with an 8px radius,
 * a card is a 0.5px border-l4 outline with a 16px radius, a nested panel is a
 * bg-module-platform fill.
 *
 * Two design rules hold throughout, both learned from the reference
 * implementation this is ported from (dsh-commandcode-provider):
 *
 * - **No literal colours.** Every value is a `--dsw-alias-*` token with a
 *   neutral fallback, so the page follows the active theme, light or dark.
 *   Literal colours get this wrong in exactly one mode: `brand-primary`
 *   inverts between them, so a hardcoded white thumb vanishes in dark mode.
 * - **The content column is a fixed 720px稿纸.** The page is a stack of
 *   groups of hairline-separated rows — no card surfaces — which is what makes
 *   it read as a settings page rather than as a dashboard.
 *
 * The `wbp-` prefix is kept (rather than the reference's `cc-`) because these
 * rules are GLOBAL CSS: another plugin's stylesheet with the same prefix would
 * silently restyle these surfaces, and the reference plugin is installed on
 * this machine.
 *
 * @module dsh-workbuddy-connect/client/ui-styles
 */

/** Idempotency key for the settings-page stylesheet. */
export const PAGE_CSS_ID = 'dsh-workbuddy-connect-page'

/** Idempotency key for the panel stylesheet. */
export const PANEL_CSS_ID = 'dsh-workbuddy-connect-panel'

/**
 * The settings-page stylesheet: a 720px column of groups, each a heading over
 * hairline-separated rows, plus the fields, toggles, segmented controls,
 * account cards and dialogs the page composes from it.
 */
export const PAGE_CSS = `
.wbp-section{max-width:720px;color:var(--dsw-alias-label-primary);flex-direction:column;display:flex}
.wbp-title{margin:0;color:var(--dsw-alias-label-primary);font-size:16px;font-weight:500;line-height:24px}
.wbp-intro{margin:4px 0 0;color:var(--dsw-alias-label-tertiary);font-size:14px;line-height:22px}
.wbp-spacer{flex:1}
/* Groups: a heading over hairline-separated rows, no card surface. */
.wbp-group{flex-direction:column;display:flex;margin-top:28px}
.wbp-groupHead{align-items:center;gap:8px;display:flex;min-height:28px;padding-bottom:4px}
.wbp-groupTitle{margin:0;color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:22px}
.wbp-groupDesc{margin:0 0 12px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.wbp-rows>.wbp-groupDesc{margin:0;padding:4px 0 0}
.wbp-disclosure{width:100%;padding:0 0 4px;border:0;background:0 0;font:inherit;text-align:left;cursor:pointer;border-radius:6px}
.wbp-disclosure:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.wbp-rows{flex-direction:column;display:flex}
.wbp-row{align-items:center;gap:8px;display:flex;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.wbp-rows>.wbp-row:last-child{border-bottom:0}
.wbp-rowNested{padding-left:16px}
.wbp-rowFlush{padding:0;border-bottom:0}
.wbp-rowText{flex-direction:column;flex:1;gap:4px;min-width:0;padding-right:32px;display:flex}
.wbp-rowTitleLine{align-items:center;gap:8px;display:flex;min-width:0}
.wbp-rowTitle{min-width:0;color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}
.wbp-rowDesc{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.wbp-rowDesc p{margin:0}
.wbp-rowDesc p+p{margin-top:4px}
.wbp-rowError{margin:0;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}
.wbp-rowControl{flex:none;align-items:center;justify-content:flex-end;gap:8px;display:inline-flex;max-width:60%}
.wbp-rowInput{width:200px}
.wbp-rowInputWide{width:280px}
/* The platform's link button: a compact capsule with no fill until hovered. */
.wbp-linkButton{box-sizing:border-box;flex:none;align-items:center;display:inline-flex;height:28px;padding:0 10px;border:0;border-radius:14px;background:0 0;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;line-height:18px;white-space:nowrap;cursor:pointer}
.wbp-linkButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.wbp-linkButton:disabled{cursor:default;opacity:.4}
.wbp-linkButton:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}
/* Tags: the platform Tag's capsule (11/17, weight 500). */
.wbp-badges{align-items:center;gap:8px;display:inline-flex}
.wbp-badge,.wbp-badgeMuted{flex:none;align-items:center;display:inline-flex;white-space:nowrap;border-radius:999px;corner-shape:round;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}
.wbp-badge{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}
.wbp-badgeMuted{border:.5px solid var(--dsw-alias-border-l4);color:var(--dsw-alias-label-tertiary)}
.wbp-badgeWarn{background:var(--dsw-alias-state-warn-tertiary,var(--dsw-alias-bg-module-platform));color:var(--dsw-alias-state-warn-label,var(--dsw-alias-label-secondary))}
.wbp-badgeError{background:transparent;color:var(--dsw-alias-state-error-primary)}
.wbp-badgeOk{background:transparent;color:var(--dsw-alias-state-success-primary)}
/* A label paired with a value on one baseline (the total-credit line). */
.wbp-factRow{align-items:baseline;gap:8px;flex-wrap:wrap;display:flex}
.wbp-factLabel{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.wbp-factValue{color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;font-variant-numeric:tabular-nums}
/* The stacked field (the Models-page provider card and the account forms):
 * the platform SettingsForm field's metrics. */
.wbp-field{flex-direction:column;gap:6px;padding:12px 0;display:flex}
.wbp-field+.wbp-field{border-top:.5px solid var(--dsw-alias-border-l2)}
.wbp-fieldHead{align-items:center;gap:8px;display:flex}
.wbp-label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}
.wbp-reset{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;padding:0;font-size:12px;line-height:18px}
.wbp-reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}
.wbp-reset:disabled{cursor:default;opacity:.4}
.wbp-input{box-sizing:border-box;height:32px;min-width:0;padding:0 10px;border:.5px solid var(--dsw-alias-border-l4);border-radius:8px;background:var(--dsw-alias-bg-layer-1);font:inherit;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}
.wbp-input::placeholder{color:var(--dsw-alias-label-dimmed)}
.wbp-input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}
.wbp-input:disabled{opacity:.6;cursor:default}
.wbp-inputInvalid{border-color:var(--dsw-alias-state-error-primary)}
.wbp-invalid{color:var(--dsw-alias-state-error-primary);margin:0;font-size:12px;line-height:18px}
.wbp-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px}
/* An informational outcome (a save that took an older host's route): the same
 * metrics as the error line and the other colour, so it reads as a note. */
.wbp-notice{color:var(--dsw-alias-state-warn-label,var(--dsw-alias-label-tertiary));margin:0;font-size:12px;line-height:18px}
/* The checkbox, drawn rather than native: color-scheme is set once at BOOT and
 * is not re-applied when the theme is switched in-session, so a native box can
 * paint light chrome on a dark page. The mark rides brand-primary, so it takes
 * the theme's foreground for that fill. */
.wbp-check{box-sizing:border-box;appearance:none;flex-shrink:0;width:16px;height:16px;margin:0;border:1px solid var(--dsw-alias-border-l3);border-radius:4px;background:0 0;position:relative}
.wbp-check:checked{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.wbp-check:checked::after{content:'';position:absolute;top:3px;left:5px;width:3px;height:7px;border:solid var(--dsw-alias-label-primary-foreground,#fff);border-width:0 1.5px 1.5px 0;transform:rotate(45deg)}
.wbp-check:disabled{cursor:default;opacity:.4}
.wbp-checkRow{align-items:center;gap:8px;display:inline-flex;min-width:0}
.wbp-checkRow:hover{cursor:pointer}
.wbp-checkName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* The platform Switch: a 36x20 capsule padding its track by 2px, sliding a
 * 16px thumb across the 32px content box. corner-shape:round on both the track
 * and the thumb keeps the capsule from squaring its ends around a round thumb. */
.wbp-toggle{box-sizing:border-box;appearance:none;flex-shrink:0;width:36px;height:20px;margin:0;padding:2px;border:0;border-radius:10px;corner-shape:round;background:var(--dsw-alias-border-l3);cursor:pointer;position:relative}
.wbp-toggle:checked{background:var(--dsw-alias-brand-primary)}
.wbp-toggle::after{content:'';display:block;width:16px;height:16px;border-radius:50%;corner-shape:round;background:var(--dsw-alias-label-primary-foreground);transition:transform .12s ease}
.wbp-toggle:checked::after{transform:translateX(16px)}
.wbp-toggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.wbp-toggle:disabled{cursor:default;opacity:.5}
/* The platform SegmentedControl: a translucent track with one raised pill that
 * slides under the picked segment. Segments are equal grid tracks, so the
 * indicator's width and offset follow from the count and index alone — no DOM
 * measurement. */
.wbp-segmented{position:relative;display:inline-grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:2px;padding:3px;border-radius:9px;background:var(--dsw-alias-interactive-bg-hover)}
.wbp-segmentIndicator{position:absolute;top:3px;left:3px;width:calc((100% - 6px - 2px * (var(--wbp-segment-count) - 1)) / var(--wbp-segment-count));height:calc(100% - 6px);border-radius:7px;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-soft,0 1px 2px rgba(0,0,0,.12));transform:translateX(calc(var(--wbp-segment-index) * (100% + 2px)));transition:transform .16s ease;pointer-events:none}
.wbp-segment{box-sizing:border-box;position:relative;z-index:1;height:28px;padding:0 16px;border:0;border-radius:7px;background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;font-weight:500;line-height:20px;white-space:nowrap;cursor:pointer;transition:color .12s ease}
.wbp-segment:hover:not(:disabled),.wbp-segment[aria-checked=true]{color:var(--dsw-alias-label-primary)}
.wbp-segment:disabled{cursor:default;opacity:.4}
/* ------------------------------------------------- the model picker menu */
/* The multi-select trigger: the platform's selector capsule (the reference
 * implementation's .cc-selector, same numbers). */
.wbp-modelSelectAnchor{flex-direction:column;align-items:stretch;gap:6px;display:inline-flex;min-width:160px}
.wbp-selector{box-sizing:border-box;align-items:center;gap:12px;display:inline-flex;height:36px;padding:0 14px;border:0;border-radius:18px;corner-shape:round;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;text-align:left;cursor:pointer}
.wbp-selector:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.wbp-selector:disabled{cursor:default;opacity:.4}
.wbp-selector:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}
.wbp-selectorText{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wbp-selectorCaret{flex-shrink:0;border-right:1.5px solid var(--dsw-alias-label-tertiary);border-bottom:1.5px solid var(--dsw-alias-label-tertiary);width:6px;height:6px;margin-bottom:3px;transform:rotate(45deg)}
/* The portaled list needs its own floor: the models are long names, and a menu
 * clamped to the trigger's width would ellipsis the part that tells two of them
 * apart. */
.wbp-modelMenu{min-width:240px}
/* The search box sits INSIDE the Menu anchor, so typing in it never trips the
 * Menu's outside-click close. */
.wbp-modelSearch{width:100%}
.wbp-modelSearch::-webkit-search-cancel-button{cursor:pointer}
/* A model the filter excludes: the platform's muted dot, the same mark the
 * reference implementation's account default-state column uses. */
.wbp-modelFiltered{flex-shrink:0;width:6px;height:6px;border-radius:50%;corner-shape:round;background:var(--dsw-alias-label-dimmed,var(--dsw-alias-label-tertiary))}
/* Three dots from one element: the dot itself plus two box-shadow copies (the
 * reference implementation's .cc-kebab). */
.wbp-kebab{width:3px;height:3px;border-radius:50%;corner-shape:round;background:currentColor;box-shadow:0 -5px 0 currentColor,0 5px 0 currentColor}
/* ------------------------------------------------ account meters (cc port) */
.wbp-accountMeters{flex-wrap:wrap;gap:6px 20px;display:flex;padding-left:16px}
.wbp-miniMeter{align-items:center;gap:8px;display:inline-flex;font-size:12px;line-height:18px}
.wbp-miniMeterLabel{color:var(--dsw-alias-label-tertiary)}
.wbp-miniMeterTrack{overflow:hidden;background:var(--dsw-alias-bg-module-platform);border-radius:999px;width:64px;height:4px}
.wbp-miniMeterFill{display:block;background:var(--dsw-alias-brand-primary);border-radius:999px;height:100%}
.wbp-miniMeterFillWarn{background:var(--dsw-alias-state-error-primary)}
.wbp-miniMeterValue{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
/* ------------------------------------------- the add-account affordance */
/* The Models page's dashed add button, opening a filled panel in its place. */
.wbp-addButton{box-sizing:border-box;align-items:center;justify-content:center;gap:6px;display:flex;width:100%;height:44px;border:1px dashed var(--dsw-alias-border-l3);border-radius:16px;background:0 0;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;cursor:pointer}
.wbp-addButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.wbp-addButton:disabled{cursor:default;opacity:.4}
.wbp-accountList+.wbp-addButton,.wbp-accountList+.wbp-addPanel,.wbp-usageStats+.wbp-addButton{margin-top:12px}
.wbp-addGlyph{position:relative;width:12px;height:12px}
.wbp-addGlyph::before,.wbp-addGlyph::after{content:'';position:absolute;background:currentColor;border-radius:1px}
.wbp-addGlyph::before{left:0;right:0;top:5.25px;height:1.5px}
.wbp-addGlyph::after{top:0;bottom:0;left:5.25px;width:1.5px}
.wbp-addPanel{flex-direction:column;gap:12px;display:flex;padding:14px 16px;border-radius:12px;background:var(--dsw-alias-bg-module-platform)}
/* ------------------------------------------------------ staged edit bar (cc port) */
/* The floating save bar, pinned to the bottom of the page's scrollport and slid
 * out of view when there is nothing to save. Ported from the reference
 * implementation's .cc-saveBar: a 44px capsule, 22px radius, concentric 36px
 * buttons, and a leading tone dot. */
.wbp-saveBarDock{position:sticky;bottom:0;z-index:20;height:0;pointer-events:none}
.wbp-saveBar{--wbp-saveBar-tone:var(--dsw-alias-state-warn-primary,#d97706);position:absolute;left:50%;bottom:20px;box-sizing:border-box;width:max-content;max-width:calc(100% - 24px);align-items:center;gap:10px;display:flex;height:44px;padding:4px 4px 4px 16px;border:0;border-radius:22px;corner-shape:round;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-prominent,0 12px 32px -8px rgba(0,0,0,.24),0 2px 8px rgba(0,0,0,.08));opacity:0;visibility:hidden;transform:translate(-50%,12px);transition:opacity .16s ease,transform .16s ease,visibility 0s linear .16s}
.wbp-saveBarShown{opacity:1;visibility:visible;transform:translate(-50%,0);pointer-events:auto;transition:opacity .2s ease,transform .24s cubic-bezier(.2,.9,.3,1.1),visibility 0s}
.wbp-saveBarError{--wbp-saveBar-tone:var(--dsw-alias-state-error-primary)}
.wbp-saveBarSuccess{--wbp-saveBar-tone:var(--dsw-alias-state-success-primary,#16a34a);padding-right:18px}
.wbp-saveBarIcon{flex-shrink:0;align-items:center;justify-content:center;display:inline-flex;width:16px;height:16px;color:var(--wbp-saveBar-tone)}
.wbp-saveBarPulse{width:8px;height:8px;border-radius:50%;corner-shape:round;background:var(--wbp-saveBar-tone)}
.wbp-saveBarText{min-width:0;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}
.wbp-saveBarError .wbp-saveBarText{color:var(--dsw-alias-state-error-primary)}
.wbp-saveBarActions{flex-shrink:0;align-items:center;gap:4px;display:flex;margin-left:8px}
.wbp-saveBarButton{box-sizing:border-box;height:36px;padding:0 16px;border:0;border-radius:18px;corner-shape:round;font:inherit;font-size:14px;line-height:22px;white-space:nowrap;cursor:pointer}
.wbp-saveBarButton:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}
.wbp-saveBarButton:disabled{cursor:default;opacity:.4}
.wbp-saveBarGhost{background:0 0;color:var(--dsw-alias-label-primary)}
.wbp-saveBarGhost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.wbp-saveBarPrimary{background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));color:var(--dsw-alias-label-primary-foreground,#fff)}
.wbp-saveBarPrimary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary)))}
.wbp-chevron{flex-shrink:0;border-right:1.5px solid var(--dsw-alias-label-tertiary);border-bottom:1.5px solid var(--dsw-alias-label-tertiary);width:7px;height:7px;margin-right:6px;margin-bottom:3px;transform:rotate(45deg);transition:transform .15s ease}
.wbp-chevronUp{transform:rotate(-135deg);margin-bottom:-3px}
/* ------------------------------------------------------------- accounts */
.wbp-accountList{flex-direction:column;gap:8px;display:flex}
.wbp-accountItem{flex-direction:column;gap:10px;display:flex;padding:12px 14px;border:.5px solid var(--dsw-alias-border-l4);border-radius:16px}
/* The account the pool is actually serving from: the reference
 * implementation's own active-row hairline. */
.wbp-accountItemActive{border-color:var(--dsw-static-neutral-bluish-400,var(--dsw-alias-border-l3))}
.wbp-accountHead{align-items:center;gap:4px;display:flex;min-height:28px}
.wbp-accountToggle{align-items:center;gap:8px;display:flex;flex:1;min-width:0;padding:0;background:0 0;border:0;color:inherit;cursor:pointer;font:inherit;text-align:left}
.wbp-accountToggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;border-radius:4px}
.wbp-accountName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:22px}
/* The product label and the account's own upstream name, ported from the
 * reference implementation's .cc-usageAccount / .cc-usagePlan. */
.wbp-accountProduct{max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.wbp-usagePlan{flex:none;white-space:nowrap;border:.5px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary);border-radius:999px;corner-shape:round;padding:0 7px;font-size:11px;font-weight:500;line-height:17px}
.wbp-usagePlanStatus{flex:none;margin:0;white-space:nowrap;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}
.wbp-tabDot{flex-shrink:0;width:8px;height:8px;border-radius:50%;corner-shape:round}
.wbp-tabDotOk{background:var(--dsw-alias-state-success-primary)}
.wbp-tabDotWarn{background:var(--dsw-alias-state-warn-primary,#d97706)}
.wbp-tabDotError{background:var(--dsw-alias-state-error-primary)}
.wbp-tabDotOff{background:var(--dsw-alias-label-dimmed,#9aa0a6)}
.wbp-iconButton{flex-shrink:0;align-items:center;justify-content:center;display:inline-flex;width:28px;height:28px;padding:0;background:0 0;border:0;border-radius:6px;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.wbp-iconButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.wbp-iconButton:disabled{cursor:default;opacity:.4}
.wbp-iconButton:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}
.wbp-accountDetails{container-type:inline-size;border-top:.5px solid var(--dsw-alias-border-l2);flex-direction:column;gap:14px;display:flex;padding-top:12px}
.wbp-inlineForm,.wbp-confirmBar{flex-direction:column;gap:8px;display:flex}
.wbp-inlineActions{align-items:center;gap:8px;display:flex;flex-wrap:wrap}
.wbp-confirmBar{border:.5px solid var(--dsw-alias-state-error-primary);border-radius:12px;padding:12px 14px}
.wbp-confirmText{color:var(--dsw-alias-label-primary);margin:0;font-size:14px;line-height:22px}
/* Adding an account: the Models page's dashed add button, opening a filled
 * panel in its place. */
.wbp-addButton{box-sizing:border-box;align-items:center;justify-content:center;gap:6px;display:flex;width:100%;height:44px;border:1px dashed var(--dsw-alias-border-l3);border-radius:16px;background:0 0;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;cursor:pointer}
.wbp-addButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.wbp-addButton:disabled{cursor:default;opacity:.4}
.wbp-addButton:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}
.wbp-addGlyph{position:relative;width:12px;height:12px}
.wbp-addGlyph::before,.wbp-addGlyph::after{content:'';position:absolute;background:currentColor;border-radius:1px}
.wbp-addGlyph::before{left:0;right:0;top:5.25px;height:1.5px}
.wbp-addGlyph::after{top:0;bottom:0;left:5.25px;width:1.5px}
.wbp-addPanel{flex-direction:column;gap:12px;display:flex;padding:14px 16px;border-radius:12px;background:var(--dsw-alias-bg-module-platform)}
.wbp-panelTitle{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:22px}
/* Account report: stat tiles are filled panels, like the platform's editors. */
/* The per-product total tiles sit under the account cards, so they need the
 * same air the add button gets — flush against the last card they read as part
 * of it. The reference implementation has no equivalent row, so this spacing is
 * ours to set. */
.wbp-usageStats{grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;display:grid;margin-top:12px}
.wbp-usageStat{min-width:0;flex-direction:column;gap:2px;display:flex;padding:10px 12px;border-radius:12px;background:var(--dsw-alias-bg-module-platform)}
.wbp-usageStatLabel{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.wbp-usageStatValue{color:var(--dsw-alias-label-primary);font-size:16px;font-weight:500;line-height:24px;font-variant-numeric:tabular-nums}
.wbp-usageStatSub{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* Tabs across the top of the page: one per product. */
.wbp-tabs{flex-wrap:wrap;gap:6px;display:flex}
.wbp-tab{align-items:center;font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:2px 10px;font-size:12px;line-height:18px;display:inline-flex;gap:6px}
.wbp-tab:hover:not(.wbp-tabActive){color:var(--dsw-alias-label-primary)}
.wbp-tabActive{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-brand-primary)}
/* --------------------------------------------------------------- models */
.wbp-modelList{flex-direction:column;display:flex}
.wbp-modelRow{align-items:center;gap:8px;display:flex;padding:10px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.wbp-modelList>.wbp-modelRow:last-child{border-bottom:0}
.wbp-modelName{min-width:0;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wbp-modelId{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:17px;font-variant-numeric:tabular-nums}
.wbp-modelMeta{align-items:center;gap:8px;display:inline-flex;flex-wrap:wrap}
/* The row's right-hand column, as a fixed grid so the rows line up top to
 * bottom: one column per slot (probe result, Detect button, context figure),
 * each sized to its widest occupancy. Flow layout could not hold a column — a
 * row without a Detect button would pull its context figure left, and the
 * figures would read as ragged down the page even though every row is
 * individually correct.
 *
 * The two fixed tracks are the widths of the button and of the context figure
 * at their widest real content, so a row can be missing either without shifting
 * the other. The first track is auto so the result badge takes what it needs;
 * justify-items:end keeps every cell flush right, which is what makes the
 * column's edge straight. */
.wbp-modelControl{flex:none;align-items:center;display:grid;grid-template-columns:auto 76px minmax(120px,auto);gap:8px;justify-items:end}
.wbp-modelProbeResult{display:inline-flex;justify-content:flex-end;min-width:0}
.wbp-modelProbeAction{display:inline-flex;justify-content:flex-end}
.wbp-modelContext{display:inline-flex;justify-content:flex-end;align-items:center;text-align:right;white-space:nowrap}
/* --------------------------------------------------------------- dialogs */
.wbp-overlay{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--dsw-alias-bg-mask,rgba(0,0,0,.45))}
.wbp-dialog{box-sizing:border-box;width:100%;max-width:380px;display:flex;flex-direction:column;gap:14px;padding:20px;border-radius:16px;border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-prominent,0 12px 32px -8px rgba(0,0,0,.24))}
.wbp-dialogTitle{margin:0;color:var(--dsw-alias-label-primary);font-size:16px;line-height:24px;font-weight:500;text-align:center}
.wbp-dialogBody{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.wbp-dialogActions{display:flex;justify-content:flex-end;gap:8px}
.wbp-qrFrame{display:flex;align-items:center;justify-content:center;padding:12px;border-radius:12px;background:#fff}
.wbp-tokenArea{box-sizing:border-box;width:100%;min-height:96px;padding:10px;border:.5px solid var(--dsw-alias-border-l4);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;resize:vertical}
/* The address of a page no strategy could open: a copy target, so it stays
 * selectable and reads in the same field style as the other inputs. */
.wbp-linkFallback{display:flex;flex-direction:column;gap:8px}
.wbp-linkFallback .wbp-input{font-size:12px}
.wbp-tokenArea:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}
@media (prefers-reduced-motion:reduce){.wbp-chevron,.wbp-toggle::after,.wbp-segmentIndicator,.wbp-segment{transition:none}}
`

/** The panel stylesheet. */
export const PANEL_CSS = `
/* ------------------------------------------------- sidebar footer card */
/* The shell's foot area renders this list ABOVE the Settings seat, so the card
   is the sidebar's bottom-most content. The shell supplies no chrome: the entry
   is the button. It is deliberately quiet — a surface that sits beside Settings
   should read as part of the column, not as a call to action — with one hover
   step and a hairline border.

   The shell's container is a flex ROW whose occupants each declare a full-width
   line, so as a row it would overflow the column: this card cannot shrink and a
   sibling sized 100% would absorb the whole overflow. Both were written for a
   full-width line, which is what a column gives them. Matched by the CSS-module
   class STEM — never a hashed name — so a renamed shell degrades to its own row
   rather than breaking, and anchored under "footArea" rather than the bare
   "footerActions" stem because that stem is NOT the shell's alone:
   dsh-client-ui-user-questions renders the ask-user-question dialog's button
   row with it, and the unanchored rule stacked that dialog's side-by-side
   buttons on every page. The descendant combinator (rather than a child one)
   deliberately survives a wrapper element appearing between the two. */
[class*="_footArea"] [class*="_footerActions"]{flex-direction:column}
.wbp-foot{box-sizing:border-box;flex:0 0 auto;width:100%;min-width:0;font:inherit;color:var(--dsw-alias-label-secondary);text-align:left;cursor:pointer;background:0 0;border:1px solid transparent;border-radius:10px;flex-direction:column;gap:6px;margin:0 0 4px;padding:8px;display:flex}
.wbp-foot:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l2)}
.wbp-foot:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.wbp-footTop{align-items:center;gap:8px;min-width:0;display:flex}
.wbp-footName{white-space:nowrap;text-overflow:ellipsis;color:var(--dsw-alias-label-primary);min-width:0;overflow:hidden;font-size:13px;font-weight:500;line-height:20px}
/* ONE line per product: the label names the figure, the figure sits flush right.
 * nowrap on both halves is load-bearing — the label carries the product name and
 * "剩余额度", and a wrap would put the number on a line of its own, which is
 * exactly the stacked layout this replaced. */
.wbp-footRow{align-items:baseline;gap:8px;min-width:0;display:flex}
/* The "used / total + bar" style stacks its head line over a full-width bar; the
 * default style is the single line above. Two shapes rather than two skins of one
 * markup, because the bar must span the card, not the space left beside a figure. */
.wbp-footRowUsage{flex-direction:column;gap:4px;align-items:stretch}
.wbp-footHead{align-items:baseline;gap:8px;min-width:0;display:flex}
.wbp-footLabel{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.wbp-footAmount{flex:none;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;font-variant-numeric:tabular-nums;white-space:nowrap}
.wbp-footBar{display:block;width:100%;background:var(--dsw-alias-bg-layer-2);border-radius:999px;height:5px;overflow:hidden}
.wbp-footFill{display:block;background:var(--dsw-alias-brand-primary);border-radius:999px;height:100%;transition:width .3s ease}
/* ------------------------------------------------------- composer badge */
/* The credit figure in the composer dock, beside the harness's own token /
 * cache-hit readout. margin-left:auto is what puts it at the far right of that
 * row: the dock centres its entries, and an auto margin absorbs the free space
 * on one side only, so the harness's readout keeps its place and this lands on
 * the row's right edge. */
.wbp-creditBadge{flex:none;align-items:baseline;gap:4px;display:inline-flex;margin-left:auto;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;font-variant-numeric:tabular-nums}
.wbp-creditBadgeName{color:var(--dsw-alias-label-tertiary)}
.wbp-creditBadgeValue{color:var(--dsw-alias-label-secondary)}
/* -------------------------------------------------------- the rail icon */
.wbp-railButton{box-sizing:border-box;width:36px;height:36px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:1px solid transparent;border-radius:8px;flex:none;justify-content:center;align-items:center;margin:0 0 4px;padding:0;display:inline-flex}
.wbp-railButton:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.wbp-railButton:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
/* The quota ring: one glyph serves the rail button, the card's head and the
   dashboard header. Circumference 2πr = 45.55 at r = 7.25. */
.wbp-glyph{flex:none;justify-content:center;align-items:center;display:inline-flex;color:var(--dsw-alias-brand-primary)}
/* ----------------------------------------------------------- dashboard */
.wbp-main{background:var(--dsw-alias-bg-layer-1);width:100%;height:100%;overflow:auto;display:block}
.wbp-mainInner{max-width:760px;margin:0 auto;padding:24px 20px 40px;flex-direction:column;gap:14px;display:flex;color:var(--dsw-alias-label-primary)}
.wbp-header{align-items:center;gap:10px;display:flex;flex-wrap:wrap}
.wbp-headerText{flex-direction:column;gap:2px;display:flex;min-width:0}
.wbp-titleLg{margin:0;font-size:18px;font-weight:600;line-height:1.4}
.wbp-subtitle{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}
.wbp-meta{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.5;font-variant-numeric:tabular-nums}
.wbp-close{min-width:28px;justify-content:center;padding-left:0;padding-right:0}
.wbp-close span{font-size:16px;line-height:1}
.wbp-notice{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;padding:12px 14px;flex-direction:column;gap:4px;display:flex}
.wbp-noticeError{border-color:var(--dsw-alias-state-error-primary)}
.wbp-noticeTitle{margin:0;font-size:13px;font-weight:600;line-height:1.5}
.wbp-noticeError .wbp-noticeTitle{color:var(--dsw-alias-state-error-primary)}
.wbp-noticeHint{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.55}
/* One product's card: the account head, its quota windows, its totals. */
.wbp-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:14px;padding:16px 18px;flex-direction:column;gap:16px;display:flex}
.wbp-cardHead{align-items:center;gap:10px;display:flex;flex-wrap:wrap}
.wbp-avatar{flex:none;width:28px;height:28px;color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-module-platform);border-radius:50%;justify-content:center;align-items:center;font-size:12px;font-weight:600;line-height:1;display:inline-flex}
.wbp-cardIdentity{flex-direction:column;gap:1px;min-width:0;display:flex}
.wbp-cardTitle{font-size:13px;font-weight:600;line-height:1.4}
.wbp-block{flex-direction:column;gap:8px;display:flex}
.wbp-blockTitle{margin:0;color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:600;line-height:1.5;text-transform:uppercase;letter-spacing:.04em}
.wbp-planRow{align-items:center;gap:8px;display:flex;flex-wrap:wrap}
.wbp-fieldLabel{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}
.wbp-planName{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:1.5}
.wbp-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px}
.wbp-tile{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);border-radius:8px;padding:8px 10px;flex-direction:column;gap:2px;display:flex;min-width:0}
.wbp-tileLabel{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.5}
.wbp-tileValue{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4;font-variant-numeric:tabular-nums}
.wbp-tileSub{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* One account's bench: a labelled bar over its remaining wait. */
.wbp-windows{flex-direction:column;gap:14px;display:flex}
.wbp-window{flex-direction:column;gap:6px;display:flex}
.wbp-windowHead{align-items:baseline;gap:8px;display:flex}
.wbp-windowLabel{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;line-height:1.5}
.wbp-windowValue{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5;font-variant-numeric:tabular-nums;white-space:nowrap}
.wbp-windowPct{color:var(--dsw-alias-label-primary);min-width:38px;text-align:right;font-size:12px;font-weight:600;line-height:1.5;font-variant-numeric:tabular-nums}
.wbp-warnTag{white-space:nowrap;background:var(--dsw-alias-state-warn-tertiary,var(--dsw-alias-bg-module-platform));color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-label-secondary));border-radius:999px;padding:0 8px;font-size:11px;font-weight:600;line-height:17px}
.wbp-bar{overflow:hidden;background:var(--dsw-alias-bg-layer-1);border-radius:999px;height:8px}
.wbp-barFill{background:var(--dsw-alias-brand-primary);border-radius:999px;height:100%;transition:width .3s ease}
.wbp-barFillWarn{background:var(--dsw-alias-state-error-primary)}
.wbp-windowReset{color:var(--dsw-alias-label-tertiary);margin:0;font-size:11px;line-height:1.5}
.wbp-badge2{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-brand-primary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:600;line-height:17px}
.wbp-badge2Warn{background:var(--dsw-alias-state-warn-tertiary,var(--dsw-alias-bg-module-platform));color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-label-secondary))}
.wbp-badge2Error{background:transparent;color:var(--dsw-alias-state-error-primary)}
@media (prefers-reduced-motion:reduce){.wbp-barFill,.wbp-footFill{transition:none}}
`
