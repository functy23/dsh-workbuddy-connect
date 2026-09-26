/**
 * The plugin-wide display preferences, declared once.
 *
 * A preference the sidebar draws exists in three shapes that have to agree: a
 * field in this plugin's own config schema (with its default), the value the
 * status document states, and the rule that turns the first into the second.
 * Written out per preference those three drift — the schema defaults one way
 * while the projection excuses the other, and the symptom is a setting that
 * looks saved and behaves reset, or a sidebar that empties itself the first time
 * the config file is hand-edited.
 *
 * One row per preference is what makes a new one cheap: the field, its default,
 * and its projection are here, so the rest of the host reads the whole set
 * through {@link statedPreferences} and never names an individual preference
 * again. What is deliberately NOT here is the write path — each preference is
 * written through its own named route action, and a route's name, its refusal
 * messages, and what it is willing to accept are part of the route contract
 * rather than of the value.
 *
 * @module dsh-workbuddy-connect/preferences
 */

import z from '@deepseek-ai/schemastery'
import type { WorkBuddySidebarCreditStyle } from './status-paths.ts'

/**
 * One display preference: its config field, and how the status document states
 * a stored value.
 */
export interface WorkBuddyPreference<Stored, Stated> {
  /**
   * The config field, marked volatile by the exported schema.
   *
   * The description is the user-facing string the harness's own settings form
   * shows, so it is written for a reader who has never opened this file.
   */
  readonly field: z<Stored>
  /**
   * Project a stored value onto what the browser half is told.
   *
   * `undefined` omits the field from the document entirely. That is the shape a
   * host which cannot persist the preference produces, and the browser half
   * reads it as "keep the default" — which is why the projection decides this
   * rather than the reader.
   */
  readonly stated: (value: Stored) => Stated | undefined
}

/**
 * Every plugin-wide preference, by the name of its config field.
 *
 * Both products' surfaces draw these, and each is written once but read from
 * whichever document carries it — see `client/status-document.ts`.
 */
export const WORKBUDDY_PREFERENCES = {
  /**
   * How the sidebar card states each product's credit.
   *
   * `'remaining'` (default) is one line per product — "WorkBuddy 剩余额度 5,266";
   * `'usage'` is the reference card's shape — a "used / total" pair over a bar of
   * that ratio. Both describe the same pool; they differ in which figure leads,
   * and that is a matter of taste rather than of correctness, which is why it is
   * a setting instead of a decision this plugin makes for the user.
   */
  sidebarCreditStyle: {
    field: z.union(['remaining', 'usage']).default('remaining')
      .description('Sidebar credit line: "remaining" states the balance per product; "usage" shows used / total over a bar'),
    // Narrowed rather than passed through: a hand-edited config file can hold
    // anything, and an unknown spelling must draw the default line rather than
    // reach the card as a value no renderer knows.
    stated: (value: WorkBuddySidebarCreditStyle): WorkBuddySidebarCreditStyle =>
      value === 'usage' ? 'usage' : 'remaining',
  },
  /**
   * Whether the sidebar keeps its credit card at all.
   *
   * The one preference here that REMOVES a surface instead of reshaping it:
   * `false` takes the card out of the sidebar's foot, which is where both the
   * resident credit summary and the way into the dashboard live. The dashboard
   * therefore stays reachable from the settings page while this is off — a
   * switch that stranded a destination would be a trap rather than a setting.
   */
  sidebarCreditVisible: {
    field: z.boolean().default(true)
      .description('Show the WorkBuddy credit card at the bottom of the sidebar (off: the dashboard stays reachable from this settings page)'),
    // `!== false` rather than a truthiness test: an untouched config field
    // resolves to the schema default, and a hand-edited settings.yaml missing
    // the key must still mean "present" — the opposite reading would empty the
    // sidebar of anyone whose file predates the field.
    stated: (value: boolean): boolean => value !== false,
  },
} as const

/** Every preference's config-field name. */
export type WorkBuddyPreferenceKey = keyof typeof WORKBUDDY_PREFERENCES

/** The config value one preference stores. */
export type WorkBuddyPreferenceValue<K extends WorkBuddyPreferenceKey> =
  Parameters<(typeof WORKBUDDY_PREFERENCES)[K]['stated']>[0]

/** The preference half of this plugin's config. */
export type WorkBuddyPreferenceConfig = {
  [K in WorkBuddyPreferenceKey]?: WorkBuddyPreferenceValue<K>
}

/** The preference half of a status document. */
export type WorkBuddyStatedPreferences = {
  [K in WorkBuddyPreferenceKey]?: ReturnType<(typeof WORKBUDDY_PREFERENCES)[K]['stated']>
}

/**
 * Project every stored preference onto what the status document states.
 *
 * A preference whose projection answers `undefined` is omitted rather than
 * written as `undefined`, which matters on a JSON wire and for the browser
 * half's `in`-style reads alike.
 *
 * @param config - the live config, already unwrapped from its volatile refs.
 */
export function statedPreferences(config: WorkBuddyPreferenceConfig): WorkBuddyStatedPreferences {
  const stated: WorkBuddyStatedPreferences = {}
  for (const key of Object.keys(WORKBUDDY_PREFERENCES) as WorkBuddyPreferenceKey[]) {
    const value = WORKBUDDY_PREFERENCES[key].stated(config[key] as never)
    if (value !== undefined) Object.assign(stated, { [key]: value })
  }
  return stated
}
