import { describe, expect, it } from 'vitest'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { CARD_VARIANTS } from '../src/client/card-variants.ts'

/**
 * The settings-navigation contract.
 *
 * The accounts used to live in two cards under the Plugins tab. They now live
 * on one page of their own, which means the plugin depends on a different —
 * and much less forgiving — slot: `settings.section` is a list whose owner
 * renders **one page per entry** and reads `label` as the navigation text. If
 * that registration silently does nothing, the page is unreachable and no
 * amount of correct code behind it matters.
 *
 * These tests drive the real `SlotCore` rather than trusting the registration
 * shape, because "the slot accepts a list entry with a lazy label" is a
 * property of the registry, not of this plugin.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Minimal component stand-in; the registry only stores the reference. */
const Component = (): null => null

const register = (core: SlotCore, options: Record<string, unknown>): unknown =>
  (core.register as any)(options, Component)

/**
 * Declare `settings.section` the way DSH's settings shell does: a parent entry
 * contributes a `children` table. `SlotCore` has no standalone declare method —
 * the child spec belongs to the registering entry, which is also why one slot
 * can only be claimed once.
 */
function declareSection(core: SlotCore): void {
  register(core, {
    name: 'root',
    children: { 'settings.section': { kind: 'list' } },
  })
}

const entries = (core: SlotCore): any[] => (core.entries as any)('settings.section')

describe('settings.section carries the WorkBuddy page', () => {
  it('accepts one page entry with an id, an order, and a lazy label', () => {
    const core = new SlotCore()
    declareSection(core)
    expect(() => {
      register(core, {
        name: 'settings.section',
        id: 'dsh-workbuddy',
        order: 40,
        label: () => 'DSH-WorkBuddy',
      })
    }).not.toThrow()
    expect(entries(core)).toHaveLength(1)
  })

  it('projects the navigation entry under the id the plugin registers', () => {
    const core = new SlotCore()
    declareSection(core)
    register(core, { name: 'settings.section', id: 'dsh-workbuddy', order: 40, label: () => 'DSH-WorkBuddy' })
    // The owner looks the entry up by `id`; a registration under any other id
    // would render nothing while appearing to succeed.
    const found = entries(core)[0]
    expect(found).toBeTruthy()
    expect(found.options.id).toBe('dsh-workbuddy')
  })

  it('keeps the label a function, so the shell re-registers on a locale change', () => {
    const core = new SlotCore()
    declareSection(core)
    // The shell does not subscribe to locale state; it relies on the registrant
    // handing it fresh text. A string label captured at registration would
    // freeze the nav item in whichever language was active at load.
    register(core, { name: 'settings.section', id: 'dsh-workbuddy', order: 40, label: () => 'Account' })
    expect(typeof entries(core)[0].options.label).toBe('function')
    expect(entries(core)[0].options.label()).toBe('Account')
  })

  it('rejects a duplicate id at the same priority, which is why only one owner registers', () => {
    const core = new SlotCore()
    declareSection(core)
    register(core, { name: 'settings.section', id: 'dsh-workbuddy', order: 40 })
    // A list slot names the conflict by id (a keyed slot would say "for key").
    expect(() => register(core, { name: 'settings.section', id: 'dsh-workbuddy', order: 40 }))
      .toThrow(/already has an entry with id "dsh-workbuddy"/)
  })

  it('rejects registering into an undeclared slot', () => {
    const core = new SlotCore()
    expect(() => register(core, { name: 'settings.section', id: 'dsh-workbuddy' }))
      .toThrow(/not declared/)
  })

  it('still pairs each product with its own routes', () => {
    // The page renders both products; a variant whose statusPath pointed at the
    // other's document would show one product's accounts under the other's
    // heading. This is the one invariant the page cannot check for itself.
    const paths = CARD_VARIANTS.map(variant => variant.statusPath)
    expect(new Set(paths).size).toBe(CARD_VARIANTS.length)
    expect(new Set(CARD_VARIANTS.map(variant => variant.accountPath)).size).toBe(CARD_VARIANTS.length)
    for (const variant of CARD_VARIANTS) {
      expect(variant.accountPath).not.toBe(variant.statusPath)
      expect(variant.probePath).not.toBe(variant.statusPath)
    }
  })
})
