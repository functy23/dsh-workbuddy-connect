/**
 * React binding for the shared panel store: the `useSyncExternalStore` seat
 * both panel surfaces read through, plus the two effects that keep the poll
 * alive for exactly as long as a surface is mounted.
 *
 * Kept apart from `panel-view.tsx` so the components stay render-only and the
 * subscription logic has one home.
 *
 * @module dsh-workbuddy-connect/client/panel-hooks
 */

import { useEffect, useSyncExternalStore } from 'react'
import type { WorkBuddyPanelSnapshot, WorkBuddyPanelStore } from './panel-store.ts'

/**
 * Subscribe to the shared panel store.
 *
 * `getServerSnapshot` is the same reader as `getSnapshot`: the store is a
 * module-level singleton with a stable in-memory snapshot, so server rendering
 * (and a test renderer without a browser) reads exactly what a client would.
 */
export function useWorkBuddyPanel<T>(
  store: WorkBuddyPanelStore,
  selector: (snapshot: WorkBuddyPanelSnapshot) => T,
): T {
  return useSyncExternalStore(
    listener => store.subscribe(listener),
    () => selector(store.getSnapshot()),
    () => selector(store.getSnapshot()),
  )
}

/**
 * Run `start` once for the mount, disposing on unmount.
 *
 * The panel's poll is started by the sidebar card (always mounted) rather than
 * by the dashboard, and `start()` is idempotent per store — so opening the
 * dashboard does not start a second timer, and closing it does not stop the
 * card's.
 */
export function useEffectOnce(start: () => () => void): void {
  useEffect(() => start(), [start])
}
