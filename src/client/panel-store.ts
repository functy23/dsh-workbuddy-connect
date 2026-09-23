/**
 * Shared status poll for the WorkBuddy dashboard: one store both the sidebar
 * footer card and the centre-column panel read.
 *
 * The panel exists because the two products' pools are read *together* — the
 * footer card's whole job is one line summarising both, which no single status
 * document can answer. So one poller fetches every variant's status route and
 * publishes one snapshot; the dashboard then opens with data already in hand
 * instead of starting its own fetch on mount.
 *
 * Deliberately dependency-free apart from the route constants (a browser
 * bundle must not pull Node code in) and DOM-free at the fetch seam, so the
 * projection and its tests run under plain Node with an injected `fetch`.
 *
 * @module dsh-workbuddy-connect/client/panel-store
 */

import type { WorkBuddyWebStatus } from '../status-paths.ts'
import { CARD_VARIANTS } from './card-variants.ts'
import type { WorkBuddyCardVariant } from './card-variants.ts'
import { isWorkBuddyWebStatus } from './status-document.ts'

/** How often the store re-reads both status documents while it has a subscriber. */
export const PANEL_REFRESH_MS = 60_000

/** One published snapshot: both variants' latest documents, or the gap where one failed. */
export interface WorkBuddyPanelSnapshot {
  /**
   * Latest status document per variant id.
   *
   * A variant is ABSENT — not present-and-undefined — when its fetch has never
   * succeeded, so a reader distinguishes "not read yet" from "read and empty"
   * the same way the routes themselves do.
   */
  statuses: Partial<Record<string, WorkBuddyWebStatus>>
  /** Whether a sweep is in flight right now. */
  loading: boolean
  /** When the last completed sweep finished, epoch ms; 0 before the first. */
  fetchedAt: number
}

/** What the store needs from its environment; all optional so tests inject. */
export interface WorkBuddyPanelStoreOptions {
  /** Variants to poll. Defaults to both products. */
  variants?: readonly WorkBuddyCardVariant[]
  /** Fetch implementation. Defaults to the browser's same-origin `fetch`. */
  fetch?: typeof globalThis.fetch
  /** Sweep interval. Defaults to {@link PANEL_REFRESH_MS}. */
  intervalMs?: number
  /** Clock, for the snapshot's `fetchedAt`. */
  now?: () => number
}

/** The observable triple `useSyncExternalStore` consumes. */
export interface WorkBuddyPanelStore {
  getSnapshot(): WorkBuddyPanelSnapshot
  subscribe(listener: () => void): () => void
  /**
   * Sweep both routes and publish. Concurrent calls share one sweep, so a
   * subscriber that mounts while one is in flight does not start a second.
   */
  refresh(): Promise<void>
  /**
   * Begin the background sweep and return its disposer. Idempotent per store:
   * a second call returns the same disposer rather than starting a second
   * timer, because the footer card and the panel can both ask for it.
   */
  start(): () => void
}

/** Notify every subscriber without letting one faulty consumer suppress the rest. */
function notify(listeners: ReadonlySet<() => void>): void {
  for (const listener of listeners) {
    try {
      listener()
    } catch (error: unknown) {
      console.error('[dsh-workbuddy-connect] panel subscriber failed:', error)
    }
  }
}

/**
 * Create the shared panel store.
 *
 * A failed read leaves that variant's previous document in place rather than
 * clearing it: a transient network error must not blank a dashboard the user is
 * looking at, and the next sweep replaces it anyway.
 */
export function createWorkBuddyPanelStore(options: WorkBuddyPanelStoreOptions = {}): WorkBuddyPanelStore {
  const variants = options.variants ?? CARD_VARIANTS
  const doFetch = options.fetch ?? ((...args: Parameters<typeof globalThis.fetch>) => globalThis.fetch(...args))
  const intervalMs = options.intervalMs ?? PANEL_REFRESH_MS
  const now = options.now ?? (() => Date.now())

  let snapshot: WorkBuddyPanelSnapshot = { statuses: {}, loading: false, fetchedAt: 0 }
  const listeners = new Set<() => void>()
  let inFlight: Promise<void> | undefined
  let timer: ReturnType<typeof setInterval> | undefined

  const publish = (next: WorkBuddyPanelSnapshot): void => {
    if (Object.is(next.statuses, snapshot.statuses)
      && next.loading === snapshot.loading
      && next.fetchedAt === snapshot.fetchedAt) return
    snapshot = next
    notify(listeners)
  }

  const sweep = async (): Promise<void> => {
    publish({ ...snapshot, loading: true })
    const answers = await Promise.all(variants.map(async variant => {
      try {
        const response = await doFetch(variant.statusPath, {
          headers: { accept: 'application/json' },
          credentials: 'same-origin',
        })
        if (!response.ok) return undefined
        const value: unknown = await response.json().catch(() => undefined)
        return isWorkBuddyWebStatus(value) ? [variant.id, value] as const : undefined
      } catch {
        return undefined
      }
    }))
    const statuses: Partial<Record<string, WorkBuddyWebStatus>> = { ...snapshot.statuses }
    for (const answer of answers) if (answer !== undefined) statuses[answer[0]] = answer[1]
    publish({ statuses, loading: false, fetchedAt: now() })
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    refresh() {
      if (inFlight !== undefined) return inFlight
      inFlight = sweep().finally(() => {
        inFlight = undefined
      })
      return inFlight
    },
    start() {
      if (timer !== undefined) {
        return () => {
          if (timer === undefined) return
          clearInterval(timer)
          timer = undefined
        }
      }
      void this.refresh()
      timer = setInterval(() => { void this.refresh() }, intervalMs)
      timer.unref?.()
      return () => {
        if (timer === undefined) return
        clearInterval(timer)
        timer = undefined
      }
    },
  }
}
