/**
 * The on-disk shape every plugin-owned store shares: a version-tagged JSON
 * document under `$DSH_HOME`, written atomically and read as "nothing saved"
 * whenever anything about it is wrong.
 *
 * Six stores implement that same policy — the account pool, the saved catalog,
 * the usage tallies, the visibility lists, the probe results and the context
 * preferences. Each one used to carry its own copy of the read guard and its
 * own copy of the temp-file dance, which meant a change to either policy (a
 * size cap, a permissions bit, a new failure class) had to be made six times
 * and could be missed in five.
 *
 * The write is deliberately synchronous: every store's public write method is
 * synchronous and called from timers and event handlers, so an async writer
 * would push an `await` through six classes and their callers for no gain at
 * this size. What it is *not* is naive — see {@link writeStoreDocument}.
 *
 * @module dsh-workbuddy-connect/store-file
 */

import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { parseJsonObject } from './json-value.ts'

/**
 * Read a store document and take one value out of it.
 *
 * Absent, unreadable, not JSON, not an object, or written by another format
 * version all collapse into the same answer — `undefined` — because every
 * caller degrades identically: fall back to what it can serve without the file.
 * The caller's `pick` decides what a *usable* document is beyond the version,
 * so catalog entries, usage counters and visibility lists do not have to share
 * a shape to share this policy.
 *
 * @param path - absolute path of the store.
 * @param version - the format version this build writes and accepts.
 * @param pick - reads the caller's collection out of a version-matched document.
 */
export function readStoreDocument<T>(
  path: string,
  version: number,
  pick: (document: Record<string, unknown>) => T | undefined,
): T | undefined {
  if (!existsSync(path)) return undefined
  try {
    const document = parseJsonObject(readFileSync(path, 'utf8'))
    if (document === undefined || document['version'] !== version) return undefined
    return pick(document)
  } catch {
    // Corrupt or unreadable. Nothing is reported to the user: none of these
    // stores is load-bearing for the session, and a loud failure here would
    // take down a request over a file the user never asked about.
    return undefined
  }
}

/**
 * Replace a store document in one atomic step.
 *
 * Three details make this safe rather than merely tidy:
 *
 * - **A per-write temp name.** Two processes writing the same store at the same
 *   moment must not share a `${path}.tmp`: the second `writeFileSync` would
 *   then truncate the first writer's half-written file, and whichever rename
 *   landed last would publish it. The suffix is random and the open is
 *   exclusive (`wx`), so a colliding name fails loudly instead of silently.
 * - **The mode is on the fresh inode**, not applied afterwards, so the document
 *   is never briefly readable by others.
 * - **The temp is a sibling**, so the rename stays on one filesystem and is
 *   therefore atomic — a reader sees either the old document or the new one.
 *
 * A caller that must not lose a concurrent writer's change has to serialize the
 * whole read-modify-write, not just this write; see the class docs of the
 * stores that say so.
 *
 * @param path - absolute path of the store.
 * @param document - the complete next document.
 */
export function writeStoreDocument(path: string, document: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = resolve(`${path}.${randomBytes(6).toString('hex')}.tmp`)
  writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
  renameSync(temporary, path)
}
