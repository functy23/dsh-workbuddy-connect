/**
 * Browser half: the WorkBuddy dashboard — a sidebar-foot entry, the centre
 * column panel it opens, and the standalone settings page.
 *
 * Three surfaces, one navigation story:
 *
 * 1. **`sidebar.footer.action`** — a card pinned at the bottom of the sidebar,
 *    directly above the Settings seat, summarising both pools (accounts, total
 *    credit, models). Clicking it opens the panel.
 * 2. **`main` (keyed, `workbuddy-panel`)** — the dashboard in the centre
 *    column, selected by `ctx.layout.selectPanel`. Both registrations are
 *    required: the layout resolves the id against that registry and throws when
 *    no cell occupies it, so a footer card without the panel would be a dead
 *    button.
 * 3. **`settings.section`** — the full management page (accounts, QR sign-in,
 *    model list, reasoning probes), at the same navigation level as General /
 *    Models / Plugins.
 *
 * The conversation-side surfaces are registered the same way — the credit badge
 * rides `conversation.composer.dock` and the reasoning probe rides
 * `conversation.input.right` — so the plugin has no bespoke mounting of its own
 * anywhere.
 *
 * `ctx.slots.inject` follows the slot's declaration lifetime: a callback for a
 * slot the host never declares simply never runs. That is what makes the
 * version differences (which owner declares which seat) a non-issue at runtime,
 * and why every registration below can be unconditional.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: the slot declarations this bundle registers into. Cross-plugin
// collaboration goes through cordis services, so a value import would fail the
// client bundle-purity gate.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import { WORKBUDDY_PROFILE_ENTRY_ID } from '../status-paths.ts'
import { CARD_VARIANTS } from './card-variants.ts'
import { WorkBuddySettingsPage } from './WorkBuddySettingsPage.tsx'
import { WorkBuddyProbeControl } from './WorkBuddyProbeControl.tsx'
import { WorkBuddyCreditBadge } from './credit-badge.tsx'
import { WorkBuddyFooterEntry, WorkBuddyPanel } from './panel-view.tsx'
import type { PanelInjected } from './panel-view.tsx'
import { WorkBuddyProviderCard } from './provider-card.tsx'
import { createWorkBuddyPanelStore } from './panel-store.ts'
import { PANEL_CSS, PANEL_CSS_ID, PAGE_CSS, PAGE_CSS_ID } from './ui-styles.ts'
import { PANEL_COPY_EN, PANEL_COPY_ZH, PANEL_LOCALE_NS, panelTranslator } from './panel-copy.ts'
import { en, zh } from './locales.ts'
import type { WorkBuddySettingsKey, WorkBuddyTranslate } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** WorkBuddy settings-page copy. */
    'settings.workbuddy': WorkBuddySettingsKey
    /** WorkBuddy dashboard copy (the sidebar card and its panel). */
    'panel.workbuddy': keyof typeof PANEL_COPY_EN
  }
}

/** Stable browser-plugin name. */
export const name = 'dsh-workbuddy-connect-client'

/**
 * Client services required by this browser half.
 *
 * DSH 0.1.2 removed `@deepseek-ai/dsh-client-runtime` (the package that used to
 * hold the browser `ClientContext` alias and the `slots` service), so the
 * services come from narrower packages: the `slots` registry lives in
 * `@deepseek-ai/dsh-client-ui-renderer` and `locale` in
 * `@deepseek-ai/dsh-client-locale`. None of the SEAT OWNERS is named here:
 * `sidebar.footer.action`, `main` and `settings.section` are declared by three
 * different packages, and the seam each host actually ships is discovered by
 * slot-declaration lifetime rather than by activation order — a static inject
 * would park this fiber on a package some profiles never mount.
 */
// `modelDirectories` reads the active session through `remote.session`.
// Declaring that dependency at the client entry is required by the Desktop
// renderer; without it Cordis rejects `directoryFor()` before this bundle can
// finish registering its contributions.
export const inject = ['slots', 'locale', 'remote', 'remote.session']

/** Prefix every guarded client contribution's degradation logs with this. */
const CLIENT_CONTRIBUTION_FAILED = '[dsh-workbuddy-connect] client contribution failed to load (host provider unaffected):'

/** Disposer handed back when a deferred registration degraded: nothing to undo. */
const NOOP_DISPOSER = (): void => {}

/**
 * The sidebar panel's id. It is the layout's `MainPanelId`: one string shared
 * by the `sidebar.footer.action` card and the `main` slot cell, so the card
 * selects this panel and nothing else.
 */
export const PANEL_ID = 'workbuddy-panel'

/**
 * `ui-conversation`'s reserved `main` key, used only as the exit fallback for
 * a layout whose `selectPanel` predates the `null` "show the Conversation"
 * selection. Declared locally because `ui-conversation` is not a dependency of
 * this bundle and the key is a published contract of the layout.
 */
const CONVERSATION_PANEL_ID = 'conversation'

/**
 * The one shot of the `layout` service this plugin needs, declared
 * structurally: importing the package would make the browser resolve a client
 * module this bundle never calls. Reached through the reflective
 * `ctx.get('layout')`, never a bare `ctx.layout` property — cordis throws
 * `cannot get property … without inject` for an undeclared service, and
 * declaring `layout` statically would park the whole client fiber (settings
 * page included) on a service some profiles never mount.
 */
interface LayoutSelectionSeam {
  /** `null` shows the Conversation again; a string selects that registered `main` key. */
  selectPanel(id: string | null): void
}

/** Inject the settings-page copy and resolve the translator bound to it. */
function bindSettingsCopy(ctx: ClientContext, namespace: string): WorkBuddyTranslate {
  return ctx.locale.bind(namespace) as WorkBuddyTranslate
}

/**
 * Inject one stylesheet once and return its disposer, for `ctx.effect` to own.
 *
 * Keyed by its own `data-plugin-css` id, so the injection is idempotent even if
 * a second surface asks for it later. The two ids must stay distinct from each
 * other: they key two separate style tags, and a shared id would make the
 * second injection a silent no-op that drops one stylesheet.
 */
function injectCss(id: string, css: string): () => void {
  if (typeof document === 'undefined') return NOOP_DISPOSER
  if (document.querySelector(`style[data-plugin-css="${id}"]`) !== null) return NOOP_DISPOSER
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-workbuddy-connect'
  tag.dataset.pluginCss = id
  tag.textContent = css
  document.head.appendChild(tag)
  return () => {
    tag.remove()
  }
}

/**
 * Run ONE browser-side contribution, degrading its failure to a `console.error`
 * instead of throwing into the DSH loader. Returns the contribution's own value
 * on success, or `undefined` when it degraded — the deferred slot callbacks
 * below substitute `NOOP_DISPOSER` for that, because the slot runtime always
 * expects a disposer back.
 *
 * Every contribution is guarded at BOTH boundaries where it can throw:
 *
 * 1. the eager `ctx.slots.inject(...)` / `ctx.inject(...)` call itself, which
 *    runs synchronously inside `apply()` — e.g. a slot-API shape break such as
 *    the rc.6→rc.7 `id`→`key` rename;
 * 2. the deferred callback, which the slot runtime invokes later — when the
 *    owner commits the slot's declaration, or when the injected services
 *    arrive — long after `apply()` has returned, where no enclosing try/catch
 *    could still catch it.
 *
 * The pair is what makes the contributions independent: a failure in one
 * surface leaves every other registration intact. Guards are for THIS browser
 * half only; the host half reports its own errors through `ctx.logger`.
 */
function guardClientContribution<T>(label: string, fn: () => T): T | undefined {
  try {
    return fn()
  } catch (error: unknown) {
    console.error(`${CLIENT_CONTRIBUTION_FAILED} ${label}`, error)
    return undefined
  }
}

/**
 * Register the copy namespaces, the dashboard, and the conversation-side
 * surfaces, one guarded contribution at a time.
 *
 * The host provider keeps working throughout: the `workbuddy` model channel is
 * unaffected, and `dsh-workbuddy-connect status` reports host health via the
 * heartbeat file.
 */
export function apply(ctx: ClientContext): void {
  // The locale copy feeds every contribution below through `t`. Its guard
  // exists only so a broken locale service cannot reach the loader; if it
  // degrades, `t` still binds and renders the key names as fallback copy.
  const namespace = 'settings.workbuddy'
  guardClientContribution('settings copy', () => {
    ctx.effect(() => ctx.locale.register(namespace, { zh, en }), 'dsh-workbuddy-connect: settings copy')
  })
  const t = bindSettingsCopy(ctx, namespace)
  // The dashboard's copy is its own namespace: the panel is not part of the
  // settings page, but it follows the SAME active language.
  guardClientContribution('panel copy', () => {
    ctx.effect(
      () => ctx.locale.register(PANEL_LOCALE_NS, { zh: PANEL_COPY_ZH, en: PANEL_COPY_EN }),
      'dsh-workbuddy-connect: panel copy',
    )
  })

  // One store shared by the sidebar card and the panel, so a single sweep
  // feeds both and the two surfaces can never disagree about what was read.
  const panelStore = createWorkBuddyPanelStore()

  /**
   * The injected face both panel slots carry. `layout` is read reflectively AT
   * CLICK TIME, never captured at setup: ui-layout is not a dependency of this
   * bundle, so a static `inject` would park the whole client fiber.
   */
  const panelFace = (): PanelInjected => ({
    hooks: { workBuddyPanel: panelStore },
    refresh: () => { void panelStore.refresh() },
    startAutoRefresh: () => panelStore.start(),
    open: () => {
      const layout = ctx.get('layout') as LayoutSelectionSeam | undefined
      if (typeof layout?.selectPanel === 'function') layout.selectPanel(PANEL_ID)
    },
    // The dashboard's way out: it covers the Conversation while open, so
    // without this the footer card could only re-select what the user is
    // already looking at. `selectPanel(null)` is layout's "show the
    // Conversation" selection and leaves the current Session untouched; a
    // layout whose `selectPanel` predates that form accepts only a registered
    // key, so fall back to ui-conversation's reserved seat. A failure here must
    // not take the surface down.
    close: () => {
      const layout = ctx.get('layout') as LayoutSelectionSeam | undefined
      if (typeof layout?.selectPanel !== 'function') return
      try {
        layout.selectPanel(null)
      } catch {
        try {
          layout.selectPanel(CONVERSATION_PANEL_ID)
        } catch (error: unknown) {
          console.error('[dsh-workbuddy-connect] could not close the dashboard:', error)
        }
      }
    },
  })

  guardClientContribution('styles', () => {
    // Both stylesheets ride one effect: they are injected together and dropped
    // together, and a half-installed pair would render a page whose rows have no
    // layout at all.
    ctx.effect(() => {
      const page = injectCss(PAGE_CSS_ID, PAGE_CSS)
      const panel = injectCss(PANEL_CSS_ID, PANEL_CSS)
      return () => {
        page()
        panel()
      }
    }, 'dsh-workbuddy-connect: styles')
  })

  // The dashboard cell. Registering a cell for a declaration that never arrives
  // is a no-op by construction (the callback runs only while the declaration is
  // live), so this needs no version gate of its own.
  guardClientContribution('dashboard panel', () => {
    ctx.slots.inject('main', () => (
      guardClientContribution('dashboard panel', () => ctx.slots.register(
        { name: 'main', key: PANEL_ID, locale: PANEL_LOCALE_NS, inject: panelFace },
        WorkBuddyPanel,
      )) ?? NOOP_DISPOSER
    ))
  })

  // The sidebar footer card. Gated on the `layout` service — the same package
  // that owns `main` — because without `selectPanel` the card would register,
  // render, and do nothing when clicked: a dead button is worse than no button.
  // A profile without ui-layout (the TUI, a headless client) therefore never
  // registers it.
  guardClientContribution('sidebar footer card', () => {
    ctx.inject(['layout'], layoutCtx => {
      const layout = layoutCtx.get('layout') as LayoutSelectionSeam | undefined
      if (typeof layout?.selectPanel !== 'function') return
      guardClientContribution('sidebar footer card', () => layoutCtx.slots.inject('sidebar.footer.action', () => (
        guardClientContribution('sidebar footer card', () => layoutCtx.slots.register(
          // `order` is the only control over position inside a list slot, and
          // the renderer sorts ascending. Anything a sibling registers at an
          // order ≥ 1 lands between this card and Settings, so "directly above
          // Settings" is a preference, not a guarantee.
          { name: 'sidebar.footer.action', id: PANEL_ID, order: 1, locale: PANEL_LOCALE_NS, inject: panelFace },
          WorkBuddyFooterEntry,
        )) ?? NOOP_DISPOSER
      )))
    })
  })

  // The accounts live on their own settings page, at the same navigation level
  // as General / Models / Plugins. `settings.section` is what puts a
  // destination in the settings navigation: the owner renders one page per
  // entry and uses `label` as the nav text, re-registering on a locale change.
  guardClientContribution('settings section', () => {
    ctx.slots.inject('settings.section', () => (
      guardClientContribution('settings section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'dsh-workbuddy',
        order: 40,
        label: () => t('navWorkBuddy'),
        locale: namespace,
        // The settings page is the one surface that hands the user to an
        // external page, so it is the one that gets the ambient seam source:
        // the dialog falls back to the right sidebar's browser when neither
        // `window.open` nor the host's own opener answers (see
        // `open-external`). Passed as a value, never read reflectively inside
        // the dialog, so a profile without the sidebar simply gets `undefined`.
        // `refreshPanel` reaches the sidebar card and the dashboard — surfaces
        // this page's own reads do not touch, and whose poll interval is a minute
        // long, which is how a preference that changes how the card is DRAWN
        // would otherwise appear to do nothing.
        inject: (): { t: WorkBuddyTranslate, context: ClientContext, refreshPanel: () => void } => ({
          t,
          context: ctx,
          refreshPanel: () => { void panelStore.refresh() },
        }),
      }, WorkBuddySettingsPage)) ?? NOOP_DISPOSER
    ))
  })

  // The Models-page provider card: one occurrence per variant, dispatched by
  // the Models settings page with `entryKey = settingsNs` on its provider row.
  // That row exists because the host half registers a
  // `registerConfigurableProviders` directory entry for each variant — the slot
  // callback fires only while the declaration is live, so on a host without the
  // slot (or without the directory entry) the card simply never renders, and
  // nothing else about the plugin changes.
  //
  // The `t` seat comes from the registration's own `locale` namespace, so the
  // card follows the harness's active language like every other surface.
  guardClientContribution('models provider card', () => {
    ctx.slots.inject('settings.models.provider-card', () => (
      guardClientContribution('models provider card', () => ctx.slots.register({
        name: 'settings.models.provider-card',
        // The Host's `settingsNs` for the same rows: the Models page dispatches
        // this keyed slot with it, so the two halves must agree on the string.
        key: WORKBUDDY_PROFILE_ENTRY_ID,
        locale: namespace,
        inject: (): { t: WorkBuddyTranslate } => ({ t }),
      }, WorkBuddyProviderCard)) ?? NOOP_DISPOSER
    ))
  })

  // The credit badge in the composer DOCK — the row DSH already fills with the
  // turn's tokens / cache-hit rate / speed. It rides the same
  // `modelDirectories` scope as the probe control (the session's model is what
  // decides whether there is a quota to state), and it reads the SAME panel
  // store the sidebar card and the dashboard do, so the three surfaces can never
  // disagree about what is left.
  guardClientContribution('composer credit badge', () => {
    ctx.inject(['modelDirectories'], scope => {
      guardClientContribution('composer credit badge', () => {
        scope.slots.inject('conversation.composer.dock', () => (
          guardClientContribution('composer credit badge', () => scope.slots.register({
            name: 'conversation.composer.dock',
            id: 'workbuddy-credit-badge',
            // Last in the row: the harness's own readout owns the middle.
            order: 100,
            inject: sessionId => ({
              directory: scope.modelDirectories.directoryFor(
                sessionId as Parameters<typeof scope.modelDirectories.directoryFor>[0],
              ).store,
              panel: panelStore,
              // Widened deliberately: the settings copy binder is keyed by ITS
              // namespace, and the panel dictionary falls back to English for a
              // key it does not carry, which is exactly the behaviour wanted here.
              t: panelTranslator((key: string, params?: Record<string, unknown>) => t(key as WorkBuddySettingsKey, params)),
            }),
          }, WorkBuddyCreditBadge)) ?? NOOP_DISPOSER
        ))
      })
    })
  })

  // The reasoning-probe seat in the conversation composer. `modelDirectories`
  // may arrive after this fiber starts, so the scoped callback — and the slot
  // callback inside it — are guarded at their own boundaries too.
  guardClientContribution('conversation probe control', () => {
    ctx.inject(['modelDirectories'], scope => {
      guardClientContribution('conversation probe control', () => {
        scope.slots.inject('conversation.input.right', () => (
          guardClientContribution('conversation probe control', () => scope.slots.register({
            name: 'conversation.input.right',
            id: 'workbuddy-probe',
            order: 10,
            inject: sessionId => ({
              directory: scope.modelDirectories.directoryFor(
                sessionId as Parameters<typeof scope.modelDirectories.directoryFor>[0],
              ).store,
              t,
            }),
          }, WorkBuddyProbeControl)) ?? NOOP_DISPOSER
        ))
      })
    })
  })
}

/** Both products, re-exported so tests and host tooling can enumerate them. */
export { CARD_VARIANTS }
