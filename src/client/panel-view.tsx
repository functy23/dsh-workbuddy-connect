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
 * Styles ride the two stylesheets `./ui-styles.ts` returns (the panel's own, and
 * the settings page's shared row pieces), injected once by the client entry.
 *
 * @module dsh-workbuddy-connect/client/panel-view
 */

import type { ReactNode } from 'react'
import { Badge, Ring, StatTile as UiStatTile, cx } from './ui-rows.tsx'
import { ActionButton } from './ui-button.tsx'
import type { WorkBuddyPanelStore } from './panel-store.ts'
import { panelTranslator } from './panel-copy.ts'
import type { PanelKey, PanelLocaleSeat, PanelTranslator } from './panel-copy.ts'
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
   *
   * Typed as {@link PanelLocaleSeat} — the namespace's own key union, not
   * `string` — because that is what the renderer actually composes for a
   * registration that declares a `locale`: a seat accepting every string is the
   * one shape it cannot be assigned to.
   */
  t?: PanelLocaleSeat
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

/** The tag tone a product's sign-in state earns. */
function stateTone(product: PanelProductView): 'success' | 'danger' | 'warning' | 'neutral' {
  if (product.state === 'signed-in') return 'success'
  if (product.state === 'error') return 'danger'
  if (product.state === 'signed-out') return 'warning'
  return 'neutral'
}

/** One product's state as words. */
function stateText(product: PanelProductView, t: PanelTranslator): string {
  if (product.state === 'signed-in') return t('signedIn')
  if (product.state === 'signed-out') return t('signedOut')
  if (product.state === 'error') return t('failure')
  return t('loading')
}

/** The figures shared by both surfaces for one product. */
function statValue(product: PanelProductView, label: PanelKey): string {
  return product.stats.find(stat => stat.label === label)?.value ?? ''
}

/**
 * One product on the dashboard: its identity, its state, and its figures.
 *
 * Built from the same row pieces the settings page uses, so the two surfaces are
 * visibly the same product's UI. The block is a `<section>` of rows rather than
 * a card because the reference layout has no card surfaces at all.
 */
function ProductCard({ product, t }: { product: PanelProductView; t: PanelTranslator }): ReactNode {
  const tone = stateTone(product)
  return (
    <section className="wbp-card" aria-label={product.name}>
      <div className="wbp-cardHead">
        <span className="wbp-avatar" aria-hidden="true">{product.name.slice(0, 1).toUpperCase()}</span>
        <span className="wbp-cardIdentity">
          <span className="wbp-cardTitle">{product.name}</span>
        </span>
        <span className="wbp-spacer" />
        <Badge tone={tone === 'success' ? 'plain' : tone === 'danger' ? 'error' : tone === 'warning' ? 'warn' : 'muted'}>
          {stateText(product, t)}
        </Badge>
        {product.benched > 0 ? <Badge tone="warn">{t('benched', { count: product.benched })}</Badge> : null}
        {product.catalogSource === 'none' ? null : (
          <Badge tone="muted">
            {t(product.catalogSource === 'live'
              ? 'sourceLive'
              : product.catalogSource === 'saved' ? 'sourceSaved' : 'sourceFallback')}
          </Badge>
        )}
      </div>
      {product.detail === undefined ? null : <p className="wbp-noticeHint">{product.detail}</p>}
      <div className="wbp-tiles">
        {product.stats.map(stat => (
          <UiStatTile
            key={stat.label}
            label={t(stat.label)}
            value={stat.value === '' ? (stat.pending === undefined ? '' : t(stat.pending)) : stat.value}
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
    // The dashboard is the panel's own scrollport: the layout hands the `main`
    // cell the whole centre column, so this element owns the background and the
    // scrolling, and the content column inside it is the same 760px column the
    // reference's dashboard uses.
    <div className="wbp-main">
      <div className="wbp-mainInner">
        <header className="wbp-header">
          <Ring percent={ringPercent(view)} warn={view.benchedCount > 0} size={20} />
          <span className="wbp-headerText">
            <h2 className="wbp-titleLg">{t('nav')}</h2>
            <p className="wbp-subtitle">{view.available ? t('footerLabel') : t('unavailable')}</p>
          </span>
          <span className="wbp-spacer" />
          <ActionButton label={t('refresh')} onClick={() => { props.refresh() }} />
          <ActionButton label={t('close')} onClick={() => { props.close() }} />
        </header>

        {!view.available && !view.loading ? (
          <div className="wbp-notice wbp-noticeError" role="status">
            <p className="wbp-noticeTitle">{t('failure')}</p>
            <p className="wbp-noticeHint">{t('unavailable')}</p>
          </div>
        ) : null}

        {view.loading ? <p className="wbp-hint">{t('loading')}</p> : null}

        {view.available ? (
          <div className="wbp-tiles">
            <UiStatTile label={t('accounts')} value={String(view.accountCount)} />
            <UiStatTile label={t('models')} value={String(view.modelCount)} />
            {view.benchedCount === 0
              ? null
              : <UiStatTile label={t('benched', { count: view.benchedCount })} value={String(view.benchedCount)} />}
          </div>
        ) : null}

        {view.products.map(product => (
          <ProductCard key={product.id} product={product} t={t} />
        ))}
      </div>
    </div>
  )
}

/**
 * The header ring's sweep: how much of what the pools hold is servable now.
 *
 * A ring rather than a number because the header has no room for a sentence, and
 * "everything is fine" is the state a glance should confirm. With nothing read
 * yet the ring is empty rather than full, so "nothing known" does not look like
 * "all healthy".
 */
function ringPercent(view: PanelView): number {
  if (view.accountCount === 0) return 0
  return ((view.accountCount - view.benchedCount) / view.accountCount) * 100
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
 *
 * The one thing that can take this card away is the user's own switch
 * ({@link PanelView.creditVisible}). The component still MOUNTS when that is
 * off — it renders `null` and keeps the shared poll alive with it. That matters:
 * the poll's home is this entry, and a component that unmounted would leave the
 * dashboard and the composer badge reading a snapshot nothing refreshes.
 */
export function WorkBuddyFooterEntry(props: WorkBuddyFooterEntryProps): ReactNode {
  const view = usePanelView(props)
  const t = translatorOf(props)
  const startAutoRefresh = props.startAutoRefresh
  const refresh = props.refresh

  useEffectOnce(startAutoRefresh)

  // Switched off in the settings. Returning after the hooks (never before them)
  // is what keeps the mount order stable across the flip, and what keeps the
  // background sweep running for the surfaces that remain on screen.
  if (!view.creditVisible) return null

  const label = view.footTitle === '' ? t('footerLabel') : view.footTitle

  if (!props.wide) {
    return (
      <button
        type="button"
        className="wbp-railButton"
        aria-label={t('railLabel')}
        title={label}
        onClick={() => { props.open() }}
      >
        <Ring percent={ringPercent(view)} warn={view.benchedCount > 0} size={18} />
      </button>
    )
  }

  return (
    <button
      type="button"
      className="wbp-foot"
      aria-label={label}
      title={label}
      onClick={() => { props.open() }}
      // A double-click re-reads rather than opening: the card is always on
      // screen, so "this is stale" is the one thing the click cannot express.
      onDoubleClick={() => { refresh() }}
    >
      <span className="wbp-footTop">
        <span className="wbp-footName">{t('nav')}</span>
        <span className="wbp-spacer" />
      </span>
      {/*
        * One line per product — or one line plus a ratio bar — according to the
        * display style the user chose in the settings ({@link view.creditStyle}):
        *
        * - `'remaining'` (default): the balance alone, named by the product it
        *   belongs to. The label carries the meaning ("WorkBuddy 剩余额度"), so
        *   the figure needs no column header, and the number that leads is the
        *   one people open the sidebar for — not the capacity ("/ 6200" across
        *   two accounts' 2800 + 3400), which is what the older shape led with.
        * - `'usage'`: the reference provider card's shape, a "used / total" pair
        *   over a bar of that ratio, which states how much of the cycle has been
        *   spent as well as what is left.
        *
        * Both are the same pool described twice; nothing is derived differently,
        * and the two products stay on their own lines in either style because
        * their credits are not convertible.
        *
        * Which products appear is the view model's call (footProducts), so that
        * decision stays testable without a DOM.
        */}
      {view.footProducts.map(product => {
        const remaining = product.creditsRemaining
        const capacity = product.creditsCapacity
        const format = (value: number): string =>
          new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)
        // Used is derived, never fetched: the upstream bills a balance and a cap,
        // and the spent amount is what is left over. Deriving it here keeps the
        // one invariant the pair has to satisfy — used + remaining === capacity —
        // true by construction, even against an upstream that reports a balance
        // above its own cap (clamped below, so the bar cannot exceed 100%).
        const used = capacity === undefined || remaining === undefined
          ? undefined
          : Math.max(0, capacity - remaining)
        const percent = capacity === undefined || capacity <= 0 || used === undefined
          ? 0
          : Math.min(100, (used / capacity) * 100)
        const usageStyle = view.creditStyle === 'usage'
        return (
          // The two styles need different shapes, not just different words: the
          // usage style stacks a head line over a full-width bar, the remaining
          // style is a single line.
          <span key={product.id} className={cx('wbp-footRow', usageStyle && 'wbp-footRowUsage')}>
            <span className="wbp-footHead">
              <span className="wbp-footLabel">
                {usageStyle ? product.name : t('creditRemainingLabel', { product: product.name })}
              </span>
              <span className="wbp-footAmount">
                {product.state !== 'signed-in'
                  ? stateText(product, t)
                  : usageStyle
                    ? used === undefined || capacity === undefined
                      ? remaining === undefined ? t('creditPending') : t('creditRemaining', { remaining: format(remaining) })
                      : t('creditUsed', { used: format(used), total: format(capacity) })
                    : remaining === undefined
                      ? t('creditPending')
                      : format(remaining)}
              </span>
            </span>
            {!usageStyle || product.state !== 'signed-in' || capacity === undefined ? null : (
              <span
                className="wbp-footBar"
                role="progressbar"
                aria-label={product.name}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(percent)}
              >
                <span className="wbp-footFill" style={{ width: `${String(percent)}%` }} />
              </span>
            )}
          </span>
        )
      })}
    </button>
  )
}

/** Read a numeric stat back out of a product block, for the card's bar. */
function countOf(product: PanelProductView, label: PanelKey): number {
  const value = statValue(product, label)
  // The figure was formatted for display; grouping separators are the only
  // thing between it and a number.
  return Number(value.replace(/\D/gu, '')) || 0
}
