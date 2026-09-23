/**
 * Stylesheet for the WorkBuddy dashboard: the sidebar footer card and the
 * centre-column panel it opens.
 *
 * Injected once by the client entry under its own `data-plugin-css` id, so a
 * second surface asking for it is a no-op. Classes are `wbp-` prefixed to stay
 * clear of any other plugin's set.
 *
 * Every colour goes through a `--dsw-alias-*` token with a literal fallback, so
 * the panel follows the harness theme where those tokens exist and stays
 * readable where they do not.
 *
 * @module dsh-workbuddy-connect/client/panel-styles
 */

/** Idempotency key for the injected `<style>` tag. */
export const PANEL_CSS_ID = 'dsh-workbuddy-connect-panel'

export const PANEL_CSS = `
.wbp-foot {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.24));
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1, transparent);
  color: var(--dsw-alias-label-primary, inherit);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.wbp-foot:hover { background: var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, 0.08)); }
.wbp-foot:focus-visible { outline: 2px solid var(--dsw-alias-state-focus-primary, #4c8dff); outline-offset: 1px; }

.wbp-footTop { display: flex; align-items: center; gap: 6px; min-width: 0; }
.wbp-footName {
  font-size: 13px;
  line-height: 18px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wbp-footLines { display: flex; flex-direction: column; gap: 3px; }
.wbp-footLine {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 12px;
  line-height: 16px;
  color: var(--dsw-alias-label-secondary, inherit);
}
.wbp-footLineLabel { flex: 0 0 auto; color: var(--dsw-alias-label-tertiary, inherit); }
.wbp-spacer { flex: 1 1 auto; }
.wbp-num { font-variant-numeric: tabular-nums; }

.wbp-railButton {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, inherit);
  cursor: pointer;
}
.wbp-railButton:hover { background: var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, 0.12)); }
.wbp-railButton:focus-visible { outline: 2px solid var(--dsw-alias-state-focus-primary, #4c8dff); outline-offset: 1px; }

.wbp-glyph { display: inline-flex; flex: 0 0 auto; }

.wbp-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
  min-height: 0;
  padding: 20px 24px 28px;
  overflow: auto;
  color: var(--dsw-alias-label-primary, inherit);
}
.wbp-head { display: flex; align-items: center; gap: 10px; }
.wbp-title { margin: 0; font-size: 16px; line-height: 22px; font-weight: 600; }
.wbp-headActions { display: flex; align-items: center; gap: 8px; }

.wbp-button {
  padding: 5px 12px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.28));
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1, transparent);
  color: var(--dsw-alias-label-primary, inherit);
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
}
.wbp-button:hover { background: var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, 0.08)); }
.wbp-button:disabled { opacity: 0.5; cursor: default; }

.wbp-summary { display: flex; flex-wrap: wrap; gap: 8px; }
.wbp-chip {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  padding: 4px 10px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.2));
  border-radius: 999px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary, inherit);
}
.wbp-chipValue { font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-primary, inherit); font-weight: 600; }

.wbp-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px 16px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.24));
  border-radius: 12px;
  background: var(--dsw-alias-bg-module-platform, transparent);
}
.wbp-cardHead { display: flex; align-items: center; gap: 8px; }
.wbp-cardName { font-size: 14px; line-height: 20px; font-weight: 600; }
.wbp-state {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-secondary, inherit);
  background: var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, 0.14));
}
.wbp-stateOk { color: var(--dsw-alias-state-success-primary, #22a06b); }
.wbp-stateWarn { color: var(--dsw-alias-state-warning-primary, #b45309); }
.wbp-stateError { color: var(--dsw-alias-state-error-primary, #d92d20); }

.wbp-detail { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary, inherit); }
.wbp-dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; background: currentColor; }

.wbp-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; }
.wbp-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.18));
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1, transparent);
}
.wbp-statLabel { font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary, inherit); }
.wbp-statValue { font-size: 18px; line-height: 24px; font-weight: 600; font-variant-numeric: tabular-nums; }
.wbp-statValueEmpty { color: var(--dsw-alias-label-dimmed, #9aa0a6); }

.wbp-hint { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary, inherit); }
.wbp-notice {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.24));
  border-radius: 12px;
  background: var(--dsw-alias-bg-module-platform, transparent);
}
.wbp-noticeError { border-color: var(--dsw-alias-state-error-primary, #d92d20); }
`
