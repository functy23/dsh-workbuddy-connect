/**
 * Per-account model-visibility preferences: which models the signed-in account
 * has hidden from the DSH model picker (issue #36).
 *
 * A disabled *list*, deliberately not an enabled whitelist: a new account and a
 * model the upstream adds both start visible, and an id that temporarily
 * disappears from the catalog is kept — when the model returns it stays hidden
 * until this account says otherwise. Entries are also kept across sign-outs, so
 * returning to an account restores exactly what it left.
 *
 * One file per variant (the two endpoints share model ids but never
 * preferences), keyed by the same `uid:enterpriseId` identity the saved
 * catalogs and probe records use. Not a place for secrets: model-id strings
 * only, never a token, and never written into the desktop auth file or the
 * plugin-owned credential copy — hiding a model is a picker preference, not
 * credential state.
 *
 * Why a plugin-owned file rather than a settings section: the settings sections
 * are statically-typed schemastery objects, and `settings.yaml` is account-global
 * — a per-uid dynamic map fits neither without weakening the schema or mixing
 * one account's preferences into another's config. The saved-catalog and probe
 * stores already persist per-account data this way, so this store follows them:
 * version-tagged document, atomic write with `0o600`, and a malformed file that
 * reads as "nothing saved" rather than throwing.
 *
 * @module dsh-workbuddy-connect/visibility-store
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** On-disk format this reader accepts; other versions are discarded. */
const VISIBILITY_FORMAT_VERSION = 1

/** Basename of the CN variant's visibility file inside the Harness home. */
export const WORKBUDDY_VISIBILITY_FILENAME = '.workbuddy-model-visibility.json'

/** One account's saved preferences: the account they belong to and its hidden ids. */
interface SavedVisibility {
  /** `uid:enterpriseId` the preferences belong to. */
  account: string
  /** Model ids hidden from this account's picker; never auto-pruned. */
  disabled: readonly string[]
  /**
   * The account's "only show these" allowlist, when it has one.
   *
   * A SECOND list beside {@link disabled} rather than a reinterpretation of it,
   * because the two answer different questions and converting between them is
   * not possible from the stored data alone: `disabled` names what to hide,
   * while an allowlist only means anything against a catalog (everything not
   * listed is hidden), and the catalog is not persisted here. Keeping both lets
   * a saved hide-list survive a user trying the allowlist and switching back.
   *
   * Absent or empty means "no allowlist" — every model is shown unless
   * `disabled` says otherwise. That is the same empty-default the reference
   * implementation uses, and it is why this is not a `mode` flag: an empty
   * allowlist and no allowlist are the same state, so storing a separate flag
   * would let the file describe a mode it has no list for.
   */
  allowlist?: readonly string[]
  /** When this account's list last changed, epoch milliseconds. */
  updatedAtMs: number
}

interface VisibilityDocument {
  version: typeof VISIBILITY_FORMAT_VERSION
  accounts: Record<string, SavedVisibility>
}

/** Plugin-owned visibility-file path inside the Harness home. */
export function workbuddyVisibilityPath(filename: string = WORKBUDDY_VISIBILITY_FILENAME): string {
  return join(resolveDshHome(), filename)
}

/** Whether a parsed value is a saved preference entry this reader can trust. */
function isSaved(value: unknown): value is SavedVisibility {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const entry = value as Record<string, unknown>
  if (typeof entry['account'] !== 'string' || entry['account'] === '') return false
  if (typeof entry['updatedAtMs'] !== 'number' || !Number.isFinite(entry['updatedAtMs'])) return false
  const disabled = entry['disabled']
  if (!Array.isArray(disabled)) return false
  if (!disabled.every(id => typeof id === 'string' && id !== '')) return false
  const allowlist = entry['allowlist']
  if (allowlist === undefined) return true
  return Array.isArray(allowlist) && allowlist.every(id => typeof id === 'string' && id !== '')
}

/** Options for {@link WorkBuddyVisibilityStore}. */
export interface WorkBuddyVisibilityStoreOptions {
  /** Explicit state-file path, overriding the `$DSH_HOME` default. */
  path?: string
}

/**
 * The per-account hidden-model lists, read once and written atomically.
 *
 * Unlike the saved-catalog store, a failed *write* propagates: the caller
 * reports it to the user rather than answering "hidden" for a preference that
 * did not persist. Reads stay forgiving — a corrupt or unreadable file is
 * "nothing hidden", which only ever shows models the account can still pick.
 */
export class WorkBuddyVisibilityStore {
  private readonly path: string
  private accounts: Record<string, SavedVisibility> | undefined

  constructor(options: WorkBuddyVisibilityStoreOptions | string = {}) {
    this.path = typeof options === 'string'
      ? options
      : options.path ?? workbuddyVisibilityPath()
  }

  /** Resolved state-file path, for the CLI and tests. */
  filePath(): string {
    return this.path
  }

  private load(): Record<string, SavedVisibility> {
    if (this.accounts !== undefined) return this.accounts
    const accounts: Record<string, SavedVisibility> = {}
    if (existsSync(this.path)) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(this.path, 'utf8'))
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          const document = parsed as Record<string, unknown>
          const raw = document['version'] === VISIBILITY_FORMAT_VERSION ? document['accounts'] : undefined
          if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
            for (const [key, value] of Object.entries(raw)) {
              if (isSaved(value)) accounts[key] = value
            }
          }
        }
      } catch {
        // Corrupt or unreadable: treated as nothing hidden.
      }
    }
    this.accounts = accounts
    return accounts
  }

  /** The model ids one account has hidden; empty when it never hid any. */
  disabled(account: string): readonly string[] {
    return this.load()[account]?.disabled ?? []
  }

  /**
   * The ids one account allows, when it narrowed the list; undefined = no
   * allowlist, i.e. show everything {@link disabled} does not hide.
   *
   * undefined and `[]` are deliberately NOT the same value here even though
   * both are stored as an absent list: a caller asking "did the user narrow
   * this?" needs to know, and only the caller can decide whether an empty
   * allowlist means "nothing allowed" or "no filter". Storage keeps no such
   * distinction (see {@link SavedVisibility.allowlist}), so this returns
   * undefined for both and the caller's own empty-string check is what tells
   * the cases apart.
   */
  allowlist(account: string): readonly string[] | undefined {
    const saved = this.load()[account]?.allowlist
    return saved === undefined || saved.length === 0 ? undefined : saved
  }

  /**
   * Replace one account's allowlist.
   *
   * Passing undefined (or an empty list) clears it, which restores the state
   * where the account shows everything `disabled` does not hide — that is what
   * the card's "show all" action does, and it is deliberately the same call as
   * "narrow to these": one method, one meaning per argument.
   *
   * The hidden list is untouched by an allowlist write. A model in `disabled`
   * stays hidden if it is later added to the allowlist only through the
   * subtraction below — see {@link effectiveHidden}, which is what every reader
   * must go through.
   */
  setAllowlist(account: string, ids: readonly string[] | undefined): void {
    const current = this.load()[account]
    const next = ids === undefined || ids.length === 0 ? undefined : [...new Set(ids)]
    const accounts = { ...this.load() }
    if (next === undefined && (current === undefined || current.disabled.length === 0)) {
      // Nothing to store either way: the account has no preferences at all.
      delete accounts[account]
      this.persist(accounts)
      this.accounts = accounts
      return
    }
    accounts[account] = {
      account,
      disabled: current?.disabled ?? [],
      ...next === undefined ? {} : { allowlist: next },
      updatedAtMs: Date.now(),
    }
    this.persist(accounts)
    this.accounts = accounts
  }

  /**
   * The ids the picker must actually hide for one account: the union of the
   * allowed-list's complement and the explicit hide-list.
   *
   * The ONE reader every caller uses. With an allowlist set, everything outside
   * it is hidden, and an id in `disabled` stays hidden even if it was also
   * allowed — the two lists can disagree (a stale allowlist entry beside an
   * explicit hide), and "hidden" winning is the only resolution that does not
   * resurrect a model the user turned off.
   */
  effectiveHidden(account: string, catalogIds: readonly string[]): readonly string[] {
    const saved = this.load()[account]
    if (saved === undefined) return []
    const allowlist = saved.allowlist
    const hidden = new Set(saved.disabled)
    if (allowlist !== undefined && allowlist.length > 0) {
      const allowed = new Set(allowlist)
      for (const id of catalogIds) if (!allowed.has(id)) hidden.add(id)
    }
    return [...hidden]
  }

  /**
   * Show or hide one model for one account, persisting before committing.
   *
   * Re-enabling (showing) the last hidden model removes the account's entry
   * entirely — an absent entry and an empty list mean the same thing
   * (everything visible), and the file should not accumulate empty buckets.
   * Throws when the write fails, leaving the in-memory state untouched so a
   * re-read cannot lie about what was persisted.
   */
  setVisible(account: string, model: string, visible: boolean): void {
    const current = this.load()[account]?.disabled ?? []
    const next = visible ? current.filter(id => id !== model) : [...new Set([...current, model])]
    const accounts = { ...this.load() }
    if (next.length === 0) delete accounts[account]
    else accounts[account] = { account, disabled: next, updatedAtMs: Date.now() }
    this.persist(accounts)
    this.accounts = accounts
  }

  private persist(accounts: Record<string, SavedVisibility>): void {
    const directory = dirname(this.path)
    if (!existsSync(directory)) mkdirSync(directory, { recursive: true })
    const document: VisibilityDocument = { version: VISIBILITY_FORMAT_VERSION, accounts }
    const temporary = resolve(`${this.path}.tmp`)
    writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 })
    renameSync(temporary, this.path)
  }
}
