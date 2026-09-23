/**
 * Volatile-config bridge — the seam between dsh's two config generations.
 *
 * dsh 0.1.7 rewrote settings around profile Config: `settings.describe()`
 * projects each active entry's schema through `volatileForm()`, so a form
 * contains ONLY fields whose schema nodes carry `meta.volatile`, and a form
 * edit is refused unless its path lies beneath a marked node. On that
 * generation the loader resolves each marked top-level field into a readonly
 * `Volatile<T>` reference (`{ get() }`, frozen, written in place by the owning
 * runtime) instead of a plain value, commits later changes WITHOUT remounting
 * the fiber, and dispatches `loader/volatile-update` to the owning fiber.
 *
 * Older engines know neither mechanism: schemastery < 3.18.3 has no
 * `.volatile()` method at all, and where the mark can be applied but the
 * loader predates volatile config, `meta.voltage` is inert metadata and
 * `apply()` still receives plain values (settings writes reach the plugin
 * through the ≤0.1.6 settings document instead).
 *
 * Two helpers keep the rest of the plugin reading a PLAIN `Config`:
 *
 * - `markVolatile(schema)` calls `.volatile()` when the installed schemastery
 *   exposes it and returns the schema untouched otherwise, so schema
 *   construction never throws on an old engine while 0.1.7's forms see every
 *   field we mark. The method is typed structurally, never imported from
 *   schemastery, because this checkout pins 3.18.2 (no such member) while the
 *   0.1.7 engine ships 3.18.3.
 * - `unwrapVolatileConfig(config)` reads every top-level field through its
 *   reference when one is present — returning a FRESH object per call, since
 *   a reference's identity is stable while its value changes — and returns the
 *   config untouched when none is, which preserves object identity on
 *   plain-config engines.
 *
 * Only TOP-LEVEL fields are marked (form writes name top-level paths), so one
 * unwrap level is complete.
 *
 * **The marks are for the 0.1.7 generation ONLY, and the legacy settings
 * registration must never see them.** schemastery creates the frozen
 * `{ get() }` references during PARSE on every generation, while ≤0.1.6's
 * `installSection` re-validates the base it is handed and `describe()`
 * structuredClones that base. A marked schema plus a reference-carrying base
 * therefore throws `ValidationError` at BOOT on those engines
 * (`expected boolean but got [object Object]`), or `DataCloneError` when the
 * directory is read. That is why `src/index.ts` builds the fields TWICE: the
 * exported `Config` with the marks (loader + 0.1.7 forms) and
 * `LegacySettingsSchema` without them, and hands the legacy service an
 * unwrapped base.
 *
 * @module dsh-workbuddy-connect/config-volatile
 */

/** The one schemastery member this module needs, typed structurally. */
interface MarkableSchema {
  volatile?: (() => unknown) | undefined
}

/** A readonly reference the 0.1.7 loader substitutes for a marked field. */
export interface VolatileReference<T> {
  get(): T
}

/**
 * Mark one schema field volatile when the installed schemastery supports it.
 *
 * @param schema - The field schema (any generation).
 * @returns The schema carrying `meta.volatile`, or the schema itself on an
 * engine whose schemastery predates `.volatile()`.
 */
export function markVolatile<S>(schema: S): S {
  const candidate = schema as S & MarkableSchema
  if (typeof candidate.volatile !== 'function') return schema
  return candidate.volatile() as S
}

/**
 * Mark every field of a Config field dict volatile.
 *
 * The result is a NEW dict of schema instances: callers that also need an
 * UNMARKED schema for the legacy settings generation must build the fields
 * twice rather than mutating one dict (see `src/index.ts`).
 *
 * @param fields - The unmarked field dict.
 * @returns A dict whose entries are the marked schemas.
 */
export function markVolatileFields<F extends Record<string, unknown>>(fields: F): { [K in keyof F]: F[K] } {
  const marked: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(fields)) marked[key] = markVolatile(field)
  return marked as { [K in keyof F]: F[K] }
}

/** Whether a value is one of the loader's frozen `{ get() }` references. */
function isVolatileReference(value: unknown): value is VolatileReference<unknown> {
  return typeof value === 'object' && value !== null
    && typeof (value as { get?: unknown }).get === 'function'
    && Object.isFrozen(value)
}

/**
 * Resolve one top-level field to its current plain value.
 *
 * @param config - The applied config, reference-carrying or plain.
 * @param key - The field to read.
 * @returns The value the field currently holds.
 */
export function readVolatileField<T>(config: object, key: string): T | undefined {
  const raw = (config as Record<string, unknown>)[key]
  return (isVolatileReference(raw) ? raw.get() : raw) as T | undefined
}

/**
 * Read every top-level field through its reference when one is present.
 *
 * A FRESH object is returned whenever any field was a reference, because a
 * reference's identity never changes while its value does — memoising on the
 * config object itself would freeze the first read. A plain config is returned
 * untouched, which preserves object identity for callers that memo on it.
 *
 * @param config - The applied config.
 * @returns A plain config snapshot, valid until the next volatile update.
 */
export function unwrapVolatileConfig<T extends object>(config: T): T {
  let sawReference = false
  const plain: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(config)) {
    if (isVolatileReference(value)) {
      sawReference = true
      plain[key] = value.get()
    } else {
      plain[key] = value
    }
  }
  return (sawReference ? plain : config) as T
}
