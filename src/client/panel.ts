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

import type { WorkBuddyWebAccount, WorkBuddyWebStatus } from '../status-paths.ts'
import { CARD_VARIANTS } from './card-variants.ts'
import type { WorkBuddyCardVariant } from './card-variants.ts'
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
}

/** The whole dashboard. */
export interface PanelView {
  /** Both products, in display order. */
  products: readonly PanelProductView[]
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
  return {
    id: variant.id,
    name: variant.appName,
    state: productState(status),
    ...detailOf(status) === undefined ? {} : { detail: detailOf(status) as string },
    stats,
    benched,
    catalogSource,
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
    loading: snapshot.loading && snapshot.fetchedAt === 0,
    available: snapshot.fetchedAt > 0,
    accountCount,
    benchedCount,
    modelCount,
    footTitle: footTitle(products),
  }
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
