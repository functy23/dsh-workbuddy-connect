/**
 * The composer's credit badge: "WorkBuddy: 5,266" beside the harness's own
 * token / cache-hit readout, shown only while a WorkBuddy model is selected.
 *
 * Why this seat and not a surface of its own: the composer dock is where DSH
 * already states what the turn cost (tokens, cache-hit rate, speed). A credit
 * figure answers the next question — "and how much of my quota is left" — so it
 * belongs in that row rather than in a card elsewhere. It is pushed to the far
 * right (`margin-left:auto`) so it reads as a separate fact rather than as
 * another term in the harness's own sentence.
 *
 * Why it is conditional on the model: the figure describes the quota behind the
 * model about to answer. Showing it while some other provider is selected would
 * attach a WorkBuddy number to a session that cannot spend it.
 *
 * Two seats are read, and both are checked before anything is rendered:
 *
 * 1. **the session's current model** — through the same `ModelDirectory` store the
 *    reasoning-probe control uses, read with `useSyncExternalStore` so a model
 *    switch re-renders this badge;
 * 2. **the credit itself** — from the panel store both the sidebar card and the
 *    dashboard already poll, so the three surfaces can never disagree about what
 *    is left.
 *
 * A host that supplies neither (an older client, or a profile without the
 * composer dock) renders nothing: this is an annotation, never a requirement.
 *
 * @module dsh-workbuddy-connect/client/credit-badge
 */

import { useCallback, useSyncExternalStore } from 'react'
import type { ModelDirectory } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import { buildPanelView } from './panel.ts'
import { cardVariantFor } from './WorkBuddyProbeControl.tsx'
import type { PanelTranslator } from './panel-copy.ts'
import type { WorkBuddyPanelStore } from './panel-store.ts'

/** Props the composer dock hands this entry. */
export interface WorkBuddyCreditBadgeProps {
  /** Resolves the session's current model selection. */
  directory: ModelDirectory['store']
  /** The shared status store the sidebar card and dashboard read. */
  panel: WorkBuddyPanelStore
  /** The dock's copy binder, for the panel namespace. */
  t: PanelTranslator
}

/** One credit figure, grouped the way every other surface in this plugin groups it. */
function formatCredit(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)
}

/**
 * The badge.
 *
 * Both seats are read through `useSyncExternalStore` with the same
 * subscribe/snapshot pair the probe control uses, so a model switch and a landed
 * sweep each update the figure in place.
 */
export function WorkBuddyCreditBadge({ directory, panel, t }: WorkBuddyCreditBadgeProps): React.ReactNode {
  const subscribeDirectory = useCallback((listener: () => void) => directory.subscribe(listener), [directory])
  const readDirectory = useCallback(() => directory.getSnapshot(), [directory])
  const selection = useSyncExternalStore(subscribeDirectory, readDirectory, readDirectory).current
  const subscribePanel = useCallback((listener: () => void) => panel.subscribe(listener), [panel])
  const readPanel = useCallback(() => panel.getSnapshot(), [panel])
  const snapshot = useSyncExternalStore(subscribePanel, readPanel, readPanel)

  // A model under any other provider is not this badge's subject: the quota it
  // would name cannot be spent by the turn about to run.
  const card = selection == null ? undefined : cardVariantFor(selection.provider)
  if (card === undefined) return null

  const product = buildPanelView({ snapshot }).products.find(candidate => candidate.id === card.id)
  const remaining = product?.creditsRemaining
  // Signed out, or a balance not read yet: no figure rather than a zero, which
  // would read as "this account is empty".
  if (product === undefined || product.state !== 'signed-in' || remaining === undefined) return null

  const label = t('creditBadgeLabel', { product: card.appName, remaining: formatCredit(remaining) })
  return (
    <span className="wbp-creditBadge" title={label} aria-label={label} data-workbuddy-credit-badge="">
      <span className="wbp-creditBadgeName">{card.appName}</span>
      <span className="wbp-creditBadgeValue">{formatCredit(remaining)}</span>
    </span>
  )
}
