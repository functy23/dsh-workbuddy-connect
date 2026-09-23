/**
 * React components for the WorkBuddy dashboard: the sidebar footer card and the
 * centre-column panel it opens.
 *
 * Both render one {@link PanelView} projected by `./panel.ts` — no fact is
 * derived here. Strings are resolved through the injected `t` seat, bound to the
 * `panel.workbuddy` namespace by each registration, so the surfaces follow the
 * harness's active language (a language switch mints a fresh `t`, which is the
 * invalidation the renderer propagates).
 *
 * The footer card is the panel's home: the sidebar shell renders it in the foot
 * area directly ABOVE the Settings seat, so both pools' account counts and
 * credit totals are on screen without opening anything. Clicking it selects the
 * `workbuddy-panel` cell this file also renders — and unlike a
 * `sidebar.panellist` row, whose button chrome the SHELL owns, this entry owns
 * its whole surface and therefore calls `open()` itself.
 *
 * Styles ride the stylesheet `./panel-styles.ts` returns, injected once by the
 * client entry.
 *
 * @module dsh-workbuddy-connect/client/panel-view
 */

import type { ReactNode } from 'react'
import type { WorkBuddyPanelStore } from './panel-store.ts'
import { panelTranslator } from './panel-copy.ts'
import type { PanelKey, PanelTranslator } from './panel-copy.ts'
import { buildPanelView } from './panel.ts'
import type { PanelProductView, PanelView } from './panel.ts'
import type { WorkBuddyPanelSnapshot } from './panel-store.ts'
import { useEffectOnce, useWorkBuddyPanel } from './panel-hooks.ts'
// Load-bearing: the SlotMap merge for `main` / `sidebar.footer.action` is what
// types the registrations in the client entry.
import './panel-slots.ts'

/**
 * Owner share of the sidebar-foot action hole: the shell renders the foot area
 * and hands each action only the column fold state. There is no button chrome
 * and no `label` seat — the entry is the whole surface.
 */
export interface SidebarFooterActionOwnerProps {
  /** Whether the sidebar renders wide content (false = 56px rail). */
  wide: boolean
}

/**
 * The injected face both panel slots carry, bound by the client entry so the
 * components stay unaware of the store, the layout service, and the module-level
 * poll loop.
 *
 * NOTE the split from {@link PanelComponentProps}: this is the face the
 * registration's `inject` factory RETURNS, and the renderer does not hand it to
 * the component verbatim. It destructures the `hooks` compartment OUT of the
 * face and re-exposes each member as a `use<Name>` prop — so a component that
 * reads `props.hooks.*` finds `undefined` at runtime and the renderer contains
 * that by ABDICATING the entry, making the surface vanish with no visible error.
 */
export interface PanelInjected {
  hooks: {
    workBuddyPanel: WorkBuddyPanelStore
  }
  /** Fetch both status documents now (the dashboard's Refresh action). */
  refresh(): void
  /** Start the shared background poll for this mount; returns its disposer. */
  startAutoRefresh(): () => void
  /** Select this panel in the center column (`ctx.layout.selectPanel`). */
  open(): void
  /**
   * Leave the dashboard and show the Conversation again
   * (`ctx.layout.selectPanel(null)`; the current Session is untouched).
   */
  close(): void
}

/**
 * The props a panel component actually receives: the bound `useX` seats (what
 * {@link PanelInjected}'s `hooks` compartment becomes), the pass-through
 * actions, and no raw `hooks` key.
 */
export interface PanelComponentProps {
  /** Bound from the injected `hooks.workBuddyPanel` compartment by the slot renderer. */
  useWorkBuddyPanel<T>(selector: (snapshot: WorkBuddyPanelSnapshot) => T): T
  /**
   * Locale seat for the `panel.workbuddy` namespace, bound by the
   * registration's own `locale` declaration. Optional so a missing locale face
   * degrades to English instead of crashing the surface.
   */
  t?: (key: string, params?: Record<string, unknown>) => string
  refresh(): void
  startAutoRefresh(): () => void
  open(): void
  close(): void
}

/** Props of the sidebar footer card: the panel face plus the shell's fold state. */
export interface WorkBuddyFooterEntryProps extends PanelComponentProps, SidebarFooterActionOwnerProps {}

/** Props of the centre-column dashboard cell. */
export type WorkBuddyPanelProps = PanelComponentProps

/**
 * The panel's view. `useWorkBuddyPanel` subscribes to the shared store, so a
 * completed sweep re-renders BOTH surfaces from the same snapshot — the footer
 * card's totals and the dashboard can never disagree about what was read.
 */
function usePanelView(props: PanelComponentProps): PanelView {
  const snapshot = props.useWorkBuddyPanel((state: WorkBuddyPanelSnapshot) => state)
  return buildPanelView({ snapshot })
}

/** Resolve the translator once per render from the injected locale seat. */
function translatorOf(props: PanelComponentProps): PanelTranslator {
  return panelTranslator(props.t)
}

/** One small glyph: a filled dot whose colour follows the product's state. */
function stateClass(product: PanelProductView): string {
  if (product.state === 'signed-in') return 'wbp-state wbp-stateOk'
  if (product.state === 'error') return 'wbp-state wbp-stateError'
  if (product.state === 'signed-out') return 'wbp-state wbp-stateWarn'
  return 'wbp-state'
}

/** One labelled figure. */
function StatTile({ label, value, pending, t }: {
  label: PanelKey
  value: string
  pending?: PanelKey | undefined
  t: PanelTranslator
}): ReactNode {
  const empty = value === ''
  return (
    <div className="wbp-stat">
      <span className="wbp-statLabel">{t(label)}</span>
      <span className={empty ? 'wbp-statValue wbp-statValueEmpty' : 'wbp-statValue'}>
        {empty ? (pending === undefined ? '' : t(pending)) : value}
      </span>
    </div>
  )
}

/** The figures shared by both surfaces for one product. */
function statValue(product: PanelProductView, label: PanelKey): string {
  return product.stats.find(stat => stat.label === label)?.value ?? ''
}

/** The pending key of one product's credit figure, when it has none. */
function statPending(product: PanelProductView, label: PanelKey): PanelKey | undefined {
  return product.stats.find(stat => stat.label === label)?.pending
}

/** One product's full block on the dashboard. */
function ProductCard({ product, t }: { product: PanelProductView; t: PanelTranslator }): ReactNode {
  const stateText = product.state === 'signed-in'
    ? t('signedIn')
    : product.state === 'signed-out'
      ? t('signedOut')
      : product.state === 'error'
        ? t('failure')
        : t('loading')
  return (
    <section className="wbp-card">
      <div className="wbp-cardHead">
        <span className="wbp-cardName">{product.name}</span>
        <span className={stateClass(product)}>{stateText}</span>
        <span className="wbp-spacer" />
        {product.benched > 0 ? (
          <span className="wbp-state wbp-stateWarn">{t('benched', { count: product.benched })}</span>
        ) : null}
        {product.catalogSource === 'none' ? null : (
          <span className="wbp-state">
            {t(product.catalogSource === 'live'
              ? 'sourceLive'
              : product.catalogSource === 'saved' ? 'sourceSaved' : 'sourceFallback')}
          </span>
        )}
      </div>
      {product.detail === undefined ? null : <p className="wbp-detail">{product.detail}</p>}
      <div className="wbp-stats">
        {product.stats.map(stat => (
          <StatTile
            key={stat.label}
            label={stat.label}
            value={stat.value}
            pending={stat.pending}
            t={t}
          />
        ))}
      </div>
    </section>
  )
}

/**
 * The centre-column dashboard, registered into the layout's keyed `main` slot
 * under `workbuddy-panel`. Selecting that key is what the footer card's
 * `open()` does, so the two registrations are one navigation entry.
 *
 * The panel covers the Conversation while it is open, which is why it carries
 * its own way back (`close`): without one the footer card could only re-select
 * a panel the user is already looking at.
 */
export function WorkBuddyPanel(props: WorkBuddyPanelProps): ReactNode {
  const view = usePanelView(props)
  const t = translatorOf(props)

  return (
    <div className="wbp-panel">
      <header className="wbp-head">
        <h2 className="wbp-title">{t('nav')}</h2>
        <span className="wbp-spacer" />
        <div className="wbp-headActions">
          <button type="button" className="wbp-button" onClick={() => { props.refresh() }}>
            {t('refresh')}
          </button>
          <button type="button" className="wbp-button" onClick={() => { props.close() }}>
            {t('close')}
          </button>
        </div>
      </header>

      {!view.available && !view.loading ? (
        <div className="wbp-notice">
          <p className="wbp-hint">{t('unavailable')}</p>
        </div>
      ) : null}

      {view.loading ? <p className="wbp-hint">{t('loading')}</p> : null}

      {view.available ? (
        <div className="wbp-summary">
          <span className="wbp-chip">
            <span>{t('accounts')}</span>
            <span className="wbp-chipValue wbp-num">{view.accountCount}</span>
          </span>
          <span className="wbp-chip">
            <span>{t('models')}</span>
            <span className="wbp-chipValue wbp-num">{view.modelCount}</span>
          </span>
          {view.benchedCount > 0 ? (
            <span className="wbp-chip">
              <span className="wbp-chipValue wbp-num">{view.benchedCount}</span>
              <span>{t('benched', { count: view.benchedCount })}</span>
            </span>
          ) : null}
        </div>
      ) : null}

      {view.products.map(product => (
        <ProductCard key={product.id} product={product} t={t} />
      ))}
    </div>
  )
}

/**
 * The sidebar footer card, registered into `sidebar.footer.action` — the list
 * the shell renders in the sidebar's foot area directly ABOVE the Settings
 * seat, so the card reads as a bottom-pinned sibling of Settings rather than a
 * global panel icon at the top of the column.
 *
 * The shell wraps nothing here, so this component owns the surface: the button,
 * its chrome and its accessible name. In the expanded column it draws the title
 * row and one line per product (accounts, total credit, models) — the two
 * products are never merged into one figure, because their credits are not
 * convertible. In the 56px rail it collapses to a 36px icon button, matching the
 * shell's own rail geometry. `wide` arrives from the shell as an owner prop.
 *
 * The poll starts here rather than in the panel: the card is always mounted, so
 * the dashboard opens with data already in hand.
 */
export function WorkBuddyFooterEntry(props: WorkBuddyFooterEntryProps): ReactNode {
  const view = usePanelView(props)
  const t = translatorOf(props)
  const startAutoRefresh = props.startAutoRefresh
  const refresh = props.refresh

  useEffectOnce(startAutoRefresh)

  if (!props.wide) {
    return (
      <button
        type="button"
        className="wbp-railButton"
        aria-label={t('railLabel')}
        title={view.footTitle === '' ? t('footerLabel') : view.footTitle}
        onClick={() => { props.open() }}
      >
        <Glyph size={18} />
      </button>
    )
  }

  return (
    <button
      type="button"
      className="wbp-foot"
      aria-label={view.footTitle === '' ? t('footerLabel') : view.footTitle}
      title={view.footTitle === '' ? t('footerLabel') : view.footTitle}
      onClick={() => { props.open() }}
      onDoubleClick={() => { refresh() }}
    >
      <span className="wbp-footTop">
        <Glyph size={16} />
        <span className="wbp-footName">{t('nav')}</span>
        <span className="wbp-spacer" />
      </span>
      <span className="wbp-footLines">
        {view.products.map(product => (
          <span className="wbp-footLine" key={product.id}>
            <span className="wbp-footLineLabel">{product.name}</span>
            <span className="wbp-spacer" />
            {product.state === 'signed-in' ? (
              <>
                <span className="wbp-num">{statValue(product, 'accountCount')}</span>
                <span className="wbp-num">
                  {statValue(product, 'creditTotal') === ''
                    ? t(statPending(product, 'creditTotal') ?? 'creditPending')
                    : statValue(product, 'creditTotal')}
                </span>
              </>
            ) : (
              <span>{product.state === 'signed-out' ? t('signedOut') : t('failure')}</span>
            )}
          </span>
        ))}
      </span>
    </button>
  )
}

/**
 * A 20×20 mark for the rail button. A glyph rather than an icon dependency:
 * the panel needs exactly one, and a package import would be a second client
 * module the browser has to resolve for one shape.
 */
function Glyph({ size }: { size: number }): ReactNode {
  return (
    <span className="wbp-glyph" aria-hidden="true">
      <svg viewBox="0 0 20 20" width={size} height={size} focusable="false">
        <circle cx="10" cy="10" r="7.25" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.45" />
        <path d="M6.4 10.2 L9 12.8 L13.8 7.4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}
