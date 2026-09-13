/**
 * Per-model context-window preference: which of the upstream-declared lengths
 * the user wants this model to run at.
 *
 * Why this is a real setting and not a display toggle: the window is what pi-ai
 * uses to clamp a request's output budget
 * (`available = contextWindow - promptTokens - safety`), so the chosen value
 * changes what actually gets sent. Choosing 1M instead of 200K is the difference
 * between a long transcript continuing and being cut off.
 *
 * Storage is one small JSON document per variant, keyed by model id. A model the
 * upstream stops declaring a length for keeps its entry — the preference is the
 * user's, and a catalog that comes back with the length again should find the
 * choice still made. The value is only *applied* when the upstream still offers
 * it, so a stale entry can never widen a window the model does not have.
 *
 * @module dsh-workbuddy-connect/context-preference
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { WorkBuddyVariant } from './variants.ts'

/** On-disk format this reader accepts; other versions are discarded. */
const FORMAT_VERSION = 1

/** Basename of the CN variant's preference file inside the Harness home. */
export const WORKBUDDY_CONTEXT_FILENAME = '.workbuddy-context.json'

/** Where one variant's preferences live. */
export function workbuddyContextPath(filename: string): string {
  return resolve(resolveDshHome(), filename)
}

/** One model's stored choice: the length the user picked. */
interface ContextDocument {
  version: number
  /** Model id → chosen context length in tokens. */
  models: Record<string, number>
}

/**
 * The chosen context lengths for one variant.
 *
 * Reads are synchronous and cached in memory: the adapter asks for every model
 * on every `getModels()`, so a file read per model per call would be absurd for
 * a document that changes only when the user clicks.
 */
export class WorkBuddyContextPreference {
  private readonly path: string
  private models: Map<string, number>

  constructor(options: { variant: WorkBuddyVariant, path?: string }) {
    this.path = options.path ?? workbuddyContextPath(options.variant.contextFilename)
    this.models = this.load()
  }

  /** Read the document, treating any problem as "no preferences yet". */
  private load(): Map<string, number> {
    const models = new Map<string, number>()
    try {
      if (!existsSync(this.path)) return models
      const parsed: unknown = JSON.parse(readFileSync(this.path, 'utf8'))
      if (typeof parsed !== 'object' || parsed === null) return models
      const document = parsed as Partial<ContextDocument>
      if (document.version !== FORMAT_VERSION || typeof document.models !== 'object' || document.models === null) {
        return models
      }
      for (const [id, value] of Object.entries(document.models)) {
        if (typeof value === 'number' && Number.isFinite(value) && value > 0) models.set(id, value)
      }
    } catch {
      // A corrupt or unreadable file is not worth failing a request over; the
      // user simply gets the upstream's default until they choose again.
    }
    return models
  }

  /** Persist atomically, so a crash mid-write cannot truncate the document. */
  private save(): void {
    const document: ContextDocument = {
      version: FORMAT_VERSION,
      models: Object.fromEntries(this.models),
    }
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      const temporary = `${this.path}.${String(process.pid)}.tmp`
      writeFileSync(temporary, JSON.stringify(document, null, 2), { encoding: 'utf8', mode: 0o600 })
      renameSync(temporary, this.path)
    } catch {
      // Persisting is best-effort: the in-memory map already holds the choice,
      // so this session behaves as the user asked either way.
    }
  }

  /**
   * The length to use for a model.
   *
   * @param declared - every length the upstream offers for this model.
   * @returns the user's choice when it is still on offer, otherwise the model's
   *   default (the first entry, which is what the catalog reports).
   */
  resolve(modelId: string, declared: readonly number[]): number | undefined {
    const chosen = this.models.get(modelId)
    if (chosen !== undefined && declared.includes(chosen)) return chosen
    return undefined
  }

  /** Record a choice. Passing a length the model declares is the caller's job. */
  set(modelId: string, length: number): void {
    this.models.set(modelId, length)
    this.save()
  }

  /** Forget a model's choice, so it runs at the upstream default again. */
  clear(modelId: string): void {
    if (this.models.delete(modelId)) this.save()
  }

  /** Every stored choice, for tests and diagnostics. */
  entries(): ReadonlyMap<string, number> {
    return this.models
  }
}
