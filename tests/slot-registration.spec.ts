import { describe, expect, it } from 'vitest'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { CARD_VARIANTS } from '../src/client/card-variants.ts'
import { PANEL_ID } from '../src/client/index.tsx'

/**
 * The slot contracts ONE client bundle registers into, driven against the real
 * registry rather than trusted from the registration calls.
 *
 * The plugin contributes three navigation surfaces and two conversation-side
 * ones, each owned by a DIFFERENT package:
 *
 * - `sidebar.footer.action` (ui-sidebar) — the dashboard card, pinned at the
 *   bottom of the column.
 * - `main` (ui-layout, keyed) — the dashboard cell the card opens.
 * - `settings.section` (ui-settings, list) — the accounts page.
 * - `conversation.session.header.utilities` (ui-conversation) — the floating
 *   account window.
 * - `conversation.input.right` (ui-conversation) — the reasoning probe.
 *
 * `ctx.slots.inject` runs its callback only once the owning entry commits the
 * slot's declaration, so a host that ships none of these simply never runs the
 * matching registration. These tests pin what the registry does with each
 * registration SHAPE — a key/id collision, a missing key, an undeclared slot —
 * because that behaviour is what decides whether a surface appears at all.
 *
 * The register calls are typed loosely on purpose: the point under test is the
 * registry's behaviour, not the DSH client typings.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Minimal component stand-in; the registry only stores the reference. */
const Component = (): null => null

const register = (core: SlotCore, options: Record<string, unknown>): unknown =>
  (core.register as any)(options, Component)

/** How each host slot is declared, keyed by the slot name. */
const SLOT_DECLS: Record<string, { kind: 'list' | 'keyed' | 'single', scope: 'root', keyProps?: Record<string, object> }> = {
  'sidebar.footer.action': { kind: 'list', scope: 'root' },
  'main': { kind: 'keyed', scope: 'root' },
  'settings.section': { kind: 'list', scope: 'root' },
  'conversation.session.header.utilities': { kind: 'list', scope: 'root' },
  'conversation.input.right': { kind: 'list', scope: 'root' },
}

/**
 * Declare slots the way their host pages do: one entry contributes a
 * `children` table. `SlotCore` has no standalone declare method — the child
 * spec is owned by the registering entry, which is also why a slot can only be
 * claimed once.
 */
function declareHostSlots(core: SlotCore, slots: readonly string[]): void {
  const children: Record<string, unknown> = {}
  for (const slot of slots) children[slot] = SLOT_DECLS[slot]
  register(core, { name: 'root', children })
}

/** The dashboard's two registrations: the footer card and the centre cell. */
function registerDashboard(core: SlotCore): void {
  register(core, { name: 'sidebar.footer.action', id: PANEL_ID, order: 1 })
  register(core, { name: 'main', key: PANEL_ID })
}

const entries = (core: SlotCore, name: string): any[] => (core.entries as any)(name)
const cells = (core: SlotCore, name: string): any[] => (core.entriesOfSlot as any)(name)

describe('the dashboard is one navigation entry across two slots', () => {
  it('accepts the footer card and the main cell under the same id', () => {
    const core = new SlotCore()
    declareHostSlots(core, ['sidebar.footer.action', 'main'])
    expect(() => registerDashboard(core)).not.toThrow()
    expect(entries(core, 'sidebar.footer.action')).toHaveLength(1)
    expect(cells(core, 'main')).toHaveLength(1)
  })

  it('shares ONE id, which is what makes the card able to open the panel', () => {
    // The layout resolves the id the card passes against the `main` registry
    // and throws when no cell occupies it. Two different ids would register
    // cleanly and produce a button that does nothing — the dead-button failure
    // this shape exists to prevent.
    const core = new SlotCore()
    declareHostSlots(core, ['sidebar.footer.action', 'main'])
    registerDashboard(core)
    expect(entries(core, 'sidebar.footer.action')[0].options.id).toBe(PANEL_ID)
    expect(cells(core, 'main')[0].options.key).toBe(PANEL_ID)
  })

  it('rejects a second cell under the same key, which is why only one entry registers', () => {
    const core = new SlotCore()
    declareHostSlots(core, ['main'])
    register(core, { name: 'main', key: PANEL_ID })
    expect(() => register(core, { name: 'main', key: PANEL_ID }))
      .toThrow(/already has an entry for key/)
  })

  it('requires an explicit key on the keyed cell', () => {
    const core = new SlotCore()
    declareHostSlots(core, ['main'])
    // This is the kind of slot-API breakage the client entry's guards exist for.
    expect(() => register(core, { name: 'main' })).toThrow(/requires options.key/)
  })

  it('rejects the footer card on a host that declares no footer list', () => {
    // The capability boundary: on a layout without this seat the registration
    // throws, which is exactly why the client entry mounts it through
    // `ctx.slots.inject` (the callback never runs for an undeclared slot)
    // and gates it on the `layout` service besides.
    const core = new SlotCore()
    declareHostSlots(core, ['main'])
    expect(() => register(core, { name: 'sidebar.footer.action', id: PANEL_ID }))
      .toThrow(/not declared/)
  })
})

describe('settings.section carries the WorkBuddy page', () => {
  it('accepts one page entry with an id, an order, and a lazy label', () => {
    const core = new SlotCore()
    declareHostSlots(core, ['settings.section'])
    expect(() => {
      register(core, {
        name: 'settings.section',
        id: 'dsh-workbuddy',
        order: 40,
        label: () => 'DSH-WorkBuddy',
      })
    }).not.toThrow()
    expect(entries(core, 'settings.section')).toHaveLength(1)
  })

  it('keeps the label a function, so the shell re-registers on a locale change', () => {
    const core = new SlotCore()
    declareHostSlots(core, ['settings.section'])
    // The shell does not subscribe to locale state; it relies on the registrant
    // handing it fresh text. A string label captured at registration would
    // freeze the nav item in whichever language was active at load.
    register(core, { name: 'settings.section', id: 'dsh-workbuddy', order: 40, label: () => 'Account' })
    expect(typeof entries(core, 'settings.section')[0].options.label).toBe('function')
    expect(entries(core, 'settings.section')[0].options.label()).toBe('Account')
  })

  it('rejects a duplicate id at the same priority, which is why only one owner registers', () => {
    const core = new SlotCore()
    declareHostSlots(core, ['settings.section'])
    register(core, { name: 'settings.section', id: 'dsh-workbuddy', order: 40 })
    // A list slot names the conflict by id (a keyed slot would say "for key").
    expect(() => register(core, { name: 'settings.section', id: 'dsh-workbuddy', order: 40 }))
      .toThrow(/already has an entry with id "dsh-workbuddy"/)
  })

  it('rejects the page on a host that declares no settings section', () => {
    const core = new SlotCore()
    expect(() => register(core, { name: 'settings.section', id: 'dsh-workbuddy' }))
      .toThrow(/not declared/)
  })
})

describe('the conversation-side seats are lists with distinct ids', () => {
  it('lands the floating window and the probe control in one host', () => {
    const core = new SlotCore()
    declareHostSlots(core, ['conversation.session.header.utilities', 'conversation.input.right'])
    expect(() => {
      register(core, { name: 'conversation.session.header.utilities', id: 'workbuddy-floating-accounts', order: 90 })
      register(core, { name: 'conversation.input.right', id: 'workbuddy-probe', order: 10 })
    }).not.toThrow()
    expect(entries(core, 'conversation.session.header.utilities')).toHaveLength(1)
    expect(entries(core, 'conversation.input.right')).toHaveLength(1)
  })

  it('runs no registration for a seat the host does not declare', () => {
    // THE CAPABILITY BOUNDARY, asserted directly: a bundle that eagerly
    // registered into every seat would throw on every host missing one, which
    // is why each goes through `ctx.slots.inject` instead.
    const core = new SlotCore()
    expect(() => register(core, { name: 'conversation.input.right', id: 'workbuddy-probe' }))
      .toThrow(/not declared/)
  })
})

describe('both products stay enumerable for these registrations', () => {
  it('lists the two variants in display order', () => {
    // The floating window and the settings page both iterate this list; the
    // dashboard store polls it. A single-entry list would silently drop a
    // product from every surface at once.
    expect(CARD_VARIANTS.map(card => card.id)).toEqual(['workbuddy', 'workbuddy-ai'])
  })
})
