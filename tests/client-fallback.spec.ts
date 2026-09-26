/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, PANEL_ID } from '../src/client/index.tsx'

/**
 * Per-contribution error isolation of the REAL client entry.
 *
 * Every browser-side contribution is guarded at both boundaries where it can
 * throw — the eager `ctx.slots.inject(...)` call and the deferred callback the
 * slot runtime invokes later — so one failing registration never takes the
 * others with it, and nothing ever throws into the DSH loader (the red
 * "Failed to load plugins" banner). These specs drive the real `apply()`
 * directly: its only runtime imports are React and local modules (every DSH
 * import is type-only and erased), so unlike the old hand-copied mirror there
 * is no drift risk between this spec and the implementation.
 *
 * The fake context simulates a host whose slots are all already declared, so
 * each `ctx.slots.inject(name, cb)` runs `cb` synchronously — exercising both
 * guarded boundaries in one pass. Failure injection happens at the register
 * or inject call, matching where a slot-API breakage or a bad registration
 * actually throws.
 */

/** One registration the fake slot registry accepted: slot name and key/id. */
interface RecordedRegistration {
  name: string
  key?: string
  id?: string
}

/** Everything a driven `apply()` did, for assertions. */
interface Harness {
  ctx: any
  /** Slot names passed to `ctx.slots.inject`, in call order. */
  injectedSlots: string[]
  /** Accepted registrations, in order. */
  registered: RecordedRegistration[]
  /** Whether the `modelDirectories` scope was entered. */
  enteredModelDirectories: () => boolean
  /** Captured console.error arguments, one entry per degraded contribution. */
  errors: unknown[][]
}

/** Which slot declarations exist, so the inject callbacks fire (and register). */
const ALL_SLOTS = [
  'settings.section',
  // Declared by the Models settings page, which dispatches it per provider row.
  // Absent on a host without that page: the contribution then never registers,
  // which is the designed degradation rather than a failure.
  'settings.models.provider-card',
  'sidebar.footer.action',
  'main',
  'conversation.composer.dock',
  'conversation.input.right',
]

/**
 * Build the fake host context. `failInject` throws from a `ctx.slots.inject`
 * call for a slot name; `failRegister` throws from the deferred
 * `ctx.slots.register` for a slot name; `failLocale` throws from the locale
 * registration.
 */
function harness(options: {
  failInject?: (name: string) => string | undefined
  failRegister?: (name: string, key?: string, id?: string) => string | undefined
  failLocale?: boolean
  declared?: readonly string[]
} = {}): Harness {
  const declared = new Set(options.declared ?? ALL_SLOTS)
  const injectedSlots: string[] = []
  const registered: RecordedRegistration[] = []
  const errors: unknown[][] = []
  let enteredModelDirectories = false
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errors.push(args) })

  const slots: any = {
    inject: (name: string, callback: () => void) => {
      const failure = options.failInject?.(name)
      if (failure !== undefined) throw new Error(failure)
      injectedSlots.push(name)
      if (declared.has(name)) callback()
    },
    register: (slotOptions: any) => {
      const failure = options.failRegister?.(slotOptions.name, slotOptions.key, slotOptions.id)
      if (failure !== undefined) throw new Error(failure)
      // Only the addressing field the slot actually used is recorded: a keyed
      // slot carries `key`, a list slot carries `id`, and recording both would
      // put an `undefined` in every fixture for no assertion's benefit.
      registered.push({
        name: slotOptions.name,
        ...slotOptions.key === undefined ? {} : { key: slotOptions.key },
        ...slotOptions.id === undefined ? {} : { id: slotOptions.id },
      })
    },
  }

  const layout = { selectPanel: (): void => {} }
  const ctx: any = {
    // The footer card is gated on the `layout` service, which the fake host
    // mounts; the reflective `ctx.get('layout')` is how the entry reads it.
    get: (name: string) => (name === 'layout' ? layout : undefined),
    effect: (fn: () => unknown) => { fn(); return () => {} },
    locale: {
      register: () => {
        if (options.failLocale === true) throw new Error('locale service is broken')
        return () => {}
      },
      bind: () => (key: string) => key,
    },
    slots,
    inject: (names: string[], callback: (scope: any) => void) => {
      // Each contribution's scoped inject gets the services it named: the
      // probe seat asks for `modelDirectories`, the sidebar card for
      // `layout`. A scope that answered a service it was not asked for would
      // hide exactly the wiring these tests exist to pin.
      if (names.includes('layout')) {
        callback({ slots, get: (name: string) => (name === 'layout' ? layout : undefined) })
      }
      if (names.includes('modelDirectories')) {
        enteredModelDirectories = true
        callback({
          modelDirectories: { directoryFor: () => ({ store: {} }) },
          slots,
        })
      }
    },
  }

  return {
    ctx,
    injectedSlots,
    registered,
    enteredModelDirectories: () => enteredModelDirectories,
    errors,
  }
}

/**
 * The registrations a fully successful `apply()` makes, in order: the dashboard
 * cell, its sidebar card, the settings page, the Models-page provider card, the
 * composer credit badge, and the composer probe.
 */
const ALL_REGISTRATIONS: RecordedRegistration[] = [
  { name: 'main', key: PANEL_ID },
  { name: 'sidebar.footer.action', id: PANEL_ID },
  { name: 'settings.section', id: 'dsh-workbuddy' },
  // Keyed by the settings namespace the Host's configurable-provider directory
  // entry carries, because that is what the Models page dispatches the slot
  // with — a different string here would register a card that renders nowhere.
  { name: 'settings.models.provider-card', key: 'llm-workbuddy' },
  { name: 'conversation.composer.dock', id: 'workbuddy-credit-badge' },
  { name: 'conversation.input.right', id: 'workbuddy-probe' },
]

/** Every slot `apply()` injects into, in call order. */
const ALL_INJECTED = [
  'main', 'sidebar.footer.action', 'settings.section', 'settings.models.provider-card',
  'conversation.composer.dock', 'conversation.input.right',
]

afterEach(() => {
  vi.restoreAllMocks()
})

describe('client contribution isolation', () => {
  it('registers every contribution on a healthy host', () => {
    const h = harness()
    expect(() => apply(h.ctx)).not.toThrow()
    expect(h.registered).toEqual(ALL_REGISTRATIONS)
    expect(h.injectedSlots).toEqual(ALL_INJECTED)
    expect(h.enteredModelDirectories()).toBe(true)
    expect(h.errors).toHaveLength(0)
  })

  it('keeps every other surface when the dashboard cell registration throws', () => {
    // The deferred register for the `main` cell breaks (e.g. the key
    // collides); the isolation contract: every other surface — the sidebar card,
    // the settings page, the Models-page card, the floating window, and the
    // probe control — still registers.
    const h = harness({ failRegister: name => name === 'main'
      ? 'keyed slot already has an entry for key workbuddy-panel'
      : undefined })
    expect(() => apply(h.ctx)).not.toThrow()
    expect(h.registered).toEqual([
      { name: 'sidebar.footer.action', id: PANEL_ID },
      { name: 'settings.section', id: 'dsh-workbuddy' },
      { name: 'settings.models.provider-card', key: 'llm-workbuddy' },
      { name: 'conversation.composer.dock', id: 'workbuddy-credit-badge' },
      { name: 'conversation.input.right', id: 'workbuddy-probe' },
    ])
    expect(h.errors).toHaveLength(1)
    expect(String(h.errors[0])).toContain('dashboard panel')
    expect(String(h.errors[0])).toContain('host provider unaffected')
  })

  it('keeps the probe control when the settings page registration throws', () => {
    const h = harness({ failRegister: name => name === 'settings.section'
      ? 'list slot "settings.section" already has an entry with id "dsh-workbuddy"'
      : undefined })
    expect(() => apply(h.ctx)).not.toThrow()
    expect(h.registered).toEqual([
      { name: 'main', key: PANEL_ID },
      { name: 'sidebar.footer.action', id: PANEL_ID },
      { name: 'settings.models.provider-card', key: 'llm-workbuddy' },
      { name: 'conversation.composer.dock', id: 'workbuddy-credit-badge' },
      { name: 'conversation.input.right', id: 'workbuddy-probe' },
    ])
    expect(h.errors).toHaveLength(1)
    expect(String(h.errors[0])).toContain('settings section')
  })

  it('keeps every other surface when the probe contribution throws', () => {
    // The probe seat's slots.inject itself breaks — inside the
    // modelDirectories scope, i.e. the deferred half of that contribution.
    const h = harness({ failInject: name => name === 'conversation.input.right'
      ? 'slot conversation.input.right is not declared'
      : undefined })
    expect(() => apply(h.ctx)).not.toThrow()
    // Everything before the probe seat: main, the footer card, the settings
    // section, the Models-page card, the floating window.
    expect(h.registered).toEqual(ALL_REGISTRATIONS.slice(0, 5))
    expect(h.enteredModelDirectories()).toBe(true)
    expect(h.errors).toHaveLength(1)
    expect(String(h.errors[0])).toContain('conversation probe control')
  })

  it('keeps every other contribution when the locale registration throws', () => {
    // TWO namespaces are registered — the settings page's copy and the
    // dashboard's — so a broken locale service degrades each independently and
    // every slot registration still lands.
    const h = harness({ failLocale: true })
    expect(() => apply(h.ctx)).not.toThrow()
    expect(h.registered).toEqual(ALL_REGISTRATIONS)
    expect(h.errors).toHaveLength(2)
    expect(String(h.errors[0])).toContain('settings copy')
    expect(String(h.errors[1])).toContain('panel copy')
  })

  it('degrades every contribution independently under a total slot-API breakage', () => {
    // The rc.6→rc.7-style API break: every slots.inject throws. Each
    // contribution logs its own degradation, none rethrows into the loader,
    // and the locale copy still lands.
    const h = harness({ failInject: () => 'slots.inject is not a function' })
    expect(() => apply(h.ctx)).not.toThrow()
    expect(h.registered).toEqual([])
    expect(h.injectedSlots).toEqual([])
    expect(h.enteredModelDirectories()).toBe(true)
    // Six slot contributions, one degradation each.
    expect(h.errors).toHaveLength(6)
  })
})
