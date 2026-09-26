/** Reading and shape-checking a product's status document. */

import { isJsonObject } from '../json-value.ts'
import { CARD_VARIANTS } from './card-variants.ts'
import type { WorkBuddyCardVariant } from './card-variants.ts'
import type { WorkBuddyWebStatus } from '../status-paths.ts'

/** A status document that is a real answer, as opposed to a failed read. */
export type WorkBuddyAnsweredStatus = Exclude<WorkBuddyWebStatus, { status: 'error' }>

/**
 * Whether a parsed status response really is a status document.
 *
 * A 200 is not a promise about the body: it may be empty, literal `null`, a
 * non-JSON page from a proxy, or an array. Both halves of the browser plugin
 * read the same route, so both must agree on what is valid — storing an
 * unreadable value puts something in state that the next render dereferences.
 *
 * The check is deliberately limited to the discriminator (plus `error`'s
 * `message`, which the error paragraph renders): validating optional fields
 * here would reject documents the host legitimately omits fields from, which
 * is exactly the shape a host older than the field produces.
 */
export function isWorkBuddyWebStatus(value: unknown): value is WorkBuddyWebStatus {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const wrapped = value as Record<string, unknown>
  const status = wrapped['status']
  if (status === 'signed-out' || status === 'signed-in') return true
  return status === 'error' && typeof wrapped['message'] === 'string'
}

/**
 * What one read of a status document produced.
 *
 * The three outcomes are separated because each caller degrades differently and
 * none of them may be collapsed: a readable document replaces what is on screen,
 * a refused read carries the host's own diagnosis (the sentence naming the file
 * or the binary to fix), and an unreadable one leaves the previous document
 * alone rather than blanking a surface over a transient failure.
 */
export type WorkBuddyStatusRead =
  | { state: 'read', status: WorkBuddyWebStatus }
  /** The host answered, but not with a document: its `error` text is the diagnosis. */
  | { state: 'refused', message: string }
  /** The request threw, or the body was not a status document at all. */
  | { state: 'unreadable' }

/**
 * Read one product's status document.
 *
 * Every browser-half reader issues the identical request — the variant's own
 * path, `accept: application/json`, same-origin credentials, the caller's abort
 * signal — and every one of them then has to decide what a body that is not a
 * status document means. Both halves of that live here, so a reader only has to
 * state its own degradation policy.
 *
 * @param variant - which product's route to read.
 * @param signal - aborts the request with the caller's lifetime.
 */
export async function readWorkBuddyStatus(
  variant: WorkBuddyCardVariant,
  signal?: AbortSignal,
): Promise<WorkBuddyStatusRead> {
  let response: Response
  try {
    response = await fetch(variant.statusPath, {
      headers: { accept: 'application/json' },
      credentials: 'same-origin',
      ...signal === undefined ? {} : { signal },
    })
  } catch {
    return { state: 'unreadable' }
  }
  const body: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    // The host puts its diagnosis in the body — "no WorkBuddy Electron binary is
    // configured…" — and that sentence is the only thing that tells the user
    // what to fix, so it survives rather than becoming a bare status code.
    const message = isJsonObject(body) && typeof body['error'] === 'string'
      ? body['error']
      : `HTTP ${String(response.status)}`
    return { state: 'refused', message }
  }
  return isWorkBuddyWebStatus(body) ? { state: 'read', status: body } : { state: 'unreadable' }
}

/**
 * One plugin-wide preference, read from whichever document states it.
 *
 * A preference that belongs to the plugin rather than to a product is written to
 * both products' documents, so a reader has to pick one. The pick is not
 * arbitrary: a document that failed to load must not answer for the pair, or one
 * broken route would silently reset a saved preference to its default. So only a
 * document that is a real answer *and* actually states the field counts, and the
 * caller's `read` decides whether the field is stated — which is how a
 * preference whose absent value means "keep it as it was" stays distinguishable
 * from one whose absent value means "off".
 *
 * @param statuses - the latest document per variant id; a variant that never
 *   answered is absent.
 * @param read - pulls this preference out of one answered document.
 * @returns the first stated value, or `undefined` when no document states one.
 */
export function statedPreference<T>(
  statuses: Partial<Record<string, WorkBuddyWebStatus>>,
  read: (status: WorkBuddyAnsweredStatus) => T | undefined,
): T | undefined {
  for (const variant of CARD_VARIANTS) {
    const status = statuses[variant.id]
    if (status === undefined || status.status === 'error') continue
    const value = read(status)
    if (value !== undefined) return value
  }
  return undefined
}
