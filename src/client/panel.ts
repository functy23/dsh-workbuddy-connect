/**
 * View layer for the WorkBuddy dashboard (the sidebar footer card and the
 * centre-column panel it opens).
 *
 * Deliberately JSX-free and React-free, mirroring the plugin's other view
 * modules: it turns the shared status snapshot into one presentation tree that
 * both React components render, and it owns no side effects. Node tests drive
 * everything here without a DOM.
 *
 * Every displayed string is decided here, as a PanelKey plus the numbers the
 * component interpolates — so the components carry no formatting, pluralization,
 * or copy of their own, and the panel follows the harness's active language.
 *
 * @module dsh-workbuddy-connect/client/panel
 */

import type { WorkBuddySidebarCreditStyle, WorkBuddyWebAccount, WorkBuddyWebStatus } from '../status-paths.ts'
import { WORKBUDDY_SIDEBAR_CREDIT_VISIBLE_DEFAULT } from '../status-paths.ts'
import { CARD_VARIANTS } from './card-variants.ts'
import type { WorkBuddyCardVariant } from './card-variants.ts'
import { statedPreference } from './status-document.ts'
import type { PanelKey } from './panel-copy.ts'
import type { WorkBuddyPanelSnapshot } from './panel-store.ts'

/** One labelled figure on the dashboard. */
export interface PanelStat {
  /** Row-label key into the panel dictionary. */
  label: PanelKey
  /** The figure itself, pre-formatted ("3", "1542", "12"). */
  value: string
  /** A secondary detail under the figure, when there is one (a PanelKey). */
  pending?: PanelKey
}

/** One product's block on the dashboard. */
export interface PanelProductView {
  /** Variant id, which is also the product's stable identity. */
  id: string
  /** Product name as the user knows it ("WorkBuddy", "WorkBuddy AI"). */
  name: string
  /** The product's sign-in state, already reduced to one key. */
  state: 'signed-in' | 'signed-out' | 'error' | 'unknown'
  /** A diagnosable reason or failure message, when the host sent one. */
  detail?: string
  /** Figures: accounts, credit, models. */
  stats: readonly PanelStat[]
  /** Accounts the pool is currently benching. */
  benched: number
  /** Where the served model list came from, when the document says. */
  catalogSource: 'live' | 'saved' | 'fallback' | 'none'
  /**
   * Remaining credit across the pool, undefined when no account reported one.
   *
   * The same number `creditTotal` carries as a stat, kept here as a number
   * because the footer card renders it as a BAR — a fill needs the value, not
   * the formatted string the stat list hands a reader.
   */
  creditsRemaining?: number
  /**
   * The pool's capacity, undefined when it cannot be stated completely.
   *
   * "Cannot be stated" covers an uncapped account and any account whose answer
   * carried no capacity — see {@link creditCapacity} — and the card then shows
   * the remaining figure alone.
   */
  creditsCapacity?: number
}

/** The whole dashboard. */
export interface PanelView {
  /** Both products, in display order. */
  products: readonly PanelProductView[]
  /**
   * The products the SIDEBAR CARD lists — {@link products} minus the ones with
   * nothing to say.
   *
   * The dashboard still shows every product (it is where a product gets set up),
   * while the card is a glance at what is being spent: a product with no account
   * has no figures, and a permanent "WorkBuddy AI · Not signed in" row turns a
   * status card into a reminder about something the user does not use. A product
   * WITH accounts stays even when all of them are set aside — that is a fact
   * about the card's own subject, and hiding it would hide the one state worth
   * acting on.
   *
   * Decided here rather than in the component so it is testable without a DOM,
   * like every other fact this module produces.
   */
  footProducts: readonly PanelProductView[]
  /** Whether a sweep is in flight and nothing has been read yet. */
  loading: boolean
  /** Whether a host route has ever answered. */
  available: boolean
  /** Accounts across both pools. */
  accountCount: number
  /** Accounts benched across both pools. */
  benchedCount: number
  /** Models across both pools. */
  modelCount: number
  /** The footer card's tooltip: what the card opens and what it currently says. */
  footTitle: string
  /**
   * How the sidebar states each product's credit — the user's choice, carried on
   * the status document (see {@link WorkBuddySidebarCreditStyle}).
   *
   * Resolved here rather than inside the component so the choice is testable
   * without a DOM, and so both surfaces read one value: a document that cannot
   * state the preference (an older host) leaves the default in place.
   */
  creditStyle: WorkBuddySidebarCreditStyle
  /**
   * Whether the sidebar draws its footer card at all — the user's choice,
   * carried on the status document beside the style.
   *
   * Resolved here rather than in the component for the same reason as the
   * style, and read by BOTH surfaces: the card uses it to decide whether to
   * render, and the dashboard's own numbers are unaffected either way (the
   * switch hides a surface, it does not stop the plugin reading the pool).
   */
  creditVisible: boolean
}

/** Inputs the projection needs beyond the snapshot itself. */
export interface BuildPanelViewOptions {
  snapshot: WorkBuddyPanelSnapshot
  /** Clock, so a cooldown's remaining time is measured against a real "now". */
  now?: number
}

/** Thousands-separated integer, using the reader's own grouping. */
function formatCount(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)
}

/**
 * Total remaining credit for one product's pool, or undefined when no account
 * reported a balance.
 *
 * Deliberately a SUM over accounts that answered, not over the pool: a pool
 * where one account's lookup failed would otherwise show a figure that silently
 * treats the missing account as zero. Products are never summed together — the
 * two subscriptions' credits are not convertible — which is why this is
 * per-product and there is no grand total anywhere in the view.
 */
function creditTotal(accounts: readonly WorkBuddyWebAccount[]): number | undefined {
  const known = accounts.filter(account => account.credits !== undefined)
  if (known.length === 0) return undefined
  return known.reduce((sum, account) => sum + (account.credits ?? 0), 0)
}

/**
 * The pool's stated capacity, summed the same way as {@link creditTotal}.
 *
 * undefined unless EVERY account that reported a balance also reported a cap:
 * a partial sum would understate the pool's size while looking like a complete
 * figure, and the used amount derived from it would be wrong in the direction
 * nobody checks (used = total - remaining would come out too large).
 */
function creditCapacity(accounts: readonly WorkBuddyWebAccount[]): number | undefined {
  const known = accounts.filter(account => account.credits !== undefined)
  if (known.length === 0) return undefined
  if (known.some(account => account.creditsTotal === undefined)) return undefined
  const capacities = known.map(account => account.creditsTotal ?? 0)
  // An all-zero capacity is the upstream saying "no cap", not a zero-sized pool.
  if (capacities.every(capacity => capacity <= 0)) return undefined
  return capacities.reduce((sum, capacity) => sum + capacity, 0)
}

/** Whether an account is benched right now. */
function isBenched(account: WorkBuddyWebAccount, now: number): boolean {
  return account.cooldown !== undefined && account.cooldown.untilMs > now
}

/**
 * The single key naming a product's sign-in state.
 *
 * The pool is the authority — "signed in" means *the pool has an account*, not
 * that the desktop app is signed in — so the state is read from the account
 * section the host sends in both states, never inferred from a missing one.
 */
function productState(status: WorkBuddyWebStatus | undefined): PanelProductView['state'] {
  if (status === undefined) return 'unknown'
  if (status.status === 'error') return 'error'
  return status.status === 'signed-in' ? 'signed-in' : 'signed-out'
}

/** Accounts the document carries, whichever sign-in state it is in. */
function accountsOf(status: WorkBuddyWebStatus | undefined): readonly WorkBuddyWebAccount[] {
  if (status === undefined || status.status === 'error') return []
  return status.accounts?.accounts ?? []
}

/**
 * The one-line explanation a product shows under its name, when it has one.
 *
 * Precedence is deliberate: a host failure outranks a sign-in reason (it means
 * the plugin could not answer at all), and a sign-in reason outranks the
 * generic signed-out hint (it names the file to fix).
 */
function detailOf(status: WorkBuddyWebStatus | undefined): string | undefined {
  if (status === undefined) return undefined
  if (status.status === 'error') return status.message
  return status.status === 'signed-out' ? status.reason : undefined
}

/** One product's block, from its own status document. */
function productView(
  variant: WorkBuddyCardVariant,
  status: WorkBuddyWebStatus | undefined,
  now: number,
): PanelProductView {
  const accounts = accountsOf(status)
  const benched = accounts.filter(account => isBenched(account, now)).length
  const total = creditTotal(accounts)
  const models = status !== undefined && status.status === 'signed-in' ? status.models ?? [] : []
  const catalogSource = status !== undefined && status.status === 'signed-in'
    ? status.catalog?.source ?? 'none'
    : 'none'
  const stats: PanelStat[] = [
    { label: 'accountCount', value: formatCount(accounts.length) },
    {
      label: 'creditTotal',
      value: total === undefined ? '' : formatCount(total),
      ...total === undefined ? { pending: 'creditPending' as const } : {},
    },
    { label: 'modelCount', value: formatCount(models.length) },
  ]
  const capacity = creditCapacity(accounts)
  return {
    id: variant.id,
    name: variant.appName,
    state: productState(status),
    ...detailOf(status) === undefined ? {} : { detail: detailOf(status) as string },
    stats,
    benched,
    catalogSource,
    ...total === undefined ? {} : { creditsRemaining: total },
    ...capacity === undefined ? {} : { creditsCapacity: capacity },
  }
}

/**
 * Project one snapshot into the panel's view.
 *
 * `available` is a fact about the HOST, not about sign-in: with no route
 * answering, the dashboard says so once instead of rendering two products that
 * look signed out for reasons the plugin cannot see.
 */
export function buildPanelView(options: BuildPanelViewOptions): PanelView {
  const { snapshot } = options
  const now = options.now ?? Date.now()
  const products = CARD_VARIANTS.map(variant =>
    productView(variant, snapshot.statuses[variant.id], now))
  const accountCount = products.reduce((sum, product) => sum + countOf(product, 'accountCount'), 0)
  const modelCount = products.reduce((sum, product) => sum + countOf(product, 'modelCount'), 0)
  const benchedCount = products.reduce((sum, product) => sum + product.benched, 0)
  return {
    products,
    footProducts: products.filter(product =>
      product.state === 'signed-in' || countOf(product, 'accountCount') > 0),
    loading: snapshot.loading && snapshot.fetchedAt === 0,
    available: snapshot.fetchedAt > 0,
    accountCount,
    benchedCount,
    modelCount,
    footTitle: footTitle(products),
    creditStyle: creditStyleOf(snapshot),
    creditVisible: creditVisibleOf(snapshot),
  }
}

/**
 * The card's display preference, as the host stated it.
 *
 * Read from whichever document carries it (both variants are told the same
 * value — it is one plugin-wide setting, not a per-product one), and any
 * document that cannot state it — an older host, or a read that failed — leaves
 * the default shape in place rather than blanking the card.
 */
function creditStyleOf(snapshot: WorkBuddyPanelSnapshot): WorkBuddySidebarCreditStyle {
  return statedPreference(snapshot.statuses, status => status.sidebarCreditStyle) ?? 'remaining'
}

/**
 * Whether the sidebar keeps its card, as the host stated it.
 *
 * The same shape as {@link creditStyleOf} — one plugin-wide answer read from
 * whichever document carries it — with one deliberate difference: a document
 * that does NOT state it means "present", not "hidden". An older host, a read
 * that failed, or a profile with no settings service must all leave the card
 * exactly where it was; only an explicit `false` takes it away.
 */
function creditVisibleOf(snapshot: WorkBuddyPanelSnapshot): boolean {
  return statedPreference(snapshot.statuses, status => status.sidebarCreditVisible)
    ?? WORKBUDDY_SIDEBAR_CREDIT_VISIBLE_DEFAULT
}
/** Read one numeric stat back out of a product block. */
function countOf(product: PanelProductView, label: PanelKey): number {
  const stat = product.stats.find(candidate => candidate.label === label)
  if (stat === undefined || stat.value === '') return 0
  // The value was formatted for display; the grouping separator is the only
  // thing between it and a number, so strip anything that is not a digit.
  return Number(stat.value.replace(/\D/gu, '')) || 0
}

/**
 * The footer card's tooltip: the product count plus each product's own state,
 * so the card's accessible name carries the same facts its visible rows do.
 */
function footTitle(products: readonly PanelProductView[]): string {
  const parts = products.map(product =>
    product.state === 'signed-in'
      ? product.name + ': ' + String(countOf(product, 'accountCount')) + '/' + String(countOf(product, 'modelCount'))
      : product.name + ': ' + product.state)
  return parts.join(' · ')
}
