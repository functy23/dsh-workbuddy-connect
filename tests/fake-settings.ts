/**
 * A @deepseek-ai/dsh-settings stand-in for the 0.1.7 generation.
 *
 * DSH 0.1.7 replaced the provider service's section API (`installSection`,
 * `load`, `persist`, `get`) with a schema-derived form surface, and it
 * commits a form write differently: marked `volatile` fields are resolved into
 * frozen `{ get() }` references, a write lands IN those references, and the
 * owning fiber is notified through `loader/volatile-update` rather than
 * remounted. A test that only stored a patch would therefore exercise none of
 * the path the plugin actually depends on.
 *
 * This service emulates that mechanism faithfully:
 *
 * - the test registers a plain config for a profile entry id;
 * - `ctx.plugin` runs the plugin's own `Config` schema (through cordis), which
 *   is what turns each marked field into a live reference, and
 *   {@link FakeSettingsService.bindFiber} captures that parsed object;
 * - the plugin's own `configure({ auto: false })` binds its fiber to that
 *   entry, exactly as the host's Loader row does;
 * - `update` writes into the references and dispatches
 *   `loader/volatile-update` on the bound fiber.
 *
 * @module tests/fake-settings
 */

import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import { createVolatile, isVolatile, updateVolatile } from '@deepseek-ai/cosmokit'

/** One registered profile entry. */
interface EntryState {
  id: string
  /** The reference-carrying config handed to `ctx.plugin`. */
  config: Record<string, unknown>
  /** Live values, keyed by field name. */
  values: Record<string, unknown>
  /** The plain document the values started from (for schema re-validation). */
  base: Record<string, unknown>
  /** The fiber whose plugin declared this entry, once `configure` binds it. */
  owner?: unknown
}

/** A frozen reference, matching the loader's `Volatile<T>` shape. */
function reference<T>(read: () => T): { get(): T } {
  return Object.freeze({ get: read })
}

/** The `meta.volatile`-marked entries of a schemastery object node. */
function volatileFieldDict(schema: unknown): Record<string, { meta?: { default?: unknown } }> {
  const dict = (schema as { dict?: Record<string, { meta?: { volatile?: boolean, default?: unknown } }> } | undefined)?.dict
  if (dict === undefined) return {}
  return Object.fromEntries(Object.entries(dict).filter(([, node]) => node.meta?.volatile === true))
}

/** A schema node's declared default, when it has one. */
function defaultOf(node: { meta?: { default?: unknown } }): unknown {
  return node.meta?.default
}

export class FakeSettingsService extends Service {
  static current: FakeSettingsService | undefined
  private readonly entries = new Map<string, EntryState>()
  private readonly schemas = new Map<string, unknown>()
  /** `configure()` arguments, in call order, for policy assertions. */
  readonly policies: { auto?: boolean }[] = []
  /** Every `update` this service accepted, in call order. */
  readonly writes: { ns: string, patch: Record<string, unknown> }[] = []
  /** Whether this generation accepts writes at all. */
  writable = true

  constructor(ctx: Context) {
    super(ctx, 'settings')
    FakeSettingsService.current = this
  }

  /**
   * Register a profile entry and its plain config.
   *
   * The reference-carrying config is produced by the PLUGIN'S OWN schema, so the
   * references have exactly the shape (and the `Volatile` prototype) the real
   * loader creates — hand-rolled `{ get() }` objects would pass a test that the
   * host would then reject for a different reason.
   *
   * @param id - The profile row id (`llm-workbuddy` for this plugin).
   * @param config - The plain config the composition would carry.
   * @param schema - The plugin's config schema (the loader validates through it).
   */
  declareEntry(id: string, config: Record<string, unknown>, schema: unknown): void {
    this.entries.set(id, { id, config: { ...config }, values: { ...config }, base: { ...config } })
    this.schemas.set(id, schema)
  }

  /**
   * Bind the entry to the config the plugin's fiber actually received.
   *
   * The loader hands `ctx.plugin` the RAW config and cordis's `resolveConfig`
   * runs the plugin's schema, which is what turns each marked field into a
   * frozen reference. That parsed object — `fiber.config` — is the one the
   * plugin reads through and the one a later write must land in, so the fake
   * takes it from the fiber rather than building its own references.
   */
  bindFiber(id: string, fiberConfig: unknown): void {
    const entry = this.entries.get(id)
    if (entry === undefined) throw new Error(`FakeSettingsService: no entry "${id}"`)
    entry.config = fiberConfig as Record<string, unknown>
    for (const [key, value] of Object.entries(entry.config)) {
      if (isVolatile(value)) entry.values[key] = value.get()
    }
  }

  /** The schema one entry was declared with. */
  schemaOf(id: string): unknown {
    return this.schemas.get(id)
  }

  /** The live value of one field, for assertions. */
  valueOf(id: string, key: string): unknown {
    const entry = this.entries.get(id)
    if (entry === undefined) return undefined
    const held = entry.config[key]
    return isVolatile(held) ? held.get() : held
  }

  /** Register the calling instance's auto-form policy and bind its fiber. */
  configure(presentation: { auto?: boolean }, owner?: unknown): () => void {
    this.policies.push(presentation)
    // The host addresses a form write by the ENTRY the fiber belongs to, which
    // is what `update` looks up; `configure` is where the plugin declares that
    // identity, so the binding happens here.
    for (const entry of this.entries.values()) {
      if (entry.owner === undefined) entry.owner = owner
    }
    return () => {
      const at = this.policies.indexOf(presentation)
      if (at >= 0) this.policies.splice(at, 1)
    }
  }

  /**
   * Merge a patch into an entry's config the way the loader does: into the
   * references, then notify the owning fiber.
   */
  update(ns: string, patch: object): Promise<void> {
    if (!this.writable) return Promise.reject(new Error('settings are read-only'))
    const entry = this.entries.get(ns)
    if (entry === undefined) {
      return Promise.reject(new Error(`No configurable plugin entry "${ns}"`))
    }
    const fields = Object.keys(patch)
    // Commit into the EXISTING references, which is what the loader does
    // (`updateVolatile`) and why a plugin reading through them sees the change
    // with no remount and no re-parse.
    const merged = { ...entry.base, ...entry.values, ...patch }
    // Commit into the EXISTING references, which is what the loader does
    // (`updateVolatile`) and why a plugin reading through them sees the change
    // with no remount. A field with no reference is not marked volatile, so the
    // write lands as a plain value — the same shape the loader produces.
    for (const [key, value] of Object.entries(patch)) {
      const current = entry.config[key]
      if (isVolatile(current)) updateVolatile(current, createVolatile(value))
      else entry.config[key] = value
    }
    entry.values = { ...entry.values, ...patch }
    entry.base = { ...entry.base, ...patch }
    this.writes.push({ ns, patch: patch as Record<string, unknown> })
    // Every value is committed BEFORE dispatch, exactly as the loader documents.
    const owner = entry.owner as { ctx?: { emit(name: string, ...args: unknown[]): void } } | undefined
    owner?.ctx?.emit('loader/volatile-update', [fields])
    return Promise.resolve()
  }

  /** Replace an entry's whole config. */
  replace(ns: string, section: object): Promise<void> {
    if (!this.writable) return Promise.reject(new Error('settings are read-only'))
    const entry = this.entries.get(ns)
    if (entry === undefined) return Promise.reject(new Error(`No configurable plugin entry "${ns}"`))
    for (const [key, value] of Object.entries(section)) entry.values[key] = value
    return this.update(ns, {})
  }

  /** Apply path-addressed edits. */
  async mutate(ns: string, ops: readonly ({ op: 'set', path: readonly string[], value: unknown } | { op: 'unset', path: readonly string[] })[]): Promise<void> {
    const patch: Record<string, unknown> = {}
    for (const op of ops) {
      const key = op.path[0]
      if (key === undefined) continue
      if (op.op === 'unset') patch[key] = undefined
      else patch[key] = op.value
    }
    await this.update(ns, patch)
  }

  /** The profile patch path; a real host points at its own file. */
  get documentPath(): string {
    return '/dev/null'
  }

  /** Locate the profile patch; a real host opens its own editor. */
  prepareDocument(): Promise<string> {
    return Promise.resolve(this.documentPath)
  }

  /** One descriptor per registered entry, in the shape the plugin reads. */
  describe(): { ns: string, autoGenerate: boolean, schema: unknown, value: unknown, revision: number, applies: 'live' }[] {
    return [...this.entries.values()].map(entry => ({
      ns: entry.id,
      autoGenerate: false,
      schema: this.schemas.get(entry.id),
      value: { ...entry.values },
      revision: this.writes.length,
      applies: 'live' as const,
    }))
  }
}

export default FakeSettingsService
